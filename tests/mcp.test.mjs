import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { mcpConfig, mcpName, capabilityStatus } from '../domain/mcp.mjs';
import { createMcpConnections } from '../server/mcp.mjs';
import { createCapabilities } from '../server/capabilities.mjs';
import { attachMcpHost } from './fixtures/mcp-host.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

function fixture(initial = {}) {
  const host = { request: async () => [] };
  const state = attachMcpHost(host, initial);
  const service = createMcpConnections({ host, backendRoot: '/app/backend', changeConnections: async change => {
    await change(); await host.request('/global/dispose', { method: 'POST' });
  } });
  const act = async input => service.act({ expectedRevision: (await service.read()).revision, ...input });
  return { host, state, service, act };
}
const remote = { type: 'remote', url: 'https://example.test/mcp', enabled: true };

test('MCP configuration is native connection data, not an identity access matrix', () => {
  assert.deepEqual(mcpConfig({ type: 'local', command: ['node', 'C:/tools/server.mjs'], environment: { MODE: 'development', TOKEN: '{env:TOKEN}' } }),
    { type: 'local', command: ['node', 'C:/tools/server.mjs'], environment: { MODE: 'development', TOKEN: '{env:TOKEN}' }, enabled: true });
  assert.deepEqual(mcpConfig({ ...remote, headers: { Authorization: '{env:MCP_AUTH}' }, oauth: false }),
    { ...remote, headers: { Authorization: '{env:MCP_AUTH}' }, oauth: false });
  for (const selector of ['agent', 'model', 'project', 'tools', 'allowedAgents'])
    assert.throws(() => mcpConfig({ ...remote, [selector]: 'x' }), /shared/);
  for (const name of ['', '../name', '__proto__', 'constructor', 'a/b']) assert.throws(() => mcpName(name));
  for (const config of [{ type: 'local', command: 'node server.mjs' }, { ...remote, url: 'javascript:alert(1)' },
    { ...remote, url: 'https://user:password@example.test' }, { ...remote, oauth: { clientSecret: 'secret' } }]) assert.throws(() => mcpConfig(config));
});

test('registered, exposed, permitted and usable are distinct observations', () => {
  const base = { discovered: true, modelExposure: true, configured: true, dependency: 'usable', nativePermission: 'allow' };
  for (const [changes, status] of [
    [{}, 'Available'], [{ nativePermission: 'unknown' }, 'Registered · permission unverified'], [{ dependency: 'unverified' }, 'Registered · use unverified'],
    [{ modelExposure: null }, 'Registered · use unverified'], [{ discovered: null }, 'Unknown'],
    [{ discovered: false }, 'Not registered'], [{ modelExposure: false }, 'Not exposed by this model'],
    [{ nativePermission: 'deny' }, 'Explicitly restricted'], [{ configured: false }, 'Explicitly restricted'],
    [{ nativePermission: 'ask' }, 'Permission required'], [{ nativePermission: 'conditional' }, 'Permission depends on operation'],
    [{ applicationAccess: 'blocked' }, 'Operation restricted'], [{ dependency: 'missing' }, 'Dependency unavailable'],
  ]) assert.equal(capabilityStatus({ ...base, ...changes }), status);
});

test('adding a shared service persists only native global configuration and reads it back', async () => {
  const f = fixture({ existing: { type: 'local', command: ['existing'], enabled: true } });
  assert.equal((await f.service.read()).scope, 'platform');
  const result = await f.act({ action: 'add', name: 'browser', config: remote });
  assert.equal(result.saved, true);
  assert.deepEqual(f.state.config.mcp.browser, remote);
  assert.ok(f.state.config.mcp.existing);
  assert.equal(result.services.find(row => row.name === 'browser').status, 'needs_auth');
  assert.equal(typeof result.services.find(row => row.name === 'browser').reason, 'string');
  const patch = f.state.calls.find(call => call.options.method === 'PATCH');
  assert.equal(patch.route, '/global/config');
  assert.equal(patch.options.directory, undefined, 'never saved to an active project');
  assert.deepEqual(Object.keys(patch.options.body), ['mcp']);
  assert.ok(f.state.calls.some(call => call.route === '/global/dispose'));
  assert.doesNotMatch(JSON.stringify(result), /example\.test|private-token|C:\\tools/);
});

test('enable, disable, retry, authentication and sign out use native lifecycle endpoints', async () => {
  const f = fixture({ browser: remote });
  await f.act({ action: 'disable', name: 'browser' });
  assert.equal((await f.service.read()).services[0].status, 'disabled');
  await f.act({ action: 'enable', name: 'browser' });
  assert.equal(f.state.config.mcp.browser.url, remote.url, 'enablement preserves native connection fields');
  assert.equal((await f.act({ action: 'authenticate', name: 'browser' })).services[0].status, 'connected');
  assert.equal((await f.act({ action: 'logout', name: 'browser' })).services[0].status, 'needs_auth');
  assert.equal((await f.act({ action: 'retry', name: 'browser' })).services[0].status, 'connected');
  assert.ok(f.state.calls.some(call => call.route === '/mcp/browser/auth/authenticate' && call.options.method === 'POST'));
  assert.ok(f.state.calls.some(call => call.route === '/mcp/browser/auth' && call.options.method === 'DELETE'));
  assert.ok(f.state.calls.some(call => call.route === '/mcp/browser/connect'));
});

test('stale revisions, duplicate names and unknown services never silently overwrite configuration', async () => {
  const f = fixture();
  const prior = await f.service.read();
  await f.act({ action: 'add', name: 'one', config: remote });
  await assert.rejects(f.service.act({ action: 'add', name: 'two', config: remote, expectedRevision: prior.revision }), error => error.status === 409);
  await assert.rejects(f.act({ action: 'add', name: 'one', config: remote }), error => error.status === 409);
  await assert.rejects(f.act({ action: 'disable', name: 'absent' }), error => error.status === 409);
  assert.deepEqual(Object.keys(f.state.config.mcp), ['one']);
});

test('failed reads, ignored native patches and refresh failures cannot claim activation', async () => {
  const f = fixture();
  f.state.fail = true;
  assert.equal((await f.service.read()).state, 'unavailable');
  f.state.fail = false; f.state.dropPatch = true;
  await assert.rejects(f.act({ action: 'add', name: 'unconfirmed', config: remote }), /not confirmed/);
  assert.equal(f.state.config.mcp.unconfirmed, undefined);
  f.state.dropPatch = false; f.state.disposeFails = true;
  const result = await f.act({ action: 'add', name: 'saved', config: remote });
  assert.equal(result.saved, true);
  assert.equal(result.activation, 'unverified');
  assert.match(result.notice, /Restart/);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('native secrets, raw launch commands and upstream errors do not escape diagnostics', async () => {
  const f = fixture({ private: { ...remote, url: 'https://secret.example/?key=secret', headers: { Authorization: 'secret-token' } } });
  const result = await f.service.read();
  assert.doesNotMatch(JSON.stringify(result), /secret-token|secret\.example|Authorization/);
  f.state.fail = true;
  await assert.rejects(f.service.act({ action: 'retry', name: 'private', expectedRevision: result.revision }),
    error => error.status === 503 && !error.message.includes('private-token'));
});

test('tool inventory retains MCP tools across every agent, model and project without a platform filter', async () => {
  const host = { request: async route => route === '/experimental/tool/ids' ? ['browser_navigate', 'native_custom']
    : route.startsWith('/experimental/tool?') ? [{ id: 'browser_navigate' }, { id: 'native_custom' }]
    : route === '/config' || route === '/mcp' ? {} : [] };
  for (const projectID of ['a', 'b']) for (const agent of ['engineer', 'designer', 'researcher', 'custom'])
    for (const model of ['provider/free', 'other/subscribed']) {
      const result = await createCapabilities({ host, backendRoot: '/fixture/no-manifest' }).read({ directory: `/projects/${projectID}`, projectID, agent, model });
      const tool = result.tools.find(row => row.id === 'browser_navigate');
      assert.equal(tool.discovered, true); assert.equal(tool.modelExposure, true); assert.equal(tool.applicationAccess, 'shared');
    }
});

test('HTTP MCP setup needs no project selection and remains shared when projects change', async t => {
  const f = await localDataFixture({ timers: false }); t.after(() => f.close());
  const native = attachMcpHost(f.host);
  const before = await f.api('mcp');
  const result = await f.api('mcp', { action: 'add', name: 'browser', config: remote, expectedRevision: before.revision });
  assert.equal(result.saved, true);
  const next = path.join(f.root, 'second-project'); await mkdir(next); await f.app.addProject(next);
  assert.deepEqual((await f.api('mcp')).services, result.services);
  assert.equal((await f.store.read('settings')).mcp, undefined, 'no second app-owned MCP store');
  assert.equal(native.calls.filter(call => call.options.method === 'PATCH').length, 1);
  const response = await fetch(`${f.url}/api/mcp`, { method: 'POST', headers: { 'X-Freelancer-Client': 'webpage', Origin: 'http://foreign.example' },
    body: JSON.stringify({ action: 'disable', name: 'browser', expectedRevision: result.revision }) });
  assert.equal(response.status, 403); assert.equal(native.config.mcp.browser.enabled, true);
  await assert.rejects(f.api('mcp', { action: 'disable', name: 'browser', project: f.project.id, expectedRevision: result.revision }), /platform-wide/);
});

test('changing connections cannot dispose running work or pending native decisions', async t => {
  const f = await localDataFixture({ timers: false }); t.after(() => f.close());
  const native = attachMcpHost(f.host, { browser: remote });
  const change = async () => f.api('mcp', { action: 'disable', name: 'browser', expectedRevision: (await f.api('mcp')).revision });
  f.state.status.ses_history = { type: 'busy' };
  await assert.rejects(change()); delete f.state.status.ses_history;
  for (const key of ['questions', 'permissions']) {
    f.state[key].push({ id: 'pending', sessionID: 'ses_history' });
    await assert.rejects(change(), /pending native decisions/); f.state[key] = [];
  }
  assert.equal(native.calls.some(call => call.options.method === 'PATCH' || call.route === '/global/dispose'), false);
  await change(); assert.equal(native.config.mcp.browser.enabled, false, 'no permanent lock after a refused reload');
});
