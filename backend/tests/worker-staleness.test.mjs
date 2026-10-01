import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateWorkerContext } from '../tools/runtime/worker-result.mjs';

test('worker result is retained and explicitly marked stale when its activity is old', () => {
  const result = { summary: 'Useful old finding.', findings: ['Check the API route.'], validationStatus: 'unverified' };
  const receipt = { created_at: '2026-10-01T10:00:00.000Z', status: 'completed', worker_result: result };
  const annotated = annotateWorkerContext(result, receipt, { now: Date.parse('2026-10-01T11:00:00.000Z') });
  assert.deepEqual({ ...annotated, context: undefined }, { ...result, context: undefined });
  assert.equal(annotated.context.stale, true);
  assert.equal(annotated.context.project_state, 'source_not_recorded');
  assert.equal(annotated.context.findings_preserved, true);
  assert.match(annotated.context.warnings.join(' '), /stale/);
  assert.match(annotated.context.warnings.join(' '), /no project-state fingerprint/);
});

test('matching and conflicting fingerprints are annotations, never reasons to drop findings', () => {
  const result = { summary: 'Keep the conclusion.', findings: ['Inspect the lock.'] };
  const receipt = { created_at: '2026-10-01T11:55:00.000Z', state_fingerprint: 'old', worker_result: result };
  const same = annotateWorkerContext(result, receipt, { now: Date.parse('2026-10-01T12:00:00.000Z'), currentProjectState: { fingerprint: 'old' } });
  assert.equal(same.context.project_state, 'matching_fingerprints');
  assert.deepEqual(same.findings, result.findings);
  const changed = annotateWorkerContext(result, receipt, { now: Date.parse('2026-10-01T12:00:00.000Z'), currentProjectState: { fingerprint: 'new' } });
  assert.equal(changed.context.project_state, 'conflicting_fingerprints');
  assert.deepEqual(changed.findings, result.findings);
  assert.ok(changed.context.warnings.some(warning => /project changed/i.test(warning)));
});

test('unknown worker age remains unknown and partial claims are preserved', () => {
  const result = { summary: 'Partial result.', resultSource: 'partial', validationStatus: 'unverified' };
  const annotated = annotateWorkerContext(result, {}, { now: Date.parse('2026-10-01T12:00:00.000Z') });
  assert.equal(annotated.context.stale, null);
  assert.equal(annotated.context.project_state, 'source_not_recorded');
  assert.equal(annotated.resultSource, 'partial');
  assert.ok(annotated.context.warnings.length > 0);
});
