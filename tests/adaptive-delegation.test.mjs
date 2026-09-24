import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { normalizePreferences, strategyGuidance } from '../shared/strategy.mjs';
import { delegationPool, effectiveDelegationPreferences } from '../domain/delegation-policy.mjs';
import { workspaceCatalog } from '../domain/workspace.mjs';
import { gitToolGuard } from '../backend/tools/runtime/git-guard.mjs';
import { unifiedFixture } from './fixtures/unified-agents.mjs';
import { startServer } from '../server/http.mjs';

const job = { agentID: 'engineer', task: 'Implement the bounded change in src/example.js and verify it.', selectedModel: 'opencode/free-b' };
async function budget(f, patch, scope = 'session') {
  const sessionID = scope === 'session' ? f.parent.id : undefined;
  const saved = await f.app.readPreferences(f.project.id, sessionID);
  return f.app.savePreferences(f.project.id, {
    scope, sessionID, revision: saved.revision, preferences: { ...saved.defaults, ...patch },
  });
}
async function workflow(f, id, patch) {
  const current = workspaceCatalog(await f.store.read('settings')).workflows.find(w => w.id === id);
  return f.app.saveWorkflow({ ...current, ...patch });
}

test('coordination instructions do not prescribe a team from a legacy strategy preset', () => {
  const p = normalizePreferences({ strategy: 'research-heavy' });
  assert.equal(p.subscriptionDelegation, 'ask', 'no silent spending-policy migration');
  assert.match(strategyGuidance(p), /No helper or team shape is mandatory/);
  assert.doesNotMatch(strategyGuidance(p), /Use Researcher for evidence/);
  assert.throws(() => normalizePreferences({ subscriptionDelegation: 'anything' }), /Invalid/);
});

test('the root budget honors user limits independently of workflow labels and excludes metered routes', () => {
  const models = [
    { id: 'opencode/free', provider: 'opencode', costClass: 'free', variants: ['high'] },
    { id: 'opencode-go/paid', provider: 'opencode-go', costClass: 'subscription', variants: [] },
    { id: 'openai/api', provider: 'openai', costClass: 'metered', variants: ['high'] },
  ];
  const connected = ['opencode', 'opencode-go', 'openai'];
  assert.deepEqual(delegationPool(normalizePreferences(), { category: 'connected' }, models, connected), ['opencode/free', 'opencode-go/paid']);
  assert.deepEqual(delegationPool(normalizePreferences({ costPreference: 'free-only' }), { category: 'subscriptions' }, models, connected), ['opencode/free']);
  assert.deepEqual(delegationPool(normalizePreferences({ excludedModels: ['opencode/free'] }), { category: 'connected' }, models, connected, 'high'), []);
});

test('changing a budget cannot expand an active request, but current limits can tighten it', () => {
  const current = normalizePreferences({ subscriptionDelegation: 'automatic', maxParallel: 6 });
  const captured = normalizePreferences({ delegation: 'ask', costPreference: 'free-only', maxParallel: 2 });
  const p = effectiveDelegationPreferences(current, captured);
  assert.equal(p.subscriptionDelegation, 'ask');
  assert.equal(p.delegation, 'ask');
  assert.equal(p.costPreference, 'free-only');
  assert.equal(p.maxParallel, 2);
});

test('empty delegation capacity does not prevent a valid parent chat or silently open the pool', async t => {
  const f = await unifiedFixture(t);
  await budget(f, { excludedProviders: ['opencode', 'opencode-go'] });
  const ctx = await f.send();
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0].body.system, /No models currently satisfy/);
  const catalog = await f.delegator.execute({}, ctx);
  assert.deepEqual(catalog.budget.modelPool, []);
  const { selectedModel, ...request } = job;
  const r = await f.delegator.execute(request, ctx);
  assert.equal(r.status, 'delegation_unavailable');
  assert.deepEqual(r.attempts, []);
  assert.equal(f.permissions.length, 0);
  assert.equal(f.prompts.length, 1);
});


test('catalog is optional and an ordinary free assignment starts in one call', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  const catalog = await f.delegator.execute({}, ctx);
  assert.ok(catalog.agents.every(a => a.expertise && Array.isArray(a.allowedModes)));
  const { selectedModel, ...request } = job;
  assert.equal((await f.delegator.execute(request, ctx)).status, 'completed');
  assert.equal(f.permissions.length, 0);
  assert.equal(f.sessions.size, 2);
  const executed = await f.delegator.execute(job, ctx);
  assert.equal(executed.status, 'completed');
  assert.equal(f.permissions.length, 0, 'free delegation has no extra app-owned assignment prompt');
  assert.equal(executed.parent_model, 'opencode/free-a');
});
test('named assignments inherit Build authority, and explicit inspection narrows it', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  const r = await f.delegator.execute({ ...job, agentID: 'designer' }, ctx);
  assert.equal(r.status, 'completed');
  assert.equal(r.workflow.id, 'build');
  assert.equal(r.read_only, false);
  assert.equal(f.selections.at(-1).needsWrites, true);
  const inspected = await f.delegator.execute({ ...job, needsWrites: false, task: 'Inspect a different bounded part.' }, ctx);
  assert.equal(inspected.read_only, true);
  await assert.rejects(f.delegator.checkTool({ sessionID: inspected.attempts[0].child_session, tool: 'edit' }, { args: {} }), /Read-only/);
});


test('Review guides the child without becoming a tool permission boundary', async t => {
  const f = await unifiedFixture(t), ctx = await f.send({ workflowID: 'review' });
  const r = await f.delegator.execute({ ...job, agentID: 'designer', task: 'Review the bounded module.' }, ctx);
  assert.equal(r.workflow.id, 'review');
  assert.equal(r.read_only, false);
  assert.equal(f.selections.at(-1).needsModelDiversity, true);
  const writer = await f.delegator.execute({ ...job, workflowID: 'build', needsWrites: true, task: 'Implement the bounded fix.' }, ctx);
  assert.equal(writer.status, 'completed');
  await f.delegator.checkTool({ sessionID: r.attempts[0].child_session, tool: 'delegate' }, { args: job });
  const inspected = await f.delegator.execute({ ...job, needsWrites: false, task: 'Inspect only; do not modify files.' }, ctx);
  assert.equal(inspected.read_only, true);
});

test('a workflow guides the job without creating a second model or concurrency filter', async t => {
  const f = await unifiedFixture(t);
  await workflow(f, 'review', { category: 'subscriptions', parallel: false, variant: 'high' });
  await budget(f, { costPreference: 'free-only', maxParallel: 4 });
  const ctx = await f.send();
  const r = await f.delegator.execute({ ...job, workflowID: 'review', task: 'Review src/example.js.' }, ctx);
  assert.equal(r.status, 'completed');
  assert.equal(r.runtime_policy.max_parallel, 4);
  assert.equal(r.attempts[0].observed_model, 'opencode/free-b');
  assert.equal(f.prompts.at(-1).body.variant, undefined);
  const next = await f.send({ workflowID: 'review' });
  const pool = (await f.delegator.execute({}, next)).budget.modelPool;
  assert.ok(pool.includes('opencode/free-b'));
  assert.ok(pool.length > 0, 'workflow category cannot silently empty the root model pool');
});
test('omitted and explicit inherited workflows coalesce into one child', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  const [a, b] = await Promise.all([
    f.delegator.execute(job, ctx), f.delegator.execute({ ...job, workflowID: 'build' }, ctx),
  ]);
  assert.equal(a.status, 'completed');
  assert.equal(b.task_id, a.task_id);
  assert.equal(f.sessions.size, 2);
  assert.equal(f.permissions.length, 0);
});


test('paid subscriptions keep the native paid permission without a free-child assignment prompt', async t => {
  const f = await unifiedFixture(t);
  await budget(f, { subscriptionDelegation: 'automatic' });
  const ctx = await f.send();
  const r = await f.delegator.execute({ ...job, selectedModel: 'opencode-go/paid' }, ctx);
  assert.equal(r.status, 'completed');
  assert.deepEqual(f.permissions.map(p => p.permission), ['paid_delegate']);
  assert.equal(r.model_selection.source, 'host');
  assert.equal(r.parent_model, 'opencode/free-a');
});

test('paid-model denial remains authoritative while legacy ask-each-assignment is advisory in v5', async t => {
  const f = await unifiedFixture(t);
  await budget(f, { subscriptionDelegation: 'automatic' });
  const ctx = await f.send();
  const denied = await f.delegator.execute({ ...job, selectedModel: 'opencode-go/paid' }, {
    ...ctx, ask: async p => { if (p.permission === 'paid_delegate') throw Error('Native user denied'); },
  });
  assert.equal(denied.status, 'paid_permission_declined');
  assert.equal(f.sessions.size, 1);
  await budget(f, { delegation: 'ask' });
  const next = await f.send({ text: 'Use opencode-go/paid for the delegated task.' });
  const allowed = await f.delegator.execute({ ...job, task: 'Another bounded change', selectedModel: 'opencode-go/paid' }, next);
  assert.equal(allowed.status, 'completed');
  assert.equal(f.permissions.at(-1).permission, 'paid_delegate');
});
test('subscription preference changes never bypass native paid permission', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  await budget(f, { subscriptionDelegation: 'automatic' });
  assert.equal((await f.delegator.execute({ ...job, selectedModel: 'opencode-go/paid' }, ctx)).status, 'completed');
  const next = await f.send();
  assert.equal((await f.delegator.execute({ ...job, task: 'Second bounded task', selectedModel: 'opencode-go/paid' }, next)).status, 'completed');
  await budget(f, { subscriptionDelegation: 'ask' });
  assert.equal((await f.delegator.execute({ ...job, task: 'Third bounded task', selectedModel: 'opencode-go/paid' }, next)).status, 'completed');
  assert.deepEqual(f.permissions.map(p => p.permission), ['paid_delegate', 'paid_delegate', 'paid_delegate']);
});


test('manual delegation blocks workers while agent-access matrices remain guidance', async t => {
  const f = await unifiedFixture(t);
  await budget(f, { delegation: 'manual', agentAccess: { engineer: ['review'] } });
  const ctx = await f.send();
  await assert.rejects(f.delegator.execute(job, ctx), /disabled by the user/);
  await budget(f, { delegation: 'automatic', agentAccess: { engineer: ['review'] } });
  const next = await f.send();
  const designer = await f.delegator.execute({ ...job, agentID: 'designer', task: 'Handle the bounded UI task.' }, next);
  assert.equal(designer.status, 'completed');
});
test('an unavailable default is advisory, while an explicit unavailable model never falls back', async t => {
  const f = await unifiedFixture(t);
  const agent = await f.app.saveAgent({ name: 'Specialist', prompt: 'Investigate this area.', response: 'balanced', approach: 'practical', model: 'opencode-go/paid' });
  await budget(f, { costPreference: 'free-only' });
  const ctx = await f.send(), { selectedModel, ...request } = job;
  const r = await f.delegator.execute({ ...request, agentID: agent.id }, ctx);
  assert.equal(r.status, 'completed');
  assert.equal(r.model_selection.source, 'runtime');
  assert.equal(f.sessions.size, 2);
  await assert.rejects(f.delegator.execute({ ...job, agentID: agent.id, selectedModel: 'opencode-go/paid' }, ctx), /excluded/);
});

test('a free-only user instruction prevents a paid default even without a saved free-only budget', async t => {
  const f = await unifiedFixture(t);
  const agent = await f.app.saveAgent({ name: 'Specialist', prompt: 'Investigate.', response: 'balanced', approach: 'practical', model: 'opencode-go/paid' });
  await budget(f, { subscriptionDelegation: 'automatic' });
  const ctx = await f.send({ text: 'Use only free models for delegated work.' });
  const r = await f.delegator.execute({ agentID: agent.id, task: 'Inspect the bounded module.' }, ctx);
  assert.equal(r.status, 'completed');
  assert.equal(f.selections.at(-1).freeOnly, true);
  assert.equal(f.selections.at(-1).selectedModel, undefined);
  assert.equal(f.permissions.length, 0);
});


test('Git agreement is authoritative while Git expertise and Sync remain optional guidance', async t => {
  const f = await unifiedFixture(t), ctx = await f.send({ agentID: 'git', workflowID: 'explore' });
  await f.delegator.checkTool({ sessionID: f.parent.id, tool: 'delegate' }, { args: job });
  const r = await f.delegator.execute({ ...job, agentID: 'researcher', task: 'Investigate repository conventions.' }, ctx);
  assert.equal(r.status, 'completed');
  assert.equal(r.read_only, false);
  await gitToolGuard({ toolkitRoot: f.root, directory: f.directory, input: { sessionID: f.parent.id, tool: 'delegate' }, args: job, client: f.client });
  const build = await f.send({ agentID: 'git', workflowID: 'build' });
  await assert.rejects(
    f.app.gitAgentAction({ directory: f.directory, sessionID: f.parent.id, messageID: build.messageID, action: 'execute', planID: 'forged' }),
    error => { assert.doesNotMatch(error.message, /Sync workflow/); return true; },
  );
  const sync = await f.send({ agentID: 'engineer', workflowID: 'sync' });
  assert.equal((await f.delegator.execute({ ...job, task: 'Coordinate the bounded sync preparation.' }, sync)).status, 'completed');
  await gitToolGuard({ toolkitRoot: f.root, directory: f.directory, input: { sessionID: f.parent.id, tool: 'bash' }, args: { command: 'node --version' }, client: f.client });
  await f.store.update('settings', settings => { settings.gitProjects = { [f.project.id]: { tracking: true, preset: 'main' } }; return settings; });
  await assert.rejects(
    gitToolGuard({ toolkitRoot: f.root, directory: f.directory, input: { sessionID: f.parent.id, tool: 'bash' }, args: { command: 'git status' }, client: f.client }),
    /agreement|git_project/,
  );
});
test('preference HTTP reads/writes preserve scope, revisions, hidden limits and local-only guards', async t => {
  const f = await unifiedFixture(t);
  const web = await startServer({ application: f.app, assets: f.directory });
  t.after(async () => { await web.sender.close(); web.server.closeAllConnections(); await new Promise(r => web.server.close(r)); });
  const headers = { 'X-Freelancer-Client': 'webpage', 'Content-Type': 'application/json' };
  const route = `${web.url}/api/preferences?project=${f.project.id}&session=${f.parent.id}`;
  assert.equal((await fetch(route)).status, 403);
  assert.equal((await fetch(route, { headers: { ...headers, Origin: 'https://foreign.example' } })).status, 403);
  await budget(f, { excludedModels: ['opencode/free-a'], childTimeoutSeconds: 120 });
  const before = await (await fetch(route, { headers })).json();
  const patch = { project: f.project.id, scope: 'session', sessionID: f.parent.id, revision: before.revision,
    preferences: { ...before.defaults, subscriptionDelegation: 'automatic', maxParallel: 4 } };
  const write = () => fetch(`${web.url}/api/preferences`, { method: 'PUT', headers, body: JSON.stringify(patch) });
  assert.equal((await write()).status, 200);
  const after = await (await fetch(route, { headers })).json();
  assert.equal(after.defaults.subscriptionDelegation, 'automatic');
  assert.deepEqual(after.defaults.excludedModels, before.defaults.excludedModels);
  assert.equal(after.defaults.childTimeoutSeconds, 120);
  assert.notEqual((await write()).status, 200, 'stale save must not overwrite');
  const project = await f.app.readPreferences(f.project.id);
  assert.equal(project.defaults.subscriptionDelegation, 'ask');
  const foreign = { id: 'ses_foreign', directory: f.root };
  f.sessions.set(foreign.id, foreign);
  assert.notEqual((await fetch(route.replace(f.parent.id, foreign.id), { headers })).status, 200);
  await assert.rejects(f.app.savePreferences(f.project.id, { ...patch, sessionID: foreign.id, revision: after.revision }), /another project/);
  assert.equal((await f.app.readPreferences(f.project.id, f.parent.id)).defaults.maxParallel, 4);
});

test('the retired app-owned Build allowlist cannot silently restrict future custom agents', async () => {
  await assert.rejects(access(new URL('../backend/opencode/agents/build.md', import.meta.url)), { code: 'ENOENT' });
  const prompt = await readFile(new URL('../backend/opencode/global-instructions.md', import.meta.url), 'utf8');
  assert.match(prompt, /No orientation helper or team topology is mandatory/);
  assert.match(prompt, /Keep provider\/auth\/quota failures separate/);
});

test('a concurrency refusal can retry after capacity frees without replaying any started child', async t => {
  const f = await unifiedFixture(t);
  await budget(f, { maxParallel: 1 });
  const ctx = await f.send();
  // A native child surviving restart occupies a slot even without local state.
  const running = { id: 'ses_running', parentID: f.parent.id, directory: f.directory, metadata: { freelancer: { selected: 'opencode/free-a' } } };
  f.sessions.set(running.id, running);
  f.status[running.id] = { type: 'busy' };
  const refused = await f.delegator.execute(job, ctx);
  assert.equal(refused.status, 'parallel_limit');
  assert.deepEqual(refused.attempts, []);
  assert.equal(f.prompts.length, 1);
  delete f.status[running.id];
  const dispatched = await f.delegator.execute(job, ctx);
  assert.equal(dispatched.status, 'completed');
  assert.equal(dispatched.task_id, refused.task_id);
  assert.equal(f.prompts.length, 2);
  const replay = await f.delegator.execute(job, ctx);
  assert.equal(replay.replay, true);
  assert.equal(f.prompts.length, 2);
});

test('catalog reports tightened effective limits rather than the older captured pool', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  await budget(f, { excludedModels: ['opencode/free-b'], costPreference: 'free-only', maxParallel: 1 });
  const catalog = await f.delegator.execute({}, ctx);
  assert.deepEqual(catalog.budget.modelPool, ['opencode/free-a']);
  assert.equal(catalog.budget.maxParallel, 1);
  assert.equal(catalog.budget.freeOnly, true);
});


test('legacy captured assignments do not silently gain Build write authority after an upgrade', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  const userID = f.rows.get(f.parent.id).at(-1).info.parentID;
  await f.store.update('requests', s => {
    const record = s.records[userID];
    record.policyVersion = 3;
    delete record.delegationPool;
    return s;
  });
  const r = await f.delegator.execute(job, ctx);
  assert.equal(r.status, 'completed');
  assert.equal(r.read_only, true);
  const next = await f.send();
  const current = await f.delegator.execute({ ...job, task: 'A newly authorized Build assignment.' }, next);
  assert.equal(current.read_only, false);
});

test('unknown future execution contracts cannot authorize delegation', async t => {
  const f = await unifiedFixture(t), ctx = await f.send();
  const userID = f.rows.get(f.parent.id).at(-1).info.parentID;
  await f.store.update('requests', s => { s.records[userID].policyVersion = 99; return s; });
  await assert.rejects(f.delegator.execute(job, ctx), /current Freelancer request/);
  assert.equal(f.prompts.length, 1);
});


test('simultaneous distinct assignments reserve the root concurrency slot atomically', { timeout: 5000 }, async t => {
  const f = await unifiedFixture(t);
  await budget(f, { maxParallel: 1 });
  const ctx = await f.send();
  const create = f.client.session.create;
  let release, entered, creates = 0;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  f.client.session.create = async (...args) => { creates++; entered(); await held; return create(...args); };
  const first = f.delegator.execute({ ...job, task: 'First bounded assignment.' }, ctx);
  await started;
  const competing = f.delegator.execute({ ...job, task: 'Second distinct assignment.' }, ctx);
  try {
    const second = await competing;
    assert.equal(second.status, 'parallel_limit');
    assert.equal(creates, 1);
  } finally { release(); }
  assert.equal((await first).status, 'completed');
});
