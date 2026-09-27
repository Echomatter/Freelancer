import test from 'node:test';
import assert from 'node:assert/strict';
import { responseErrorLabel } from '../domain/chat-view.mjs';
import { activityLabel } from '../domain/activity.mjs';

test('stopped responses retain honest completion boundaries and provider diagnostics', () => {
  assert.match(responseErrorLabel({ name: 'MessageAbortedError', data: { message: 'The operation was aborted.' } }), /Response stopped/);
  assert.match(responseErrorLabel('aborted'), /work already completed/);
  assert.equal(responseErrorLabel({ name: 'APIError', data: { message: 'Insufficient credits' } }), 'Insufficient credits');
  assert.equal(activityLabel('completed'), 'Finished');
  assert.equal(activityLabel('aborted'), 'Stopped');
  assert.equal(activityLabel('stop_unverified'), 'Stop not confirmed');
});
