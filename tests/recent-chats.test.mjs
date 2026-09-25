import assert from 'node:assert/strict';
import test from 'node:test';
import { RecentChats } from '../src/recent-chats.mjs';

test('recent chats are project scoped, bounded, and never replay live decisions', () => {
  let time = 0;
  const cache = new RecentChats({ limit: 2, maxBytes: 100_000, ttlMs: 100, now: () => time });
  const response = { messages: [{ parts: [{ text: 'Saved conversation' }] }],
    status: { one: { type: 'busy' } }, permissions: [{ id: 'old' }], questions: [{ id: 'old' }] };
  cache.put('one', 'same', response, 1);
  cache.put('two', 'same', { messages: [{ parts: [{ text: 'Other project' }] }] }, 2);
  assert.equal(cache.get('one', 'same').messages[0].parts[0].text, 'Saved conversation');
  assert.deepEqual(cache.get('one', 'same').status, {});
  assert.deepEqual(cache.get('one', 'same').permissions, []);
  assert.deepEqual(cache.get('one', 'same').questions, []);
  cache.put('one', 'same', { messages: [] }, 0);
  assert.equal(cache.get('one', 'same').messages.length, 1, 'late older reads cannot replace newer content');
  cache.put('three', 'same', { messages: [] }, 3);
  assert.equal(cache.get('two', 'same'), null, 'least recently used chat is evicted');
  time = 101;
  assert.equal(cache.get('one', 'same'), null, 'expired chats need a fresh read');
  cache.deleteProject('three');
  assert.equal(cache.get('three', 'same'), null);
});

test('oversized chats are not held in memory', () => {
  const cache = new RecentChats({ maxBytes: 500 });
  cache.put('one', 'large', { messages: [{ text: 'x'.repeat(1000) }] });
  assert.equal(cache.get('one', 'large'), null);
});
