import test from 'node:test';
import assert from 'node:assert/strict';
import { runJourneys, journeys } from '../scripts/test-browser.mjs';

test('browser runner preserves the full catalog and continues after a failed journey without retrying it', () => {
  assert.equal(journeys.length, 17);
  assert.equal(new Set(journeys).size, journeys.length);
  const calls = [], snapshots = [];
  const results = runJourneys({ names: ['first', 'second', 'third'], log: () => {}, record: report => snapshots.push(structuredClone(report)),
    run: (executable, args, options) => {
      assert.equal(executable, process.execPath);
      assert.equal(options.timeout, 180000);
      calls.push(args[0]);
      return { status: calls.length === 1 ? 1 : 0 };
    } });
  assert.deepEqual(calls, ['tests/first.browser.mjs', 'tests/second.browser.mjs', 'tests/third.browser.mjs']);
  assert.deepEqual(results.map(row => row.outcome), ['failure', 'success', 'success']);
  assert.deepEqual(snapshots[0].notRun, ['second', 'third']);
  assert.deepEqual(snapshots.at(-1).notRun, []);
  assert.equal(snapshots.at(-1).liveProviderInference, 'not-run');
});

test('browser timeout, signal and launch failure cannot produce a passing journey', () => {
  const responses = [
    { status: null, error: Object.assign(Error('Timed out'), { code: 'ETIMEDOUT' }) },
    { status: null, signal: 'SIGTERM' },
    { status: 0, error: Error('Launch failed') },
  ];
  const results = runJourneys({ names: ['timeout', 'signal', 'error'], log: () => {}, run: () => responses.shift() });
  assert.ok(results.every(result => result.outcome === 'failure'));
  assert.equal(results[0].errorCode, 'ETIMEDOUT');
  assert.equal(results[1].signal, 'SIGTERM');
});

test('browser runner records success only for an observed zero exit and records thrown launch errors', () => {
  let calls = 0;
  const results = runJourneys({ names: ['throw', 'pass'], log: () => {}, run: () => {
    if (++calls === 1) throw Object.assign(Error('Not found'), { code: 'ENOENT' });
    return { status: 0 };
  } });
  assert.deepEqual(results.map(row => row.outcome), ['failure', 'success']);
  assert.equal(results[0].errorCode, 'ENOENT');
});
