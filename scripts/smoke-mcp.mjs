// Native MCP persistence/transport acceptance, no model inference or user auth.
// Every native/config/data path is disposable. Never use a live installation.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { startHost } from '../server/host.mjs';
import { FRESH_RUNTIME_ID, runtimeEnv } from '../server/runtime-config.mjs';
import { assertFreshRuntimeRoot, createLocalDataStore } from '../server/data/store.mjs';
import { nativeSmokeConfigPaths, seedNativeSmokeDependencies } from './native-smoke-fixture.mjs';
import { fileURLToPath } from 'node:url';
import { createMcpConnections } from '../server/mcp.mjs';
import { updateOpenCodeProjectModel } from '../server/opencode-project-config.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-mcp-smoke-'));
const backendRoot = path.join(root, 'backend');
const { xdgConfigHome, nativeConfig } = nativeSmokeConfigPaths(root);
const nativeHome = path.join(root, 'native-home'), nativeTemp = path.join(root, 'native-temp');
const config = { backendRoot, opencodePlugins: [], instructions: [], dataRoot: path.join(root, 'app-data'), runtimeID:FRESH_RUNTIME_ID };
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
const env = { ...inherited, ...runtimeEnv(config), OPENCODE_CONFIG_DIR: nativeConfig,
  XDG_CONFIG_HOME: xdgConfigHome, XDG_DATA_HOME: path.join(root, 'native-data'),
  XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
  OPENCODE_TEST_HOME: nativeHome, HOME: nativeHome, USERPROFILE: nativeHome,
  APPDATA: path.join(nativeHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(nativeHome, 'AppData', 'Local'),
  TEMP: nativeTemp, TMP: nativeTemp };
delete env.OPENCODE_CONFIG;
delete env.OPENCODE_CONFIG_CONTENT;
let host;
try {
  await Promise.all([backendRoot,xdgConfigHome,nativeConfig,nativeHome,nativeTemp,env.APPDATA,env.LOCALAPPDATA]
    .map(folder=>mkdir(folder,{recursive:true})));
  assertFreshRuntimeRoot(config.dataRoot,config.runtimeID);
  const initialData = createLocalDataStore(config.dataRoot);
  try { initialData.initializeFreshRuntime(config.runtimeID); }
  finally { initialData.close(); }
  await writeFile(path.join(nativeConfig, 'opencode.jsonc'), '{}');
  await seedNativeSmokeDependencies({fixtureRoot:root,appRoot:fileURLToPath(new URL('..',import.meta.url)),nativeConfig,projectDirectories:[backendRoot]});
  host = await startHost({ backendRoot, config, env, ...(process.env.FREELANCER_SMOKE_OPENCODE ? { executable: process.env.FREELANCER_SMOKE_OPENCODE } : {}) });
  const [providers, authMethods] = await Promise.all([
    host.request('/provider'),
    host.request('/provider/auth'),
  ]);
  assert.ok(Array.isArray(providers.all), 'native provider catalog must be readable');
  assert.ok(Array.isArray(providers.connected), 'native connected-provider state must be readable');
  assert.ok(authMethods && typeof authMethods === 'object' && !Array.isArray(authMethods), 'native provider auth methods must be readable');
  const project = path.join(root, 'native-project'); await mkdir(project);
  await seedNativeSmokeDependencies({fixtureRoot:root,appRoot:fileURLToPath(new URL('..',import.meta.url)),nativeConfig,projectDirectories:[project]});
  execFileSync('git', ['init', '--quiet', project], { stdio: 'ignore' });
  const nativeModelCatalog = await host.request('/config/providers', { directory: project });
  const modelChoice = (nativeModelCatalog.providers ?? []).flatMap(provider =>
    Object.keys(provider.models ?? {}).map(model => `${provider.id}/${model}`))[0];
  if (modelChoice) {
    const projectConfig = await updateOpenCodeProjectModel(project, modelChoice);
    await host.request('/instance/dispose', { method: 'POST', directory: project });
    const confirmed = await host.request('/config', { directory: project });
    assert.equal(confirmed.model, modelChoice, 'OpenCode must read its project model default from the native project config file');
    await projectConfig.rollback();
    const nested = path.join(root, 'nested-native-project'); await mkdir(nested);
    await seedNativeSmokeDependencies({fixtureRoot:root,appRoot:fileURLToPath(new URL('..',import.meta.url)),nativeConfig,projectDirectories:[nested]});
    execFileSync('git', ['init', '--quiet', nested], { stdio: 'ignore' });
    const nestedConfig = await updateOpenCodeProjectModel(nested, modelChoice);
    await host.request('/instance/dispose', { method: 'POST', directory: nested });
    assert.equal((await host.request('/config', { directory: nested })).model, modelChoice,
      'OpenCode must read its project model default from the .opencode config directory');
    await nestedConfig.rollback();
  }
  const connections = createMcpConnections({ host, backendRoot, changeConnections: async change => {
    await change(); await host.request('/global/dispose', { method: 'POST' });
  } });
  const first = await connections.read();
  assert.equal(first.state, 'observed');
  assert.equal(first.services.length, 0, 'smoke must start without user integrations');
  const command = [process.execPath, path.resolve(import.meta.dirname, '../tests/fixtures/mcp-stdio.mjs')];
  const saved = await connections.act({ action: 'add', name: 'smoke', config: { type: 'local', command, enabled: true }, expectedRevision: first.revision });
  assert.equal(saved.saved, true);
  assert.equal(saved.activation, undefined, 'native refresh must be confirmed');
  assert.equal(saved.services[0].status, 'connected');
  for (const name of ['project-one', 'project-two']) {
    const directory = path.join(root, name); await mkdir(directory);
    await seedNativeSmokeDependencies({fixtureRoot:root,appRoot:fileURLToPath(new URL('..',import.meta.url)),nativeConfig,projectDirectories:[directory]});
    const native = await host.request('/config', { directory });
    assert.deepEqual(native.mcp.smoke.command, command);
    assert.equal((await host.request('/mcp', { directory })).smoke.status, 'connected');
  }
  for (const [action, status] of [['disable', 'disabled'], ['enable', 'connected']]) {
    const result = await connections.act({ action, name: 'smoke', expectedRevision: (await connections.read()).revision });
    assert.equal(result.saved, true); assert.equal(result.services[0].status, status);
  }
  console.log(JSON.stringify({ proof:'native-mcp-persistence', opencodeConfigDir:nativeConfig, xdgConfigHome,
    verified:`Native provider inventory/auth, ${modelChoice ? 'project model readback from root and .opencode config files, ' : ''}MCP global save/readback, two-project inheritance, local stdio connection, disable and re-enable passed.`,
    oauth:false, externalServices:false, inference:false }));
} finally {
  if (host?.process && host.process.exitCode === null && host.process.signalCode === null) {
    await host.request('/global/dispose', { method: 'POST', signal:AbortSignal.timeout(5000) }).catch(() => {});
    const exited = once(host.process, 'exit'); host.stop();
    await exited;
  }
  const resolved = path.resolve(root), parent = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(parent) || !path.basename(resolved).startsWith('freelancer-mcp-smoke-')) throw Error('Unsafe temporary cleanup path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
