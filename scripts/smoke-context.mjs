// Isolated native configuration check. No provider credentials or inference.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { startHost } from '../server/host.mjs';
import { createStore } from '../server/store.mjs';
import { createContextSettings } from '../server/context-settings.mjs';
import { runtimeEnv } from '../server/runtime-config.mjs';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'freelancer-context-smoke-'));
const root = path.join(tempRoot, 'backend'), directory = path.join(tempRoot, 'project');
const config = { backendRoot: root, opencodeConfigDir: path.join(root, 'opencode'), xdgConfigHome: path.join(tempRoot, 'config'), xdgDataHome: path.join(tempRoot, 'data'), dataRoot: path.join(tempRoot, 'user-data') };
let host;
try {
  await mkdir(config.opencodeConfigDir, { recursive: true }); await mkdir(directory);
  const adapter = new URL('../backend/tools/runtime/context-settings.mjs', import.meta.url).href;
  await mkdir(path.join(config.opencodeConfigDir, 'plugins'));
  await writeFile(path.join(config.opencodeConfigDir, 'plugins/context.ts'), `export default async ({ directory }) => ({ config: async config => { const { configureContextSettings } = await import(${JSON.stringify(adapter)}); await configureContextSettings(config, ${JSON.stringify(root)}, directory); } });`);
  await writeFile(path.join(config.opencodeConfigDir, 'opencode.json'), JSON.stringify({ autoupdate: false, share: 'disabled', compaction: { auto: true, prune: true, reserved: 8192 } }));
  const store = createStore(root);
  const project = { id: 'context-smoke', name: 'Isolated context check', directory };
  await store.update('settings', s => ({ ...s, projects: [project] }));
  Object.assign(process.env, runtimeEnv(config));
  process.env.XDG_CACHE_HOME = path.join(tempRoot, 'cache');
  host = await startHost({ backendRoot: root, config });
  console.log('Isolated native host started; reading compaction configuration.');
  let locked = false;
  const service = createContextSettings({ store, host, project: async () => project, canRefresh: () => !locked, setRefreshing: value => { locked = value; } });
  assert.equal((await service.read(project.id)).autoCompact, true);
  console.log('Native default confirmed; changing only automatic compaction.');
  assert.equal((await service.save(project.id, { autoCompact: false })).autoCompact, false);
  let native = await host.request('/config', { directory });
  assert.equal(native.compaction.auto, false); assert.equal(native.compaction.prune, true); assert.equal(native.compaction.reserved, 8192);
  console.log('Native override confirmed; restarting the isolated host.');
  const stopped = once(host.process, 'exit'); host.stop(); await stopped;
  host = await startHost({ backendRoot: root, config });
  await host.request('/agent', { directory });
  native = await host.request('/config', { directory });
  assert.equal(native.compaction.auto, false);
  console.log('Native OpenCode confirmed compaction off, preserved pruning/reserve, and retained the preference after a real engine restart. No inference requested.');
} finally {
  if (host?.process && host.process.exitCode === null && host.process.signalCode === null) { const stopped = once(host.process, 'exit'); host.stop(); await stopped; }
  const resolved = path.resolve(tempRoot), parent = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(parent) || !path.basename(resolved).startsWith('freelancer-context-smoke-')) throw Error('Unsafe temporary cleanup path');
  await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
