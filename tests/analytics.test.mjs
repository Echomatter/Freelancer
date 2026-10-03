import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChildProcess } from 'node:child_process';
import { createLocalDataStore } from '../server/data/store.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-analytics-'));
  const store = createLocalDataStore(root);
  const cleanup = async () => { store.close(); await rm(root, { recursive: true, force: true }); };
  t.after(cleanup);
  return { store, cleanup };
}

test('analytics runs named, authorized SELECTs in a bounded worker', async t => {
  const { store } = await fixture(t);
  const limited = await store.analyze('WITH valueset(n) AS (VALUES(1),(2),(3)) SELECT n FROM valueset WHERE n >= $min ORDER BY n', { $min: 2 }, { maxRows: 1 });
  assert.deepEqual(limited.rows, [{ n: 2 }]);
  assert.equal(limited.truncated, true);
  assert.equal(limited.partial, false);
  const booleanParams = {$yes:true,$no:false};
  const flags = await store.analyze('SELECT $yes AS yes, $no AS no', booleanParams);
  assert.deepEqual(flags.rows,[{yes:1,no:0}]);
  assert.deepEqual(booleanParams,{$yes:true,$no:false},'binding normalization must preserve caller inputs');
  assert.throws(() => store.analyze('DELETE FROM drafts'), /read-only SELECT or CTE/);
  assert.throws(() => store.analyze('SELECT load_extension($extension)', { $extension: 'x' }), /read-only SELECT or CTE/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => store.analyze('SELECT 1', {}, { signal: controller.signal }), { name: 'AbortError' });
});

test('abort terminates SQLite work that does not yield a row', async t => {
  const { store, cleanup } = await fixture(t);
  const actualKill = ChildProcess.prototype.kill;
  let worker, requestedSignal, stoppedResolve, settled = false;
  const stopRequested = new Promise(resolve => { stoppedResolve = resolve; });
  t.mock.method(ChildProcess.prototype, 'kill', function(signalName) {
    worker = this;
    requestedSignal = signalName;
    stoppedResolve();
    return true; // Hold termination until the assertion observes an outstanding query.
  });
  const controller = new AbortController();
  const query = store.analyze(`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) AS total FROM n`, {}, { signal: controller.signal, timeoutMs: 10_000 });
  query.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(query, { name: 'AbortError' });
  controller.abort();
  await stopRequested;
  try {
    assert.equal(requestedSignal, 'SIGTERM');
    worker.emit('message', { result: { rows: [{ late: true }] } });
    assert.equal(settled, false, 'requesting a kill must not settle before the worker actually exits');
  } finally {
    actualKill.call(worker, 'SIGKILL');
  }
  await rejected;
  assert.ok(worker.exitCode !== null || worker.signalCode !== null, 'query rejection follows observed worker exit');
  await cleanup(); // No retries: rejection must imply the child released SQLite.
});

test('hard execution timeout terminates long SQLite work', async t => {
  const { store, cleanup } = await fixture(t);
  await assert.rejects(
    store.analyze(`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) AS total FROM n`, {}, { timeoutMs: 250 }),
    { code: 'ERR_SQLITE_ANALYTICS_TIMEOUT' },
  );
  await cleanup();
});

test('closing analytics cancels an in-flight worker before its query settles', async t => {
  const { store, cleanup } = await fixture(t);
  const query = store.analyze('WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) AS total FROM n', {}, { timeoutMs: 10_000 });
  const rejected = assert.rejects(query, { code: 'ERR_SQLITE_ANALYTICS_CLOSED' });
  store.close();
  await rejected;
  await cleanup();
});
