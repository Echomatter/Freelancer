import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDelegator, atomicJson, observe, failureKind, splitModel, freeOnlyAssignment, noWriteAssignment, userDirectedModelAssignment, sameDecisionAssignment } from '../tools/runtime/delegation.mjs';
import { savePreferences } from '../tools/runtime/preferences.mjs';
import { checkedCatalog } from '../tools/runtime/agent-catalog.mjs';
import { defaults, preset } from '../../shared/strategy.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'toolkit-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'routing'));
  await writeFile(path.join(root, 'routing', 'policy.json'), JSON.stringify({ allowed_surfaces: ['opencode-go', 'opencode-free'], allow_overage: false }));
  const requests = [], sessions = new Map([['parent', { id: 'parent', permission: [{ permission: 'secret-tool', pattern: '*', action: 'deny' }] }]]);
  const catalog = checkedCatalog({ agents: options.agents ?? [] });
  let parentAgent = options.parentAgent ?? 'engineer', parentMode = options.parentMode ?? 'build';
  const rootAssistant = () => ({ role: 'assistant', parentID: 'user1', agent: parentAgent, ...splitModel(options.parentModel || 'opencode/free-parent') });
  // Real native rows always carry IDs and user ancestry. Tests may still supply
  // explicit mismatched identities to exercise fail-closed behavior.
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
  const rootRecord = { id:'user1', projectID:'project', directory:root, sessionID:'parent', policyVersion:3,
    catalog, catalogConnected: ['opencode','opencode-go'],
    catalogModels: routes.map(id=>({id,provider:id.split('/')[0],costClass:id.startsWith('opencode/')?'free':'subscription',variants:['low','high']})) };
  const requestFile = path.join(root,'.state/webpage/requests.json');
  await mkdir(path.dirname(requestFile),{recursive:true});
  async function setContext(agentID = parentAgent, workflowID = parentMode) {
    parentAgent = agentID; parentMode = workflowID;
    rootRecord.agent = catalog.agents.find(a=>a.id===agentID);
    rootRecord.workflow = catalog.workflows.find(w=>w.id===workflowID);
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
    // Task time uses the deterministic clock. SDK request time is real wall
    // time: concurrency barriers include disk-backed receipts/preferences.
    sleep: async ms => { time += ms; }, limits: { pollMs: 1, taskMs: 6, firstResponseMs: 2, stopMs: 4, requestMs: options.submitTimeout ? 20 : 2000 },
  });
  // Existing execution contracts model a real user choosing the recommendation.
  // Choice-specific contracts use rawChoice and explicitly seed the native reply.
  const execute = service.execute.bind(service);
  service.execute = async (a, c) => {
    // Most contracts start after the host reasoned over evidence. The new
    // selection contracts use rawSelection to exercise the no-execution proposal.
    if (Object.keys(a).length && !options.rawSelection && !a.selectedModel) {
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
const args = { agentID: 'engineer', workflowID: 'build', task: 'Perform a bounded task; preserve user changes.', needsWrites: true };
test('delegation receipts replace an existing JSON file without discarding it', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'delegation-write-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const file = path.join(root, '.state', 'delegation', 'receipt.json');
  await atomicJson(file, {status:'starting'});
  await atomicJson(file, {status:'completed', attempts:[{child:'ses_1'}]});
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {status:'completed', attempts:[{child:'ses_1'}]});
  assert.deepEqual(await readdir(path.dirname(file)), ['receipt.json']);
});
test('todos work for every managed role without granting source writes', async t => {
  for (const [agentID, workflowID] of [['engineer','build'],['engineer','plan'],['researcher','explore'],['engineer','review'],['designer','build']]) {
    for (const needsWrites of [false, true]) {
      const f = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'] });
      const result = await f.service.execute({ ...args, agentID, workflowID, needsWrites }, f.ctx);
      assert.equal(result.status, 'completed');
      const permission = f.sessions.get('child1').permission;
      assert.equal(permission.some(r => r.permission === 'todowrite'), false, 'no injected deny');
      await f.service.checkTool({ sessionID: 'child1', tool: 'todowrite' }, { args: { todos: [] } });
      await f.service.checkTool({ sessionID: 'child1', tool: 'todoread' }, { args: {} });
      if (!needsWrites || workflowID !== 'build') {
        for (const tool of ['edit', 'write', 'apply_patch', 'unknown_mutator'])
          await assert.rejects(f.service.checkTool({ sessionID: 'child1', tool }, { args: {} }), /Read-only/);
        // Read-only blocks source writes, not retrieval maintenance.
        await f.service.checkTool({ sessionID: 'child1', tool: 'content_index' }, { args: { operation: 'rebuild' } });
      }
    }
  }
});
test('direct reader roles can track todos while explicit parent native denial survives', async t => {
  for (const mode of ['explore', 'review']) {
    const f = await fixture(t, {parentMode:mode});
    await f.service.checkTool({ sessionID: 'parent', tool: 'todowrite' }, { args: { todos: [] } });
    await assert.rejects(f.service.checkTool({ sessionID: 'parent', tool: 'edit' }, { args: {} }), /Read-only/);
  }
  const f = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'] });
  f.sessions.get('parent').permission.push({ permission: 'todowrite', action: 'deny', pattern: '*' });
  assert.equal((await f.service.execute(args, f.ctx)).status, 'completed');
  assert.ok(f.sessions.get('child1').permission.some(r => r.permission === 'todowrite' && r.action === 'deny'));
});
test('workflow intelligence reaches the native child without changing its parent', async t => {
  const f = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'] });
  await savePreferences(f.root, f.root, { scope: 'project', preferences: { ...defaults, childVariant: 'high' } });
  const result = await f.service.execute({ ...args, variant: 'low' }, f.ctx);
  assert.equal(result.status, 'completed', JSON.stringify({ result }));
  const prompt = f.requests.find(r => r.kind === 'prompt');
  assert.equal(prompt.body.variant, 'low');
  assert.equal(prompt.body.model.modelID, 'free');
  assert.equal(result.parent_model, 'opencode/free-parent');
});
test('historical no-edit reports do not turn an authorized writer into a read-only helper',async t=>{
  const task='Implement only the loader and its tests. Failed Muse stopped verified with no edits; no competing writer for these files.';
  assert.equal(noWriteAssignment(task),false);
  assert.equal(noWriteAssignment('Implement only these files; no other writes.'),false);
  for(const text of ['No edits. Inspect only.','Inspect the module; no writes.','Read-only orientation','Do not modify any files.'])assert.equal(noWriteAssignment(text),true);
  const f=await fixture(t,{surface:'opencode-free',models:['opencode/free']});
  const result=await f.service.execute({...args,task},f.ctx);
  assert.equal(result.status,'completed');assert.equal(f.requests.find(r=>r.kind==='select').args.needsWrites,true);
  assert.ok(!f.sessions.get('child1').permission.some(r=>r.permission==='edit'&&r.action==='deny'));
});

test('manual, disabled role and excluded model preferences prevent execution in the shared backend', async t => {
  for (const preferences of [preset('manual'),{...defaults,agentAccess:{engineer:['review']}},{...defaults,excludedModels:['opencode-go/model-b']},{...defaults,excludedProviders:['opencode-go']},{...defaults,allowedModels:['opencode/free-only-choice']}]) {
    const f=await fixture(t);
    await savePreferences(f.root,f.root,{preferences,scope:'project'});
    await assert.rejects(f.service.execute(args,f.ctx),/disabled|excluded|workflow restrictions/);
    assert.equal(f.requests.filter(r=>r.kind==='create'||r.kind==='prompt').length,0);
  }
});
test('free-only and context preferences constrain the selector even if caller omits them', async t => {
  const f=await fixture(t,{surface:'opencode-free',models:['opencode/free']});
  await savePreferences(f.root,f.root,{preferences:{...preset('premium-parent'),contextPolicy:'large',minimumContext:192000},scope:'project'});
  const result=await f.service.execute(args,f.ctx);
  assert.equal(result.status,'completed');
  const selected=f.requests.find(r=>r.kind==='select').args;
  assert.equal(selected.freeOnly,true);assert.equal(selected.minimumContext,192000);
});
test('ask strategy requires a recorded native choice even for free children', async t => {
  const f=await fixture(t,{surface:'opencode-free',models:['opencode/free'],rawChoice:true});
  await savePreferences(f.root,f.root,{preferences:{...preset('minimal-agents'),delegation:'ask'},scope:'project'});
  const result=await f.service.execute(args,f.ctx);
  assert.equal(result.status,'decision_required');assert.equal(f.requests.filter(r=>r.kind==='create').length,0);
});
test('user concurrency cap prevents a second dispatch while a child is starting', async t => {
  const f=await fixture(t,{surface:'opencode-free',models:['opencode/free']});
  await savePreferences(f.root,f.root,{preferences:{...defaults,maxParallel:1},scope:'project'});
  const original=f.client.session.promptAsync;
  let release,started;
  const ready=new Promise(r=>{started=r});
  f.client.session.promptAsync=async req=>{started();await new Promise(r=>{release=r});return original(req)};
  const first=f.service.execute(args,f.ctx);await ready;
  const second=await f.service.execute({...args,task:'Independent second assignment'},f.ctx);
  assert.equal(second.status,'parallel_limit');assert.equal(f.requests.filter(r=>r.kind==='create').length,1);
  release();assert.equal((await first).status,'completed');
});
test('concurrency cap sees native running children after a backend restart', async t => {
  const f=await fixture(t,{surface:'opencode-free',models:['opencode/free']});
  await savePreferences(f.root,f.root,{preferences:{...defaults,maxParallel:1},scope:'project'});
  f.client.session.children=async()=>({data:[{id:'existing',metadata:{freelancer:{selected:'opencode/free'}}}]});
  f.states.existing={type:'busy'};
  const result=await f.service.execute(args,f.ctx);
  assert.equal(result.status,'parallel_limit');assert.equal(f.requests.filter(r=>r.kind==='create').length,0);
});
test('recovered native child and a newly starting child both occupy concurrency slots', async t => {
  const f=await fixture(t,{surface:'opencode-free',models:['opencode/free']});
  await savePreferences(f.root,f.root,{preferences:{...defaults,maxParallel:2},scope:'project'});
  f.client.session.children=async()=>({data:[{id:'existing',metadata:{freelancer:{selected:'opencode/free'}}}]});
  f.states.existing={type:'busy'};
  const original=f.client.session.create;
  let release,started;
  const ready=new Promise(r=>{started=r});
  f.client.session.create=async req=>{started();await new Promise(r=>{release=r});return original(req)};
  const first=f.service.execute(args,f.ctx);await ready;
  try {
    const second=await f.service.execute({...args,task:'Independent second assignment'},f.ctx);
    assert.equal(second.status,'parallel_limit');assert.equal(f.requests.filter(r=>r.kind==='create').length,0);
  } finally {release();await first;}
});

test('host inspects rich candidates without inference and chooses a different free route', async t => {
  const candidates = [
    {id:'opencode/a',surface:'opencode-free',context:{input_tokens:1000000},cost:{note:'free'},assessment_notes:[]},
    {id:'opencode/b',surface:'opencode-free',context:{input_tokens:200000},capabilities:{coding:{rating:'good'}},assessment_notes:['Below heuristic floor']},
  ];
  const f=await fixture(t,{rawSelection:true,rawChoice:true,models:['opencode/a','opencode/b'],surface:'opencode-free',candidates,adequacy:'host_assessment_required'});
  const proposal=await f.service.execute({...args,needsWrites:false},f.ctx);
  assert.equal(proposal.status,'selection_required');
  assert.deepEqual(proposal.candidates,candidates);
  assert.equal(f.requests.filter(r=>r.kind==='create'||r.kind==='prompt').length,0);
  const selected=await f.service.execute({...args,needsWrites:false,selectedModel:'opencode/b'},f.ctx);
  assert.equal(selected.status,'completed');
  assert.equal(selected.attempts[0].observed_model,'opencode/b');
  assert.equal(selected.attempts[0].evidence_assessment,'host_assessment_required');
  assert.equal(selected.attempts[0].host_selection_reason,null);
  assert.equal(f.requests.filter(r=>r.req?.permission==='paid_delegate').length,0);
});

test('friendly user model wording recognizes the provider-qualified route', () => {
  assert.equal(userDirectedModelAssignment('Delegate the core fixes to MiMo Pro engineer.', 'opencode-go/mimo-v2.5-pro'), true);
  assert.equal(userDirectedModelAssignment('Use Muse Spark 1.3 for the docs.', 'opencode/muse-spark-1.3-contributor-free'), true);
  assert.equal(userDirectedModelAssignment('Use Muse Spark 1.2 for the docs.', 'opencode/muse-spark-1.3-contributor-free'), false);
  assert.equal(userDirectedModelAssignment('Use a free model for docs.', 'opencode/muse-spark-1.3-contributor-free'), false);
  assert.equal(userDirectedModelAssignment('Use MiMo Pro.', 'opencode-go/minimax-m2.7'), false);
});

test('user-directed subscription model skips duplicate model-choice question but keeps paid permission', async t => {
  const f=await fixture(t,{rawChoice:true,models:['opencode-go/mimo-v2.5-pro'],surface:'opencode-go'});
  f.messages.set('parent',[{info:{id:'user1',role:'user'},parts:[{type:'text',text:'Delegate the core fixes to MiMo Pro engineer.'}]}]);
  const result=await f.service.execute({...args,selectedModel:'opencode-go/mimo-v2.5-pro'},f.ctx);
  assert.equal(result.status,'completed');
  assert.equal(result.model_selection.source,'user');
  assert.equal(f.requests.filter(r=>r.req?.permission==='paid_delegate').length,1);
  assert.equal(f.requests.filter(r=>r.kind==='create').length,1);
  assert.equal(result.decision,undefined);
});

test('host-selected subscription model still requires the native model-choice decision', async t => {
  const f=await fixture(t,{rawChoice:true,models:['opencode-go/mimo-v2.5-pro'],surface:'opencode-go'});
  f.messages.set('parent',[{info:{id:'user1',role:'user'},parts:[{type:'text',text:'Delegate the core fixes to a strong engineer.'}]}]);
  const result=await f.service.execute({...args,selectedModel:'opencode-go/mimo-v2.5-pro'},f.ctx);
  assert.equal(result.status,'decision_required');
  assert.equal(result.model_selection.source,'host');
  assert.equal(f.requests.filter(r=>r.req?.permission==='paid_delegate').length,0);
  assert.equal(f.requests.filter(r=>r.kind==='create').length,0);
});

test('another review excludes prior observed reviewers, even from restored native cards', async t => {
  const f=await fixture(t,{rawSelection:true,rawChoice:true,surface:'opencode-free'});
  f.messages.set('parent',[{info:{role:'assistant'},parts:[{type:'tool',tool:'task',state:{status:'completed',output:JSON.stringify({parent_session:'parent',role:'review',status:'completed',attempts:[{status:'completed',observed_model:'opencode/prior'}]})}}]}]);
  const proposal=await f.service.execute({...args,agentID:'engineer', workflowID:'review',needsWrites:false,excludeModels:['openai/implementation']},f.ctx);
  assert.equal(proposal.status,'selection_required');
  assert.deepEqual(f.requests.find(r=>r.kind==='select').args.excludeModels,['openai/implementation','opencode/prior']);
});

test('nested delegate and helper task blocked for writers and after runtime restart', async t => {
  const f=await fixture(t); await f.service.execute(args,f.ctx);
  const restarted=createDelegator({client:f.client,toolkitRoot:f.root,directory:f.root});
  for (const service of [f.service,restarted]) {
    await assert.rejects(service.checkTool({sessionID:'child1',tool:'delegate'},{args:{agentID:'engineer',workflowID:'review'}}),/Nested/);
    await assert.rejects(service.checkTool({sessionID:'child1',tool:'task'},{args:{subagent_type:'researcher'}}),/named agentID/);
    await assert.rejects(service.checkTool({sessionID:'child1',tool:'task'},{args:{subagent_type:'explore'}}),/named agentID/);
  }
  assert.ok(f.sessions.get('child1').permission.some(r=>r.permission==='delegate'&&r.action==='deny'));
});

test('read-only user wording does not replace Build native shell permissions', async t => {
  const f = await fixture(t);
  f.messages.set('parent', [{info:{role:'user'},parts:[{type:'text',text:'Read-only orientation; check git status.'}]},
    {info:{role:'assistant',agent:'engineer'},parts:[]}]);
  await f.service.checkTool({sessionID:'parent',tool:'bash'},{args:{command:'git status --short'}});
});

test('subscription proposal starts nothing, rejects fabricated consent and honors native cancel', async t => {
  const f=await fixture(t,{rawChoice:true});
  const proposal=await f.service.execute(args,f.ctx);
  assert.equal(proposal.status,'decision_required');
  assert.equal(f.requests.filter(r=>r.kind==='create'||r.req?.permission==='paid_delegate').length,0);
  const resume={...args,decisionId:proposal.decision.id};
  await assert.rejects(f.service.execute(resume,{...f.ctx,messageID:'resume'}),/recorded user choice/);
  f.messages.set('parent',[{info:{role:'assistant'},parts:[{type:'tool',tool:'question',callID:'native-cancel',state:{status:'completed',time:{start:0},input:{questions:proposal.decision.questions},metadata:{answers:[['Cancel']]}}}]}]);
  const cancelled=await f.service.execute(args,{...f.ctx,messageID:'fresh-after-answer'});
  assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.user_choice.questionCallID,'native-cancel');
  assert.equal(f.requests.filter(r=>r.kind==='create').length,0);
  await assert.rejects(f.service.execute({...resume,task:'Different task'},f.ctx),/does not match/);
  await assert.rejects(f.service.execute(resume,{...f.ctx,sessionID:'other'}));
});

test('recorded native recommendation resumes with or without decisionId and dispatches once', async t => {
  const f=await fixture(t,{rawChoice:true});
  const p=await f.service.execute(args,f.ctx);
  f.messages.set('parent',[{info:{role:'assistant'},parts:[{type:'tool',tool:'question',callID:'native-choice',state:{status:'completed',time:{start:0},input:{questions:p.decision.questions},metadata:{answers:[['Recommended child']]}}}]}]);
  const resume={...args,decisionId:p.decision.id,selectionReason:'Harmless changed audit note'};
  const [r, concurrent]=await Promise.all([
    f.service.execute(resume,{...f.ctx,messageID:'resume'}),
    f.service.execute(args,{...f.ctx,messageID:'fresh-after-answer'}),
  ]);
  assert.equal(concurrent.task_id,r.task_id);
  assert.equal(r.status,'completed');assert.equal(r.attempts[0].observed_model,'opencode-go/model-b');
  assert.equal(f.requests.filter(r=>r.kind==='select').at(-1).args.selectedModel,'opencode-go/model-b');
  const replay=await f.service.execute(args,{...f.ctx,messageID:'another-message'});
  assert.equal(replay.replay,true);assert.equal(f.requests.filter(r=>r.kind==='prompt').length,1);
});

test('direct researcher and its native children retain read-only edits and native shell permissions', async t => {
  const f = await fixture(t,{parentAgent:'researcher',parentMode:'explore'});
  f.sessions.set('explorer', {id:'explorer',parentID:'parent',metadata:{freelancer:{selected:'opencode/free',readOnly:true}}});
  await f.service.checkTool({sessionID:'parent',tool:'bash'},{args:{command:'git status'}});
  await assert.rejects(f.service.checkTool({sessionID:'explorer',tool:'edit'},{args:{}}), /Read-only/);
});
test('explicit user free-only request survives an omitted or false parent tool flag',async t=>{
 const f=await fixture(t);
 f.messages.set('parent',[{info:{role:'user'},parts:[{type:'text',text:'Call a worker with freeOnly true for this task.'}]}]);
 const result=await f.service.execute({...args,freeOnly:false},f.ctx);
 assert.equal(result.free_only,true);assert.equal(result.status,'free_only_violation');
 assert.equal(f.requests.filter(r=>r.kind==='create').length,0);
 assert.equal(freeOnlyAssignment('Use only free models for review'),true);
 assert.equal(freeOnlyAssignment('Prefer free or cheap models'),false);
 assert.equal(freeOnlyAssignment('freeOnly false'),false);
});

test('freeOnly is forwarded, enforced at dispatch and inherited by descendants', async t => {
  const f = await fixture(t);
  const denied = await f.service.execute({ ...args, freeOnly: true }, f.ctx);
  assert.equal(denied.status, 'free_only_violation');
  assert.equal(f.requests.find(r => r.kind === 'select').args.freeOnly, true);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 0);
  const g = await fixture(t, { surface: 'opencode-free', models: ['opencode/free'] });
  await g.service.execute({ ...args, freeOnly: true }, g.ctx);
  assert.equal(g.sessions.get('child1').metadata.freelancer.freeOnly, true);
  g.sessions.get('parent').metadata = { freelancer: { selected: 'opencode/free-parent', readOnly: false, freeOnly: true } };
  await g.service.execute({ ...args, freeOnly: false, task: 'Cannot weaken inherited free constraint' }, { ...g.ctx, messageID: 'new' });
  assert.equal(g.requests.filter(r => r.kind === 'select').at(-1).args.freeOnly, true);
  assert.equal(g.requests.filter(r => r.kind === 'permission' && r.req.permission === 'paid_delegate').length, 0);
});

test('subscription permission precedes creation and rejection never dispatches or retries', async t => {
  const f = await fixture(t, { denyPaid: true });
  const result = await f.service.execute(args, f.ctx);
  assert.equal(result.status, 'paid_permission_declined');
  assert.equal(result.subscription_request.selected_model, 'opencode-go/model-b');
  assert.equal(result.subscription_request.status, 'not_granted');
  assert.equal(result.attempts.length, 0);
  assert.match(result.result, /NO CHILD RAN/);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 0);
  const g = await fixture(t);
  await g.service.execute(args, g.ctx);
  assert.ok(g.requests.findIndex(r => r.req?.permission === 'paid_delegate') < g.requests.findIndex(r => r.kind === 'create'));
  assert.deepEqual(g.requests.find(r => r.req?.permission === 'paid_delegate').req.patterns, ['opencode-go/model-b']);
});

test('review defaults to model diversity and no-route cannot imply completed review', async t => {
  const f = await fixture(t, { noRoute: true });
  const result = await f.service.execute({ ...args, agentID:'engineer', workflowID:'review', freeOnly: true }, f.ctx);
  assert.equal(f.requests.find(r => r.kind === 'select').args.needsModelDiversity, true);
  assert.equal(result.validation, 'pending');
  assert.equal(result.status, 'decision_required');
  assert.equal(result.routing_diagnostics.free_only, true);
});

test('CLI bridge forwards hard free constraint and specialist review mode', async () => {
  const { selectorArguments } = await import('../tools/runtime/bridge.mjs');
  const flags = selectorArguments({ mode: 'review', freeOnly: true, reviewMode: 'specialist' }, 'select-model.ps1');
  assert.equal(flags[flags.indexOf('-FreeOnly') + 1], 'true');
  assert.equal(flags[flags.indexOf('-ReviewMode') + 1], 'specialist');
});

test('model parser keeps provider identity and nested model id', () => {
  assert.deepEqual(splitModel('go/vendor/model'), { providerID: 'go', modelID: 'vendor/model' });
  assert.throws(() => splitModel('missing-provider'));
});
test('decision resume ignores advisory model fields but preserves bounded task constraints', () => {
  const base = { agentID:'engineer',workflowID:'build', task:'Fix only src/a.ts', needsWrites:true, taskTypes:['bounded_feature'] };
  assert.equal(sameDecisionAssignment(
    { ...base, selectedModel:'opencode/a', selectionReason:'first rationale' },
    { ...base, selectedModel:'opencode/b' },
  ), true);
  assert.equal(sameDecisionAssignment(base, { ...base, task:'Fix src/b.ts' }), false);
  assert.equal(sameDecisionAssignment(base, { ...base, needsWrites:false }), false);
});
test('selected B is dispatched and independently observed, parent A unchanged', async t => {
  const f = await fixture(t); const before = structuredClone(f.sessions.get('parent'));
  const result = await f.service.execute(args, f.ctx);
  assert.equal(result.status, 'completed'); assert.equal(result.validation, 'pending');
  assert.equal(result.parent_model, 'opencode/free-parent');
  assert.equal(result.attempts[0].observed_model, 'opencode-go/model-b');
  assert.equal(f.requests.find(r => r.kind === 'prompt').body.agent, 'engineer');
  assert.deepEqual(f.requests.find(r => r.kind === 'prompt').body.model, { providerID: 'opencode-go', modelID: 'model-b' });
  assert.deepEqual(f.sessions.get('parent'), before);
  const permission = f.requests.findIndex(r => r.kind === 'permission');
  const created = f.requests.findIndex(r => r.kind === 'create');
  assert.ok(permission >= 0 && created > permission, 'native permission must precede creation and inference');
  assert.ok(f.sessions.get('child1').permission.some(r => r.permission === 'secret-tool' && r.action === 'deny'));
});
test('wrong-model adapter negative control fails and does not earn selected-model success', async t => {
  const f = await fixture(t, { wrongModel: true }); const result = await f.service.execute(args, f.ctx);
  assert.equal(result.execution_status, 'failed'); assert.equal(result.attempts[0].failure, 'binding');
  assert.equal(result.attempts[0].observed_model, 'opencode/free-parent'); assert.equal(f.requests.filter(r => r.kind === 'prompt').length, 1);
  assert.ok(f.requests.some(r => r.kind === 'abort'));
});
test('SDK must echo preserved session permission rules before inference', async t => {
  const f = await fixture(t, { stripPermission: true }); const result = await f.service.execute(args, f.ctx);
  assert.notEqual(result.status, 'completed'); assert.equal(f.requests.filter(r => r.kind === 'prompt').length, 0);
});
test('task permission rejection prevents session creation', async t => {
  const f = await fixture(t, { deny: true }); await assert.rejects(f.service.execute(args, f.ctx), /denied/);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 0);
});
test('configured depth respected before creation', async t => {
  const f = await fixture(t, { depth: 0 }); await assert.rejects(f.service.execute(args, f.ctx), /depth/);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 0);
});
test('one role can execute B then C without editing a shared model pin', async t => {
  const f = await fixture(t, { models: ['opencode-go/b', 'opencode-go/c'] });
  const b = await f.service.execute(args, f.ctx);
  const c = await f.service.execute({ ...args, task: 'A different task' }, { ...f.ctx, messageID: 'next-message' });
  assert.equal(b.attempts[0].observed_model, 'opencode-go/b'); assert.equal(c.attempts[0].observed_model, 'opencode-go/c');
});
test('duplicate completion delivery does not launch another child', async t => {
  const f = await fixture(t); await f.service.execute(args, f.ctx);
  const replay = await f.service.execute(args, f.ctx);
  assert.equal(replay.replay, true); assert.equal(f.requests.filter(r => r.kind === 'prompt').length, 1);
});
test('simultaneous identical dispatch coalesces to one execution', async t => {
  const f = await fixture(t); await Promise.all([f.service.execute(args, f.ctx), f.service.execute(args, f.ctx)]);
  assert.equal(f.requests.filter(r => r.kind === 'prompt').length, 1);
});
test('background delegation returns after dispatch while the worker is observed separately', async t => {
  const f = await fixture(t);
  const updates = [];
  const result = await f.service.execute({ ...args, background: true }, { ...f.ctx, metadata: update => updates.push(update) });
  assert.equal(result.status, 'running');
  assert.equal(result.attempts[0].status, 'starting');
  assert.equal(f.requests.filter(r => r.kind === 'prompt').length, 1);
  for (let i = 0; i < 40 && !updates.some(update => update.metadata?.freelancer_status === 'completed'); i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(result.status, 'running', 'the completed dispatch result remains an honest start receipt');
  assert.equal(result.attempts[0].status, 'completed');
  assert.ok(updates.some(update => update.metadata?.freelancer_status === 'completed'));
});
test('timeout aborts actual session, no automatic replacement writer', async t => {
  const f = await fixture(t, { hang: true }); const result = await f.service.execute(args, f.ctx);
  assert.equal(result.execution_status, 'failed'); assert.equal(result.attempts[0].abort_verified, true);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 1);
});
test('unverified abort retains evidence and never automatically replaces the writer', async t => {
  const f = await fixture(t, { hang: true, abortFails: true }); const result = await f.service.execute(args, f.ctx);
  assert.equal(result.execution_status, 'stop_unverified');
  const names = await readdir(path.join(f.root, '.state', 'delegation')); assert.ok(!names.some(n => n.endsWith('.lock')));
  assert.equal(JSON.parse(await readFile(path.join(f.root, '.state', 'delegation', `${result.task_id}.json`))).execution_status, 'stop_unverified');
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 1);
});

test('independent writers in one worktree dispatch before either finishes', async t => {
  const f = await fixture(t);
  const prompt = f.client.session.promptAsync;
  const waiting = [];
  // Neither child can complete until both prompts arrive. A global writer lock
  // makes this fail rather than accidentally passing two serial executions.
  f.client.session.promptAsync = req => new Promise((resolve, reject) => {
    waiting.push({ req, resolve, reject });
    if (waiting.length === 2) for (const row of waiting) prompt(row.req).then(row.resolve, row.reject);
  });

  const results = await Promise.all([
    f.service.execute({ ...args, task: 'Edit only first.txt.' }, { ...f.ctx, callID: 'first' }),
    f.service.execute({ ...args, task: 'Edit only second.txt.' }, { ...f.ctx, callID: 'second' }),
  ]);
  assert.deepEqual(results.map(r => r.status), ['completed', 'completed']);
  assert.equal(new Set(results.map(r => r.attempts[0].child_session)).size, 2);
  assert.equal(new Set(results.map(r => r.task_id)).size, 2);
  assert.equal(f.records.length, 2);
});
test('ambiguous prompt submission cannot release writer for an unsafe replacement', async t => {
  const f = await fixture(t, { submitTimeout: true }); const result = await f.service.execute(args, f.ctx);
  assert.equal(result.execution_status, 'stop_unverified'); assert.equal(f.requests.filter(r => r.kind === 'create').length, 1);
});
test('read-only role forces write restrictions even when caller asks for writes', async t => {
  const f = await fixture(t); await f.service.execute({ ...args, agentID:'researcher', workflowID:'explore' }, f.ctx);
  const p = f.sessions.get('child1').permission;
  assert.ok(!p.some(r => r.permission === 'bash' && r.action === 'deny'));
  await f.service.checkTool({ sessionID: 'child1', tool: 'bash' }, { args: { command: 'git diff --stat' } });
  await assert.rejects(f.service.checkTool({sessionID:'child1',tool:'edit'},{args:{}}), /Read-only/);
  const handoff = f.requests.find(r=>r.kind==='prompt').body.parts[0].text;
  assert.match(handoff, /content_index status\/search/);
  assert.match(handoff, /not a shell sandbox/);
  assert.match(handoff, /Working directory:/);
  assert.ok(p.some(r => r.permission === 'edit' && r.action === 'deny'));
});
test('unapproved overage and weak selection never execute', async t => {
  const f = await fixture(t, { overage: true }); const r = await f.service.execute(args, f.ctx);
  assert.equal(r.status, 'overage_not_authorized'); assert.equal(f.requests.filter(x => x.kind === 'create').length, 0);
  const g = await fixture(t, { adequacy: 'weak' }); const q = await g.service.execute(args, g.ctx);
  assert.equal(q.execution_status, 'no_qualified_route');
});
test('all assistant tool continuations must retain selected binding', () => {
  const b = { providerID: 'go', modelID: 'b' };
  const first = assistant('1', b, { finish: 'tool-calls' });
  const second = assistant('2', b);
  assert.equal(observe([first, second], 'go/b').usage.input, 20);
  assert.throws(() => observe([first, assistant('2', { providerID: 'go', modelID: 'a' })], 'go/b'), /differs/);
});
test('same-model independent sessions are measured separately, duplicate message ids counted once', () => {
  const a = assistant('a', { providerID: 'go', modelID: 'b' });
  const b = assistant('b', { providerID: 'go', modelID: 'b' });
  assert.equal(observe([a, a], 'go/b').usage.input, 10);
  assert.equal(observe([b], 'go/b').usage.input, 10);
});
test('missing usage is unknown, not measured zero', () => {
  const m = assistant('a', { providerID: 'go', modelID: 'b' }); delete m.info.tokens;
  assert.equal(observe([m], 'go/b').usage, null);
});
test('quota vs binding vs provider errors stay separate', () => {
  assert.equal(failureKind({ name: 'FreeUsageLimitError' }), 'quota');
  assert.equal(failureKind({ name: 'BindingFailure' }), 'binding');
  assert.equal(failureKind({ data: { statusCode: 429 } }), 'throttle');
});


test('selector arguments preserve composite task categories and rejected routes', async () => {
  const { selectorArguments } = await import('../tools/runtime/bridge.mjs');
  const a = selectorArguments({ mode: 'build', taskTypes: ['ml', 'debugging'], rejected: ['go/b'], currentModel: 'go/a', needsWrites: true }, 'select-model.ps1');
  assert.equal(a[a.indexOf('-TaskType') + 1], 'ml,debugging');
  assert.equal(a[a.indexOf('-ExcludedModels') + 1], 'go/b');
  assert.equal(a[a.indexOf('-CurrentModel') + 1], 'go/a');
});
test('auxiliary process timeout returns instead of hanging the parent', async () => {
  const { runProcess } = await import('../tools/runtime/bridge.mjs');
  await assert.rejects(runProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeoutMs: 25 }), /timed out/);
});
test('missing child identity is not an echoed-selector success', () => {
  const m = assistant('a', { providerID: 'go', modelID: 'b' }); delete m.info.providerID;
  assert.throws(() => observe([m], 'go/b'), /lacks runtime/);
});
test('provider error placeholder zeros are not measured consumption', () => {
  const m=assistant('a',{providerID:'go',modelID:'b'},{error:{name:'APIError'},tokens:{input:0,output:0,cache:{read:0,write:0}}});
  assert.equal(observe([m],'go/b').usage,null);
});

test('paid parent to free child retains provider-qualified identity', async t => {
  const f = await fixture(t, { parentModel: 'openai/paid-parent', models: ['opencode/free-child'], surface: 'opencode-free' });
  const r = await f.service.execute({ ...args, needsWrites: false }, f.ctx);
  assert.equal(r.parent_model, 'openai/paid-parent');
  assert.equal(r.attempts[0].observed_model, 'opencode/free-child');
  assert.equal(r.status, 'completed');
});

test('free provider failure returns to host instead of mechanically choosing the next model', async t => {
  const f=await fixture(t,{failFirst:true,models:['opencode/a','opencode/b'],surface:'opencode-free'});
  const r=await f.service.execute({...args,needsWrites:false},f.ctx);
  assert.equal(r.status,'decision_required');assert.equal(r.attempts.length,1);
  assert.equal(r.attempts[0].failure,'provider');assert.equal(r.attempts[0].abort_verified,true);
  assert.equal(f.requests.filter(r=>r.kind==='prompt').length,1);
});

test('free failure never silently falls through to a subscription route', async t => {
  const f=await fixture(t,{failFirst:true,models:['opencode/a','opencode-go/b'],surfaces:['opencode-free','opencode-go']});
  const r=await f.service.execute({...args,needsWrites:false},f.ctx);
  assert.equal(r.execution_status,'failed');assert.equal(r.attempts.length,1);
  assert.equal(f.requests.filter(r=>r.kind==='prompt').length,1);
});

test('subscription provider failure returns to parent without a retry', async t => {
  const f=await fixture(t,{failFirst:true});
  const r=await f.service.execute({...args,needsWrites:false},f.ctx);
  assert.equal(r.execution_status,'failed');assert.equal(r.attempts.length,1);
  assert.equal(f.requests.filter(r=>r.kind==='prompt').length,1);
});
test('independent review executes the selected different model as a read-only reviewer', async t => {
  const f=await fixture(t,{models:['opencode-go/independent-reviewer']});
  const r=await f.service.execute({...args,agentID:'engineer', workflowID:'review',needsWrites:false,needsModelDiversity:true,excludeModel:'opencode/free-parent'},f.ctx);
  assert.equal(r.agent.id,'engineer');assert.equal(r.workflow.mode,'review');assert.equal(r.role,undefined);assert.equal(r.attempts[0].observed_model,'opencode-go/independent-reviewer');
  assert.notEqual(r.parent_model,r.attempts[0].observed_model);
  await assert.rejects(f.service.checkTool({sessionID:'child1',tool:'edit'},{args:{}}),/Read-only/);
});
test('null route cannot create a child or become an empty model id', async t => {
  const f = await fixture(t, { noRoute: true });
  const r = await f.service.execute(args, f.ctx);
  assert.equal(r.execution_status, 'no_qualified_route'); assert.equal(r.attempts.length, 0);
  assert.equal(f.requests.filter(r => r.kind === 'create').length, 0);
});
test('worker cannot create another worker even if a permissive host approves task', async t => {
  const f = await fixture(t);
  f.sessions.set('grandparent',{id:'grandparent'});f.sessions.get('parent').parentID='grandparent';
  await assert.rejects(f.service.execute(args, f.ctx), /Nested/);
});
test('explicit no-write user assignment overrides a mistaken writer request', async t => {
  const f = await fixture(t);
  f.messages.set('parent', [{info:{role:'user'},parts:[{type:'text',text:'Explain only. Do not modify files.'}]}]);
  await f.service.execute(args, f.ctx);
  assert.equal(f.sessions.get('child1').metadata.freelancer.readOnly, true);
  // No-write blocks source writes; index rebuild remains permitted maintenance.
  await f.service.checkTool({ sessionID: 'child1', tool: 'content_index' }, { args: {operation:'rebuild'} });
  await f.service.checkTool({ sessionID: 'child1', tool: 'content_index' }, { args: {operation:'search'} });
});
test('parent ask and deny permissions remain authoritative in child', async t => {
  const f = await fixture(t);
  f.sessions.get('parent').permission.push({permission:'bash',pattern:'*',action:'ask'});
  f.sessions.get('parent').permission.push({permission:'bash',pattern:'git status*',action:'allow'});
  await f.service.execute(args, f.ctx);
  assert.ok(f.sessions.get('child1').permission.some(r=>r.permission==='bash' && r.action==='ask'));
  assert.ok(f.sessions.get('child1').permission.some(r=>r.permission==='bash' && r.pattern==='git status*' && r.action==='allow'));
});
test('read-only guard and binding survive controller restart through session metadata', async t => {
  const f = await fixture(t);
  await f.service.execute({...args,needsWrites:false},f.ctx);
  const restarted=createDelegator({client:f.client,toolkitRoot:f.root,directory:f.root});
  await restarted.checkTool({sessionID:'child1',tool:'bash'},{args:{command:'git status'}});
  await assert.rejects(restarted.checkTool({sessionID:'child1',tool:'write'},{args:{}}),/Read-only/);
  await assert.rejects(restarted.checkModel({sessionID:'child1',model:{providerID:'wrong',id:'model'}}),/binding/);
});
test('nested researcher blocked even when host depth would permit it', async t => {
  const f = await fixture(t, {depth:2});
  f.sessions.set('grandparent',{id:'grandparent'}); f.sessions.get('parent').parentID='grandparent';
  await assert.rejects(f.service.execute({...args,agentID:'researcher', workflowID:'explore',needsWrites:false},f.ctx),/Nested/);
  assert.equal(f.requests.filter(r=>r.kind==='create'||r.kind==='select').length,0);
  const limited=await fixture(t,{depth:1});
  limited.sessions.set('grandparent',{id:'grandparent'}); limited.sessions.get('parent').parentID='grandparent';
  await assert.rejects(limited.service.execute({...args,agentID:'researcher', workflowID:'explore',needsWrites:false},limited.ctx),/depth/);
});
