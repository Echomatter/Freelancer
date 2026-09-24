import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedFixture } from './fixtures/unified-agents.mjs';
import { workerResult, runtimeSignals } from '../backend/tools/runtime/worker-result.mjs';

test('simple delegate starts free work in one call and supplies a compact captured catalog', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  assert.match(f.prompts[0].body.system, /Available agents: engineer/);
  const receipt = await f.delegator.execute({ agent: 'designer', task: 'Inspect the toolbar.', inspectionOnly: true }, ctx);
  assert.equal(receipt.status, 'completed');
  assert.equal(receipt.read_only, true);
  assert.equal(f.selections.length, 1);
  assert.equal(f.permissions.length, 0);
  assert.equal(receipt.worker_result.resultSource, 'final_assistant_fallback');
  assert.equal(receipt.worker_result.validationStatus, 'unverified');
});

test('same-worker follow-up retains model and native conversation without creating a duplicate', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  const first = await f.delegator.execute({ agent: 'researcher', task: 'Inspect the adapter.' }, ctx);
  const worker = first.attempts[0].child_session;
  const next = await f.delegator.execute({ worker, task: 'Show evidence for the second finding.' }, ctx);
  assert.equal(next.status, 'completed');
  assert.equal(next.attempts[0].child_session, worker);
  assert.equal(next.attempts[0].observed_model, first.attempts[0].observed_model);
  assert.equal(next.agent.id, 'researcher');
  assert.equal(f.sessions.size, 2);
  assert.equal(f.prompts.length, 3);
  await f.delegator.checkTool({ sessionID: worker, tool: 'read' }, { args: {} });
  await assert.rejects(f.delegator.execute({ worker, model: 'opencode/free-a', task: 'Change model.' }, ctx), /preserves/);
  f.status[worker] = { type: 'busy' };
  await assert.rejects(f.delegator.execute({ worker, task: 'Another follow-up.' }, ctx), /idle/);
});

test('same-worker continuation rejects a child from another parent', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  const first = await f.delegator.execute({ agent: 'engineer', task: 'Inspect a module.' }, ctx);
  const worker = first.attempts[0].child_session;
  f.sessions.get(worker).parentID = 'ses_foreign';
  await assert.rejects(f.delegator.execute({ worker, task: 'Follow up.' }, ctx), /does not belong/);
});

test('handle-it-yourself instruction prevents workers even when tool arguments request one', async t => {
  const f = await unifiedFixture(t), ctx = await f.send({ text: 'Handle this yourself. Fix the toolbar.' });
  await assert.rejects(f.delegator.execute({ agent: 'designer', task: 'Fix it.' }, ctx), /disabled by the user/);
  assert.equal(f.sessions.size, 1);
});

test('paid explicit worker requests hit native permission exactly once and denial starts nothing', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  let approvals = 0;
  const result = await f.delegator.execute({ agent: 'engineer', model: 'opencode-go/paid', task: 'Inspect code.' }, {
    ...ctx, ask: async request => { approvals++; assert.equal(request.permission, 'paid_delegate'); throw Error('Denied'); },
  });
  assert.equal(approvals, 1);
  assert.equal(result.status, 'paid_permission_declined');
  assert.equal(f.sessions.size, 1);
});

test('repeated equivalent native tool failures stop and preserve partial output', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  const prompt = f.client.session.promptAsync;
  f.client.session.promptAsync = async args => {
    const response = await prompt(args);
    const last = f.rows.get(args.path.id).at(-1);
    last.info.finish = 'tool-calls';
    last.parts = [{ type: 'text', text: 'Adapter inspected; test runner unavailable.' }, ...[1, 2, 3].map(id => ({ id: `failure-${id}`, type: 'tool', tool: 'bash', state: { status: 'error', input: { command: 'npm test' }, error: 'runner missing' } }))];
    return response;
  };
  const result = await f.delegator.execute({ agent: 'engineer', task: 'Inspect the adapter and run its tests.' }, ctx);
  assert.equal(result.status, 'failed');
  assert.equal(result.runtime_signals.needsDiagnosis, true);
  assert.equal(result.worker_result.resultSource, 'partial');
  assert.match(result.worker_result.summary, /runner unavailable/);
  assert.equal(result.attempts[0].abort_verified, true);
});

test('worker result distinguishes structured claims, fallback and interruption without inventing checks', () => {
  const structured = workerResult(JSON.stringify({ summary: 'Changed adapter', changedFiles: ['adapter.js'], validation: ['Unit suite passed'] }));
  assert.equal(structured.resultSource, 'structured_completion');
  assert.equal(structured.validationStatus, 'unverified');
  assert.deepEqual(structured.changedFiles, ['adapter.js']);
  assert.equal(workerResult('Still inspecting', { partial: true }).resultSource, 'partial');
  assert.equal(workerResult('{"summary":"Done","validation":true}').resultSource, 'final_assistant_fallback');
  assert.equal(runtimeSignals([]).needsDiagnosis, false);
});
