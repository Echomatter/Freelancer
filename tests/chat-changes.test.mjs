import test from 'node:test';
import assert from 'node:assert/strict';
import { chatChanges } from '../domain/chat-changes.mjs';

test('current files remain visible without a native session snapshot and retain provenance', () => {
  const rows = chatChanges([], [], [{ path: 'src/app.ts', added: 3, removed: 1, status: 'modified' }]);
  assert.deepEqual(rows, [{ file: 'src/app.ts', path: 'src/app.ts', additions: 3, deletions: 1, added: 3, removed: 1, status: 'modified', scope: 'workspace' }]);
});
test('successful native edit metadata fills snapshot gaps without claiming failed edits', () => {
  const row = { file: 'src/a.ts', before: 'old', after: 'new', additions: 1, deletions: 1 };
  const messages = [{ parts: [
    { type: 'tool', state: { status: 'completed', metadata: { filediff: row } } },
    { type: 'tool', state: { status: 'error', input: { filePath: 'failed.ts' }, metadata: { filediff: { file: 'failed.ts' } } } },
  ] }];
  assert.equal(chatChanges([], messages).length, 1);
  const rows = chatChanges([row], messages, [{ path: 'src/a.ts', added: 2, removed: 0 }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.scope), ['session', 'workspace']);
});
test('private state and credentials never enter the changes projection', () => {
  assert.deepEqual(chatChanges([], [], ['.env', '.git/config', 'backend/.state/data.json', 'node_modules/pkg/a.js'].map(path => ({ path }))), []);
});
