import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDelegator, publicDelegateArgs } from '../tools/runtime/delegation.mjs';
import { checkedCatalog } from '../tools/runtime/agent-catalog.mjs';
import { readStateText } from '../tools/runtime/state-database.mjs';

// Bounded fixture copy of the delegate-runtime helper. Only the taskMs override
// is added so one observer test can keep a foreground dispatch polling while a
// scoped cancellation runs; existing tests are untouched.
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'toolkit-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'routing'));
  await writeFile(path.join(root, 'routing', 'policy.json'), JSON.stringify({ allowed_surfaces: ['opencode-go', 'opencode-free'], allow_overage: false }));
  const requests = [], sessions = new Map([['parent', { id: 'parent', permission: [{ permission: 'secret-tool', pattern: '*', action: 'deny' }] }]]);
  const catalog = checkedCatalog({ agents: options.agents ?? [] });
  const legacyWorkflows = ['build', 'plan', 'explore', 'review'].map(mode => ({ id: mode, name: mode[0].toUpperCase() + mode.slice(1), mode, agentID: mode === 'explore' ? 'researcher' : 'engineer', category: 'connected', models: [], parallel: true, variant: 'inherit' }));
  let parentAgent = options.parentAgent ?? 'engineer';
  const rootAssistant = () => ({ role: 'assistant', parentID: 'user1', agent: parentAgent, ...splitModel(options.parentModel || 'opencode/free-parent') });
  class NativeMessages extends Map {
    set(id, rows) {
      if (id === 'parent') {
        rows = rows.map(row => ({...row, info: row.info?.role === 'assistant' ? {...rootAssistant(), ...row.info} : {id:'user1', ...row.info}}));
        if (!rows.some(row => row.info?.role === 'user')) rows.unshift({info:{role:'user',id:'user1'},parts:[]});
      }
      return super.set(id, rows);
    }
  }
  const messages = new NativeMessages(), states = {}, records = [];
  messages.set('parent', [{info:rootAssistant(),parts:[]}]);
  const routes = [...new Set([...(options.models ?? ['opencode-go/model-b']), ...(options.candidates ?? []).map(m => m.id)])];
  const rootRecord = { id:'user1', projectID:'project', directory:root, sessionID:'parent', policyVersion:options.policyVersion ?? 6, mode:'build', readOnly:false,
    catalog, catalogConnected: ['opencode','opencode-go'],
    catalogModels: routes.map(id=>({id,provider:id.split('/')[0],costClass:id.startsWith('opencode/')?'free':'subscription',variants:['low','high']})) };
  const requestFile = path.join(root,'.state/webpage/requests.json');
  await mkdir(path.dirname(requestFile),{recursive:true});
  async function setContext(agentID = parentAgent) {
    parentAgent = agentID;
    rootRecord.agent = catalog.agents.find(a=>a.id===agentID);
    rootRecord.policyVersion = options.policyVersion ?? 6;
    rootRecord.catalog = options.policyVersion < 5 ? { ...catalog, workflows: legacyWorkflows } : catalog;
    if (options.policyVersion < 5) rootRecord.workflow = legacyWorkflows.find(w=>w.id===(options.parentMode ?? 'build'));
    else delete rootRecord.workflow;
    await writeFile(requestFile, JSON.stringify({version:1,records:{user1:rootRecord}}));
    messages.set('parent',[{info:rootAssistant(),parts:[]}]);
  }
  await setContext();
  let next = 0, time = 0;
  const data = v => ({ data: v });
  const client = {
    config: { get: async () => data({ subagent_depth: options.depth ?? 2 }) },
    app: { agents: async () => data(catalog.agents.map(a => ({ name:a.id, mode:'all', permission: [] }))) },
    session: {
      get: async ({ path: { id } }) => data(sessions.get(id)),
      message: async () => data({ info:rootAssistant() }),
      create: async ({ body, query }) => {
        requests.push({ kind: 'create', body, query });
        const child = { ...body, id: `child${++next}` };
        if (options.stripPermission) delete child.permission;
        sessions.set(child.id, child); messages.set(child.id, []);
        return data(child);
      },
      promptAsync: async ({ path: { id }, body, query }) => {
        requests.push({ kind: 'prompt', id, body, query });
        if (options.submitTimeout) return new Promise(() => {});
        const model = options.wrongModel ? { providerID: 'opencode', modelID: 'free-parent' } : body.model;
        if (!options.hang) messages.set(id, [assistant(id, model, {agent:body.agent,parentID:body.messageID,...(options.failFirst && id === 'child1' ? {error:{name:'APIError',data:{statusCode:503,message:'provider unavailable'}}} : {})})]);
        else states[id] = { type: 'busy' };
        return { data: undefined };
      },
      messages: async ({ path: { id } }) => data(messages.get(id) || []),
      status: async () => data(states),
      abort: async ({ path: { id } }) => { requests.push({ kind: 'abort', id }); if (!options.abortFails) delete states[id]; return data(true); },
    },
  };
  const controller = new AbortController();
  const ctx = { sessionID: 'parent', messageID: 'message', agent: parentAgent, callID:'call_fixture', directory: root, worktree: root,
    abort: controller.signal, ask: async req => { requests.push({ kind: 'permission', req }); if (options.deny || (options.denyPaid && req.permission === 'paid_delegate')) throw new Error('denied'); }, metadata: () => {} };
  let choice = 0;
  const fixtureChoices = new Map();
  const service = createDelegator({ client, toolkitRoot: root, directory: root,
    select: async a => {
      requests.push({ kind: 'select', args: a });
      const index = Math.max(0, options.models?.indexOf(a.selectedModel) ?? 0);
      return { selected_model: options.noRoute ? null : a.selectedModel || options.models?.[index] || 'opencode-go/model-b', surface: options.surfaces?.[index] || options.surface || 'opencode-go', candidates: options.candidates || [{id: options.models?.[0] || 'opencode-go/model-b', surface: options.surface || 'opencode-go', assessment_notes: []}], adequacy: options.adequacy || 'adequate', quota_state: { overage: options.overage } };
    },
    record: async r => records.push(structuredClone(r)), now: () => time,
    sleep: async ms => { time += ms; if (options.yieldSleep) await new Promise(resolve => setTimeout(resolve, 0)); }, limits: { pollMs: 1, taskMs: options.taskMs ?? 6, firstResponseMs: options.firstResponseMs ?? 2, stopMs: 4, requestMs: options.submitTimeout ? 20 : 2000 },
  });
  const execute = service.execute.bind(service);
  service.execute = async (a, c) => {
    if (Object.keys(a).length && !a.workers && !(a.worker && !a.task) && !options.rawSelection && !a.selectedModel) {
      if (!fixtureChoices.has(a.task)) fixtureChoices.set(a.task, options.models?.[choice++] || options.models?.at(-1) || 'opencode-go/model-b');
      a = {...a, selectedModel: fixtureChoices.get(a.task), selectionReason: 'Fixture host compared task fit and cost; verify fixture output.'};
    }
    const r = await execute(a, c);
    if (options.rawChoice || !r.decision?.questions[0].options.some(o => o.label === 'Recommended child')) return r;
    messages.set('parent', [...(messages.get('parent') || []), {info:{role:'assistant'},parts:[{type:'tool',tool:'question',callID:'choice',state:{status:'completed',time:{start:time},input:{questions:r.decision.questions},metadata:{answers:[['Recommended child']]}}}]}]);
    return execute({...a,decisionId:r.decision.id}, {...c,messageID:`${c.messageID}-choice`});
  };
  return { root, ctx, client, service, requests, messages, records, sessions, states, controller, setContext, rootRecord, requestFile };
}
function assistant(id, model, extra = {}) {
  return { info: { id: `${id}-answer`, role: 'assistant', sessionID: id, ...model,
    time: { created: 0, completed: 1 }, finish: 'stop', cost: 0.01,
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 3, write: 1 } }, ...extra },
    parts: [{ type: 'text', text: 'A verified fixture result, not a live provider result.' }] };
}
import { splitModel } from '../tools/runtime/delegation.mjs';

const sha = x => createHash('sha256').update(x).digest('hex');
const PARTIAL = 'Partial finding from the interrupted worker.';
async function seedWorker(f, { taskID = 'a'.repeat(64), child = 'child1', priorChildren = [], status = 'running', attemptStatus = 'starting', partial = PARTIAL, runningTool = false, workerResult = undefined } = {}) {
  const dir = path.join(f.root, '.state', 'delegation');
  await mkdir(path.join(dir, 'workers'), { recursive: true });
  f.sessions.set(child, { id: child, parentID: 'parent', metadata: { freelancer: { taskID, selected: 'opencode/free' } } });
  const parts = [{ type: 'text', text: partial }];
  if (runningTool) parts.push({ type: 'tool', tool: 'read', state: { status: 'running', input: { filePath: 'a.ts' } } });
  f.messages.set(child, [{ info: { id: `${child}-m1`, role: 'assistant' }, parts }]);
  const attempts = [
    ...priorChildren.map(c => ({ child_session: c, selected_model: 'opencode/free', status: 'failed', failure: 'timeout', abort_verified: true, started_at: new Date(0).toISOString() })),
    { child_session: child, selected_model: 'opencode/free', status: attemptStatus, started_at: new Date(0).toISOString(), abort_verified: null },
  ];
  const receipt = { task_id: taskID, parent_session: 'parent', directory: f.root, status,
    agent: { id: 'engineer', name: 'Engineer' }, attempts,
    ...(workerResult === undefined ? {} : { worker_result: workerResult }),
    activity: { schema_version: 1, phase: 'working', label: 'Working' }, created_at: new Date(0).toISOString() };
  await writeFile(path.join(dir, `${taskID}.json`), JSON.stringify(receipt));
  await writeFile(path.join(dir, 'workers', `${sha(child)}.json`), JSON.stringify({ taskID }));
  return { taskID, receipt };
}
const readReceipt = (f, taskID) => readStateText(path.join(f.root, '.state', 'delegation', `${taskID}.json`)).then(JSON.parse);

test('own-worker cancellation verifies the idle stop, preserves partial output, keeps chronological attempts and starts no replacement', async t => {
  const f = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'] });
  const { taskID } = await seedWorker(f, { priorChildren: ['child0'] });
  const result = await f.service.execute({ worker: 'child1', cancel: true }, f.ctx);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.cancellation.stop_verified, true);
  // A missing native entry counts as idle only when the stop verified.
  assert.equal(result.cancellation.native_status, 'idle');
  assert.equal(result.activity.phase, 'cancelled');
  assert.equal(result.activity.abort_verified, true);
  // Transcript partial output survives the stop.
  assert.equal(result.worker_result.summary, PARTIAL);
  assert.equal(result.worker_result.resultSource, 'partial');
  // Chronological attempt history: earlier attempts stay in place, the latest
  // entry (.at(-1)) carries the cancellation.
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].child_session, 'child0');
  assert.equal(result.attempts[0].status, 'failed');
  assert.equal(result.attempts.at(-1).child_session, 'child1');
  assert.equal(result.attempts.at(-1).status, 'cancelled');
  assert.equal(result.attempts.at(-1).abort_verified, true);
  assert.ok(result.attempts.at(-1).cancelled_at);
  assert.match(result.result, /Stop verified/);
  // Scoped to this worker: exactly one abort, no replacement child.
  assert.equal(f.requests.filter(r => r.kind === 'abort').length, 1);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 0);
  // Durable receipt re-read matches the returned cancellation.
  const durable = await readReceipt(f, taskID);
  assert.equal(durable.status, 'cancelled');
  assert.deepEqual(durable.attempts, result.attempts);
  assert.deepEqual(durable.cancellation, result.cancellation);
  assert.deepEqual(durable.worker_result, result.worker_result);
  assert.equal(f.records.at(-1).status, 'cancelled');
  assert.equal(f.records.at(-1).task_id, taskID);
});

test('abort acknowledgement without an idle stop reports stop_unverified instead of a false cancelled', async t => {
  const f = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'] });
  const previous = { summary: 'Earlier observed summary.', resultSource: 'partial', validationStatus: 'unverified' };
  const { taskID } = await seedWorker(f, { runningTool: true, workerResult: previous });
  const result = await f.service.execute({ worker: 'child1', cancel: true }, f.ctx);
  assert.equal(result.status, 'stop_unverified');
  assert.equal(result.cancellation.stop_verified, false);
  // Missing native entry must NOT map to idle when unverified.
  assert.equal(result.cancellation.native_status, 'unknown');
  assert.equal(result.failure_class, 'uncertain_execution');
  assert.equal(result.activity.phase, 'stop_unverified');
  assert.equal(result.activity.abort_verified, false);
  // Latest attempt (.at(-1)) records the failed stop; prior output is kept.
  assert.equal(result.attempts.at(-1).status, 'failed');
  assert.equal(result.attempts.at(-1).abort_verified, false);
  assert.ok(result.attempts.at(-1).cancelled_at);
  assert.deepEqual(result.worker_result.summary, previous.summary);
  assert.match(result.result, /could not be verified as stopped/);
  // Abort was acknowledged but no replacement child started.
  assert.equal(f.requests.filter(r => r.kind === 'abort').length, 1);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 0);
  const durable = await readReceipt(f, taskID);
  assert.equal(durable.status, 'stop_unverified');
  assert.deepEqual(durable.attempts, result.attempts);
  assert.equal(f.records.at(-1).status, 'stop_unverified');
});

test('unknown and foreign workers are rejected and cancel arguments are validated without stopping anything', async t => {
  const f = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'] });
  await seedWorker(f, {});
  await assert.rejects(f.service.execute({ worker: 'nope', cancel: true }, f.ctx),
    error => error.name === 'InvalidAssignment' && /Unknown managed worker/.test(error.message));
  f.sessions.set('other', { id: 'other' });
  await assert.rejects(f.service.execute({ worker: 'child1', cancel: true }, { ...f.ctx, sessionID: 'other' }),
    error => error.name === 'PermissionError');
  await assert.rejects(f.service.execute({ worker: 'child1', cancel: true }, { ...f.ctx, directory: path.join(f.root, 'other') }),
    error => error.name === 'PermissionError' && /does not belong|current Freelancer request/.test(error.message));
  await assert.rejects(f.service.execute({ worker: 'child1', cancel: false }, f.ctx), /cancel:true/);
  await assert.rejects(f.service.execute({ cancel: true }, f.ctx), /cancel requires worker/);
  await assert.rejects(f.service.execute({ worker: 'child1', cancel: true, task: 'Do more.' }, f.ctx), /takes no task/);
  await assert.rejects(f.service.execute({ worker: 'child1', cancel: true, agentID: 'engineer' }, f.ctx), /only worker and cancel/);
  await assert.rejects(f.service.execute({ worker: 'child1', cancel: true, workers: true }, f.ctx), /only worker and cancel/);
  assert.equal(f.requests.filter(r => r.kind === 'abort').length, 0);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 0);
});

test('completed worker reports worker_not_running and stops nothing', async t => {
  const f = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'] });
  const { taskID } = await seedWorker(f, { status: 'completed', attemptStatus: 'completed',
    workerResult: { summary: 'Done.', resultSource: 'structured_completion', validationStatus: 'unverified' } });
  const result = await f.service.execute({ worker: 'child1', cancel: true }, f.ctx);
  assert.equal(result.status, 'worker_not_running');
  assert.equal(result.cancellation.reason, 'already_completed');
  assert.equal(f.requests.filter(r => r.kind === 'abort').length, 0);
  assert.equal((await readReceipt(f, taskID)).status, 'completed');
});

test('cancel passes through the public delegate surface without starting work', () => {
  assert.deepEqual(publicDelegateArgs({ worker: 'child1', cancel: true }), { worker: 'child1', cancel: true, background: false });
});

test('simultaneous cancellations remain scoped to distinct workers', async t => {
  const f = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'] });
  await seedWorker(f, { child: 'child1', taskID: 'a'.repeat(64) });
  await seedWorker(f, { child: 'child2', taskID: 'b'.repeat(64) });
  const results = await Promise.all(['child1', 'child2'].map(worker => f.service.execute({ worker, cancel: true }, f.ctx)));
  assert.deepEqual(results.map(result => result.cancellation.child_session), ['child1', 'child2']);
  assert.ok(results.every(result => result.status === 'cancelled'));
  assert.deepEqual(f.requests.filter(request => request.kind === 'abort').map(request => request.id).sort(), ['child1', 'child2']);
  assert.equal(f.requests.filter(request => request.kind === 'create').length, 0);
});

test('foreground observer awaits the shared persisted receipt and returns stop_unverified when the stop cannot be verified', async t => {
  const f = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'], taskMs: 60000, firstResponseMs: 60000, hang: true, yieldSleep: true });
  const dispatch = f.service.execute({ agentID: 'engineer', task: 'Bounded fixture task; preserve user changes.' }, f.ctx);
  let child = null;
  for (let i = 0; i < 200 && !child; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    if (f.requests.some(request => request.kind === 'prompt' && request.id === 'child1')) child = 'child1';
  }
  assert.ok(child, 'foreground dispatch created its child before cancellation');
  f.messages.set('child1', [{ info: { id: 'child1-m1', role: 'assistant', agent: 'engineer', providerID: 'opencode', modelID: 'free' },
    parts: [{ type: 'text', text: PARTIAL }, { type: 'tool', tool: 'read', state: { status: 'running', input: { filePath: 'a.ts' } } }] }]);
  const cancelled = await f.service.execute({ worker: 'child1', cancel: true }, f.ctx);
  const dispatched = await dispatch;
  assert.equal(cancelled.status, 'stop_unverified');
  // The observer shares the persisted receipt instead of falsely claiming cancelled.
  assert.equal(dispatched.status, 'stop_unverified');
  assert.equal(dispatched.task_id, cancelled.task_id);
  assert.equal(dispatched.attempts.at(-1).abort_verified, false);
  assert.match(dispatched.result, /could not be verified/);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 1);
  assert.equal((await readReceipt(f, cancelled.task_id)).status, 'stop_unverified');
});
