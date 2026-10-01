import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { composeWorkerFork, forkEvidenceBounds, forkRequirements } from '../tools/runtime/worker-fork.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const directory = 'F:\\Freelancer';
const task = 'Re-verify the routing guard after the eligibility change.';
const recorded = 'Inspect the failing free-model routing guard test.';
const receipt = (over = {}) => ({
  task_id: 'a'.repeat(64), parent_session: 'parent', directory, agent: { id: 'engineer', name: 'Engineer' },
  agent_id: 'engineer', read_only: false, free_only: false, status: 'completed', policy_version: 6,
  created_at: '2026-01-01T00:00:00.000Z', task_hash: hash(recorded),
  attempts: [{ child_session: 'child1', selected_model: 'opencode/free-worker', status: 'completed', completed_at: '2026-01-01T00:05:00.000Z' }],
  worker_result: { summary: 'One failure reproduced.', findings: ['guard rejects a free route'], validationStatus: 'unverified', resultSource: 'structured_completion' },
  project_state: { fingerprint: 'fp-1', ref: 'main', observed_at: '2026-01-01T00:05:00.000Z' },
  ...over,
});
const fork = (over = {}, input = {}) => composeWorkerFork({
  worker: 'child1', task, sourceReceipt: receipt(over), ...input,
  parent: { sessionID: 'parent', directory, ...(input.parent || {}) },
});

test('fork composition returns metadata for one fresh child and no dispatch authority', () => {
  const result = fork();
  assert.equal(result.status, forkRequirements.status);
  assert.deepEqual([result.source.task_id, result.source.worker, result.source.parent_session], ['a'.repeat(64), 'child1', 'parent']);
  assert.deepEqual([result.source.agent.id, result.source.captured.selected_model], ['engineer', 'opencode/free-worker']);
  assert.deepEqual([result.dispatch.fresh_child, result.dispatch.continuation, result.dispatch.reuse_child_session, result.dispatch.delivery], [true, false, false, null]);
  assert.equal(result.dispatch.task, task);
  assert.deepEqual(result.dispatch.inherited_from_source, { agent: 'engineer', read_only: false, free_only: false });
  assert.deepEqual(result.routing.granted, []);
  assert.equal(result.routing.selected_model, null);
  assert.deepEqual(result.requirements.permissions_granted, []);
  assert.equal(result.requirements.evidence_status, 'historical_unverified');
  assert.equal(result.status, 'fresh_fork_ready');
});

test('only a worker owned by this parent in this project directory can be forked', () => {
  assert.throws(() => fork({ parent_session: 'other' }), e => e.name === 'PermissionError' && /does not belong/.test(e.message));
  assert.throws(() => fork({ directory: 'F:\\Other' }), e => e.name === 'PermissionError' && /different project directory/.test(e.message));
  assert.equal(fork({ directory: directory + '\\' }).status, 'fresh_fork_ready');
  assert.equal(fork({ directory: 'f:/Freelancer/../Freelancer' }).status, 'fresh_fork_ready');
  assert.throws(() => fork({ task_id: 'short' }), { name: 'PermissionError' });
  assert.throws(() => fork({}, { sourceReceipt: null }), { name: 'PermissionError' });
  assert.throws(() => fork({}, { sourceChild: { parentID: 'other', directory } }), { name: 'PermissionError' });
  assert.throws(() => fork({}, { sourceChild: { parentID: 'parent', directory: 'F:\\Other' } }), { name: 'PermissionError' });
  assert.throws(() => fork({ attempts: [{ child_session: 'child9', status: 'completed' }] }), { name: 'PermissionError' });
  assert.throws(() => fork({ attempts: [] }), { name: 'PermissionError' });
  assert.equal(fork({}, { sourceChild: { parentID: 'parent', directory, status: 'idle' } }).source.native_status, 'idle');
});

test('a fork needs an explicit new task and is never a continuation', () => {
  assert.throws(() => fork({}, { task: undefined }), e => e.name === 'InvalidTask' && /new bounded task/.test(e.message));
  assert.throws(() => fork({}, { task: '   ' }), { name: 'InvalidTask' });
  assert.equal(fork({}, { task: recorded }).dispatch.task, recorded, 'explicit fresh context may pursue the same bounded task');
  assert.throws(() => fork({}, { continuation: true }), { name: 'InvalidAssignment' });
  assert.throws(() => fork({}, { delivery: 'steer' }), e => e.name === 'InvalidAssignment' && /fresh child session/.test(e.message));
  assert.throws(() => fork({}, { fresh: false }), { name: 'InvalidAssignment' });
  assert.throws(() => fork({}, { worker: '' }), e => e.name === 'InvalidAssignment' && /requires worker/.test(e.message));
  assert.equal(fork({ task_hash: undefined }).dispatch.task, task);
  assert.throws(() => fork({}, { agentID: 'researcher' }), e => e.name === 'BindingFailure' && /inherits the source worker agent/.test(e.message));
});

test('captured and current inspection/free restrictions are inherited and only tightened', () => {
  const inherited = fork({ read_only: true, free_only: true });
  assert.deepEqual([inherited.dispatch.read_only, inherited.dispatch.needsWrites, inherited.dispatch.inspection_only, inherited.dispatch.free_only], [true, false, true, true]);
  assert.deepEqual(inherited.dispatch.inherited_from_source, { agent: 'engineer', read_only: true, free_only: true });
  assert.deepEqual(inherited.dispatch.tightened_by_parent, []);
  const tightened = fork({}, { parent: { readOnly: true, freeOnly: true } });
  assert.deepEqual([tightened.dispatch.read_only, tightened.dispatch.free_only, tightened.dispatch.tightened_by_parent], [true, true, ['read_only', 'free_only']]);
  const inspection = fork({}, { needsWrites: false, inspectionOnly: true });
  assert.deepEqual([inspection.dispatch.read_only, inspection.dispatch.needsWrites], [true, false]);
  assert.throws(() => fork({ read_only: true }, { needsWrites: true }), e => e.name === 'PermissionError' && /cannot be relaxed/.test(e.message));
  assert.throws(() => fork({}, { needsWrites: true, parent: { readOnly: true } }), { name: 'PermissionError' });
  assert.throws(() => fork({ free_only: true }, { freeOnly: false }), e => e.name === 'PreferenceConstraint' && /free-only/.test(e.message));
  assert.throws(() => fork({}, { freeOnly: false, parent: { freeOnly: true } }), { name: 'PreferenceConstraint' });
  assert.throws(() => composeWorkerFork({ worker: 'child1', task, sourceReceipt: receipt(), parent: { sessionID: 'parent' } }), { name: 'InvalidAssignment' });
});

test('prior evidence is carried within bounds and labelled historical and unverified', () => {
  const result = fork({ worker_result: undefined });
  assert.equal(result.evidence.source, 'none');
  assert.deepEqual(result.evidence.items, []);
  const fromReceipt = fork();
  assert.equal(fromReceipt.evidence.source, 'receipt_worker_result');
  assert.deepEqual(fromReceipt.evidence.items.map(item => [item.field, item.text]), [['summary', 'One failure reproduced.'], ['findings', 'guard rejects a free route']]);
  assert.equal(fromReceipt.evidence.item_count, 2);
  assert.ok(fromReceipt.evidence.items.every(item => item.status === 'historical_unverified' && item.source_task === 'a'.repeat(64) && item.source_worker === 'child1' && item.recorded_status === 'unverified'));
  const long = 'x'.repeat(forkEvidenceBounds.maxItemChars * 3);
  const many = Array.from({ length: 12 }, (_, n) => `validation step ${n}`);
  const bounded = fork({}, { evidence: { summary: 'y'.repeat(forkEvidenceBounds.maxSummaryChars * 2), validation: many.map(step => `${step}: ${long}`) } });
  assert.equal(bounded.evidence.source, 'supplied');
  const summary = bounded.evidence.items.find(item => item.field === 'summary');
  const validation = bounded.evidence.items.filter(item => item.field === 'validation');
  assert.ok(summary.text.length <= forkEvidenceBounds.maxSummaryChars && summary.text.endsWith('…'));
  assert.ok(validation.length > 0 && validation.length <= forkEvidenceBounds.maxItemsPerField);
  assert.ok(validation.every(item => item.text.length <= forkEvidenceBounds.maxItemChars && item.text.endsWith('…')));
  assert.deepEqual(bounded.evidence.bounds.chars_used <= forkEvidenceBounds.maxTotalChars, true);
  assert.deepEqual(bounded.evidence.dropped.map(row => [row.field, row.reason]), [['validation', 'total_budget']]);
  const itemBound = fork({}, { evidence: { validation: many } });
  assert.equal(itemBound.evidence.items.length, forkEvidenceBounds.maxItemsPerField);
  assert.ok(itemBound.evidence.dropped.some(row => row.reason === 'field_item_limit'));
  assert.deepEqual([...new Set(bounded.evidence.truncated_fields)].sort(), ['summary', 'validation']);
  assert.ok(bounded.notices.some(note => /evidence item\(s\) exceeded the fork bounds/.test(note)));
  const budget = fork({}, { evidence: Object.fromEntries(forkEvidenceBounds.fields.slice(1).map(field => [field, 'z'.repeat(forkEvidenceBounds.maxItemChars)])) });
  assert.ok(budget.evidence.bounds.chars_used <= forkEvidenceBounds.maxTotalChars);
  assert.ok(budget.evidence.dropped.some(row => row.reason === 'total_budget'));
  const list = fork({}, { evidence: ['one note', 'two note', 42] });
  assert.deepEqual(list.evidence.items.map(item => item.text), ['one note', 'two note']);
  const unknown = fork({}, { evidence: { findings: ['kept'], transcript: ['dropped'] } });
  assert.deepEqual(unknown.evidence.items.map(item => item.field), ['findings']);
  assert.deepEqual(unknown.evidence.dropped, [{ field: 'transcript', reason: 'unknown_field', dropped: 1 }]);
});

test('missing, stale and conflicting project-state fingerprints are annotated without dropping findings', () => {
  const none = fork({ project_state: undefined, state_fingerprint: undefined });
  assert.deepEqual(none.project_state.drift, ['missing_source_state', 'missing_current_state']);
  assert.equal(none.project_state.comparable, false);
  assert.equal(none.project_state.consistent, null);
  assert.equal(none.project_state.findings_preserved, true);
  assert.equal(none.evidence.items.find(item => item.field === 'findings').text, 'guard rejects a free route');
  const matched = fork({}, { now: '2026-01-01T00:06:00.000Z', projectState: { fingerprint: 'fp-1', ref: 'main' } });
  assert.deepEqual(matched.project_state.drift, []);
  assert.equal(matched.project_state.consistent, true);
  assert.equal(matched.project_state.comparable, true);
  assert.ok(matched.project_state.warnings.some(warning => /fingerprints match/.test(warning)));
  const conflicting = fork({}, { now: '2026-01-01T00:06:00.000Z', projectState: { fingerprint: 'fp-2', ref: 'feature' } });
  assert.deepEqual(conflicting.project_state.drift, ['conflicting']);
  assert.equal(conflicting.project_state.consistent, false);
  assert.equal(conflicting.project_state.annotation_only, true);
  assert.ok(conflicting.project_state.warnings.some(warning => /project state changed/i.test(warning)));
  assert.ok(conflicting.project_state.warnings.some(warning => /differs from the current ref feature/.test(warning)));
  assert.equal(conflicting.evidence.items.find(item => item.field === 'findings').status, 'historical_unverified');
  assert.ok(conflicting.notices.some(note => /project state changed/i.test(note)));
  assert.match(conflicting.result, /project-state drift: conflicting/);
  const stale = fork({}, { now: '2026-01-01T02:00:00.000Z', projectState: { fingerprint: 'fp-1' } });
  assert.deepEqual(stale.project_state.drift, ['stale']);
  assert.ok(stale.project_state.warnings.some(warning => /115 minutes old/.test(warning)));
  assert.equal(stale.project_state.stale_after_ms, forkEvidenceBounds.staleAfterMs);
  const fresh = fork({}, { now: '2026-01-01T00:06:00.000Z', projectState: { fingerprint: 'fp-1' } });
  assert.deepEqual(fresh.project_state.drift, []);
});

test('an explicit model stays with normal eligible, paid and native routing', () => {
  const plain = fork();
  assert.deepEqual(plain.routing.ignored, []);
  assert.deepEqual(plain.routing.permission_required, ['eligible budget and surface policy', 'native task permission', 'paid_delegate for any non-free route']);
  const supplied = fork({}, { model: 'openai/some-model' });
  assert.equal(supplied.routing.supplied_model, 'openai/some-model');
  assert.equal(supplied.routing.selected_model, null);
  assert.deepEqual(supplied.routing.ignored, ['model']);
  assert.deepEqual(supplied.routing.granted, []);
  assert.deepEqual(supplied.requirements.permissions_granted, []);
  assert.equal(supplied.source.captured.selected_model, 'opencode/free-worker');
  assert.ok(supplied.notices.some(note => /selects and grants nothing/.test(note)));
});
