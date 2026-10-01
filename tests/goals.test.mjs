import test from 'node:test';
import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { createGoals } from '../server/goals.mjs';
import { eligibleGoalModels, availabilityFailure } from '../domain/goals.mjs';
import { isInternalMessage } from '../domain/sender.mjs';
import { buildRequestGroups } from '../domain/chat-view.mjs';
import { visibleTodosForRequest } from '../domain/todos.mjs';

async function fixture(t, options = {}) {
  const f = await localDataFixture({ timers: false, ...options }); t.after(() => f.close());
  const create = (id = 'saved_goal_test_0001', settings = {}) => f.goals.create(f.project.id, { id, objective: 'Implement and verify the requested feature', settings: { model: 'opencode/free', ...settings } });
  const current = async g => (await f.goals.list(f.project.id)).find(r => r.id === g.id);
  async function finish(g, outcome = 'continue', evidence = 'Verified test output') {
    const message = f.state.messages[g.session].findLast(m => m.info.role === 'user');
    const receipt = (await f.store.read('requests')).records[message.info.id];
    const assistant = { info: { id: `msg_assistant_${f.state.messages[g.session].length}`, role: 'assistant', parentID: message.info.id, agent: receipt.agent.id, providerID: 'opencode', modelID: 'free', finish: 'stop', time: { created: Date.now(), completed: Date.now() } }, parts: [{ type: 'text', text: 'Checkpoint ready' }] };
    f.state.messages[g.session].push(assistant);
    await f.goals.checkpoint({ directory: f.directory, sessionID: g.session, messageID: assistant.info.id, outcome, interpretation: 'The requested feature passes its acceptance checks', checkpoint: 'Implementation preserved', reason: outcome === 'complete' ? 'Required checks passed' : 'More useful work remains', evidence });
    delete f.state.status[g.session];
    await f.sender.tick(); await f.goals.tick();
  }
  return { ...f, create, current, finish };
}

test('saving is idempotent and starts no inference; only one goal may run per project', async t => {
  const f = await fixture(t), g = await f.create();
  const again = await f.create();
  assert.equal(g.session, again.session); assert.equal(g.status, 'ready');
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, 0);
  const second = await f.create('saved_goal_test_0002');
  await f.goals.start(f.project.id, g.id);
  await f.goals.start(f.project.id, g.id);
  await assert.rejects(f.goals.start(f.project.id, second.id), /Only one/);
  await f.sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, 1);
  assert.equal(f.state.sessions.filter(s => s.id === g.session).length, 1);
});

test('goals preserve encouraged delegation in saved choices and execution guidance', async t => {
  const f = await fixture(t, { persistPreferences: true }), g = await f.create('encouraged_goal_001', { preferences: { delegation: 'encouraged', maxParallel: 2 } });
  assert.equal(g.settings.preferences.delegation, 'encouraged');
  assert.equal((await f.app.readPreferences(f.project.id, g.session)).defaults.delegation, 'encouraged');
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  const dispatched = f.calls.find(call => call.route.endsWith('prompt_async'));
  assert.match(dispatched.options.body.system, /The user encourages delegation/);
  assert.match(dispatched.options.body.system, /Up to 2 simultaneous/);
});

test('goal continuation preserves conversation, root assignment, catalog and native todos', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  f.state.todos[g.session] = [{ content: 'Finish verification', status: 'pending', priority: 'high' }];
  const first = (await f.store.read('requests')).records[f.state.messages[g.session][0].info.id];
  await f.finish(g); await f.sender.tick();
  const records = Object.values((await f.store.read('requests')).records);
  assert.equal(records.length, 2); assert.equal(records[1].sessionID, g.session);
  assert.equal(records[1].rootRequestID, first.id);
  assert.equal(records[1].goalRunID, first.goalRunID);
  assert.deepEqual(records[1].catalog, first.catalog);
  assert.equal(f.state.todos[g.session][0].status, 'pending');
  assert.equal((await f.current(g)).status, 'running');
});

test('continue checkpoints dispatch the parent while independent workers stay active', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  f.state.sessions.push({ id: 'ses_independent_worker', parentID: g.session, directory: f.directory });
  f.state.status.ses_independent_worker = { type: 'busy' };
  await f.finish(g, 'continue'); await f.sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, 2);
  assert.equal(f.state.status.ses_independent_worker.type, 'busy');
  assert.equal((await f.current(g)).status, 'running');
});

test('missing checkpoint recovers once in the same goal chat without replay or confirmation', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  const user = f.state.messages[g.session][0];
  f.state.messages[g.session].push({ info: { id: 'ended_without_checkpoint', role: 'assistant', parentID: user.info.id,
    finish: 'stop', time: { created: Date.now(), completed: Date.now() } }, parts: [{ type: 'text', text: 'Partial work preserved' }] });
  delete f.state.status[g.session]; await f.sender.tick();
  await Promise.all([f.goals.tick(), f.goals.tick()]); await f.sender.tick();
  assert.equal((await f.current(g)).status, 'running');
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, 2);
  assert.match(f.state.messages[g.session].at(-1).parts[0].text, /Recover from native history/);
  assert.equal((await f.current(g)).session, g.session);
});

test('running goal automatically reconciles settled failed worker cards without replay', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  const worker = 'ses_settled_worker';
  f.state.sessions.push({ id: worker, parentID: g.session, directory: f.directory });
  f.state.messages[worker] = [
    { info: { id: 'settled_input', role: 'user', time: { created: Date.now() - 10000 } }, parts: [] },
    { info: { id: 'settled_error', role: 'assistant', parentID: 'settled_input', error: { name: 'MessageAbortedError' }, time: { completed: Date.now() } }, parts: [] },
  ];
  const records = f.sender.records, cancel = f.sender.cancel;
  let cards = [{ id: 'settled_worker_card', messageID: 'settled_input', status: 'failed' }];
  f.sender.records = async (p, s) => s === worker ? cards : records(p, s);
  f.sender.cancel = async (p, s, id) => s === worker ? (cards = cards.filter(d => d.id !== id)) : cancel(p, s, id);
  await f.goals.tick();
  assert.equal(cards.length, 0);
  assert.equal((await f.current(g)).status, 'running');
  assert.equal(f.calls.filter(c => c.route === `/session/${worker}/prompt_async`).length, 0);
});

test('settled parent input belonging to the goal is reconciled without dismissing unrelated input', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  const user = f.state.messages[g.session][0];
  f.state.messages[g.session].push({ info: { id: 'goal_input_error', role: 'assistant', parentID: user.info.id,
    error: { name: 'MessageAbortedError' }, time: { completed: Date.now() } }, parts: [] });
  delete f.state.status[g.session]; await f.sender.tick();
  const records = f.sender.records, cancel = f.sender.cancel;
  let cards = [{ id: 'goal_handoff_card', messageID: user.info.id, includedAt: 1, status: 'failed' },
    { id: 'unrelated_handoff_card', messageID: 'unaccepted', status: 'failed' }];
  f.sender.records = async (p, s) => [...await records(p, s), ...cards];
  f.sender.cancel = async (p, s, id) => cards.some(d => d.id === id) ? (cards = cards.filter(d => d.id !== id)) : cancel(p, s, id);
  await f.goals.tick();
  assert.deepEqual(cards.map(d => d.id), ['unrelated_handoff_card']);
  assert.equal((await f.current(g)).status, 'paused', 'unrelated failure still needs inspection');
});

test('uncertain worker input is retained for parent reconciliation and cannot silently complete the goal', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  const worker = 'ses_uncertain_completion_worker';
  f.state.sessions.push({ id: worker, parentID: g.session, directory: f.directory });
  f.state.messages[worker] = [];
  const records = f.sender.records;
  const card = { id: 'uncertain_completion_input', status: 'uncertain' };
  f.sender.records = async (p, s) => s === worker ? [card] : records(p, s);
  await f.finish(g, 'complete'); await f.sender.tick();
  assert.equal((await f.current(g)).status, 'running');
  assert.match(f.state.messages[g.session].at(-1).parts[0].text, /Reconcile unresolved worker delivery/);
  assert.equal(card.status, 'uncertain');
  assert.equal(f.calls.filter(c => c.route === `/session/${worker}/prompt_async`).length, 0);
});

test('workers keep a goal running while its parent is idle; Stop covers descendants only', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  f.state.sessions.push({ id: 'ses_goal_worker', parentID: g.session, directory: f.directory, title: 'Owned worker' });
  f.state.status.ses_goal_worker = { type: 'busy' }; f.state.status.ses_other = { type: 'busy' };
  await f.finish(g, 'waiting');
  assert.equal((await f.current(g)).status, 'running');
  assert.match((await f.current(g)).reason, /delegated/);
  await f.goals.stop(f.project.id, g.id);
  assert.equal(f.state.status.ses_goal_worker, undefined);
  assert.equal(f.state.status.ses_other.type, 'busy');
  assert.equal((await f.current(g)).status, 'paused');
  const count = f.calls.filter(c => c.route.endsWith('prompt_async')).length;
  await f.goals.tick(); await f.sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, count);
});

test('revision edits steer one chat and invalidate old completion reports', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  await f.goals.update(f.project.id, { id: g.id, revision: 1, objective: 'Include the new acceptance check' });
  await f.sender.tick();
  const revised = await f.current(g);
  assert.equal(revised.revision, 2); assert.equal(revised.revisions[0].objective, g.objective);
  assert.equal(revised.session, g.session);
  assert.ok(f.state.messages[g.session].some(m => m.parts.some(p => p.text?.includes('Steer handoff'))));
  assert.ok(!f.calls.some(c => c.route.endsWith('/abort')));
  assert.equal(f.calls.filter(c => c.route === '/session' && c.options.method === 'POST').length, 1);
});

test('completion requires evidence and reconciled tasks; questions after completion cannot restart automation', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  await f.finish(g, 'complete', '');
  assert.equal((await f.current(g)).status, 'paused');
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  await f.finish(g, 'complete', 'Acceptance: browser journey passed; no unfinished tasks');
  assert.equal((await f.current(g)).status, 'complete');
  await f.sender.send(f.project.id, g.session, { text: 'What changed?', model: 'opencode/free', agentID: 'engineer' });
  const latest = Object.values((await f.store.read('requests')).records).at(-1);
  assert.equal(latest.goalID, undefined);
  await f.goals.tick(); assert.equal((await f.current(g)).status, 'complete');
});

test('restart reconciles a running goal without replay and archive preserves the linked conversation', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  await f.goals.close();
  const recovered = createGoals(f.app, { sender: f.sender }); t.after(() => recovered.close()); await recovered.ready;
  assert.equal((await recovered.list(f.project.id))[0].status, 'running');
  assert.match((await recovered.list(f.project.id))[0].reason, /restart/);
  await recovered.tick(); assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, 1);
  await recovered.stop(f.project.id, g.id);
  await recovered.archive(f.project.id, g.id, true);
  assert.equal((await recovered.list(f.project.id))[0].archived, true);
  assert.ok(f.state.sessions.some(s => s.id === g.session));
  await assert.rejects(f.api('history/archive', { project: f.project.id, session: g.session, archived: false, revision: 1 }, 'PUT'), /Project settings/);
});

test('free rotation eligibility never admits paid models and test failures are not availability failures', () => {
  const models = [{ id: 'opencode/free', provider: 'opencode', costClass: 'free', quota: null }, { id: 'openai/paid', provider: 'openai', costClass: 'subscription' }];
  assert.deepEqual(eligibleGoalModels(models, ['openai'], {}).map(m => m.id), ['opencode/free']);
  assert.deepEqual(eligibleGoalModels(models, ['openai'], {}, ['opencode/free']), []);
  assert.equal(availabilityFailure('test assertion failed'), false);
  assert.equal(availabilityFailure({ data: { message: '429 quota exhausted' } }), true);
  assert.equal(availabilityFailure({ type: 'retry', message: 'Free usage exceeded, subscribe to Go', action: { reason: 'free_tier_limit' } }), true);
});

test('a native free-tier retry rotates without waiting for its reset or losing the goal plan', async t => {
  const f = await fixture(t);
  f.state.extraModels = { replacement: { cost: { input: 0, output: 0 }, variants: {} } };
  f.app.refreshUsage = async () => ({ refreshed: true });
  const g = await f.create('goal_native_retry_01', { freeRotation: true });
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  const run = (await f.current(g)).runID;
  f.state.todos[g.session] = [{ content: 'Keep the research plan', status: 'pending' }];
  f.state.messages[g.session][0].info.time.created -= 4000;
  f.state.messages[g.session].push({ info: { id: 'msg_retry_assistant', role: 'assistant', parentID: f.state.messages[g.session][0].info.id, time: { created: Date.now() } }, parts: [] });
  f.state.messages[g.session].push({ info: { id: 'msg_auto_compaction', role: 'user', time: { created: Date.now() } }, parts: [{ type: 'compaction', auto: true }] });
  f.state.messages[g.session].push({ info: { id: 'msg_compaction_summary', role: 'assistant', parentID: 'msg_auto_compaction', summary: true, time: { created: Date.now() } }, parts: [] });
  f.state.status[g.session] = { type: 'retry', message: 'Free usage exceeded, subscribe to Go', action: { reason: 'free_tier_limit' }, next: Date.now() + 3600000 };
  await f.goals.tick();
  const current = await f.current(g);
  assert.equal(current.status, 'running', current.reason);
  assert.equal(current.model, 'opencode/replacement');
  assert.equal(current.runID, run);
  assert.equal(current.variant, '');
  assert.equal(f.state.status[g.session], undefined);
  assert.equal(f.state.todos[g.session][0].status, 'pending');
  assert.equal((await f.sender.records(f.project.id, g.session)).find(d => d.id.endsWith('_0')).status, 'dismissed');
  await f.sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, 2);
});

test('restart before dispatch preserves the single unsent automatic continuation', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id);
  await f.goals.close();
  const recovered = createGoals(f.app, { sender: f.sender }); t.after(() => recovered.close()); await recovered.ready;
  await f.sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, 1);
  assert.equal((await f.sender.records(f.project.id, g.session))[0].status, 'submitted');
  assert.equal((await recovered.list(f.project.id))[0].status, 'running');
});

test('explicit queued input takes precedence over an automatic goal continuation', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id);
  await f.sender.enqueue(f.project.id, g.session, { id: 'explicit_queue_01', kind: 'queue', text: 'Inspect this user concern first', model: 'opencode/free' });
  await f.sender.tick();
  assert.match(f.state.messages[g.session][0].parts[0].text, /User request:\nInspect this user concern first$/);
  assert.equal((await f.sender.records(f.project.id, g.session)).find(d => d.id.startsWith('goal_')).status, 'waiting');
});

test('goal approval preferences never answer paid consent or escape a paused goal', async t => {
  const f = await fixture(t), g = await f.create('saved_goal_approve_01', { autoApprove: true });
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  const answered = [];
  f.app.respond = async (_p, _type, id, response) => { answered.push({ id, response }); f.state.permissions = f.state.permissions.filter(p => p.id !== id); };
  f.state.permissions = [{ id: 'ordinary', sessionID: g.session, permission: 'edit' }];
  await f.goals.tick();
  assert.deepEqual(answered, [{ id: 'ordinary', response: { reply: 'once' } }]);
  f.state.permissions = [{ id: 'paid', sessionID: g.session, permission: 'paid_delegate' }];
  await f.goals.tick();
  assert.equal((await f.current(g)).status, 'paused');
  f.state.permissions.push({ id: 'later', sessionID: g.session, permission: 'edit' });
  await f.goals.tick(); assert.equal(answered.length, 1);
});

test('three continuations without observable progress pause rather than cycle forever', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  for (let i = 0; i < 4; i++) { await f.finish(g); await f.sender.tick(); }
  assert.equal((await f.current(g)).status, 'paused');
  assert.equal((await f.current(g)).reason, 'Repeated failures without progress');
});

test('internal activity stays grouped with the goal and preserves completed native todos', () => {
  const messages = [{ info: { id: 'first', role: 'user' }, parts: [{ type: 'text', text: 'Objective' }] }, { info: { id: 'reply', role: 'assistant' }, parts: [{ type: 'tool', tool: 'todowrite' }] }, { info: { id: 'next', role: 'user' }, parts: [{ type: 'text', text: '[Freelancer Goal activity goal_1]\nContinue' }] }];
  assert.equal(isInternalMessage(messages[2]), true);
  assert.equal(buildRequestGroups(messages).length, 1);
  assert.equal(visibleTodosForRequest([{ content: 'A', status: 'completed' }], messages).length, 1);
});

test('free rotation preserves a selected paid parent and reasoning on Start, failure and Resume', async t => {
  const f = await fixture(t);
  const native = f.host.request.bind(f.host);
  f.host.request = async (route, options) => {
    const result = await native(route, options);
    if (route === '/provider') return { connected: [...result.connected, 'openai'], all: [...result.all,
      { id: 'openai', models: { 'gpt-6.1-sol': { cost: { input: 1, output: 1 }, variants: { low: {} }, toolcall: true, limit: { context: 64000, output: 8192 } } } }] };
    return result;
  };
  f.app.refreshUsage = async () => ({ refreshed: true });
  const g = await f.create('goal_paid_parent_001', { model: 'openai/gpt-6.1-sol', variant: 'low', freeRotation: true });
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  const dispatched = f.calls.find(c => c.route.endsWith('prompt_async'));
  assert.deepEqual(dispatched.options.body.model, { providerID: 'openai', modelID: 'gpt-6.1-sol' });
  assert.equal(dispatched.options.body.variant, 'low');
  const user = f.state.messages[g.session].at(-1);
  f.state.messages[g.session].push({ info: { id: 'paid_error', role: 'assistant', parentID: user.info.id, agent: 'engineer', error: { data: { message: '429 quota exhausted' } }, time: { created: Date.now(), completed: Date.now() } }, parts: [] });
  delete f.state.status[g.session]; await f.sender.tick(); await f.goals.tick();
  assert.equal((await f.current(g)).status, 'paused');
  assert.equal((await f.current(g)).model, 'openai/gpt-6.1-sol');
  assert.equal((await f.current(g)).variant, 'low');
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  assert.deepEqual(f.calls.filter(c => c.route.endsWith('prompt_async')).at(-1).options.body.model, { providerID: 'openai', modelID: 'gpt-6.1-sol' });
  assert.equal((await f.current(g)).variant, 'low');
});

test('explicit Resume reconciles settled failed worker cards without replaying or clearing uncertain input', async t => {
  for (const scenario of ['settled', 'uncertain', 'unaccepted', 'approval']) await t.test(scenario, async t => {
    const f = await fixture(t), g = await f.create();
    const worker = 'ses_delivery_worker';
    f.state.sessions.push({ id: worker, parentID: g.session, directory: f.directory, title: 'Worker' });
    f.state.messages[worker] = scenario === 'unaccepted' ? [] : [
      { info: { id: 'msg_worker_input', role: 'user', time: { created: Date.now() - 10000 } }, parts: [] },
      { info: { id: 'msg_worker_error', parentID: 'msg_worker_input', role: 'assistant', error: { name: 'MessageAbortedError' },
        time: { created: Date.now() - 5000, completed: Date.now() - 4000 } }, parts: [] },
    ];
    if (scenario === 'approval') f.state.questions.push({ id: 'worker_question', sessionID: worker, questions: [] });
    let cards = [{ id: 'worker_delivery_card', status: scenario === 'uncertain' ? 'uncertain' : 'failed', messageID: 'msg_worker_input', includedAt: Date.now() - 5000 }];
    const cancellations = [];
    const sender = { ...f.sender,
      list: async (project, session) => session === worker ? cards : f.sender.list(project, session),
      cancel: async (project, session, id) => {
        assert.equal(session, worker); cancellations.push(id); cards = cards.filter(row => row.id !== id);
      },
    };
    const recovered = createGoals(f.app, { sender }); await recovered.ready; t.after(() => recovered.close());
    if (scenario !== 'approval') {
      assert.equal((await recovered.start(f.project.id, g.id)).status, 'running');
      assert.deepEqual(cancellations, scenario === 'settled' ? ['worker_delivery_card'] : []);
    } else {
      await assert.rejects(recovered.start(f.project.id, g.id), /Worker delivery needs inspection|pending decisions/);
      assert.deepEqual(cancellations, []);
      assert.equal(cards.length, 1);
    }
    assert.equal(f.calls.filter(call => call.route === `/session/${worker}/prompt_async`).length, 0);
  });
});

test('free availability rotation preserves the run and plan; exhaustion requires explicit Resume', async t => {
  const f = await fixture(t);
  f.state.extraModels = { replacement: { cost: { input: 0, output: 0 }, variants: {} } };
  f.app.refreshUsage = async () => ({ refreshed: true });
  const g = await f.create('goal_rotation_test_01', { freeRotation: true });
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  f.state.todos[g.session] = [{ content: 'Keep unfinished work', status: 'pending' }];
  const fail = async () => {
    const user = f.state.messages[g.session].at(-1);
    f.state.messages[g.session].push({ info: { id: `error_${f.state.messages[g.session].length}`, role: 'assistant', parentID: user.info.id, agent: 'engineer', error: { data: { message: '429 quota exhausted' } }, time: { created: Date.now(), completed: Date.now() } }, parts: [] });
    delete f.state.status[g.session]; await f.sender.tick(); await f.goals.tick();
  };
  const first = (await f.current(g)).runID;
  await fail();
  assert.equal((await f.current(g)).model, 'opencode/replacement');
  await f.sender.tick();
  const captured = Object.values((await f.store.read('requests')).records);
  assert.equal(captured.at(-1).goalRunID, first);
  assert.equal(captured.at(-1).rootRequestID, captured[0].id);
  assert.equal(f.state.todos[g.session][0].status, 'pending');
  await fail();
  assert.equal((await f.current(g)).reason, 'No eligible free models available');
  const count = f.calls.filter(c => c.route.endsWith('prompt_async')).length;
  await f.goals.tick(); await f.sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, count);
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  assert.equal((await f.current(g)).status, 'running');
  assert.equal((await f.current(g)).runID, first);
  assert.equal(f.state.sessions.filter(s => s.id === g.session).length, 1);
});

test('editing a pending goal continuation retains one delivery across restart', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id);
  await f.goals.update(f.project.id, { id: g.id, revision: 1, objective: 'Revised before admission' });
  await f.goals.close();
  const recovered = createGoals(f.app, { sender: f.sender }); t.after(() => recovered.close()); await recovered.ready;
  await f.sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, 1);
});

test('Stop still addresses workers when parent abort acknowledgement fails', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  f.state.sessions.push({ id: 'ses_stop_worker', parentID: g.session, directory: f.directory });
  f.state.status.ses_stop_worker = { type: 'busy' };
  const stop = f.app.stop;
  f.app.stop = async (p, s) => { if (s === g.session) throw Error('Acknowledgement lost'); return stop(p, s); };
  await f.goals.stop(f.project.id, g.id);
  assert.equal(f.state.status.ses_stop_worker, undefined);
  assert.equal((await f.current(g)).status, 'paused');
  assert.equal((await f.current(g)).unsettled, true);
  await assert.rejects(f.goals.archive(f.project.id, g.id, true), /Stop/);
});

test('rejected running settings edits leave the goal and native chat title unchanged', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  await assert.rejects(f.goals.update(f.project.id, { id: g.id, revision: 1, title: 'Rejected rename', objective: 'Rejected objective', settings: { model: 'opencode/free' } }), /Stop the goal/);
  const current = await f.current(g);
  assert.equal(current.title, g.title);
  assert.equal(current.objective, g.objective);
  assert.equal(f.state.sessions.find(s => s.id === g.session).title, g.title);
});

test('an unconfirmed Stop preserves the unsettled guard even before native tree inspection', async t => {
  const f = await fixture(t), g = await f.create();
  const tree = f.app.goalTree;
  f.app.goalTree = async () => { throw Error('Native status unavailable'); };
  await f.goals.stop(f.project.id, g.id);
  assert.equal((await f.current(g)).unsettled, true);
  f.app.goalTree = tree;
  await assert.rejects(f.goals.archive(f.project.id, g.id, true), /Confirm Stop/);
});

test('stopped goal edits restore the default model and reject unknown agents before renaming', async t => {
  const f = await fixture(t);
  f.state.extraModels = { alternate: { cost: { input: 0, output: 0 }, variants: {} } };
  const g = await f.create('goal_edit_choices_01', { model: 'opencode/alternate' });
  const updated = await f.goals.update(f.project.id, { id: g.id, revision: 1, objective: g.objective, settings: { model: '', agentID: g.agentID } });
  assert.equal(updated.model, 'opencode/free');
  await assert.rejects(f.goals.update(f.project.id, { id: g.id, revision: 1, objective: g.objective, title: 'Rejected', settings: { agentID: 'missing-agent' } }), /named agent/);
  assert.equal(f.state.sessions.find(s => s.id === g.session).title, g.title);
});


test('Resume acknowledges only a settled accepted goal failure without an assistant error', async t => {
  const f = await fixture(t), g = await f.create();
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  const original = (await f.current(g)).deliveryID;
  f.state.messages[g.session][0].info.time.created -= 4000;
  delete f.state.status[g.session];
  await f.sender.tick();
  assert.equal((await f.sender.list(f.project.id, g.session))[0].status, 'failed');
  await f.goals.close();
  const recovered = createGoals(f.app, { sender: f.sender }); t.after(() => recovered.close()); await recovered.ready;
  await recovered.tick(); await f.sender.tick();
  assert.equal((await recovered.list(f.project.id))[0].status, 'running');
  assert.equal((await f.sender.records(f.project.id, g.session)).find(d => d.id === original).status, 'dismissed');
  assert.equal(f.calls.filter(c => c.route.endsWith('prompt_async')).length, 2);
  assert.equal((await recovered.list(f.project.id))[0].session, g.session);
});

test('Resume never acknowledges uncertain goal transport or unrelated failed user input', async t => {
  const f = await fixture(t), g = await f.create();
  await f.sender.enqueue(f.project.id, g.session, { id: 'unrelated_user_001', kind: 'queue', text: 'User concern', model: 'opencode/free' });
  await f.sender.tick();
  f.state.messages[g.session][0].info.time.created -= 4000;
  delete f.state.status[g.session]; await f.sender.tick();
  await assert.rejects(f.goals.start(f.project.id, g.id), /pending or uncertain/);
  assert.equal((await f.sender.list(f.project.id, g.session))[0].status, 'failed');
  await f.sender.cancel(f.project.id, g.session, 'unrelated_user_001');
  const originalSend = f.app.send;
  f.app.send = async () => { throw Error('Lost acknowledgement'); };
  await f.goals.start(f.project.id, g.id); await f.sender.tick();
  assert.equal((await f.sender.list(f.project.id, g.session))[0].status, 'uncertain');
  await f.goals.close();
  const recovered = createGoals(f.app, { sender: f.sender }); t.after(() => recovered.close()); await recovered.ready;
  await recovered.tick();
  await assert.rejects(recovered.start(f.project.id, g.id), /pending or uncertain/);
  assert.equal((await f.sender.list(f.project.id, g.session))[0].status, 'uncertain');
  f.app.send = originalSend;
});
