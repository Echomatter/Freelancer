import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVALUATION_LIMITS, assertSafeEvaluationData, evaluateExpression,
  expressionRefs, readPath, validateComposition, validateEvaluationContract,
} from '../domain/evidence-evaluation.mjs';

const q = (id, stage = 0, dependsOn = []) => ({ id, primitive: 'check',
  instructions: `Does the selected evidence support ${id}?`,
  criteria: { yes: 'Supported by the selected evidence', no: 'Not supported or unclear' },
  inputs: ['input'], stage, ...(dependsOn.length ? { dependsOn } : {}) });
const suppliedContract = extra => ({ version: 1,
  supplied: [{ id: 'input', kind: 'supplied', value: { value: 4 }, provenance: 'Synthetic fixture' }],
  ...extra,
});

test('contract accepts supplied generic evidence and only explicit later-stage dependencies', () => {
  const input = suppliedContract({ questions: [q('first'), q('second', 1, ['first'])] });
  const validated = validateEvaluationContract(input);
  assert.equal(validated.questions.length, 2);
  assert.deepEqual(validated.questions[1].dependsOn, ['first']);
  assert.notEqual(validated, input, 'validation returns a cloned contract');
});

test('query selectors require projected fields and reject unsupported domains or filters', () => {
  const valid = validateEvaluationContract({ version: 1, evidence: [{ id: 'matches', source: 'query',
    domain: 'files', query: 'offline', fields: ['title', 'sourceRevision'], limit: 10,
    filters: { projectID: 'project-1', phrase: true } }], questions: [{ ...q('coverage'), inputs: ['matches'] }] });
  assert.deepEqual(valid.evidence[0].fields, ['title', 'sourceRevision']);
  assert.throws(() => validateEvaluationContract({ version: 1, evidence: [{ id: 'matches', source: 'query',
    domain: 'files', query: 'offline' }] }), /explicit projected fields/);
  assert.throws(() => validateEvaluationContract({ version: 1, evidence: [{ id: 'matches', source: 'query',
    domain: 'files', query: 'offline', fields: ['title'], filters: { arbitrarySQL: 'select 1' } }] }), /unsupported fields/);
  assert.throws(() => validateEvaluationContract({ version: 1, evidence: [{ id: 'fact', source: 'knowledge',
    domain: 'unknown', recordID: 'fact-1' }] }), /known query domain|facts or memories/);
});

test('identifiers, exact revisions, stage order, and unknown references are checked', () => {
  assert.throws(() => validateEvaluationContract({ version: 1,
    supplied: [{ id: '__proto__', kind: 'supplied', value: 1 }] }), /identifier/);
  assert.throws(() => validateEvaluationContract({ version: 1,
    evidence: [{ id: 'fact', source: 'knowledge', domain: 'facts', recordID: 'fact-1', revision: 1 }] }), /exact memory revision/);
  assert.throws(() => validateEvaluationContract(suppliedContract({ questions: [q('first', 0, ['second']), q('second')] })), /explicit later stage/);
  assert.throws(() => validateEvaluationContract(suppliedContract({ derivations: [{ id: 'calc', expression: { ref: 'missing' } }] })), /unavailable input/);
  assert.throws(() => validateEvaluationContract(suppliedContract({ questions: [{ ...q('first'), inputs: ['missing'] }] })), /unavailable/);
});

test('secret-bearing values and unsafe projection paths are rejected', () => {
  for (const value of [
    { token: 'Bearer abc123' },
    { credential: 'sk-1234567890abcdef' },
    { nested: '-----BEGIN PRIVATE KEY-----' },
    JSON.parse('{"constructor":{"polluted":true}}'),
  ]) assert.throws(() => assertSafeEvaluationData(value));
  assert.throws(() => readPath({}, 'constructor.prototype'));
  assert.throws(() => expressionRefs({ ref: 'input', path: '__proto__.x' }));
});

test('deterministic arithmetic and explicit projections run without inference', () => {
  const entries = { left: { value: { value: 9 } }, right: { value: { value: 3 } } };
  assert.equal(evaluateExpression({ op: 'divide', args: [
    { ref: 'left', path: 'value' }, { ref: 'right', path: 'value' },
  ] }, entries), 3);
  assert.deepEqual(evaluateExpression({ op: 'project', input: { ref: 'rows' }, fields: { label: 'name', amount: 'value' } },
    { rows: { value: [{ name: 'A', value: 1, unused: true }] } }), [{ label: 'A', amount: 1 }]);
  const warnings = [];
  assert.equal(evaluateExpression({ op: 'divide', args: [{ value: 4 }, { value: 0 }] }, {}, { warnings }), null);
  assert.ok(warnings.some(message => /Division by zero is unknown/.test(message)));
  assert.equal(EVALUATION_LIMITS.expressions, 2000);
});

test('filter retains partial/unknown information and joins have bounded deterministic behavior', () => {
  const warnings = [];
  const filtered = evaluateExpression({ op: 'filter', input: { ref: 'rows' }, where: { op: 'gt', args: [
    { row: 'score' }, { value: 2 },
  ] } }, { rows: { value: [{ score: 3 }, {}, { score: 1 }] } }, { warnings });
  assert.deepEqual(filtered, [{ score: 3 }]);
  assert.ok(warnings.some(message => /unknown decisions/.test(message)));
  const joined = evaluateExpression({ op: 'join', left: { ref: 'a' }, right: { ref: 'b' },
    leftKey: 'id', rightKey: 'id', how: 'left' }, { a: { value: [{ id: 1 }, { id: 2 }] },
    b: { value: [{ id: 1, title: 'one' }] } });
  assert.deepEqual(joined, [{ left: { id: 1 }, right: { id: 1, title: 'one' } },
    { left: { id: 2 }, right: null }]);
});

test('composition requires declared numeric ranges, mappings, and a labeled output scale', () => {
  const valid = [{ id: 'weighted-fit', terms: [{ questionID: 'q1', field: 'probabilityYes', weight: 2, range: [0, 1] }],
    scale: { min: 0, max: 100, units: 'points' } }];
  assert.equal(validateComposition(valid), valid);
  assert.throws(() => validateComposition([{ ...valid[0], terms: [{ ...valid[0].terms[0], range: [0, 0] }] }]), /increasing numeric range/);
  assert.throws(() => validateComposition([{ ...valid[0], scale: { min: 1, max: 1, units: 'points' } }]), /increasing finite/);
  assert.throws(() => validateComposition([{ ...valid[0], terms: [{ questionID: 'q1', field: 'choice', weight: 1,
    range: [0, 1] }] }]), /explicit numeric mapping/);
});

test('composition rejects finite values whose spans or accumulated weights overflow', () => {
  const base = { id: 'weighted-fit', terms: [{ questionID: 'q1', field: 'probabilityYes', weight: 1, range: [0, 1] }],
    scale: { min: 0, max: 100, units: 'points' } };
  assert.throws(() => validateComposition([{ ...base, scale: { min: -Number.MAX_VALUE, max: Number.MAX_VALUE, units: 'points' } }]), /finite span|scale/);
  assert.throws(() => validateComposition([{ ...base, terms: [{ questionID: 'q1', field: 'probabilityYes', weight: 1,
    range: [-Number.MAX_VALUE, Number.MAX_VALUE] }] }]), /finite span|range/);
  assert.throws(() => validateComposition([{ ...base, terms: [
    { questionID: 'q1', field: 'probabilityYes', weight: Number.MAX_VALUE, range: [0, 1] },
    { questionID: 'q2', field: 'probabilityYes', weight: Number.MAX_VALUE, range: [0, 1] },
  ] }]), /finite total|weight/);
});

test('contract, selector, and expression bounds are finite and reject oversized input', () => {
  assert.equal(EVALUATION_LIMITS.selectors, 20);
  assert.equal(EVALUATION_LIMITS.questions, 20);
  assert.throws(() => validateEvaluationContract({ version: 1, supplied: Array.from({ length: 101 }, (_, i) =>
    ({ id: `v${i}`, kind: 'supplied', value: i })) }), /at most 100/);
  assert.throws(() => validateEvaluationContract({ version: 1,
    supplied: [{ id: 'input', kind: 'supplied', value: 'é'.repeat(70_000) }] }), /120 KB/);
  assert.throws(() => evaluateExpression({ op: 'sum', args: Array.from({ length: 2002 }, () => ({ value: 1 })) }, {}), /work exceeded/);
});
