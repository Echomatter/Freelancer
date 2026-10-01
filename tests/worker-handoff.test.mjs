import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedFixture } from './fixtures/unified-agents.mjs';
import { recordModelInput } from '../backend/tools/runtime/input-observations.mjs';
import { executionContext } from '../backend/tools/runtime/execution-context.mjs';
import { savePreferences, loadPreferences } from '../backend/tools/runtime/preferences.mjs';

async function worker(t, options = {}, fixtureOptions = {}) {
  const f = await unifiedFixture(t, fixtureOptions), ctx = await f.send();
  const first = await f.delegator.execute({ agent: 'researcher', task: 'Inspect the adapter.', ...options }, ctx);
  return { ...f, ctx, first, child: first.attempts[0].child_session };
}
test('parent Steer preserves active worker chat, identity, reasoning and read-only constraints without aborting', async t => {
  const f = await worker(t, { inspectionOnly: true, variant: 'high' });
  f.status[f.child] = { type: 'busy' };
  const input = { worker: f.child, task: 'Focus on the second adapter; preserve the first result.', delivery: 'steer' };
  const saved = await f.delegator.execute(input, f.ctx);
  const retry = await f.delegator.execute(input, f.ctx);
  assert.equal(saved.handoff.id, retry.handoff.id);
  assert.equal(saved.handoff.status, 'waiting');
  assert.equal(f.prompts.length, 2);
  await f.app.sender.tick();
  assert.equal(f.sessions.size, 2);
  assert.equal(f.prompts.length, 3);
  const prompt = f.prompts.at(-1);
  assert.equal(prompt.sessionID, f.child);
  assert.deepEqual(prompt.body.model, f.prompts[1].body.model);
  assert.equal(prompt.body.variant, 'high');
  assert.equal(prompt.body.agent, 'researcher');
  assert.match(prompt.body.parts[0].text, /Steer handoff/);
  assert.equal(f.calls.filter(c => c.route.endsWith('/abort')).length, 0);
  const captured = await executionContext(f.root, f.directory, f.sessions.get(f.child), f.rows.get(f.child).at(-1));
  assert.equal(captured.readOnly, true);
  assert.equal(captured.rootSessionID, f.parent.id);
  assert.equal(captured.rootRequestID, f.first.root_request_id);
  await assert.rejects(f.delegator.checkTool({ sessionID: f.child, tool: 'edit' }, { args: {} }), /read.only/i);
  const inspected = await f.delegator.execute({ worker: f.child }, f.ctx);
  assert.equal(inspected.deliveries[0].status, 'submitted');
  assert.equal(inspected.deliveries[0].includedAt, undefined);
});
test('worker Queue remains FIFO and editable; Steer neither clears nor jumps its turn-ending guard', async t => {
  const f = await worker(t);
  f.status[f.child] = { type: 'busy' };
  const a = await f.delegator.execute({ worker: f.child, task: 'First follow-up.', delivery: 'queue' }, f.ctx);
  await f.delegator.execute({ worker: f.child, task: 'Second follow-up.', delivery: 'queue' }, f.ctx);
  await assert.rejects(f.delegator.execute({ worker: f.child, task: 'Jump the queue.' }, f.ctx), /pending or uncertain/);
  await f.app.sender.edit(f.project.id, f.child, a.handoff.id, 'Edited first follow-up.', 0);
  await f.app.sender.tick();
  assert.equal(f.prompts.length, 2);
  await f.delegator.execute({ worker: f.child, task: 'Adjust current inspection.', delivery: 'steer' }, f.ctx);
  await f.app.sender.tick();
  assert.equal(f.prompts.length, 3);
  await recordModelInput(f.root, f.rows.get(f.child));
  delete f.status[f.child];
  await f.app.sender.tick();
  assert.match(f.prompts.at(-1).body.parts[0].text, /Edited first follow-up/);
  await f.app.sender.tick();
  assert.match(f.prompts.at(-1).body.parts[0].text, /Second follow-up/);
  assert.equal(f.prompts.length, 5);
});
test('worker handoffs reject changed models, foreign parents and tighter current limits', async t => {
  const f = await worker(t);
  await assert.rejects(f.delegator.execute({ worker: f.child, task: 'Change route.', model: 'opencode/free-a', delivery: 'steer' }, f.ctx), /preserve/);
  f.sessions.get(f.child).parentID = 'ses_other';
  await assert.rejects(f.delegator.execute({ worker: f.child, task: 'Wrong owner.', delivery: 'queue' }, f.ctx), /does not belong/);
  f.sessions.get(f.child).parentID = f.parent.id;
  await f.delegator.execute({ worker: f.child, task: 'Later work.', delivery: 'queue' }, f.ctx);
  const p = await loadPreferences(f.root, f.directory, f.parent.id);
  await savePreferences(f.root, f.directory, { scope: 'session', sessionID: f.parent.id, revision: p.revision, preferences: { ...p.defaults, delegation: 'manual' } });
  await f.app.sender.tick();
  assert.equal(f.prompts.length, 2);
  assert.match((await f.app.sender.list(f.project.id, f.child))[0].error, /budget/);
});
test('paid worker handoffs require native consent and denial retains existing work', async t => {
  const f = await worker(t, { model: 'opencode-go/paid' });
  await assert.rejects(f.delegator.execute({ worker: f.child, task: 'Correct the analysis.', delivery: 'steer' }, { ...f.ctx, ask: async p => { assert.equal(p.permission, 'paid_delegate'); throw Error('Denied'); } }), /Denied/);
  assert.equal(f.prompts.length, 2);
  assert.equal(f.app.sender, undefined);
});

test('two rapid worker steers are retained and share one existing chat', async t => {
  const f = await worker(t);
  const saved = await Promise.all(['First correction.', 'Second correction.'].map(task => f.delegator.execute({ worker: f.child, task, delivery: 'steer' }, f.ctx)));
  assert.notEqual(saved[0].handoff.id, saved[1].handoff.id);
  assert.equal((await f.app.sender.list(f.project.id, f.child)).length, 2);
  await f.app.sender.tick(); await recordModelInput(f.root, f.rows.get(f.child)); await f.app.sender.tick();
  assert.equal(f.sessions.size, 2);
  assert.equal(f.prompts.length, 4);
});

test('queued worker follow-up waits for the shared concurrency ceiling', async t => {
  const f = await worker(t);
  const prefs = await loadPreferences(f.root, f.directory, f.parent.id);
  await savePreferences(f.root, f.directory, { scope: 'session', sessionID: f.parent.id, revision: prefs.revision, preferences: { ...prefs.defaults, maxParallel: 1 } });
  f.sessions.set('ses_other_worker', { id: 'ses_other_worker', parentID: f.parent.id, directory: f.directory, metadata: { freelancer: { selected: 'opencode/free-b' } } });
  f.rows.set('ses_other_worker', []); f.status.ses_other_worker = { type: 'busy' };
  await f.delegator.execute({ worker: f.child, task: 'Follow up when capacity permits.', delivery: 'queue' }, f.ctx);
  await f.app.sender.tick();
  assert.equal(f.prompts.length, 2);
  assert.equal((await f.app.sender.list(f.project.id, f.child))[0].status, 'waiting');
  delete f.status.ses_other_worker;
  await f.app.sender.tick();
  assert.equal(f.prompts.length, 3);
});

test('native creation and durable worker Queue share reservations before native busy is visible', async t => {
  // This test deliberately holds create while another full dispatch is checked.
  // Do not turn that gate into a request timeout under parallel test load.
  const f = await worker(t, {}, { requestMs: 30000 });
  const prefs = await loadPreferences(f.root, f.directory, f.parent.id);
  await savePreferences(f.root, f.directory, { scope: 'session', sessionID: f.parent.id, revision: prefs.revision, preferences: { ...prefs.defaults, maxParallel: 1 } });
  await f.delegator.execute({ worker: f.child, task: 'Saved follow-up.', delivery: 'queue' }, f.ctx);
  const create = f.client.session.create;
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
  f.client.session.create = async args => { entered(); await held; return create(args); };
  const other = f.delegator.execute({ agent: 'engineer', task: 'Independent bounded work.' }, f.ctx);
  await started;
  try {
    await f.app.sender.tick();
    assert.equal(f.prompts.length, 2);
    assert.equal((await f.app.sender.list(f.project.id, f.child))[0].status, 'waiting');
  } finally { release(); }
  assert.equal((await other).status, 'completed');
  await f.app.sender.tick();
  assert.equal(f.prompts.length, 4);
});
