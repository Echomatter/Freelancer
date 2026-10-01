import test from 'node:test';
import assert from 'node:assert/strict';
import { measureStoreGrowth } from '../scripts/benchmark-store-growth.mjs';

test('growth benchmark rejects oversized or unbounded synthetic workloads', async () => {
  for (const options of [
    { counts: [] }, { counts: [1, 1] }, { counts: [0] }, { counts: [1001] },
    { counts: [1.5] }, { counts: [1, 2, 3, 4, 5, 6, 7] },
    { receiptBytes: 0 }, { receiptBytes: Infinity }, { repeats: 0 }, { repeats: 11 },
    { counts: [1000], receiptBytes: 1048576 },
  ]) await assert.rejects(measureStoreGrowth(options), /Choose 1–6 distinct workloads/);
});

test('growth benchmark measures actual store paths without leaking synthetic record content', async () => {
  const result = await measureStoreGrowth({ counts: [2, 4], receiptBytes: 256, repeats: 2 });
  assert.match(result.kind, /synthetic.*not live/);
  assert.deepEqual(result.workloads.map(row => row.receipts), [2, 4]);
  assert.ok(result.workloads[1].requestBytes > result.workloads[0].requestBytes);
  for (const workload of result.workloads) {
    assert.equal(workload.samples.length, 7);
    const byOperation = Object.fromEntries(workload.operations.map(row => [row.operation, row]));
    assert.equal(byOperation['changed observation'].replacements, 0, 'changed observations update SQLite rows without replacing JSON ledgers');
    assert.ok(workload.databaseBytes > 0);
    assert.equal(byOperation['identical observation'].replacements, 0, 'repeated observations must not rewrite either document');
    assert.equal(byOperation['cold scoped read'].replacements, 0);
    assert.equal(byOperation['warm scoped read'].replacements, 0);
    for (const row of workload.samples) {
      assert.ok(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0);
      assert.ok(Number.isFinite(row.cpuMs) && row.cpuMs >= 0);
    }
  }
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /catalogModels|synthetic_project|synthetic_response|\.state|webpage|description|directory/);
});
