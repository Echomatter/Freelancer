import test from 'node:test';
import assert from 'node:assert/strict';
import { createSender } from '../server/sender.mjs';

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
    id, kind: 'queue', text, model: 'opencode/free', workflowID: 'build', agentID: 'inherit',
  });
  return { sender, state, sent, queue, get stops() { return stops; } };
}

test('queued messages wait for native completion and dispatch once in FIFO order', async () => {
  const f = fixture();
  await f.queue('queue_first_0001', 'First follow-up');
  await f.queue('queue_second_0002', 'Second follow-up');
  await f.sender.tick();
  assert.deepEqual(f.sent, []);
  f.state.status = {};
  await f.sender.tick();
  assert.deepEqual(f.sent, ['First follow-up']);
  await f.sender.tick();
  assert.deepEqual(f.sent, ['First follow-up']);
  f.state.messages.push({ info: { id: 'reply', role: 'assistant', parentID: 'native_0',
    finish: 'stop', time: { completed: Date.now() } }, parts: [{ type: 'text', text: 'Done' }] });
  f.state.status = {};
  await f.sender.tick();
  assert.deepEqual(f.sent, ['First follow-up', 'Second follow-up']);
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

test('a failed parent turn holds later queued work until its notice is acknowledged', async () => {
  const f = fixture();
  await f.queue('queue_failed_0001', 'First follow-up');
  await f.queue('queue_after_0002', 'Later follow-up');
  f.state.status = {};
  await f.sender.tick();
  f.state.messages.push({ info: { id: 'failed_reply', role: 'assistant', parentID: 'native_0',
    error: 'Provider timed out' }, parts: [] });
  await f.sender.tick();
  assert.deepEqual(f.sent, ['First follow-up']);
  const rows = await f.sender.list('project', 'chat');
  assert.equal(rows.find(row => row.id === 'queue_failed_0001')?.status, 'failed');
  await f.sender.cancel('project', 'chat', 'queue_failed_0001');
  await f.sender.tick();
  assert.deepEqual(f.sent, ['First follow-up', 'Later follow-up']);
  await f.sender.close();
});
