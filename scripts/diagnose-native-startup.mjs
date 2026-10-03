// Disposable startup diagnostics. No model inference or user configuration changes.
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { startHost } from '../server/host.mjs';
import { resolveRuntimeConfig, runtimeEnv } from '../server/runtime-config.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { withUnifiedDatabase } from '../backend/tools/runtime/unified-database.mjs';
import { seedNativeSmokeDependencies } from './native-smoke-fixture.mjs';

export function parseDiagnosticOptions(args) {
  const options = { seedDependencies: false, nativeOnly: false, emptyPlugin: false, requestTimeoutMs: 45_000 };
  let timeoutProvided = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--seed-dependencies') options.seedDependencies = true;
    else if (argument === '--native-only') options.nativeOnly = true;
    else if (argument === '--empty-plugin') options.emptyPlugin = true;
    else if (argument === '--request-timeout-ms' || argument.startsWith('--request-timeout-ms=')) {
      if (timeoutProvided) throw Error('--request-timeout-ms may only be supplied once.');
      timeoutProvided = true;
      const value = argument === '--request-timeout-ms' ? args[++index] : argument.slice('--request-timeout-ms='.length);
      if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))
        || Number(value) < 1 || Number(value) > 300_000)
        throw Error('--request-timeout-ms must be an integer from 1 to 300000.');
      options.requestTimeoutMs = Number(value);
    } else throw Error(`Unknown diagnostic option: ${argument}`);
  }
  if (options.nativeOnly && options.emptyPlugin) throw Error('--native-only and --empty-plugin are mutually exclusive controls.');
  return options;
}

export function diagnosticFixture({ root, baseConfig, parentEnv, options, marker }) {
  const backendRoot = path.join(root, 'backend');
  const directory = path.join(root, 'project');
  const nativeConfig = path.join(root, 'native-config');
  const nativeHome = path.join(root, 'native-home');
  const nativeTemp = path.join(root, 'native-temp');
  const emptyPluginPath = path.join(root, 'empty-plugin.ts');
  // Keep source plugin/instruction paths, but never launch an installer in the source backend.
  const config = { ...baseConfig, dataRoot: path.join(root, 'data'), opencodeConfigDir: nativeConfig };
  if (options.nativeOnly || options.emptyPlugin) {
    config.opencodePlugins = [];
    config.instructions = [];
  }
  // Home, AppData and temporary directories must not survive from the calling user.
  const inherited = Object.fromEntries(Object.entries(parentEnv).filter(([name]) =>
    /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|PROGRAMFILES(?:\(X86\))?|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(name)));
  const env = { ...inherited, ...runtimeEnv(config), OPENCODE_CONFIG_DIR: nativeConfig,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(options.emptyPlugin ? { plugin: [pathToFileURL(emptyPluginPath).href] } : {}),
    XDG_CONFIG_HOME: nativeConfig, XDG_DATA_HOME: path.join(root, 'native-data'),
    XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
    OPENCODE_TEST_HOME: nativeHome, HOME: nativeHome, USERPROFILE: nativeHome,
    APPDATA: path.join(nativeHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(nativeHome, 'AppData', 'Local'),
    TEMP: nativeTemp, TMP: nativeTemp };
  const folders = [...new Set([backendRoot, directory, config.dataRoot, nativeConfig, nativeHome, nativeTemp,
    env.APPDATA, env.LOCALAPPDATA, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.XDG_STATE_HOME])];
  // An import-free marker proves this particular control initialized, rather than just being configured.
  const emptyPluginSource = `export default async () => { console.log(${JSON.stringify(marker)}); return {}; };\n`;
  return { config, backendRoot, directory, nativeConfig, emptyPluginPath, emptyPluginSource, env, folders };
}

function observeClose(child) {
  const observation = { closed: false, promise: null, detach: null };
  const listener = () => { observation.closed = true; resolveClose(); };
  let resolveClose;
  observation.promise = new Promise(resolve => { resolveClose = resolve; });
  child.once('close', listener);
  observation.detach = () => child.off('close', listener);
  return observation;
}

async function waitForClose(observation, timeoutMs) {
  if (observation.closed) return true;
  let timer;
  try {
    await Promise.race([observation.promise, new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]);
    return observation.closed;
  } finally { clearTimeout(timer); }
}

async function stopOwnedHost(host, observation, { graceMs, forceMs }) {
  if (observation.closed) return { confirmed: true, forced: false, reason: 'child-closed' };
  let stopError;
  try { host.stop(); } catch (error) { stopError = error.name; }
  if (await waitForClose(observation, graceMs)) return { confirmed: true, forced: false, reason: 'child-closed', ...(stopError ? { stopError } : {}) };
  let forced = false;
  // Only this invocation's returned ChildProcess is eligible for force. An exit event
  // does not prove stdio closed, so cleanup still waits for the actual close event.
  if (host.process.exitCode === null && host.process.signalCode === null) {
    try { forced = host.process.kill('SIGKILL'); } catch (error) { stopError = error.name; }
  }
  const confirmed = await waitForClose(observation, forceMs);
  observation.detach();
  return { confirmed, forced, reason: confirmed ? 'child-closed' : 'child-close-unconfirmed', ...(stopError ? { stopError } : {}) };
}

function assertDisposableRoot(root, temporaryRoot) {
  const resolved = path.resolve(root), temporary = path.resolve(temporaryRoot) + path.sep;
  if (!resolved.toLowerCase().startsWith(temporary.toLowerCase())
    || !path.basename(resolved).startsWith('freelancer-native-diagnostic-'))
    throw Error('Diagnostic cleanup target is outside its disposable directory.');
  return resolved;
}

function initializeRuntime(config) {
  const store = createLocalDataStore(config.dataRoot);
  try { store.initializeFreshRuntime(config.runtimeID); } finally { store.close(); }
}

function readDrivers(config) {
  return withUnifiedDatabase({ dataHome: config.dataRoot, runtimeID: config.runtimeID }, false, (db, runtimeID) =>
    db.prepare("SELECT data FROM operational_records WHERE runtime_id=? AND collection='storage-drivers' ORDER BY id")
      .all(runtimeID).map(row => JSON.parse(row.data)));
}

export async function runNativeStartupDiagnostic(options, {
  baseConfig = resolveRuntimeConfig(), parentEnv = process.env, startHostImpl = startHost,
  initializeRuntimeImpl = initializeRuntime, readDriversImpl = readDrivers,
  seedDependenciesImpl = seedNativeSmokeDependencies, output = value => console.log(JSON.stringify(value)),
  stopGraceMs = 5000, stopForceMs = 5000,
} = {}) {
  const temporaryRoot = os.tmpdir();
  const root = await mkdtemp(path.join(temporaryRoot, 'freelancer-native-diagnostic-'));
  const logfile = path.join(temporaryRoot, `freelancer-native-diagnostic-${randomUUID()}.jsonl`);
  const marker = `FREELANCER_EMPTY_PLUGIN_INITIALIZED:${randomUUID()}`;
  const fixture = diagnosticFixture({ root, baseConfig, parentEnv, options, marker });
  const { config, backendRoot, directory, nativeConfig, env } = fixture;
  let host, closeObservation, failure = null, requestStage = 'initialization', agentRequestDurationMs = null;
  let emptyPluginInitialized = false, markerOutput = '';
  const events = [];
  const report = value => { appendFileSync(logfile, JSON.stringify(value) + '\n'); output(value); };
  const diagnostics = event => {
    events.push(event);
    appendFileSync(logfile, JSON.stringify(event) + '\n');
    if (options.emptyPlugin && event.stage === 'output' && typeof event.text === 'string') {
      markerOutput = (markerOutput + event.text).slice(-16_384);
      if (!emptyPluginInitialized && markerOutput.includes(marker)) {
        emptyPluginInitialized = true;
        report({ stage: 'empty-plugin-initialized', marker });
      }
    }
  };
  let stop = { confirmed: true, forced: false, reason: 'not-started' }, cleanup = 'preserved';
  try {
    report({ log: logfile, fixtureRoot: root, seedDependencies: options.seedDependencies,
      nativeOnly: options.nativeOnly, emptyPlugin: options.emptyPlugin, requestTimeoutMs: options.requestTimeoutMs,
      toolsRequestTimeoutMs: 10_000, nativeWorkingDirectory: backendRoot, sourceBackendRoot: config.backendRoot });
    await Promise.all(fixture.folders.map(folder => mkdir(folder, { recursive: true })));
    await writeFile(path.join(nativeConfig, 'opencode.jsonc'), '{"autoupdate":false,"share":"disabled"}');
    if (options.emptyPlugin) await writeFile(fixture.emptyPluginPath, fixture.emptyPluginSource);
    if (options.seedDependencies) await seedDependenciesImpl({ fixtureRoot: root, appRoot: config.appRoot,
      nativeConfig, projectDirectories: [backendRoot, directory] });
    await initializeRuntimeImpl(config);
    requestStage = 'launch';
    host = await startHostImpl({ backendRoot, config, env, diagnostics,
      ...(parentEnv.FREELANCER_SMOKE_OPENCODE ? { executable: parentEnv.FREELANCER_SMOKE_OPENCODE } : {}) });
    closeObservation = observeClose(host.process);
    requestStage = 'agent';
    const requestedAt = Date.now();
    let agents;
    try { agents = await host.request('/agent', { directory, signal: AbortSignal.timeout(options.requestTimeoutMs) }); }
    finally { agentRequestDurationMs = Date.now() - requestedAt; }
    report({ stage: 'agent-ready', agents: agents.length, requestTimeoutMs: options.requestTimeoutMs, durationMs: agentRequestDurationMs });
    if (options.emptyPlugin && !emptyPluginInitialized)
      throw Error('Empty plugin initialization marker was not observed; the control is unconfirmed.');
    requestStage = 'tools';
    const tools = await host.request('/experimental/tool/ids', { directory, signal: AbortSignal.timeout(10_000) });
    report({ stage: 'tools-ready', tools });
    requestStage = 'drivers';
    report({ stage: 'storage-drivers', drivers: await readDriversImpl(config) });
  } catch (error) {
    failure = { stage: 'failed', requestStage, error: error.name, message: error.message,
      requestTimeoutMs: options.requestTimeoutMs, agentRequestDurationMs };
    report(failure);
  } finally {
    if (host) stop = await stopOwnedHost(host, closeObservation, { graceMs: stopGraceMs, forceMs: stopForceMs });
    else if (events.some(event => event.stage === 'spawned' && Number.isInteger(event.pid) && event.pid > 0))
      stop = { confirmed: false, forced: false, reason: 'start-failed-without-child-handle' };
    const dependencies = await Promise.all([nativeConfig, path.join(nativeConfig, 'opencode'),
      path.join(backendRoot, '.opencode'), path.join(directory, '.opencode')].map(async destination => {
      const pkg = await readFile(path.join(destination, 'package.json'), 'utf8').then(JSON.parse).catch(() => null);
      const lock = await readFile(path.join(destination, 'package-lock.json'), 'utf8').then(JSON.parse).catch(() => null);
      const modules = await readdir(path.join(destination, 'node_modules')).catch(() => null);
      return { directory: path.relative(root, destination), declared: pkg ? Object.keys(pkg.dependencies ?? {}) : null,
        locked: lock ? Object.keys(lock.packages?.['']?.dependencies ?? {}) : null, moduleEntries: modules?.length ?? null };
    }));
    report({ stage: 'dependency-files', dependencies });
    if (stop.confirmed) {
      try {
        await rm(assertDisposableRoot(root, temporaryRoot), { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
        cleanup = 'removed';
      } catch (error) {
        failure ??= { stage: 'failed', requestStage: 'cleanup', error: error.name, message: error.message };
        report(failure);
      }
    }
  }
  const nativeLines = events.filter(event => event.stage === 'output' && typeof event.text === 'string')
    .flatMap(event => event.text.split(/\r?\n/)).filter(Boolean);
  const result = { log: logfile, fixtureRoot: root, success: failure === null && stop.confirmed && cleanup === 'removed',
    requestTimeoutMs: options.requestTimeoutMs, agentRequestDurationMs,
    emptyPluginInitialized: options.emptyPlugin ? emptyPluginInitialized : null,
    stop, cleanup, fixturePreserved: cleanup !== 'removed',
    stages: events.filter(event => event.stage !== 'output'), lastNativeLines: nativeLines.slice(-8) };
  report(result);
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runNativeStartupDiagnostic(parseDiagnosticOptions(process.argv.slice(2)));
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ stage: 'failed', error: error.name, message: error.message }));
    process.exitCode = 1;
  }
}
