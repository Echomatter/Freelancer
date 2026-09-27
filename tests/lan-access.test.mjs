import test from 'node:test';
import assert from 'node:assert/strict';
import { privateIPv4 } from '../server/lan.mjs';

test('LAN peer and adapter selection excludes public and malformed addresses', () => {
  for (const address of ['10.0.0.1', '192.168.1.2', '172.16.0.1', '172.31.255.254', '169.254.1.2', '::ffff:192.168.1.2'])
    assert.equal(privateIPv4(address), true, address);
  for (const address of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '127.0.0.1', '192.168..1', '10.999.0.1', '::1', ''])
    assert.equal(privateIPv4(address), false, address);
});
