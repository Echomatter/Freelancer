import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelDataVault } from '../server/model-data-secrets.mjs';

test('synthetic vault protection sends key bytes through stdin only and uses current-user Windows DPAPI', async () => {
  const calls = [], key = 'Synthetic model-data test key λ 2026';
  const execImpl = (command, args, options, callback) => {
    const call = { command, args, options, input: null }; calls.push(call);
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    return { stdin: { end(input) {
      call.input = input;
      if (script.includes('::Protect(')) callback(null, Buffer.from(`opaque-fixture:${input}`, 'utf8').toString('base64'));
      else callback(null, Buffer.from(input, 'base64').toString('utf8').slice('opaque-fixture:'.length));
    } } };
  };
  const vault = createModelDataVault({ platform: 'win32', execImpl });
  assert.equal(vault.available, true);
  const sealed = await vault.seal(key);
  assert.equal(sealed.startsWith('dpapi-current-user:v1:'), true);
  assert.equal(sealed.includes(key), false); assert.equal(await vault.open(sealed), key);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.command, 'powershell.exe');
    assert.deepEqual(call.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    assert.equal(call.options.windowsHide, true); assert.equal(call.options.timeout, 10000);
    assert.equal(JSON.stringify(call.args).includes(key), false);
    assert.equal(JSON.stringify(call.args).includes(Buffer.from(key, 'utf8').toString('base64')), false);
    const script = Buffer.from(call.args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /DataProtectionScope\]::CurrentUser/); assert.match(script, /Console\]::In\.ReadToEnd/);
    assert.match(script, /Array\]::Clear/); assert.equal(script.includes(key), false);
  }
  assert.equal(Buffer.from(calls[0].input, 'base64').toString('utf8'), key);
});

test('vault failures discard process diagnostics and never fall back to storing plaintext', async () => {
  const key = 'Synthetic private key marker';
  for (const mode of ['process-error', 'malformed-output']) {
    const vault = createModelDataVault({ platform: 'win32', execImpl: (_command, _args, _options, callback) => ({
      stdin: { end() { callback(mode === 'process-error' ? Error(key) : null, mode === 'malformed-output' ? `${key}\n!` : key); } },
    }) });
    await assert.rejects(vault.seal(key), error => {
      assert.equal(error.status, 503); assert.equal(error.message.includes(key), false);
      assert.equal(JSON.stringify(error).includes(key), false); assert.equal(error.cause, undefined); return true;
    });
  }
});

test('unavailable platform and unprotected stored bytes cannot dispatch a vault subprocess', async () => {
  let calls = 0; const execImpl = () => { calls++; throw Error('Unexpected subprocess.'); };
  const unavailable = createModelDataVault({ platform: 'linux', execImpl });
  assert.equal(unavailable.available, false);
  await assert.rejects(unavailable.seal('synthetic'), error => error.status === 503);
  const windows = createModelDataVault({ platform: 'win32', execImpl });
  await assert.rejects(windows.open('synthetic plaintext'), /not protected/);
  assert.equal(calls, 0);
});

test('Windows current-user DPAPI round-trips a synthetic Unicode key without any provider request', { skip: process.platform !== 'win32' }, async () => {
  const vault = createModelDataVault(), key = `Freelancer synthetic DPAPI fixture λ ${process.pid}`;
  const sealed = await vault.seal(key);
  assert.match(sealed, /^dpapi-current-user:v1:[A-Za-z0-9+/]+=*$/);
  assert.notEqual(sealed, key); assert.equal(sealed.includes(key), false);
  assert.equal(await vault.open(sealed), key);
});
