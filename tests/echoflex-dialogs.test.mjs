import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEchoflex, dialogViolations } from '../scripts/check-echoflex.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

test('production dialog boundaries are enforced, including custom chrome and browser popups', async () => {
  assert.deepEqual(await checkEchoflex(), []);
  for (const code of ['const a = <dialog />;', 'const a = <div role="dialog" />;', 'window.confirm("Proceed?");', 'd.showModal();'])
    assert.ok(dialogViolations('src/Feature.tsx', code).length, code);
  assert.ok(dialogViolations('src/feature.css', '.custom::backdrop { background: red; }').length);
  assert.deepEqual(dialogViolations('src/Feature.tsx', 'const a = <Dialog title="Example" />;'), []);
});

test('chat decisions include verified subagents and exclude unrelated, foreign and cyclic ancestry', async t => {
  const f = await localDataFixture();
  t.after(() => f.close());
  f.state.sessions.push(
    { id: 'ses_grandchild', parentID: 'ses_worker', directory: f.directory, title: 'Nested helper' },
    { id: 'ses_foreign', parentID: 'ses_history', directory: f.directory + '-other', title: 'Foreign' },
    { id: 'ses_cycle', parentID: 'ses_cycle', directory: f.directory, title: 'Cycle' });
  f.state.questions = ['ses_history', 'ses_worker', 'ses_grandchild', 'ses_other', 'ses_foreign', 'ses_cycle', 'ses_missing']
    .map((sessionID, i) => ({ id: `question_${i}`, sessionID, questions: [], worker: true }));
  f.state.permissions = f.state.questions.map(row => ({ id: `permission_${row.id}`, sessionID: row.sessionID, permission: 'edit' }));
  const chat = await f.app.chat(f.project.id, 'ses_history');
  assert.deepEqual(chat.questions.map(row => row.sessionID), ['ses_history', 'ses_worker', 'ses_grandchild']);
  assert.deepEqual(chat.permissions.map(row => row.worker), [false, true, true]);
  assert.equal(chat.questions[2].sessionTitle, 'Nested helper');
  const child = await f.app.chat(f.project.id, 'ses_worker');
  assert.deepEqual(child.questions.map(row => row.sessionID), ['ses_worker', 'ses_grandchild']);
  assert.ok(child.questions.every(row => row.worker));
  assert.equal(f.calls.some(call => /\/(reply|reject)$/.test(call.route)), false, 'reading never answers a native request');
});
