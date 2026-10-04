import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceEvaluationService } from '../server/evidence-evaluation.mjs';
import { EVALUATION_LIMITS } from '../domain/evidence-evaluation.mjs';

const owner = { projectID: 'review-fixture', sessionID: 'ses_review_fixture' };
const byteLength = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const question = (id, inputs, extra = {}) => ({ id, inputs, primitive: 'check',
  instructions: 'Is the selected recorded state sufficient for the stated requirement?',
  criteria: { yes: 'The selected state supplies sufficient evidence.', no: 'The selected state is insufficient or unknown.' }, ...extra });
const composition = questionID => [{ id: 'view', terms: [{ questionID, field: 'probabilityYes', weight: 1, range: [0, 1] }],
  scale: { min: 0, max: 100, units: 'declared points' } }];

function fixture(t, { data = {}, query, onEvaluate } = {}) {
  const calls = [], runs = [];
  const service = createEvidenceEvaluationService({
    data: { ...data, createJudgmentDefinition() {}, recordJudgmentRun(input) {
      runs.push(structuredClone(input)); return { runID: 'synthetic-run-' + runs.length };
    } },
    knowledgeQuery: { query: query ?? (async () => ({ results: [], truncated: false, filters: { global: true }, coverage: 'Synthetic cached scope' })) },
    provider: { async evaluateMany(input) {
      calls.push(structuredClone({ ...input, signal: undefined }));
      onEvaluate?.(calls.length);
      return { status: 'ok', requestedProvider: 'typesafe', requestedModel: 'jev-fixture', reportedProvider: 'typesafe', reportedModel: 'jev-fixture',
        usage: { input_tokens: 10, output_tokens: 1 }, latencyMs: 1,
        results: input.definitions.map(definition => ({ questionID: definition.questionID, answer: { probabilityYes: 0.8 },
          probabilities: { yes: 0.8, no: 0.2 }, derived: { primitive: 'check', probabilityYes: 0.8 } })) };
    } },
  });
  t.after(() => service.close());
  return { service, calls, runs };
}

test('cumulative evaluation receipts stop before uninspectable growth and retain bounded partial results without replay', async t => {
  const { service, calls, runs } = fixture(t);
  const supplied = Array.from({ length: 20 }, (_, index) => ({ id: 'v' + index, kind: 'supplied', value: 'x'.repeat(4000) }));
  const questions = Array.from({ length: 20 }, (_, index) => question('q' + index,
    supplied.filter((_, selected) => selected !== index).map(entry => entry.id)));
  const contract = { version: 1, supplied, questions };
  assert.ok(byteLength(contract) < EVALUATION_LIMITS.contractBytes);
  const prepared = await service.prepare(contract, { owner });
  assert.ok(byteLength(prepared) < EVALUATION_LIMITS.receiptBytes);
  const result = await service.evaluate({ receiptID: prepared.receiptID }, { owner });
  assert.equal(result.status, 'partial');
  assert.match(result.failure, /Receipt capacity prevents further provider calls/);
  assert.ok(calls.length > 0 && calls.length < questions.length, 'reserve stops before another provider call can overflow the receipt');
  assert.equal(runs.length, calls.length);
  assert.equal(result.answers.length, questions.length);
  assert.equal(new Set(result.answers.map(answer => answer.questionID)).size, questions.length);
  assert.ok(result.answers.some(answer => answer.status === 'not-evaluated' && answer.reusable === false));
  assert.ok(result.answers.some(answer => answer.reusable === true), 'completed typed answers remain inspectable');
  assert.ok(byteLength(result) <= EVALUATION_LIMITS.receiptBytes);
  const inspected = service.inspect(result.receiptID, { owner });
  assert.ok(byteLength(inspected) <= EVALUATION_LIMITS.receiptBytes);
  assert.deepEqual(inspected.answers, result.answers);
  const callsBeforeReuse = calls.length;
  const reused = await service.evaluate({ receiptID: result.receiptID }, { owner });
  assert.equal(reused.reused, true);
  assert.equal(calls.length, callsBeforeReuse, 'a capacity-limited receipt never silently submits the remaining questions');
});

test('source changes during a later evaluation stage invalidate every earlier answer and null historical compositions', async t => {
  let sourceValue = 1;
  const { service, calls } = fixture(t, {
    query: async () => ({ results: [{ id: 'source', value: sourceValue, originalSourceRef: { kind: 'claim-record', claimID: 'source' } }],
      filters: { global: true }, truncated: false, coverage: 'Synthetic retained source' }),
    onEvaluate(call) { if (call === 2) sourceValue = 2; },
  });
  const result = await service.evaluate({ version: 1,
    evidence: [{ id: 'record', source: 'query', domain: 'facts', query: 'source', fields: ['value'] }],
    questions: [question('first', ['record']), question('second', ['record'], { stage: 1, dependsOn: ['first'] })],
    composition: composition('first') }, { owner });
  assert.equal(calls.length, 2);
  assert.equal(result.status, 'evidence-changed');
  assert.equal(result.answers.length, 2);
  assert.ok(result.answers.every(answer => answer.reusable === false));
  assert.equal(result.answers[0].answer.probabilityYes, 0.8, 'original typed outcome stays inspectable as historical evidence');
  assert.equal(result.compositions[0].value, null);
  assert.match(result.compositions[0].missing.join(), /no reusable typed answer/);
  const inspected = service.inspect(result.receiptID, { owner });
  assert.ok(inspected.answers.every(answer => answer.reusable === false));
  assert.equal(inspected.compositions[0].value, null);
});

test('exact memory evidence exposes the known nested revision date and numeric revision rather than a revision body in dates', async t => {
  const ref = { kind: 'memory-revision', candidateID: 'note', memoryID: 'note', revision: 3, revisionID: 'revision-3',
    bodySha256: 'a'.repeat(64), recordSha256: 'b'.repeat(64) };
  const memory = { memory_id: 'note', title: 'Stored note', kind: 'note', created_at: 1100, updated_at: 1300,
    revision: { revision_id: 'revision-3', memory_id: 'note', revision: 3, body: 'Retained body.', created_at: 1234,
      provenance: { origin: 'authored' }, captureBoundary: {} }, members: [], revisions: [{ revision: 3, createdAt: 1234 }] };
  const { service, calls } = fixture(t, { data: {
    queryJudgmentEvidence(input) { assert.equal(input.revision, 3); return { candidateIDs: ['note'], evidenceRefs: [ref] }; },
    getMemory(id, revision) { assert.equal(id, 'note'); assert.equal(revision, 3); return structuredClone(memory); },
  } });
  const result = await service.prepare({ version: 1, evidence: [{ id: 'retained', source: 'knowledge', domain: 'memories',
    recordID: 'note', revision: 3, fields: ['title', 'revision.body'] }] }, { owner });
  const entry = result.packet[0];
  assert.equal(entry.dates.revision, 3);
  assert.equal(entry.dates.recordedAt, 1234);
  assert.equal(entry.dates.observedAt, null);
  assert.equal(Object.hasOwn(entry.dates, 'body'), false);
  assert.deepEqual(entry.value, { title: 'Stored note', 'revision.body': 'Retained body.' });
  assert.deepEqual(entry.provenance.evidenceRefs, [ref]);
  assert.equal(calls.length, 0);
});

test('query evidence preserves per-row truncation and unknown source status even when projected fields omit the metadata', async t => {
  const { service, calls } = fixture(t, { query: async () => ({
    results: [{ id: 'fact-a', resultID: 'claim:fixture', value: null, valueTruncated: true, scopeTruncated: true,
      sourceRefsTruncated: true, sourceRefCount: 40, evidenceStatus: 'provenance-truncated', hashStatus: 'hash-work-limit',
      originalSourceRef: { kind: 'claim-record', claimID: 'fact-a', evidenceCount: 40, evidenceTruncated: true },
      sourceRevision: { id: 'fact-a', hash: null }, sourceRefs: [], dates: null }],
    filters: { global: true }, coverage: 'Synthetic cached scope', truncated: false, nextCursor: null, page: { metadataTruncated: true },
  }) });
  const result = await service.prepare({ version: 1, evidence: [{ id: 'facts', source: 'query', domain: 'facts', query: 'fixture', fields: ['value'] }] }, { owner });
  const entry = result.packet[0];
  assert.deepEqual(entry.value, [{ value: null }]);
  assert.equal(entry.status, 'partial');
  assert.match(entry.missing.join(), /truncated.*unknown/);
  assert.equal(entry.provenance.truncated, false, 'row metadata omission remains separate from more result pages');
  assert.equal(entry.provenance.metadataCoverage[0].valueTruncated, true);
  assert.equal(entry.provenance.metadataCoverage[0].scopeTruncated, true);
  assert.equal(entry.provenance.metadataCoverage[0].sourceRefsTruncated, true);
  assert.equal(entry.provenance.metadataCoverage[0].evidenceStatus, 'provenance-truncated');
  assert.equal(entry.provenance.metadataCoverage[0].hashStatus, 'hash-work-limit');
  assert.equal(entry.provenance.sourceRefs[0].sourceRef.evidenceCount, 40);
  assert.equal(calls.length, 0);
});
