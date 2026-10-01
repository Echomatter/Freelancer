import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoals } from '../server/goals.mjs';

test('slow native inspection coalesces goal ticks instead of starving checkpoint recording', async () => {
  const goal = { id: 'goal', project: 'p', session: 'root', status: 'ready', revision: 1, runID: 'run', settings: {} };
  let data = { records: { goal } }, reads = 0, release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const app = {
    store: {
      read: async () => structuredClone(data),
      update: async (_kind, change) => { data = change(structuredClone(data)); },
    },
    project: async () => ({ id: 'p' }),
    chat: async () => {
      reads++; entered(); await gate;
      return { messages: [], status: { root: { type: 'busy' } }, questions: [], permissions: [] };
    },
    goalTree: async () => [{ id: 'root', active: true }],
    goalActor: async () => ({ project: 'p', receipt: { goalID: 'goal', goalRunID: 'run', goalRevision: 1 },
      message: { info: { id: 'assistant', parentID: 'request' } } }),
  };
  const service = createGoals(app, { sender: { records: async () => [] } });
  await service.ready;
  data.records.goal.status = 'running';
  try {
    const first = service.tick(); await started;
    const repeats = Array.from({ length: 20 }, () => service.tick());
    const checkpoint = service.checkpoint({ outcome: 'continue', interpretation: 'Continue work', checkpoint: 'Progress retained', reason: 'Useful work remains', evidence: 'Probe' });
    release();
    await Promise.all([first, ...repeats, checkpoint]);
    assert.equal(reads, 1, 'timer observations must share one in-flight reconciliation');
    assert.ok(repeats.every(work => work === first));
    assert.equal(data.records.goal.checkpoint.requestID, 'request');
    await service.tick();
    assert.equal(reads, 2, 'a later observation still runs after the shared tick settles');
  } finally { release(); await service.close(); }
});
