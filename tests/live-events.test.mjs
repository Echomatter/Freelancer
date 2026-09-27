import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventInvalidator } from '../src/live-events.mjs';

test('native events refresh on complete frames, not chunks or heartbeat traffic', () => {
  let changes = 0;
  const accept = createEventInvalidator(() => changes++);
  accept(': keepalive\n\ndata: {"type":"server.heartbeat"}\n\n');
  assert.equal(changes, 0);
  accept('data: {"type":"message.part.');
  assert.equal(changes, 0);
  accept('updated"}\r');
  accept('\n\r\n');
  assert.equal(changes, 1);
  accept('data: {"type":"permission.asked"}\n\ndata: {"type":"question.asked"}\n\n');
  assert.equal(changes, 2, 'coalesce complete events from one network chunk');
  accept('data: {"payload":{"type":"server.heartbeat"}}\n\n');
  assert.equal(changes, 2);
  accept('data: {"type":"server.connected"}\n\n');
  assert.equal(changes, 3, 'reconnect still refreshes authoritative state');
});

test('malformed and oversized notifications fail safe without unbounded buffering', () => {
  let changes = 0;
  const accept = createEventInvalidator(() => changes++, 64);
  accept('data: unknown format\n\n');
  assert.equal(changes, 1);
  accept('data: ' + 'x'.repeat(100));
  assert.equal(changes, 2);
  accept('y'.repeat(100));
  assert.equal(changes, 2);
  accept('\n\ndata: {"type":"session.updated"}\n\n');
  assert.equal(changes, 3);
});
