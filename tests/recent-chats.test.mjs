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

test('worker navigation metadata survives cache hydration without live permissions', () => {
  const cache = new RecentChats();
  cache.put('p', 'worker', { session: { id: 'worker', parentID: 'parent', title: 'Inspect cache' },
    messages: [], permissions: [{ id: 'old-permission' }], status: { worker: { type: 'busy' } } });
  assert.equal(cache.get('p', 'worker').session.parentID, 'parent');
  assert.deepEqual(cache.get('p', 'worker').permissions, []);
  assert.equal(cache.get('other-project', 'worker'), null);
});

test('expired recent entries are removed before evicting useful older entries', () => {
  let now = 0;
  const cache = new RecentChats({ limit: 2, ttlMs: 100, now: () => now });
  cache.put('p', 'expired', { messages: [] });
  now = 50;
  cache.put('p', 'valid', { messages: [] });
  cache.get('p', 'expired'); // Make it the most recently used, but not younger.
  now = 110;
  cache.put('p', 'new', { messages: [] });
  assert.ok(cache.get('p', 'valid'));
  assert.equal(cache.get('p', 'expired'), null);
  cache.deleteProject('p');
  assert.equal(cache.bytes, 0);
});

test('cache sizing does not serialize every refreshed chat', () => {
  const original = JSON.stringify;
  const cache = new RecentChats({ maxBytes: 10_000 });
  JSON.stringify = () => { throw Error('unexpected stringify'); };
  try {
    cache.put('project', 'session', { title: 'Worker', messages: [{ parts: [{ type: 'text', text: 'cached' }] }] }, 1);
    assert.equal(cache.get('project', 'session').messages[0].parts[0].text, 'cached');
    assert.equal(cache.get('other', 'session'), null);
    cache.deleteProject('project');
    assert.equal(cache.get('project', 'session'), null);
  } finally {
    JSON.stringify = original;
  }
});
