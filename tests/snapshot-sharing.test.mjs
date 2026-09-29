import test from 'node:test';
import assert from 'node:assert/strict';
import { shareSnapshot } from '../src/snapshot-sharing.mjs';
import { eventRefreshScope } from '../src/live-events.mjs';

test('streaming snapshots preserve completed branches, remove fields, and replace changed content', () => {
  const previous = { messages: [{ text: 'completed' }, { text: 'stream' }], status: { busy: true }, permissions: ['old'] };
  const next = shareSnapshot(previous, { messages: [{ text: 'completed' }, { text: 'streamed' }], status: {}, permissions: [] });
  assert.equal(next.messages[0], previous.messages[0]);
  assert.notEqual(next.messages[1], previous.messages[1]);
  assert.equal(previous.messages[1].text, 'stream');
  assert.deepEqual(next.status, {});
  assert.deepEqual(next.permissions, []);
  assert.equal(shareSnapshot(next, structuredClone(next)), next);
  assert.deepEqual(shareSnapshot([1, 2], [1]), [1]);
  assert.deepEqual(shareSnapshot({}, { value: null }), { value: null });
});

test('project streams scope text refreshes while decisions and unknown events fail safe', () => {
  const sessions = new Set(['selected', 'worker']);
  const message = id => ({ type: 'message.part.updated', properties: { part: { sessionID: id } } });
  assert.deepEqual(eventRefreshScope([message('unrelated')], sessions), { chat: false, bootstrap: false });
  assert.deepEqual(eventRefreshScope([message('selected'), message('worker')], sessions), { chat: true, bootstrap: false });
  for (const event of [null, { type: 'permission.asked' }, { type: 'question.asked' }, { type: 'session.status' }, { type: 'server.connected' }]) {
    assert.deepEqual(eventRefreshScope([event], sessions), { chat: true, bootstrap: true });
  }
  assert.deepEqual(eventRefreshScope([{ type: 'message.updated' }], sessions), { chat: true, bootstrap: false });
});
