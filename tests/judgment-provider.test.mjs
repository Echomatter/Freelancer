import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { TypeSafeClient, APIUserAbortError, APITimeoutError } from '@typesafe-ai/sdk';
import { createTypeSafeJudgmentProvider, normalizeTypeSafeJudgmentAnswer, validateTypeSafeJudgmentDefinition } from '../server/data/judgment-provider.mjs';

const scoreDefinition = { questionID: 'relevance', primitive: 'score', question: 'How relevant is this evidence?', criteria: { levels: ['poor', 'mixed', 'strong'] } };
const choiceDefinition = { questionID: 'category', primitive: 'classify', question: { task: 'Choose the evidence category.' }, criteria: { options: { source: { description: 'Source evidence' }, claim: 'A claim', other: null } } };
const checkDefinition = { questionID: 'contains_id', primitive: 'check', question: 'Does it contain the exact identifier?', criteria: { yes: 'Exact identifier is present', no: 'Identifier is absent' } };
const scoreAnswer = { type: 'score', score: 1.8, confidence: 0.91, legend: { 0: 'poor', 1: 'mixed', 2: 'strong' }, probabilities: { 0: 0, 1: 0.2, 2: 0.8 } };
const choiceAnswer = { type: 'choice', choice: 'source', confidence: 0.8, probabilities: { source: 0.8, claim: 0.1, other: 0.1 } };
const checkAnswer = { type: 'noul', noul: 0.98 };
const usage = { input_tokens: 42, output_tokens: 6 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const providerFor = response => createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, client: { async systemOne() { return response; } } });
const responseFor = (definition, answer, extra = {}) => ({ model: 'jev-1.13.0', usage, answers: { [definition.questionID]: answer }, ...extra });
const evaluateAnswer = (definition, answer, extra = {}) => providerFor(responseFor(definition, answer, extra)).evaluate({ definition, state: { evidence: 'Synthetic retained text.' } });

test('TypeSafe adapter sends a typed score and records actual model, usage, and cancellation options', async () => {
  let request, options;
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, client: {
    async systemOne(input, settings) { request = input; options = settings; return responseFor(scoreDefinition, scoreAnswer); },
  } });
  const controller = new AbortController();
  const result = await provider.evaluate({ definition: scoreDefinition, state: { query: 'migration', evidence: [{ ref: 'source-a#L1-L4', text: 'A staged, recoverable import.' }] }, signal: controller.signal });
  assert.equal(request.model, 'jev-latest');
  assert.equal(request.questions.relevance.type, 'score');
  assert.deepEqual(request.questions.relevance.criteria, scoreDefinition.criteria.levels);
  assert.equal(options.signal, controller.signal);
  assert.equal(options.timeout, 30_000);
  assert.deepEqual(options.retry, { maxRetries: 0 });
  assert.equal(result.status, 'ok');
  assert.equal(result.modelMatch, 'alias-response');
  assert.equal(result.reportedProvider, 'typesafe');
  assert.equal(result.reportedModel, 'jev-1.13.0');
  assert.deepEqual(result.usage, usage);
  assert.equal(result.results[0].confidence, 0.91);
  assert.deepEqual(result.results[0].probabilities, scoreAnswer.probabilities);
  assert.deepEqual(result.results[0].answer.legend, scoreAnswer.legend);
});

test('TypeSafe adapter sends independent Score, Choice and Noul definitions in one System One request', async () => {
  let calls = 0, request;
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, client: { async systemOne(input) {
    calls++; request = input; return { model: 'jev-1.13.0', usage, answers: { relevance: scoreAnswer, category: choiceAnswer, contains_id: checkAnswer } };
  } } });
  const result = await provider.evaluateMany({ definitions: [scoreDefinition, choiceDefinition, checkDefinition], state: { candidate: 'Reference id REF-9 appears in this synthetic passage.' } });
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(request.questions), ['relevance', 'category', 'contains_id']);
  assert.deepEqual(request.questions.category.criteria, choiceDefinition.criteria.options);
  assert.deepEqual(request.questions.contains_id.criteria, { true: checkDefinition.criteria.yes, false: checkDefinition.criteria.no });
  assert.equal(result.status, 'ok');
  assert.equal(result.results.length, 3);
  assert.equal(result.results[2].answer.probabilityYes, 0.98);
  assert.equal(result.results[2].confidence, undefined, 'Noul has no separate confidence');
  assert.deepEqual(result.results[2].probabilities, { yes: 0.98, no: 1 - 0.98 });
});

test('TypeSafe adapter requires a runtime credential and never returns it or initializes a client without it', async () => {
  let clients = 0;
  const provider = createTypeSafeJudgmentProvider({ env: {}, clientFactory() { clients++; } });
  assert.deepEqual(provider.status(), { configured: false, provider: 'typesafe', connectivity: 'unavailable', reason: 'TYPESAFE_API_KEY is not configured.' });
  assert.equal((await provider.evaluate({ definition: {}, state: {} })).status, 'unavailable');
  assert.equal(clients, 0);
});

test('TypeSafe Score accepts ten levels and rejects eleven before contacting the provider', async () => {
  let calls = 0;
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, client: { async systemOne(input) {
    calls++;
    const levels = input.questions.relevance.criteria;
    assert.equal(levels.length, 10);
    return responseFor(scoreDefinition, { type: 'score', score: 4.5, confidence: 0.5, legend: Object.fromEntries(levels.map((text, index) => [index, text])),
      probabilities: Object.fromEntries(levels.map((_, index) => [index, 0.1])) });
  } } });
  const definition = { ...scoreDefinition, criteria: { levels: Array.from({ length: 10 }, (_, index) => 'Level ' + index) } };
  assert.equal((await provider.evaluate({ definition, state: {} })).status, 'ok');
  const invalid = await provider.evaluate({ definition: { ...definition, criteria: { levels: [...definition.criteria.levels, 'Eleventh'] } }, state: {} });
  assert.equal(invalid.status, 'invalid-response');
  assert.match(invalid.failure, /two and ten/);
  assert.equal(calls, 1);
});

test('TypeSafe Choice supports the published 255-option maximum and rejects a larger map before transport', async () => {
  const options = Object.fromEntries(Array.from({ length: 255 }, (_, index) => ['option-' + index, null]));
  const definition = { ...choiceDefinition, criteria: { options } };
  const answer = { type: 'choice', choice: 'option-0', confidence: 1, probabilities: Object.fromEntries(Object.keys(options).map(key => [key, key === 'option-0' ? 1 : 0])) };
  assert.equal((await evaluateAnswer(definition, answer)).status, 'ok');
  assert.throws(() => validateTypeSafeJudgmentDefinition({ ...definition, criteria: { options: { ...options, overflow: null } } }), /255/);
});

test('TypeSafe preflight rejects malformed batches, duplicate IDs, invalid JSON and unsupported primitives without transport', async () => {
  let calls = 0;
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, client: { async systemOne() { calls++; } } });
  const cyclic = {}; cyclic.loop = cyclic;
  const invalidInputs = [
    { definitions: [] }, { definitions: Array(21).fill(checkDefinition) }, { definitions: [null] },
    { definitions: [checkDefinition, checkDefinition] }, { definitions: [{ ...checkDefinition, questionID: '' }] },
    { definitions: [{ ...checkDefinition, primitive: 'invented' }] },
    { definitions: [{ ...choiceDefinition, criteria: { options: {} } }] },
    { definitions: [{ ...scoreDefinition, criteria: { levels: ['a', undefined] } }] },
    { definitions: [{ ...checkDefinition, question: { n: Infinity } }] },
    { definitions: [checkDefinition], state: cyclic }, { definitions: [checkDefinition], state: new Date() },
    { definitions: [checkDefinition], state: { unsupported: () => true } },
    { definitions: [checkDefinition], model: null }, { definitions: [checkDefinition], model: '  jev-latest' },
  ];
  for (const input of invalidInputs) {
    const result = await provider.evaluateMany({ state: {}, ...input });
    assert.equal(result.status, 'invalid-response');
    assert.equal(result.resultsReusable, false);
  }
  assert.equal(calls, 0);
});

test('TypeSafe Score validates structured and null legends without depending on JSON object key order', () => {
  const levels = [null, { what: 'Some support', examples: ['retained citation'], detail: { b: false, a: 1 } }, ['complete', 'bounded']];
  const definition = { ...scoreDefinition, criteria: { levels } };
  const answer = { ...scoreAnswer, legend: { 0: null, 1: { detail: { a: 1, b: false }, examples: ['retained citation'], what: 'Some support' }, 2: ['complete', 'bounded'] } };
  assert.deepEqual(normalizeTypeSafeJudgmentAnswer(definition, answer).answer.legend, Object.fromEntries(levels.map((level, index) => [index, level])));
});

for (const [label, changes] of [
  ['missing level', { probabilities: { 1: 0.2, 2: 0.8 } }],
  ['extra level', { probabilities: { 0: 0, 1: 0.2, 2: 0.8, 3: 0 } }],
  ['noncanonical level', { probabilities: { '00': 0, 1: 0.2, 2: 0.8 } }],
  ['inherited level', { probabilities: Object.assign(Object.create({ 0: 0 }), { 1: 0.2, 2: 0.8 }) }],
  ['nonfinite probability', { probabilities: { 0: 0, 1: NaN, 2: 1 } }],
  ['out of range probability', { probabilities: { 0: -0.1, 1: 0.3, 2: 0.8 } }],
  ['numeric string probability', { probabilities: { 0: 0, 1: '0.2', 2: 0.8 } }],
  ['distribution sum', { probabilities: { 0: 0, 1: 0.19, 2: 0.8 } }],
  ['missing legend', { legend: undefined }],
  ['extra legend level', { legend: { ...scoreAnswer.legend, 3: 'invented' } }],
  ['changed legend', { legend: { ...scoreAnswer.legend, 1: 'different rubric' } }],
  ['out of rubric score', { score: 9 }],
  ['weighted score mismatch', { score: 1.5 }],
  ['invalid confidence', { confidence: Infinity }],
  ['wrong primitive', { type: 'choice' }],
]) {
  test('TypeSafe Score rejects ' + label, async () => {
    const result = await evaluateAnswer(scoreDefinition, { ...scoreAnswer, ...changes });
    assert.equal(result.status, 'invalid-response');
    assert.equal(result.resultsReusable, false);
    assert.deepEqual(result.results, []);
    assert.equal(result.failures[0].questionID, 'relevance');
    assert.equal(result.reportedModel, 'jev-1.13.0');
  });
}

test('TypeSafe validates floating arithmetic without renormalizing the reported probabilities or score', () => {
  const probabilities = { 0: 0.1, 1: 0.2, 2: 0.7000000000000001 };
  const result = normalizeTypeSafeJudgmentAnswer(scoreDefinition, { ...scoreAnswer, score: 1.6, probabilities });
  assert.deepEqual(result.probabilities, probabilities);
  assert.equal(result.answer.score, 1.6);
});

test('TypeSafe accepts bounded hundredth-resolution live Score differences and records the local policy', () => {
  const levels = Array.from({ length: 10 }, (_, i) => 'Level ' + i);
  const definition = { ...scoreDefinition, criteria: { levels } };
  const legend = Object.fromEntries(levels.map((level, i) => [i, level]));
  // Sanitized Jev 1.13.0 values captured during authenticated SDK diagnosis.
  for (const [score, bins, expected] of [
    [4.76, { 2: 0.01, 3: 0.07, 4: 0.33, 5: 0.33999999999999997, 6: 0.25 }, 4.75],
    [2.45, { 1: 0.02, 2: 0.52, 3: 0.46 }, 2.44],
    [5.08, { 3: 0.02, 4: 0.29, 5: 0.26, 6: 0.43 }, 5.1],
  ]) {
    const probabilities = Object.fromEntries(levels.map((_, i) => [i, bins[i] ?? 0]));
    const result = normalizeTypeSafeJudgmentAnswer(definition, { type: 'score', score, confidence: 0.7, legend, probabilities });
    assert.equal(result.answer.score, score);
    assert.deepEqual(result.probabilities, probabilities);
    assert.ok(Math.abs(result.derived.scoreValidation.expectedFromReportedProbabilities - expected) < 1e-6);
    assert.equal(result.derived.scoreValidation.policy, 'local-hundredth-resolution');
    assert.ok(score >= result.derived.scoreValidation.compatibleScoreBounds.min);
    assert.ok(score <= result.derived.scoreValidation.compatibleScoreBounds.max);
  }
});

test('TypeSafe rounding compatibility rejects larger mismatches and does not loosen high precision or sums', () => {
  const probabilities = { 0: 0.8, 1: 0.2, 2: 0 };
  assert.equal(normalizeTypeSafeJudgmentAnswer(scoreDefinition, { ...scoreAnswer, probabilities, score: 0.21 }).answer.score, 0.21);
  assert.throws(() => normalizeTypeSafeJudgmentAnswer(scoreDefinition, { ...scoreAnswer, probabilities, score: 0.22 }), /inconsistent/);
  assert.throws(() => normalizeTypeSafeJudgmentAnswer(scoreDefinition, { ...scoreAnswer, probabilities: { 0: 0.79999, 1: 0.20001, 2: 0 }, score: 0.21 }), /inconsistent/);
  assert.throws(() => normalizeTypeSafeJudgmentAnswer(scoreDefinition, { ...scoreAnswer, probabilities: { 0: 0.79, 1: 0.2, 2: 0 }, score: 0.2 }), /sum to one/);
});

test('TypeSafe Choice requires exactly the requested keys and a maximum-probability selected option; ties are valid', async () => {
  for (const changes of [
    { probabilities: { source: 1 } }, { probabilities: { ...choiceAnswer.probabilities, injected: 0 } },
    { choice: 'missing' }, { choice: 'claim' }, { probabilities: [] }, { confidence: -0.1 },
  ]) assert.equal((await evaluateAnswer(choiceDefinition, { ...choiceAnswer, ...changes })).status, 'invalid-response');
  const tied = await evaluateAnswer(choiceDefinition, { ...choiceAnswer, choice: 'claim', probabilities: { source: 0.5, claim: 0.5, other: 0 }, confidence: 0 });
  assert.equal(tied.status, 'ok');
  assert.equal(tied.results[0].answer.choice, 'claim');
});

test('TypeSafe Noul keeps probability boundaries and never fabricates separate confidence', async () => {
  for (const noul of [0, 1, 0.5]) {
    const result = await evaluateAnswer(checkDefinition, { type: 'noul', noul, confidence: 0.8 });
    assert.equal(result.status, 'ok');
    assert.equal(result.results[0].confidence, undefined);
    assert.equal(result.results[0].answer.probabilityYes, noul);
  }
  for (const answer of [{ type: 'noul', noul: -0.01 }, { type: 'noul', noul: 1.01 }, { type: 'noul', noul: '0.8' }, { type: 'noul', noul: NaN }, { type: 'choice', noul: 0.8 }])
    assert.equal((await evaluateAnswer(checkDefinition, answer)).status, 'invalid-response');
});

test('TypeSafe batch keeps valid partial outcomes inspectable and missing or invalid answers nonreusable', async () => {
  const definitions = [scoreDefinition, checkDefinition, choiceDefinition];
  const result = await providerFor({ model: 'jev-1.13.0', usage, answers: { relevance: scoreAnswer, contains_id: { type: 'noul', noul: 2 } } })
    .evaluateMany({ definitions, state: {} });
  assert.equal(result.status, 'invalid-response');
  assert.equal(result.partial, true);
  assert.equal(result.resultsReusable, false);
  assert.deepEqual(result.results.map(item => item.questionID), ['relevance']);
  assert.deepEqual(result.failures.map(item => item.questionID), ['contains_id', 'category']);
  assert.equal(result.reportedModel, 'jev-1.13.0');
  assert.deepEqual(result.usage, usage);
  assert.equal(JSON.stringify(result).includes('"noul":2'), false);
});

test('TypeSafe rejects unrequested answer IDs without echoing their contents and retains valid answers for inspection', async () => {
  const result = await providerFor({ model: 'jev-1.13.0', answers: { contains_id: checkAnswer, unrequested: { private: 'raw-response-secret' } } })
    .evaluate({ definition: checkDefinition, state: {} });
  assert.equal(result.status, 'invalid-response');
  assert.equal(result.resultsReusable, false);
  assert.equal(result.results.length, 1);
  assert.equal(result.failures[0].failureReason, 'unexpected-answers');
  assert.equal(result.failures[0].count, 1);
  assert.doesNotMatch(JSON.stringify(result), /raw-response-secret|unrequested":/);
});

test('TypeSafe treats prototype-like question and option IDs as exact own keys', async () => {
  const definition = { ...choiceDefinition, questionID: '__proto__', criteria: { options: JSON.parse('{"__proto__":null,"constructor":null}') } };
  const answer = { type: 'choice', choice: '__proto__', confidence: 1, probabilities: JSON.parse('{"__proto__":1,"constructor":0}') };
  const result = await evaluateAnswer(definition, answer);
  assert.equal(result.status, 'ok');
  assert.equal(result.results[0].questionID, '__proto__');
  assert.equal(Object.hasOwn(result.results[0].probabilities, '__proto__'), true);
  const inherited = await providerFor({ model: 'jev-1.13.0', answers: Object.create({ contains_id: checkAnswer }) }).evaluate({ definition: checkDefinition, state: {} });
  assert.equal(inherited.status, 'invalid-response');
  assert.equal(inherited.results.length, 0);
});

test('TypeSafe accepts documented moving aliases and exact pinned models, and rejects pinned mismatch without fallback', async () => {
  for (const requested of ['jev-latest', 'jev-preview', 'jev-1.13.0']) {
    const result = await providerFor(responseFor(checkDefinition, checkAnswer)).evaluate({ definition: checkDefinition, state: {}, model: requested });
    assert.equal(result.status, 'ok');
    assert.equal(result.modelMatch, requested === 'jev-1.13.0' ? 'exact' : 'alias-response');
  }
  let calls = 0;
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, client: { async systemOne() { calls++; return responseFor(checkDefinition, checkAnswer); } } });
  const mismatch = await provider.evaluate({ definition: checkDefinition, state: {}, model: 'jev-1.12.0' });
  assert.equal(mismatch.status, 'invalid-response');
  assert.equal(mismatch.failureReason, 'model-mismatch');
  assert.equal(mismatch.modelMatch, 'mismatch');
  assert.equal(mismatch.reportedModel, 'jev-1.13.0');
  assert.equal(mismatch.requestedModel, 'jev-1.12.0');
  assert.equal(mismatch.resultsReusable, false);
  assert.deepEqual(mismatch.results, []);
  assert.equal(calls, 1);
  for (const model of [undefined, '', 'jev-1.13.0 '])
    assert.equal((await evaluateAnswer(checkDefinition, checkAnswer, { model })).status, 'invalid-response');
});

test('TypeSafe alias responses retain the reported model string without inventing a version-name restriction', async () => {
  for (const requested of ['jev-latest', 'jev-preview']) {
    for (const model of [requested, 'jev-2026-10-03-preview', 'future-release-format']) {
      const result = await providerFor(responseFor(checkDefinition, checkAnswer, { model })).evaluate({ definition: checkDefinition, state: {}, model: requested });
      assert.equal(result.status, 'ok');
      assert.equal(result.modelMatch, 'alias-response');
      assert.equal(result.requestedModel, requested);
      assert.equal(result.reportedModel, model);
    }
  }
});

test('TypeSafe captures rubric and state before waiting and does not validate against subsequent caller mutations', async () => {
  const pending = deferred();
  let captured;
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, client: { systemOne(request) { captured = request; return pending.promise; } } });
  const definition = structuredClone(scoreDefinition), state = { evidence: ['original retained source'] };
  const request = provider.evaluate({ definition, state });
  definition.criteria.levels[0] = 'changed rubric';
  definition.question = 'changed question';
  state.evidence[0] = 'changed source';
  assert.equal(captured.questions.relevance.criteria[0], 'poor');
  assert.equal(captured.state.evidence[0], 'original retained source');
  pending.resolve(responseFor(scoreDefinition, scoreAnswer));
  assert.equal((await request).status, 'ok');
});

test('TypeSafe abort before submission prevents transport and abort during a pending request detaches without replay', async () => {
  let calls = 0;
  const pending = deferred();
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, client: { systemOne() { calls++; return pending.promise; } } });
  const controller = new AbortController();
  controller.abort();
  assert.equal((await provider.evaluate({ definition: checkDefinition, state: {}, signal: controller.signal })).status, 'cancelled');
  assert.equal(calls, 0);
  const active = new AbortController();
  const request = provider.evaluate({ definition: checkDefinition, state: {}, signal: active.signal });
  assert.equal(getEventListeners(active.signal, 'abort').length, 1);
  active.abort();
  const result = await request;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.resultsReusable, false);
  assert.equal(getEventListeners(active.signal, 'abort').length, 0);
  assert.equal(calls, 1);
  pending.reject(new Error('late transport failure'));
  await new Promise(resolve => setImmediate(resolve));
});

test('TypeSafe handles SDK abort and timeout distinctly without retrying or returning fabricated answers', async () => {
  for (const [error, status, reason] of [[new APIUserAbortError(), 'cancelled', 'cancelled'], [new APITimeoutError(30_000), 'provider-failed', 'timeout']]) {
    let calls = 0;
    const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'test-key' }, client: { async systemOne() { calls++; throw error; } } });
    const result = await provider.evaluate({ definition: checkDefinition, state: {} });
    assert.equal(result.status, status);
    assert.equal(result.failureReason, reason);
    assert.equal(result.resultsReusable, false);
    assert.equal(result.results, undefined);
    assert.equal(calls, 1);
  }
});

test('TypeSafe actual SDK 0.6.0 serializes the request and honors cancellation through a synthetic fetch', async () => {
  let sent;
  const entered = deferred();
  const client = new TypeSafeClient({ apiKey: 'synthetic-sdk-key', logLevel: 'off', fetch(url, options) {
    sent = { url: String(url), body: JSON.parse(options.body), signal: options.signal };
    entered.resolve();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Synthetic fetch aborted'), { name: 'AbortError' })), { once: true });
    });
  } });
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'synthetic-sdk-key' }, client });
  const controller = new AbortController();
  const request = provider.evaluate({ definition: checkDefinition, state: { source: 'Synthetic only.' }, signal: controller.signal });
  await entered.promise;
  assert.equal(sent.url, 'https://api.typesafe.ai/v1/systemone');
  assert.deepEqual(sent.body.questions.contains_id.criteria, { true: checkDefinition.criteria.yes, false: checkDefinition.criteria.no });
  controller.abort();
  assert.equal((await request).status, 'cancelled');
  assert.equal(sent.signal.aborted, true);
});

test('TypeSafe actual SDK 0.6.0 parses complete mixed typed answers from a synthetic HTTP response', async () => {
  let calls = 0;
  const client = new TypeSafeClient({ apiKey: 'synthetic-sdk-key', logLevel: 'off', fetch(url, options) {
    calls++;
    const input = JSON.parse(options.body);
    assert.equal(String(url), 'https://api.typesafe.ai/v1/systemone');
    assert.deepEqual(Object.keys(input.questions), ['relevance', 'category', 'contains_id']);
    return Promise.resolve(new Response(JSON.stringify({ model: 'jev-1.13.0', usage,
      answers: { relevance: scoreAnswer, category: choiceAnswer, contains_id: checkAnswer } }), {
      status: 200, headers: { 'content-type': 'application/json', 'x-typesafe-request-id': 'synthetic-request-only' },
    }));
  } });
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'synthetic-sdk-key' }, client });
  const result = await provider.evaluateMany({ definitions: [scoreDefinition, choiceDefinition, checkDefinition], state: { source: 'Synthetic only.' } });
  assert.equal(result.status, 'ok');
  assert.equal(result.results.length, 3);
  assert.deepEqual(result.results[0].answer, { score: 1.8, legend: scoreAnswer.legend });
  assert.deepEqual(result.results[1].probabilities, choiceAnswer.probabilities);
  assert.equal(result.results[2].answer.probabilityYes, 0.98);
  assert.deepEqual(result.usage, usage);
  assert.equal(calls, 1);
});

test('TypeSafe token usage is bounded numeric metadata and arbitrary provider response fields are not copied', async () => {
  const result = await evaluateAnswer(checkDefinition, checkAnswer, { usage: { ...usage, key: 'extra-secret', response: 'extra-source-payload' } });
  assert.deepEqual(result.usage, usage);
  assert.doesNotMatch(JSON.stringify(result), /extra-secret|extra-source-payload/);
  for (const badUsage of [{ input_tokens: -1, output_tokens: 0 }, { input_tokens: 2.5, output_tokens: 0 }, { input_tokens: 1, output_tokens: Infinity }, null]) {
    const invalid = await evaluateAnswer(checkDefinition, checkAnswer, { usage: badUsage });
    assert.equal(invalid.status, 'invalid-response');
    assert.equal(invalid.failureReason, 'invalid-usage');
    assert.equal(invalid.reportedModel, 'jev-1.13.0');
  }
});

test('TypeSafe keeps provider errors bounded and redacts exact server-side credentials even without a label', async () => {
  for (const message of ['API key: secret-value rejected', 'Bearer secret-value was refused', 'opaque secret-value repeated secret-value ' + 'x'.repeat(1000)]) {
    const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'secret-value' }, client: { async systemOne() { throw Error(message); } } });
    const result = await provider.evaluate({ definition: checkDefinition, state: {} });
    assert.equal(result.status, 'provider-failed');
    assert.ok(result.failure.length <= 400);
    assert.doesNotMatch(JSON.stringify(result), /secret-value/);
  }
});

test('TypeSafe ignores whitespace-only default models and does not expose a credential echoed as a reported model', async () => {
  const provider = createTypeSafeJudgmentProvider({ env: { TYPESAFE_API_KEY: 'secret-value', TYPESAFE_DEFAULT_MODEL: '   ' }, client: {
    async systemOne(input) { assert.equal(input.model, 'jev-latest'); return responseFor(checkDefinition, checkAnswer, { model: 'secret-value' }); },
  } });
  assert.equal(provider.status().requestedModel, 'jev-latest');
  const result = await provider.evaluate({ definition: checkDefinition, state: {} });
  assert.equal(result.status, 'invalid-response');
  assert.equal(result.reportedModel, null);
  assert.doesNotMatch(JSON.stringify(result), /secret-value/);
});

test('TypeSafe rejects inherited typed answer fields rather than adopting prototype values', () => {
  assert.throws(() => normalizeTypeSafeJudgmentAnswer(checkDefinition, Object.create(checkAnswer)), /typed answer/);
  assert.throws(() => normalizeTypeSafeJudgmentAnswer(checkDefinition, Object.assign(Object.create({ noul: 0.8 }), { type: 'noul' })), /Noul/);
  assert.throws(() => normalizeTypeSafeJudgmentAnswer(choiceDefinition, Object.assign(Object.create({ confidence: 0.8 }), {
    type: 'choice', choice: 'source', probabilities: choiceAnswer.probabilities,
  })), /confidence/);
});
