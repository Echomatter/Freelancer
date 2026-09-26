import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { codexHistoryFixture } from './fixtures/codex-history.mjs';

test('Windows import matches a verified physical project alias, not an unrelated same-name folder', { skip: process.platform !== 'win32' }, async t => {
  const f = await localDataFixture();
  t.after(() => f.close());
  const source = await codexHistoryFixture(f);
  const alias = path.join(f.root, 'project-alias');
  await symlink(f.directory, alias, 'junction');
  const db = new DatabaseSync(source.database);
  try { db.prepare('UPDATE threads SET cwd=? WHERE id=?').run(alias, 'codex-exact'); }
  finally { db.close(); }
  await writeFile(source.source, source.records.map(row => JSON.stringify(row.type === 'session_meta'
    ? { ...row, payload: { ...row.payload, cwd: alias } } : row)).join('\n') + '\n');
  const preview = await f.app.chatgpt.preview(f.directory);
  assert.deepEqual(preview.chats.map(chat => chat.id), ['codex-exact']);
  const result = await f.app.chatgpt.complete(preview.token, ['codex-exact']);
  assert.equal(result.imported, 1);
  assert.equal(f.app.chatgpt.list(result.project.id)[0].directory, f.directory);
});

test('retargeting a resolved transcript directory after preview is rejected before importing or registering a project', async t => {
  const f = await localDataFixture();
  t.after(() => f.close());
  const source = await codexHistoryFixture(f);
  const original = await readFile(source.source);
  const nativeBefore = await readFile(f.nativeFile);
  const preview = await f.app.chatgpt.preview(f.directory);
  assert.deepEqual(preview.chats.map(chat => chat.id), ['codex-exact']);
  const outside = path.join(f.root, 'outside-rollouts');
  await mkdir(outside);
  const replacement = path.join(outside, path.basename(source.source));
  // Keep identity, bytes and length valid so only the location guard can reject it.
  await writeFile(replacement, original);
  const sessions = path.dirname(source.source);
  await rename(sessions, path.join(f.root, 'original-rollouts'));
  await symlink(outside, sessions, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.app.chatgpt.complete(preview.token, ['codex-exact']), /transcript location changed/);
  assert.deepEqual((await f.store.read('settings')).projects, []);
  assert.deepEqual(await readFile(replacement), original);
  assert.deepEqual(await readFile(f.nativeFile), nativeBefore);
});
