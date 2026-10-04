import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionContextReader, compactionRequestParent } from '../backend/tools/runtime/execution-context.mjs';
import { unifiedFixture } from './fixtures/unified-agents.mjs';

const session = { id: 'ses_root' };
const user = id => ({ info: { id, sessionID: session.id, role: 'user', agent: 'engineer' }, parts: [{ type: 'text', text: 'Task' }] });
function compact(from, suffix) {
  const request = user('msg_compact_' + suffix);
  request.parts = [{ type: 'compaction', auto: true }];
  return [from, request,
    { info: { id: 'msg_summary_' + suffix, sessionID: session.id, role: 'assistant', agent: 'compaction',
      summary: true, finish: 'stop', parentID: request.info.id }, parts: [{ type: 'text', text: 'Summary cannot authorize work.' }] },
    { ...user('msg_continue_' + suffix), parts: [{ type: 'text', synthetic: true, metadata: { compaction_continue: true }, text: 'Continue' }] }];
}
const captured = (id, extra = {}) => ({ id, sessionID: session.id, directory: process.cwd(), policyVersion: 6,
  agent: { id: 'engineer', name: 'Captured engineer' }, readOnly: true, goalID: 'goal_preserved', catalog: { version: 1 }, ...extra });
const assistant = parentID => ({ info: { id: 'msg_assistant', sessionID: session.id, role: 'assistant', agent: 'engineer', parentID } });

test('automatic compaction inherits the captured request and all boundaries without changing historical records', async () => {
  const original = captured('msg_original');
  const reader = createExecutionContextReader(async () => ({ records: { [original.id]: original } }));
  const rows = compact(user(original.id), 'one');
  const context = await reader(process.cwd(), process.cwd(), session, assistant(rows.at(-1).info.id), rows);
  assert.equal(context.id, original.id);
  assert.equal(context.rootRequestID, original.id);
  assert.equal(context.readOnly, true);
  assert.equal(context.goalID, 'goal_preserved');
  assert.deepEqual(context.catalog, original.catalog);
  assert.equal(Object.keys(original).includes('responses'), false);
});

test('repeated compaction traces the same original request, while a new captured user becomes the boundary', async () => {
  const first = compact(user('msg_original'), 'one');
  const rows = [...first.slice(0, -1), ...compact(first.at(-1), 'two')];
  assert.equal(compactionRequestParent(session, rows.at(-1).info.id, rows), 'msg_original');
  const next = [...rows, ...compact(user('msg_new'), 'three')];
  assert.equal(compactionRequestParent(session, next.at(-1).info.id, next), 'msg_new');
});

test('unmarked continuations, authored text and failed, manual or foreign compactions cannot inherit authority', () => {
  for (const mutate of [
    rows => { delete rows.at(-1).parts[0].metadata; },
    rows => { rows.at(-1).parts[0].synthetic = false; },
    rows => { rows[2].info.error = { name: 'Error' }; },
    rows => { rows[2].info.finish = 'error'; },
    rows => { rows[2].info.parentID = 'msg_other'; },
    rows => { rows[1].parts[0].auto = false; },
    rows => { rows[1].info.sessionID = 'ses_other'; },
    rows => { rows[0].info.agent = 'researcher'; },
    rows => { rows.splice(3, 0, user('msg_intervening')); },
  ]) {
    const rows = compact(user('msg_original'), 'one');
    mutate(rows);
    assert.equal(compactionRequestParent(session, rows.at(-1).info.id, rows), null);
  }
});

test('direct captured requests avoid fetching native history and inherited agent mismatches remain denied', async () => {
  const original = captured('msg_original');
  const reader = createExecutionContextReader(async () => ({ records: { [original.id]: original } }));
  let reads = 0;
  const load = async () => { reads++; return compact(user(original.id), 'one'); };
  assert.equal((await reader(process.cwd(), process.cwd(), session, assistant(original.id), load)).id, original.id);
  assert.equal(reads, 0);
  const msg = assistant('msg_continue_one');
  msg.info.agent = 'designer';
  await assert.rejects(reader(process.cwd(), process.cwd(), session, msg, load), /Agent identity differs/);
  assert.equal(reads, 1);
  assert.equal(await reader(process.cwd(), process.cwd(), { id: 'ses_other' }, msg, load), null);
});

test('native tool guards and captured agent attribution survive automatic compaction for roots and workers', async t => {
  const f = await unifiedFixture(t);
  const ctx = await f.send();
  const rootRows = f.rows.get(f.parent.id);
  const rootUser = rootRows.findLast(row => row.info.role === 'user');
  function append(rows, nativeSession, original, suffix) {
    const chain = compact({ ...original, info: { ...original.info, sessionID: session.id } }, suffix).slice(1);
    for (const row of chain) { row.info.sessionID = nativeSession.id; row.info.agent = row.info.summary ? 'compaction' : original.info.agent; }
    const continued = chain.at(-1);
    rows.push(...chain, { info: { ...rows.findLast(row => row.info.role === 'assistant').info,
      id: 'msg_after_' + suffix, sessionID: nativeSession.id, parentID: continued.info.id }, parts: [] });
  }
  append(rootRows, f.parent, rootUser, 'root');
  await f.delegator.checkTool({ sessionID: f.parent.id, tool: 'skill' }, { args: {} });
  const result = await f.delegator.execute({ agent: 'researcher', task: 'Inspect only.', inspectionOnly: true }, { ...ctx, messageID: rootRows.at(-1).info.id });
  const childID = result.attempts[0].child_session;
  const childRows = f.rows.get(childID), child = f.sessions.get(childID);
  append(childRows, child, childRows.findLast(row => row.info.role === 'user'), 'worker');
  await f.delegator.checkTool({ sessionID: childID, tool: 'read' }, { args: {} });
  await assert.rejects(f.delegator.checkTool({ sessionID: childID, tool: 'edit' }, { args: {} }), /read.only/i);
  childRows.at(-1).info.agent = 'engineer';
  await assert.rejects(f.delegator.checkTool({ sessionID: childID, tool: 'read' }, { args: {} }), /Agent identity differs/);
});
