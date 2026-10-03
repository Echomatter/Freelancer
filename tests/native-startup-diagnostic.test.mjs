import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { access, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDiagnosticOptions, diagnosticFixture, runNativeStartupDiagnostic } from '../scripts/diagnose-native-startup.mjs';
import { hostEnvironment } from '../server/host.mjs';
import { buildRuntimeConfig } from '../server/runtime-config.mjs';

const baseConfig = buildRuntimeConfig(path.resolve('fixture-source'));
const parentEnv = { PATH: 'installed-native-path', APPDATA: 'private-native-roaming', LOCALAPPDATA: 'private-native-local',
  HOME: 'private-home', home: 'private-lowercase-home', USERPROFILE: 'private-profile', TEMP: 'private-temp', tmp: 'private-tmp',
  OPENCODE_CONFIG_CONTENT: '{"plugin":["private-plugin"]}', TYPESAFE_API_KEY: 'private-key', OPENAI_API_KEY: 'private-provider-key' };

function childProcess() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 12345, exitCode: null, signalCode: null });
  child.finish = () => { child.exitCode = 0; child.emit('exit', 0, null); child.emit('close', 0, null); };
  child.kill = () => { queueMicrotask(child.finish); return true; };
  return child;
}

function fakeHost(child, options = {}) {
  return { process: child, request: options.request ?? (async route => route === '/agent' ? [{ name: 'native' }] : []),
    stop: options.stop ?? (() => queueMicrotask(child.finish)) };
}

async function removeFixture(root) {
  const resolved = path.resolve(root), temporary = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(resolved.toLowerCase().startsWith(temporary.toLowerCase()));
  assert.ok(path.basename(resolved).startsWith('freelancer-native-diagnostic-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}

async function runFixture(t, flags, overrides = {}) {
  const reports = [], { output: additionalOutput, ...dependencies } = overrides;
  t.after(async () => {
    const initial = reports.find(row => row.fixtureRoot);
    if (!initial) return;
    await removeFixture(initial.fixtureRoot);
    assert.ok(path.basename(initial.log).startsWith('freelancer-native-diagnostic-'));
    assert.equal(path.dirname(initial.log).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    await rm(initial.log, { force: true });
  });
  const result = await runNativeStartupDiagnostic(parseDiagnosticOptions(flags), {
    baseConfig, parentEnv, initializeRuntimeImpl: async () => {}, readDriversImpl: async () => [],
    seedDependenciesImpl: async () => { throw Error('Unexpected dependency seeding.'); },
    startHostImpl: async () => fakeHost(childProcess()),
    output: value => { reports.push(value); additionalOutput?.(value); }, ...dependencies,
  });
  return { result, reports };
}

test('diagnostic CLI validates native controls and the explicitly bounded request window', () => {
  assert.deepEqual(parseDiagnosticOptions([]), { seedDependencies: false, nativeOnly: false, emptyPlugin: false, requestTimeoutMs: 45_000 });
  assert.equal(parseDiagnosticOptions(['--empty-plugin', '--request-timeout-ms', '300000']).requestTimeoutMs, 300_000);
  assert.equal(parseDiagnosticOptions(['--native-only', '--seed-dependencies', '--request-timeout-ms=120000']).requestTimeoutMs, 120_000);
  assert.throws(() => parseDiagnosticOptions(['--native-only', '--empty-plugin']), /mutually exclusive/);
  for (const value of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '300001', '9007199254740993'])
    assert.throws(() => parseDiagnosticOptions([`--request-timeout-ms=${value}`]), /integer from 1 to 300000/);
  assert.throws(() => parseDiagnosticOptions(['--request-timeout-ms']), /integer from 1 to 300000/);
  assert.throws(() => parseDiagnosticOptions(['--request-timeout-ms', '--empty-plugin']), /integer from 1 to 300000/);
  assert.throws(() => parseDiagnosticOptions(['--request-timeout-ms=1', '--request-timeout-ms=2']), /only.*once/);
  assert.throws(() => parseDiagnosticOptions(['--unknown']), /Unknown diagnostic option/);
});

test('diagnostic control modes use exact native file URLs and fully disposable home paths', () => {
  const root = path.join(os.tmpdir(), 'freelancer-native-diagnostic-unit space-λ');
  for (const flags of [[], ['--native-only'], ['--empty-plugin']]) {
    const options = parseDiagnosticOptions(flags);
    const fixture = diagnosticFixture({ root, baseConfig, parentEnv, options, marker: 'fixture-initialized' });
    assert.equal(fixture.config.backendRoot, baseConfig.backendRoot);
    assert.equal(fixture.backendRoot, path.join(root, 'backend'));
    assert.equal(fixture.config.opencodeConfigDir, path.join(root, 'native-config'));
    assert.equal(fixture.env.PATH, parentEnv.PATH);
    for (const name of ['OPENCODE_TEST_HOME', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP',
      'OPENCODE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'FREELANCER_DATA_HOME']) {
      const relative = path.relative(root, fixture.env[name]);
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), name);
    }
    assert.equal(fixture.env.HOME, fixture.env.USERPROFILE);
    assert.equal(fixture.env.HOME, fixture.env.OPENCODE_TEST_HOME);
    assert.equal(fixture.env.TEMP, fixture.env.TMP);
    assert.equal(fixture.env.home, undefined);
    assert.equal(fixture.env.tmp, undefined);
    assert.doesNotMatch(JSON.stringify(fixture.env), /private-/);
    const overlay = JSON.parse(hostEnvironment(fixture.config, fixture.env).OPENCODE_CONFIG_CONTENT);
    if (options.emptyPlugin) {
      assert.deepEqual(fixture.config.opencodePlugins, []);
      assert.deepEqual(overlay.plugin, [pathToFileURL(fixture.emptyPluginPath).href]);
      assert.deepEqual(overlay.instructions, []);
      assert.doesNotMatch(fixture.emptyPluginSource, /\bimport\b/);
    } else if (options.nativeOnly) {
      assert.deepEqual(overlay.plugin, []);
      assert.deepEqual(overlay.instructions, []);
    } else {
      assert.equal(overlay.plugin.length, 5);
      assert.ok(overlay.plugin.every(url => fileURLToPath(url).startsWith(baseConfig.backendRoot + path.sep)));
      assert.equal(overlay.instructions.length, 2);
    }
  }
});

test('diagnostic empty control observes its initialization marker and seeds only owned launch folders', async t => {
  let seedArguments, launchArguments;
  const { result, reports } = await runFixture(t, ['--empty-plugin', '--seed-dependencies', '--request-timeout-ms=120000'], {
    seedDependenciesImpl: async args => { seedArguments = args; },
    startHostImpl: async args => {
      launchArguments = args;
      for (const folder of [args.backendRoot, args.env.HOME, args.env.APPDATA, args.env.LOCALAPPDATA, args.env.TEMP,
        args.env.XDG_DATA_HOME, args.env.XDG_STATE_HOME, args.env.XDG_CACHE_HOME]) assert.ok((await stat(folder)).isDirectory());
      const overlay = JSON.parse(hostEnvironment(args.config, args.env).OPENCODE_CONFIG_CONTENT);
      assert.equal(overlay.plugin.length, 1);
      const source = await readFile(fileURLToPath(overlay.plugin[0]), 'utf8');
      const marker = JSON.parse(source.match(/console\.log\(("[^"]+")\)/)[1]);
      args.diagnostics({ stage: 'output', text: marker.slice(0, 19) });
      args.diagnostics({ stage: 'output', text: marker.slice(19) + '\n' });
      return fakeHost(childProcess());
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.emptyPluginInitialized, true);
  assert.equal(result.requestTimeoutMs, 120_000);
  assert.ok(reports.some(row => row.stage === 'empty-plugin-initialized'));
  assert.equal(launchArguments.backendRoot, path.join(result.fixtureRoot, 'backend'));
  assert.equal(launchArguments.config.backendRoot, baseConfig.backendRoot);
  assert.deepEqual(seedArguments.projectDirectories, [launchArguments.backendRoot, path.join(result.fixtureRoot, 'project')]);
  assert.ok(reports.find(row => row.stage === 'dependency-files').dependencies.some(row => row.directory === path.join('backend', '.opencode')));
  await assert.rejects(access(result.fixtureRoot), { code: 'ENOENT' });
  const log = (await readFile(result.log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(log[0].requestTimeoutMs, 120_000);
  assert.equal(log.at(-1).stop.confirmed, true);
});

test('diagnostic empty control cannot report success from a configured but unobserved plugin', async t => {
  const { result, reports } = await runFixture(t, ['--empty-plugin']);
  assert.equal(result.success, false);
  assert.equal(result.emptyPluginInitialized, false);
  assert.match(reports.find(row => row.stage === 'failed').message, /marker.*not observed/);
  assert.equal(result.stop.confirmed, true);
  assert.equal(result.cleanup, 'removed');
});

test('diagnostic reports the actual agent timeout while preserving its 45000ms default', async t => {
  const keepAlive = setInterval(() => {}, 1000);
  t.after(() => clearInterval(keepAlive));
  let observedReason;
  const { result, reports } = await runFixture(t, ['--native-only', '--request-timeout-ms=20'], {
    startHostImpl: async () => fakeHost(childProcess(), { request: async (route, { signal }) => {
      assert.equal(route, '/agent');
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
        observedReason = signal.reason; reject(signal.reason);
      }, { once: true }));
    } }),
  });
  assert.equal(result.success, false);
  assert.equal(result.requestTimeoutMs, 20);
  assert.equal(observedReason.name, 'TimeoutError');
  assert.ok(result.agentRequestDurationMs >= 10);
  const failure = reports.find(row => row.stage === 'failed');
  assert.equal(failure.requestStage, 'agent');
  assert.equal(failure.requestTimeoutMs, 20);
  assert.equal(failure.agentRequestDurationMs, result.agentRequestDurationMs);
  assert.equal(parseDiagnosticOptions([]).requestTimeoutMs, 45_000);
});

test('diagnostic waits for child close rather than deleting its fixture at exit', async t => {
  const child = childProcess();
  let stopped;
  const stopping = new Promise(resolve => { stopped = resolve; });
  let fixtureRoot, settled = false;
  const pending = runFixture(t, ['--native-only'], {
    output: value => { if (value.fixtureRoot) fixtureRoot = value.fixtureRoot; },
    startHostImpl: async () => fakeHost(child, { stop: () => { child.exitCode = 0; child.emit('exit', 0, null); stopped(); } }),
  }).then(value => { settled = true; return value; });
  await stopping;
  assert.equal(settled, false);
  assert.ok((await stat(fixtureRoot)).isDirectory());
  await writeFile(path.join(fixtureRoot, 'stdout-still-closing'), 'retained until close');
  child.emit('close', 0, null);
  const { result } = await pending;
  assert.equal(result.stop.confirmed, true);
  assert.equal(result.cleanup, 'removed');
  await assert.rejects(access(fixtureRoot), { code: 'ENOENT' });
});

test('diagnostic force targets only its returned live child and still awaits close', async t => {
  const child = childProcess(), signals = [];
  child.kill = signal => { signals.push(signal); queueMicrotask(child.finish); return true; };
  const { result } = await runFixture(t, ['--native-only'], {
    stopGraceMs: 5, stopForceMs: 100,
    startHostImpl: async () => fakeHost(child, { stop: () => {} }),
  });
  assert.deepEqual(signals, ['SIGKILL']);
  assert.equal(result.stop.forced, true);
  assert.equal(result.stop.confirmed, true);
  assert.equal(result.success, true);
});

test('diagnostic preserves fixture and report when an exited child has not closed', async t => {
  const child = childProcess(), signals = [];
  child.kill = signal => { signals.push(signal); return false; };
  const { result } = await runFixture(t, ['--native-only'], {
    stopGraceMs: 5, stopForceMs: 5,
    startHostImpl: async () => fakeHost(child, { stop: () => { child.exitCode = 0; child.emit('exit', 0, null); } }),
  });
  assert.equal(result.success, false);
  assert.equal(result.stop.confirmed, false);
  assert.equal(result.stop.reason, 'child-close-unconfirmed');
  assert.equal(result.fixturePreserved, true);
  assert.deepEqual(signals, [], 'An exit receipt cannot authorize forcing an unrelated replacement PID.');
  assert.ok((await stat(result.fixtureRoot)).isDirectory());
  assert.equal(JSON.parse((await readFile(result.log, 'utf8')).trim().split('\n').at(-1)).fixturePreserved, true);
});

test('diagnostic preserves unknown startup children but cleans a pre-spawn failure', async t => {
  const unknown = await runFixture(t, ['--native-only'], { startHostImpl: async ({ diagnostics }) => {
    diagnostics({ stage: 'spawned', pid: 23456 });
    diagnostics({ stage: 'exited', code: 1, signal: null });
    throw Error('Startup failed without a returned child handle.');
  } });
  assert.equal(unknown.result.success, false);
  assert.equal(unknown.result.stop.reason, 'start-failed-without-child-handle');
  assert.equal(unknown.result.stop.forced, false);
  assert.equal(unknown.result.fixturePreserved, true);
  assert.ok((await stat(unknown.result.fixtureRoot)).isDirectory());
  const unstarted = await runFixture(t, ['--native-only'], { startHostImpl: async () => { throw Error('Native executable unavailable.'); } });
  assert.equal(unstarted.result.success, false);
  assert.equal(unstarted.result.stop.confirmed, true);
  assert.equal(unstarted.result.stop.reason, 'not-started');
  assert.equal(unstarted.result.cleanup, 'removed');
});
