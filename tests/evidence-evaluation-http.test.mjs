import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import EvidenceEvaluation from '../backend/opencode/plugins/evidence-evaluation.ts';

const facts = () => ({ version: 1, name: 'integration-fixture', supplied: [
  { id: 'requirements', kind: 'supplied', value: { must: ['offline access'] }, provenance: 'Synthetic test inputs' },
  { id: 'option', kind: 'supplied', value: { features: ['offline access'] } },
] });
const withQuestions = () => ({ ...facts(), questions: [{ id: 'coverage', primitive: 'check',
  instructions: 'Does option meet every must-have in requirements?',
  criteria: { yes: 'Every must-have is evidenced', no: 'At least one is missing or unclear' },
  inputs: ['requirements', 'option'], stage: 0 }] });
const bounded = async (promise, label) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), 3000); })]); }
  finally { clearTimeout(timer); }
};

async function fixture(t) {
  const f = await localDataFixture({ timers: false });
  const names = ['FREELANCER_GIT_BRIDGE', 'FREELANCER_RUNTIME_ROOT'];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.FREELANCER_GIT_BRIDGE = 'synthetic-evidence-bridge';
  process.env.FREELANCER_RUNTIME_ROOT = f.root;
  t.after(async () => {
    try { await f.close(); }
    finally { for (const name of names) if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name]; }
  });
  f.state.messages.ses_history = [{ info: { id: 'msg_user', sessionID: 'ses_history', role: 'user' }, parts: [] },
    { info: { id: 'msg_evidence', sessionID: 'ses_history', parentID: 'msg_user', role: 'assistant', agent: 'engineer' }, parts: [] },
    { info: { id: 'msg_later', sessionID: 'ses_history', parentID: 'msg_user', role: 'assistant', agent: 'engineer' }, parts: [] }];
  f.state.messages.ses_other = [{ info: { id: 'msg_other', sessionID: 'ses_other', parentID: 'msg_other_user', role: 'assistant', agent: 'engineer' }, parts: [] }];
  await mkdir(path.join(f.root, 'tools/runtime'), { recursive: true });
  await writeFile(path.join(f.root, 'tools/runtime/state-database.mjs'), "import { readFileSync } from 'node:fs'; export const readState = file => JSON.parse(readFileSync(file, 'utf8'));\n");
  await mkdir(path.join(f.root, '.state/webpage'), { recursive: true });
  await writeFile(path.join(f.root, '.state/webpage/launch.json'), JSON.stringify({ url: f.url }));
  const tool = (await EvidenceEvaluation({ directory: f.directory })).tool.evidence_evaluation;
  const operations = [], providerCalls = [];
  const original = f.app.evidenceEvaluationAgentAction.bind(f.app);
  f.app.evidenceEvaluationAgentAction = (input, options) => { operations.push(structuredClone(input)); return original(input, options); };
  f.app.judgmentProvider = { async evaluateMany(input) {
    providerCalls.push(input);
    return { status: 'ok', requestedProvider: 'typesafe', requestedModel: 'jev-fixture', reportedProvider: 'typesafe',
      reportedModel: 'jev-fixture-exact', latencyMs: 1, usage: { input_tokens: 12, output_tokens: 2 },
      results: input.definitions.map(definition => ({ questionID: definition.questionID,
        answer: { probabilityYes: 0.8 }, probabilities: { yes: 0.8, no: 0.2 }, derived: { probabilityYes: 0.8 } })) };
  } };
  const context = { sessionID: 'ses_history', messageID: 'msg_evidence', abort: new AbortController().signal,
    ask: async () => { throw Error('Unexpected inference permission request.'); } };
  const identity = { directory: f.directory, actorSessionID: context.sessionID, messageID: context.messageID };
  const send = async (body, { bridge = 'synthetic-evidence-bridge', method = 'POST', headers = {} } = {}) => {
    const response = await fetch(f.url + '/api/evidence/evaluate/agent', { method,
      headers: { 'Content-Type': 'application/json', ...(bridge === null ? { 'X-Freelancer-Client': 'webpage' } : { 'X-Freelancer-Git-Bridge': bridge }), ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify({ ...identity, ...body }) }) });
    return { status: response.status, body: await response.json() };
  };
  return { ...f, tool, context, identity, send, operations, providerCalls };
}

test('evidence bridge is native-only and rejects wrong credentials, origins and methods', async t => {
  const f = await fixture(t);
  for (const options of [{ bridge: null }, { bridge: 'wrong' }, { method: 'GET' }, { headers: { Origin: 'https://foreign.invalid' } }])
    assert.equal((await f.send({ operation: 'describe' }, options)).status, 403);
  assert.equal(f.operations.length, 0);
  const described = await f.send({ operation: 'describe' });
  assert.equal(described.status, 200); assert.ok(described.body);
  assert.equal(f.providerCalls.length, 0);
});

test('large native receipts paginate as complete JSON without inference, replay or dropping evidence', async t => {
  const f = await fixture(t), contract = { version: 1, supplied: [{ id: 'large', kind: 'supplied', value: 'x'.repeat(30000) }] };
  let page = JSON.parse((await f.tool.execute({ operation: 'prepare', contractJson: JSON.stringify(contract) }, f.context)).output);
  assert.equal(page.presentation.partial, true);
  assert.equal(page.requiresInference, false);
  const receiptID = page.receiptID, firstCursor = page.presentation.nextCursor;
  let combined = page.data;
  while (page.presentation.nextCursor) {
    const output = (await f.tool.execute({ operation: 'inspect', receiptID, outputCursor: page.presentation.nextCursor }, f.context)).output;
    assert.ok(Buffer.byteLength(output, 'utf8') <= 48000);
    page = JSON.parse(output); combined += page.data;
  }
  const complete = JSON.parse(combined);
  assert.equal(complete.packet[0].value, contract.supplied[0].value);
  assert.equal(complete.presentation.partial, false);
  assert.equal(f.operations.filter(input => input.operation === 'prepare').length, 1);
  assert.equal(f.providerCalls.length, 0);
  const evaluated = JSON.parse((await f.tool.execute({ operation: 'evaluate', receiptID }, f.context)).output);
  assert.equal(evaluated.status, 'factual');
  const count = f.operations.length;
  await assert.rejects(f.tool.execute({ operation: 'evaluate', receiptID, outputCursor: firstCursor }, f.context), /only when inspecting/);
  assert.equal(f.operations.length, count);
  await assert.rejects(f.tool.execute({ operation: 'inspect', receiptID, outputCursor: firstCursor }, f.context), /receipt changed/);
  assert.equal(f.operations.filter(input => input.operation === 'evaluate').length, 1);
  assert.equal(f.providerCalls.length, 0);
});

test('large recomposed native views finish pagination without changing the receipt, replaying inference or crossing sessions', async t => {
  const f = await fixture(t), asks = [], context = { ...f.context, ask: async input => { asks.push(input); } };
  const contract = withQuestions(); contract.supplied.push({ id: 'large', kind: 'supplied', value: 'x'.repeat(30000) });
  const readPages = async first => {
    let page = JSON.parse(first.output), combined = page.data;
    while (page.presentation.nextCursor) {
      const output = await f.tool.execute({ operation: 'inspect', receiptID: page.receiptID, outputCursor: page.presentation.nextCursor }, f.context);
      assert.ok(Buffer.byteLength(output.output, 'utf8') <= 48000);
      page = JSON.parse(output.output); combined += page.data;
    }
    return JSON.parse(combined);
  };
  const evaluated = await readPages(await f.tool.execute({ operation: 'evaluate', contractJson: JSON.stringify(contract) }, context));
  const composition = [{ id: 'weighted', terms: [{ questionID: 'coverage', field: 'probabilityYes', weight: 1, range: [0, 1] }], scale: { min: 0, max: 100, units: 'points' } }];
  const first = await f.tool.execute({ operation: 'evaluate', receiptID: evaluated.receiptID, compositionJson: JSON.stringify(composition) }, f.context);
  const page = JSON.parse(first.output);
  assert.equal(page.presentation.partial, true);
  const recomposed = await readPages(first);
  assert.equal(recomposed.recombined, true);
  assert.equal(recomposed.compositions[0].value, 80);
  assert.deepEqual(recomposed.answers, evaluated.answers);
  const inspected = (await f.send({ operation: 'inspect', receiptID: evaluated.receiptID })).body;
  assert.deepEqual(inspected.compositions, [], 'recomposed presentation never alters the captured service receipt');
  await assert.rejects(f.tool.execute({ operation: 'inspect', receiptID: evaluated.receiptID, outputCursor: page.presentation.nextCursor },
    { ...f.context, sessionID: 'ses_other', messageID: 'msg_other' }), /unavailable|another session/);
  assert.equal(f.providerCalls.length, 1);
  assert.equal(asks.length, 1);
});

test('evidence bridge validates registered project, native session and exact assistant message before preparing', async t => {
  const f = await fixture(t);
  const request = { operation: 'prepare', contract: facts() };
  const cases = [
    { directory: path.join(f.root, 'not-registered') }, { actorSessionID: 'invalid' }, { messageID: 'msg_missing' },
    { messageID: 'msg_user' }, { actorSessionID: 'ses_history', messageID: 'msg_other' },
  ];
  for (const input of cases) assert.ok((await f.send({ ...request, ...input })).status >= 400);
  const session = f.state.sessions.find(row => row.id === 'ses_history');
  session.directory = path.join(f.root, 'foreign-project');
  assert.match((await f.send(request)).body.error, /another project/);
  session.directory = f.directory;
  const assistant = f.state.messages.ses_history[1]; assistant.info.sessionID = 'ses_other';
  assert.match((await f.send(request)).body.error, /assistant context/);
  assert.equal(f.providerCalls.length, 0);
});

test('pure evidence preparation/evaluation needs no inference permission and receipts are scoped to native conversation', async t => {
  const f = await fixture(t);
  const result = JSON.parse((await f.tool.execute({ operation: 'evaluate', contractJson: JSON.stringify(facts()) }, f.context)).output);
  assert.equal(result.requiresInference, false); assert.ok(result.receiptID);
  assert.deepEqual(f.operations.map(row => row.operation), ['prepare', 'evaluate']);
  assert.equal(f.providerCalls.length, 0);
  const inspected = await f.send({ operation: 'inspect', receiptID: result.receiptID, messageID: 'msg_later' });
  assert.equal(inspected.status, 200); assert.equal(inspected.body.receiptID, result.receiptID);
  const foreign = await f.send({ operation: 'inspect', receiptID: result.receiptID,
    actorSessionID: 'ses_other', messageID: 'msg_other', owner: { projectID: f.project.id, sessionID: 'ses_history' } });
  assert.ok(foreign.status >= 400, 'provided owner cannot select another session receipt');
  assert.equal(f.providerCalls.length, 0);
});

test('native denial after preparation/inspection prevents evaluation dispatch and any provider call', async t => {
  const f = await fixture(t), asks = [];
  const denied = { ...f.context, ask: async input => { asks.push(input); throw Error('Native edit permission denied.'); } };
  await assert.rejects(f.tool.execute({ operation: 'evaluate', contractJson: JSON.stringify(withQuestions()) }, denied), /permission denied/);
  assert.deepEqual(f.operations.map(row => row.operation), ['prepare']);
  const prepared = await f.send({ operation: 'prepare', contract: withQuestions() });
  f.operations.length = 0;
  await assert.rejects(f.tool.execute({ operation: 'evaluate', receiptID: prepared.body.receiptID }, denied), /permission denied/);
  assert.deepEqual(f.operations.map(row => row.operation), ['inspect']);
  assert.equal(asks.length, 2); assert.ok(asks.every(row => row.permission === 'edit' && row.patterns[0] === 'shared knowledge'));
  assert.equal(f.providerCalls.length, 0);
});

test('native adapter stamps caller authority and approved evaluation uses the dynamically injected provider', async t => {
  const f = await fixture(t), asks = [];
  const before = await f.store.read('settings');
  const context = { ...f.context, ask: async input => { asks.push(input); assert.equal(f.providerCalls.length, 0); } };
  const result = JSON.parse((await f.tool.execute({ operation: 'evaluate', contractJson: JSON.stringify(withQuestions()),
    directory: 'spoofed', actorSessionID: 'ses_other', messageID: 'msg_other', owner: { sessionID: 'ses_other' } }, context)).output);
  assert.equal(asks.length, 1); assert.equal(f.providerCalls.length, 1);
  assert.ok(result.receiptID);
  assert.deepEqual(f.operations.map(row => row.operation), ['prepare', 'evaluate']);
  for (const input of f.operations) {
    assert.equal(input.directory, f.directory); assert.equal(input.actorSessionID, f.context.sessionID);
    assert.equal(input.messageID, f.context.messageID); assert.equal(input.owner, undefined);
  }
  await f.store.recordRequest({ id: 'msg_user', sessionID: 'ses_history', projectID: f.project.id, directory: f.directory,
    status: 'accepted', policyVersion: 6, agent: { id: 'engineer', name: 'Engineer' }, readOnly: true });
  const recomposed = JSON.parse((await f.tool.execute({ operation: 'evaluate', receiptID: result.receiptID,
    compositionJson: JSON.stringify([{ id: 'weighted-view', terms: [{ questionID: 'coverage', field: 'probabilityYes', weight: 1, range: [0, 1] }],
      scale: { min: 0, max: 100, units: 'declared comparison points' } }]) }, f.context)).output);
  assert.equal(recomposed.recombined, true); assert.equal(recomposed.requiresInference, false);
  assert.equal(recomposed.compositions[0].value, 80); assert.equal(f.providerCalls.length, 1);
  assert.equal(asks.length, 1, 'deterministic recomposition does not request inference permission');
  assert.deepEqual(await f.store.read('settings'), before, 'advisory results grant no settings/Git authority');
});

test('inspection-only native assignment can evaluate facts but cannot dispatch external judgments', async t => {
  const f = await fixture(t);
  await f.store.recordRequest({ id: 'msg_user', sessionID: 'ses_history', projectID: f.project.id, directory: f.directory,
    status: 'accepted', policyVersion: 6, agent: { id: 'engineer', name: 'Engineer' }, readOnly: true });
  assert.equal((await f.send({ operation: 'evaluate', contract: facts(), readOnly: false })).status, 200);
  const prepared = await f.send({ operation: 'prepare', contract: withQuestions() });
  assert.equal(prepared.status, 200); assert.equal(prepared.body.requiresInference, true);
  const denied = await f.send({ operation: 'evaluate', receiptID: prepared.body.receiptID, readOnly: false });
  assert.match(denied.body.error, /inspection-only/); assert.equal(f.providerCalls.length, 0);
  assert.match((await f.send({ operation: 'evaluate', contract: withQuestions(), readOnly: false })).body.error, /inspection-only/);
  assert.equal(f.providerCalls.length, 0);
});

test('contract UTF-8 limits reject oversized packets before local preparation or native consent', async t => {
  const f = await fixture(t);
  const contract = { ...facts(), name: 'é'.repeat(61_000) };
  assert.equal((await f.send({ operation: 'prepare', contract })).status, 400);
  assert.equal(f.operations.length, 0);
  await assert.rejects(f.tool.execute({ operation: 'evaluate', contractJson: JSON.stringify(contract) }, f.context), /120 KB/);
  assert.equal(f.operations.length, 0); assert.equal(f.providerCalls.length, 0);
  await assert.rejects(f.tool.execute({ operation: 'prepare', contractJson: '{' }, f.context), /valid JSON/);
});

test('HTTP disconnect forwards cancellation through the native evidence evaluation to the provider', async t => {
  const f = await fixture(t);
  let entered, stopped;
  const started = new Promise(resolve => { entered = resolve; });
  const aborted = new Promise(resolve => { stopped = resolve; });
  f.app.judgmentProvider = { async evaluateMany({ signal }) {
    entered(signal);
    return new Promise(resolve => {
      const finish = () => { stopped(); resolve({ status: 'cancelled', requestedProvider: 'typesafe', requestedModel: 'jev-fixture',
        reportedProvider: null, reportedModel: null, latencyMs: 1, results: [] }); };
      if (signal.aborted) finish(); else signal.addEventListener('abort', finish, { once: true });
    });
  } };
  const request = http.request(f.url + '/api/evidence/evaluate/agent', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': 'synthetic-evidence-bridge' } });
  request.on('error', () => {}); t.after(() => request.destroy());
  request.end(JSON.stringify({ ...f.identity, operation: 'evaluate', contract: withQuestions() }));
  const signal = await bounded(started, 'Provider did not receive the native evaluation.');
  assert.equal(signal.aborted, false); request.destroy();
  await bounded(aborted, 'Provider cancellation did not follow client disconnect.');
  assert.equal(signal.aborted, true);
});

test('forgotten evidence invalidates receipt reuse/recomposition without another inference call', async t => {
  const f = await fixture(t), data = f.app.localData.get();
  const memory = data.createMemory({ id: 'evaluation-source-note', kind: 'note', title: 'Fixture evidence', body: 'The fixture supports offline access.' });
  const contract = { version: 1, evidence: [{ id: 'source', source: 'knowledge', domain: 'memories', recordID: memory.id, revision: 1 }],
    questions: [{ id: 'coverage', primitive: 'check', instructions: 'Does this source support offline access?',
      criteria: { yes: 'Offline access is evidenced', no: 'Offline access is missing or unclear' }, inputs: ['source'] }] };
  const initial = await f.send({ operation: 'evaluate', contract });
  assert.equal(initial.status, 200); assert.equal(initial.body.status, 'ok'); assert.equal(f.providerCalls.length, 1);
  data.forgetMemory({ id: memory.id });
  const result = await f.send({ operation: 'evaluate', receiptID: initial.body.receiptID, composition: [{ id: 'current-view',
    terms: [{ questionID: 'coverage', field: 'probabilityYes', weight: 1, range: [0, 1] }], scale: { min: 0, max: 100, units: 'declared comparison points' } }] });
  assert.equal(result.status, 200); assert.equal(result.body.status, 'evidence-changed');
  assert.equal(result.body.requiresInference, false); assert.equal(result.body.answers[0].reusable, false);
  assert.equal(result.body.compositions[0].value, null); assert.equal(f.providerCalls.length, 1);
});

test('server shutdown waits for actual evidence evaluation settlement before closing the local store', async t => {
  const f = await fixture(t);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  f.app.judgmentProvider = { async evaluateMany({ signal }) {
    entered(signal); await pending;
    return { status: 'cancelled', requestedProvider: 'typesafe', requestedModel: 'jev-fixture', reportedProvider: null,
      reportedModel: null, latencyMs: 1, results: [] };
  } };
  const request = http.request(f.url + '/api/evidence/evaluate/agent', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': 'synthetic-evidence-bridge' } });
  request.on('error', () => {}); t.after(() => request.destroy());
  request.end(JSON.stringify({ ...f.identity, operation: 'evaluate', contract: withQuestions() }));
  const signal = await bounded(started, 'Provider evaluation did not begin.');
  let finished = false;
  const closing = f.close().then(() => { finished = true; });
  await bounded(new Promise(resolve => {
    if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true });
  }), 'Shutdown did not abort the active evaluation.');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false, 'Store shutdown must retain ownership until the actual provider settles.');
  release(); await bounded(closing, 'Server did not finish after the provider stopped.');
  assert.equal(finished, true);
});
