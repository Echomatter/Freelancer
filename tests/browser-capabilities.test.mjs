import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { clientID } from '../src/browser-capabilities.mjs';

test('request IDs work on LAN HTTP without randomUUID', () => {
  const crypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
  const ids = new Set(Array.from({ length: 100 }, () => clientID(crypto)));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => clientID({}), /secure request ID/);
});
