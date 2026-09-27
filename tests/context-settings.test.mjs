import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { createContextSettings } from '../server/context-settings.mjs';
import { configureContextSettings, applyContextSettings } from '../backend/tools/runtime/context-settings.mjs';

test('native compaction preference persists through a fresh config hook and preserves other options', async t => {
  const f = await localDataFixture(); t.after(() => f.close());
  assert.equal((await f.api(`context-settings?project=${f.project.id}`)).autoCompact, true);
  assert.deepEqual(await f.api('context-settings', { project: f.project.id, autoCompact: false }, 'PUT'), { saved: true, autoCompact: false });
  assert.equal((await f.api(`context-settings?project=${f.project.id}`)).autoCompact, false);
  const native = { compaction: { auto: true, prune: true, reserved: 8192 }, permission: { edit: 'ask' } };
  await configureContextSettings(native, f.root, f.directory);
  assert.deepEqual(native, { compaction: { auto: false, prune: true, reserved: 8192 }, permission: { edit: 'ask' } });
  assert.equal((await f.store.read('settings')).github.preserved, true);
  assert.equal(applyContextSettings({ compaction: { auto: true } }, await f.store.read('settings'), f.root).compaction.auto, true);
  await f.api('context-settings', { project: f.project.id, autoCompact: true }, 'PUT');
  assert.equal((await f.api(`context-settings?project=${f.project.id}`)).autoCompact, true);
});
test('busy, retrying, pending approvals and invalid values never mutate or dispose the native instance', async t => {
  const f = await localDataFixture(); t.after(() => f.close());
  const original = await f.store.read('settings');
  for (const status of ['busy', 'retry', 'unknown']) {
    f.state.status.ses_history = { type: status };
    await assert.rejects(f.api('context-settings', { project: f.project.id, autoCompact: false }, 'PUT'), /running chats/);
  }
  f.state.status = {};
  for (const field of ['questions', 'permissions']) {
    f.state[field] = [{ id: 'pending' }];
    await assert.rejects(f.api('context-settings', { project: f.project.id, autoCompact: false }, 'PUT'), /pending decisions/);
    f.state[field] = [];
  }
  await assert.rejects(f.api('context-settings', { project: f.project.id, autoCompact: 'false' }, 'PUT'), /on or off/);
  assert.deepEqual(await f.store.read('settings'), original);
  assert.equal(f.calls.filter(c => c.route === '/instance/dispose').length, 0);
});
test('failed native confirmation restores the previous preference and releases the setup lock', async t => {
  const f = await localDataFixture(); t.after(() => f.close());
  let locked = false, disposing = 0;
  const service = createContextSettings({ store: f.store, project: async () => f.project,
    canRefresh: () => !locked, setRefreshing: value => { locked = value; },
    host: { request: async route => {
      if (route === '/instance/dispose') { disposing++; return true; }
      if (route === '/config') return { compaction: { auto: true } };
      if (route === '/session/status') return {};
      return [];
    } },
  });
  await assert.rejects(service.save(f.project.id, { autoCompact: false }), /previous preference was restored/);
  assert.equal((await f.store.read('settings')).contextSettings[f.project.id], undefined);
  assert.equal(locked, false); assert.equal(disposing, 2);
  locked = true;
  await assert.rejects(service.save(f.project.id, { autoCompact: false }), /current setup/);
  assert.equal(disposing, 2);
});
