import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceEvaluationView, nativeEvidenceOutput, NATIVE_EVIDENCE_OUTPUT_BYTES } from '../domain/evidence-evaluation-view.mjs';

const fixture = () => {
  const entry = { id: 'facts', kind: 'stored', value: 'x'.repeat(29000), provenance: { source: 'catalog', sourceRef: 'exact/source', snapshotID: 'snapshot' } };
  const derived = { id: 'price', kind: 'derived', value: 4 };
  return { receiptID: 'fixture', status: 'ok', requiresInference: false, evidenceHash: 'evidence', advisory: true, consequencesExecuted: false,
    packet: [entry], derived: [derived], scenarios: [{ id: 'base', entries: { facts: structuredClone(entry), price: structuredClone(derived) } },
      { id: 'changed', entries: { facts: structuredClone(entry), price: { ...derived, value: 9 } }, overlays: [{ target: 'price', value: 9 }] }],
    stages: [{ stateHash: 'state', questionIDs: ['q'], state: { evidence: [entry] } }], answers: [{ questionID: 'q', answer: { score: 0.8 }, runID: 'run', reusable: true }], compositions: [{ id: 'score', value: 80 }] };
};

test('native receipt deduplicates scenario facts, keeps changed overlays and exact source provenance without changing service data', () => {
  const result = fixture(), before = structuredClone(result), output = JSON.parse(nativeEvidenceOutput(result));
  assert.ok(Buffer.byteLength(JSON.stringify(output), 'utf8') < NATIVE_EVIDENCE_OUTPUT_BYTES);
  assert.equal(output.presentation.partial, false);
  assert.deepEqual(output.scenarios[0].entries, {});
  assert.deepEqual(output.scenarios[0].entryRefs, { facts: '/packet/0', price: '/derived/0' });
  assert.equal(output.scenarios[1].entries.price.value, 9);
  assert.deepEqual(output.scenarios[1].overlays, result.scenarios[1].overlays);
  assert.deepEqual(output.packet, result.packet);
  assert.deepEqual(output.answers, result.answers);
  assert.deepEqual(output.compositions, result.compositions);
  assert.equal(output.stages[0].stateHash, 'state');
  assert.deepEqual(output.stages[0].runIDs, ['run']);
  assert.match(output.stages[0].stateOmitted, /complete state remains/);
  assert.deepEqual(result, before);
});

test('large receipts remain losslessly accessible in bounded valid JSON chunks, including Unicode and completed answers', () => {
  const result = fixture(); result.packet[0].value = 'quote " newline\n 😀'.repeat(9000);
  let outputCursor, combined = '', chunks = 0;
  do {
    const text = nativeEvidenceOutput(result, { outputCursor });
    assert.ok(Buffer.byteLength(text, 'utf8') <= NATIVE_EVIDENCE_OUTPUT_BYTES);
    const output = JSON.parse(text);
    assert.equal(output.receiptID, result.receiptID);
    assert.equal(output.status, 'ok');
    assert.equal(output.requiresInference, false);
    assert.equal(output.presentation.offset, combined.length);
    assert.equal(output.presentation.partial, true);
    assert.match(output.presentation.instructions, /without inference or replay/);
    combined += output.data; outputCursor = output.presentation.nextCursor; chunks++;
  } while (outputCursor);
  assert.ok(chunks > 1);
  assert.deepEqual(JSON.parse(combined), evidenceEvaluationView(result));
  assert.deepEqual(JSON.parse(combined).answers, result.answers);
});

test('changed receipts or invalid cursors cannot silently read another chunk or trigger evaluation', () => {
  const result = fixture(), first = JSON.parse(nativeEvidenceOutput(result, { maxBytes: 4000 }));
  assert.throws(() => nativeEvidenceOutput(result, { outputCursor: '0' }), /invalid or the receipt changed/);
  result.status = 'evidence-changed';
  assert.throws(() => nativeEvidenceOutput(result, { outputCursor: first.presentation.nextCursor }), /do not repeat evaluation/);
  assert.throws(() => nativeEvidenceOutput(result, { maxBytes: 50000 }), /Invalid native evidence response limit/);
});

test('describe uses compact complete JSON without changing the app-owned contract schema', () => {
  const schema = { version: 1, schema: { instructions: 'Use official source contracts' } };
  assert.deepEqual(JSON.parse(nativeEvidenceOutput(schema)), schema);
});
