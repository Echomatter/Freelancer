import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationEvidence } from '../scripts/verification-evidence.mjs';

const commit = 'a'.repeat(40);
test('verification evidence records failure, cancellation and skips without promoting them to success', () => {
  const report = verificationEvidence({ commit, steps: {
    tests: { outcome: 'failure', conclusion: 'failure' },
    browser: { outcome: 'skipped', conclusion: 'skipped' },
    cancelled: { outcome: 'cancelled', conclusion: 'cancelled' },
    incomplete: {},
  }, env: {}, now: new Date('2026-09-25T00:00:00Z') });
  assert.deepEqual(report.checks.map(check => check.outcome), ['failure', 'skipped', 'cancelled', 'unknown']);
  assert.equal(report.checkoutCommit, commit);
  assert.equal(report.liveProviderInference, 'not-run');
});

test('verification evidence distinguishes a tested merge checkout from the PR head and excludes secrets', () => {
  const report = verificationEvidence({ commit, steps: { test: { outcome: 'success', conclusion: 'success', outputs: { token: 'PRIVATE_OUTPUT' } } },
    env: { PR_HEAD_SHA: 'b'.repeat(40), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', VERIFICATION_JOB: 'browser', SECRET: 'PRIVATE_ENVIRONMENT' } });
  assert.notEqual(report.checkoutCommit, report.pullRequestHead);
  assert.equal(report.run.attempt, '2');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_OUTPUT|PRIVATE_ENVIRONMENT/);
});

test('verification evidence refuses an invented checkout and malformed step collection', () => {
  assert.throws(() => verificationEvidence({ commit: 'main', steps: {} }), /SHA/);
  assert.throws(() => verificationEvidence({ commit, steps: [] }), /outcomes/);
});
