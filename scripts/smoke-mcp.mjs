// Native MCP persistence/transport acceptance, no model inference or user auth.
// Every native/config/data path is disposable. Never use a live installation.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { startHost } from '../server/host.mjs';
import { runtimeEnv } from '../server/runtime-config.mjs';
import { createMcpConnections } from '../server/mcp.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-mcp-smoke-'));
const backendRoot = path.join(root, 'backend');
const config = { backendRoot, opencodeConfigDir: path.join(backendRoot, 'opencode'),
  xdgConfigHome: path.join(root, 'config'), xdgDataHome: path.join(root, 'native-data'), dataRoot: path.join(root, 'app-data') };
let host;
try {
  await mkdir(config.opencodeConfigDir, { recursive: true });
  await writeFile(path.join(config.opencodeConfigDir, 'opencode.jsonc'), '{}');
  Object.assign(process.env, runtimeEnv(config), { XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state') });
  host = await startHost({ backendRoot, config, ...(process.env.FREELANCER_SMOKE_OPENCODE ? { executable: process.env.FREELANCER_SMOKE_OPENCODE } : {}) });
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
    const native = await host.request('/config', { directory });
    assert.deepEqual(native.mcp.smoke.command, command);
    assert.equal((await host.request('/mcp', { directory })).smoke.status, 'connected');
  }
  for (const [action, status] of [['disable', 'disabled'], ['enable', 'connected']]) {
    const result = await connections.act({ action, name: 'smoke', expectedRevision: (await connections.read()).revision });
    assert.equal(result.saved, true); assert.equal(result.services[0].status, status);
  }
  console.log('Native MCP global save/readback, two-project inheritance, local stdio connection, disable and re-enable passed. No OAuth credentials, external services or model inference used.');
} finally {
  if (host) {
    await host.request('/global/dispose', { method: 'POST' }).catch(() => {});
    const exited = once(host.process, 'exit'); host.stop();
    await Promise.race([exited, new Promise(resolve => { const timer = setTimeout(resolve, 3000); timer.unref(); })]);
  }
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
