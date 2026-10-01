import { withRecordDatabase } from '../backend/tools/runtime/record-database.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSender } from '../server/sender.mjs';
import { userInitiatedRequest } from '../domain/sender.mjs';
import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function fixture() {
  const state = { messages: [], status: { chat: { type: 'busy' } }, permissions: [], questions: [], receipts: [] };
  const records = {};
  let settings = {};
  const sent = [];
  let stops = 0;
  const app = {
    store: {
      read: async kind => kind === 'requests' ? { records } : { chatChoices: settings },
      update: async (_kind, change) => { const result = change({ chatChoices: settings }); settings = result.chatChoices || {}; },
    },
    chat: async () => state,
    bootstrap: async () => ({ models: [{ id: 'opencode/free', provider: 'opencode', costClass: 'free' }],
      providers: { connected: ['opencode'] }, sessions: [{ id: 'chat' }] }),
    send: async (_project, _session, input) => {
      const id = `native_${sent.length}`;
      records[id] = { id, projectID: 'project', sessionID: 'chat' };
      state.messages.push({ info: { id, role: 'user', time: { created: Date.now() } }, parts: [{ type: 'text', text: input.text }] });
      state.status = { chat: { type: 'busy' } };
      sent.push(input.text);
    },
    stop: async () => { stops++; state.status = {}; },
  };
  const sender = createSender(app);
  const queue = (id, text) => sender.enqueue('project', 'chat', {
    id, kind: 'queue', text, model: 'opencode/free', agentID: 'engineer',
  });
  return { sender, state, sent, queue, app, get stops() { return stops; } };
}

test('queued messages wait for native completion and dispatch once in FIFO order', async () => {
  const f = fixture();
  await f.queue('queue_first_0001', 'First follow-up');
  await f.queue('queue_second_0002', 'Second follow-up');
  await f.sender.tick();
  assert.deepEqual(f.sent, []);
  f.state.status = {};
  await f.sender.tick();
  assert.deepEqual(f.sent.map(text => userInitiatedRequest(text)?.text), ['First follow-up']);
  await f.sender.tick();
  assert.deepEqual(f.sent.map(text => userInitiatedRequest(text)?.text), ['First follow-up']);
  f.state.messages.push({ info: { id: 'reply', role: 'assistant', parentID: 'native_0',
    finish: 'stop', time: { completed: Date.now() } }, parts: [{ type: 'text', text: 'Done' }] });
  f.state.status = {};
  await f.sender.tick();
  assert.deepEqual(f.sent.map(text => userInitiatedRequest(text)?.text), ['First follow-up', 'Second follow-up']);
  await f.sender.close();
});

test('interrupt cancels waiting delivery before aborting native work', async () => {
  const f = fixture();
  await f.queue('queue_interrupt_01', 'Do not send');
  await f.sender.stop('project', 'chat');
  f.state.status = {};
  await f.sender.tick();
  assert.equal(f.stops, 1);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(await f.sender.list('project', 'chat'), []);
  await f.sender.close();
});

test('steering preserves Queue, current parent choices and captured constraints without aborting', async () => {
  const f = fixture();
  try {
    f.state.receipts = [{ id: 'original', status: 'accepted', agent: { id: 'engineer' }, model: { providerID: 'opencode', modelID: 'free' }, variant: 'high' }];
    f.state.messages = [{ info: { id: 'original', role: 'user', model: { providerID: 'opencode', modelID: 'free' } }, parts: [{ type: 'text', text: 'Original work' }] }];
    await f.queue('queue_before_steer', 'Old queued message');
    const input = { id: 'steer_request_0001', kind: 'steer', text: 'Focus on the new direction', model: 'auto' };
    const first = await f.sender.enqueue('project', 'chat', input);
    assert.equal(first.status, 'waiting');
    await f.sender.tick();
    assert.equal(f.stops, 0);
    assert.equal(f.sent.length, 1);
    assert.match(f.sent[0], /Freelancer Steer handoff/);
    assert.match(f.sent[0], /Focus on the new direction/);
    await f.sender.enqueue('project', 'chat', input);
    await f.sender.tick();
    assert.equal(f.sent.length, 1);
    assert.equal((await f.sender.list('project', 'chat')).find(r => r.kind === 'queue').status, 'waiting');
    await assert.rejects(f.sender.enqueue('project', 'chat', { ...input, text: 'Changed' }), /different request/);
  } finally { await f.sender.close(); }
});

test('pending edits are revision checked and cannot alter submitted input', async () => {
  const f = fixture();
  try {
    await f.queue('editable_queue_01', 'First draft');
    await f.sender.edit('project', 'chat', 'editable_queue_01', 'Revised draft', 0);
    await assert.rejects(f.sender.edit('project', 'chat', 'editable_queue_01', 'Stale edit', 0), /changed/);
    f.state.status = {};
    await f.sender.tick();
    assert.deepEqual(f.sent.map(text => userInitiatedRequest(text)?.text), ['Revised draft']);
    await assert.rejects(f.sender.edit('project', 'chat', 'editable_queue_01', 'Late edit', 1), /still saved/);
  } finally { await f.sender.close(); }
});

test('an unsaved pending edit cannot change the next delivered text or edit revision', async t => {
  const f = fixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-edit-save-'));
  const file = path.join(root, 'outbox.json');
  const sender = createSender(f.app, { file });
  t.after(async () => { await sender.close(); await f.sender.close(); await rm(root, { recursive: true, force: true }); });
  await sender.enqueue('project', 'chat', { id: 'failed_edit_save_01', kind: 'queue', text: 'Original saved text', model: 'opencode/free' });
  withRecordDatabase(root, true, db => db.exec("CREATE TRIGGER fail_outbox BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT,'disk full'); END;"));
  await assert.rejects(sender.edit('project', 'chat', 'failed_edit_save_01', 'Unsaved text', 0));
  assert.equal((await sender.list('project', 'chat'))[0].text, 'Original saved text');
  withRecordDatabase(root, true, db => db.exec('DROP TRIGGER fail_outbox'));
  await sender.edit('project', 'chat', 'failed_edit_save_01', 'Confirmed text', 0);
  f.state.status = {};
  await sender.tick();
    assert.deepEqual(f.sent.map(text => userInitiatedRequest(text)?.text), ['Confirmed text']);
});

test('a failed parent turn holds later queued work until its notice is acknowledged', async () => {
  const f = fixture();
  await f.queue('queue_failed_0001', 'First follow-up');
  await f.queue('queue_after_0002', 'Later follow-up');
  f.state.status = {};
  await f.sender.tick();
  f.state.messages.push({ info: { id: 'failed_reply', role: 'assistant', parentID: 'native_0',
    error: 'Provider timed out' }, parts: [] });
  await f.sender.tick();
  assert.deepEqual(f.sent.map(text => userInitiatedRequest(text)?.text), ['First follow-up']);
  const rows = await f.sender.list('project', 'chat');
  assert.equal(rows.find(row => row.id === 'queue_failed_0001')?.status, 'failed');
  await f.sender.cancel('project', 'chat', 'queue_failed_0001');
  await f.sender.tick();
  assert.deepEqual(f.sent.map(text => userInitiatedRequest(text)?.text), ['First follow-up', 'Later follow-up']);
  await f.sender.close();
});
