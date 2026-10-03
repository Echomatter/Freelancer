import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const request = (fixture, parameters = {}) => fetch(fixture.url + '/api/capabilities?' + new URLSearchParams(parameters), {
  headers: { 'X-Freelancer-Client': 'webpage' },
});

test('fresh workspace HTTP capability inventory uses the application scope without inventing a chat or agent', async t => {
  const f = await localDataFixture({ timers: false });
  t.after(() => f.close());
  await f.store.update('settings', settings => ({ ...settings, projects: [], lastProjectID: undefined }));
  const nativeCalls = [];
  f.host.request = async (route, options = {}) => {
    nativeCalls.push({ route, options });
    if (route === '/experimental/tool/ids') return ['read', 'edit', 'knowledge', 'docs_query'];
    if (route === '/agent') return [{ name: 'engineer', permission: { read: 'deny' } }];
    if (route === '/config') return { permission: { read: 'allow', edit: 'deny' },
      mcp: { docs: { type: 'remote', url: 'https://private-fixture.invalid/secret', headers: { token: 'private-fixture-token' } } } };
    if (route === '/skill') return [{ name: 'verify', location: 'native/skills/verify/SKILL.md' }];
    if (route === '/mcp') return { docs: { status: 'connected' } };
    if (route === '/command') return [];
    throw Error('Unexpected native request');
  };

  const response = await request(f);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.context, { projectID: null, sessionID: null, agent: null, model: null });
  assert.equal(result.probes.ids.state, 'observed');
  assert.equal(result.probes.skills.state, 'observed');
  assert.equal(result.probes.exposed.state, 'not-run');
  assert.equal(result.tools.find(row => row.id === 'read').nativePermission, 'allow');
  assert.equal(result.tools.find(row => row.id === 'edit').nativePermission, 'deny');
  assert.equal(result.tools.find(row => row.id === 'knowledge').discovered, true);
  assert.equal(result.tools.find(row => row.id === 'docs_query').discovered, true);
  assert.equal(result.skills.find(row => row.name === 'verify').discovered, true);
  assert.equal(result.mcp.find(row => row.name === 'docs').status, 'connected');
  assert.ok(result.tools.every(row => row.modelExposure === null && row.dependency === 'unverified'));
  assert.equal(nativeCalls.length, 6);
  assert.ok(nativeCalls.every(call => call.options.directory === f.root && !call.options.method && !call.options.body));
  assert.deepEqual((await f.store.read('settings')).projects, []);
  assert.equal(JSON.stringify(result).includes('private-fixture'), false, 'native config details are not returned');
});

test('HTTP capability inventory rejects unknown projects and a session without project before native inspection', async t => {
  const f = await localDataFixture({ timers: false });
  t.after(() => f.close());
  const nativeCalls = [];
  f.host.request = async route => { nativeCalls.push(route); throw Error('No native inspection should run'); };
  for (const [parameters, reason] of [
    [{ project: 'unknown_project' }, 'Choose a project'],
    [{ session: 'ses_history' }, 'Choose the project for this chat.'],
  ]) {
    const response = await request(f, parameters);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, reason);
  }
  assert.deepEqual(nativeCalls, []);
});

test('HTTP capability inventory retains native session ownership validation for a registered project', async t => {
  const f = await localDataFixture({ timers: false });
  t.after(() => f.close());
  f.state.sessions.find(row => row.id === 'ses_history').directory = path.join(f.root, 'foreign-project');
  const start = f.calls.length;
  const response = await request(f, { project: f.project.id, session: 'ses_history' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'This chat belongs to another project');
  assert.deepEqual(f.calls.slice(start).map(call => call.route), ['/session/ses_history']);
});
