import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyResult, journeyRunStatus } from '../scripts/browser-reporter.mjs';

test('browser evidence records skips, timeouts and interrupted journeys honestly', () => {
  const result = status => journeyResult({ title: 'navigation' }, { status, duration: 30, retry: 0 });
  assert.equal(result('passed').outcome, 'success');
  assert.equal(result('skipped').outcome, 'skipped');
  for (const status of ['failed', 'timedOut', 'interrupted', undefined])
    assert.equal(result(status).outcome, 'failure');
});

test('a green runner exit cannot promote skipped or unrun journeys to complete evidence', () => {
  assert.equal(journeyRunStatus('passed', [{ outcome: 'success' }], []), 'passed');
  assert.equal(journeyRunStatus('passed', [{ outcome: 'skipped' }], []), 'incomplete');
  assert.equal(journeyRunStatus('passed', [], ['navigation']), 'incomplete');
  assert.equal(journeyRunStatus('failed', [{ outcome: 'success' }], []), 'failed');
});
