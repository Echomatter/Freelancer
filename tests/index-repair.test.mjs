import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalDataStore } from '../server/data/store.mjs';

test('derived index reset is in-place and preserves memory, pins, revision evidence, and live store', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-index-reset-'));
  const store = createLocalDataStore(root);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });

  store.saveDraft('p', 'draft', 'keep runtime state', 0);
  const note = store.createMemory({ id: 'memory-reset-test', kind: 'note', title: 'Pinned durable note', body: 'violet telescope evidence' });
  store.pinConversationSnapshot({ projectID: 'p', sessionID: 'session-1', title: 'Pinned conversation', originalPinnedAt: 1234 });
  const db = await stat(store.filename);
  const raw = await import('node:sqlite').then(({ DatabaseSync }) => new DatabaseSync(store.filename));
  raw.prepare('INSERT INTO content_meta VALUES(?,?,?)').run('p', 'built_at_utc', 'now');
  raw.prepare(`INSERT INTO chat_search VALUES(?,?,?,?,?,?,?,?)`).run('p','s','m','user','model','1','','stale searchable transcript');
  raw.prepare('INSERT INTO chat_search_state(project_id,session_id,native_updated_at,indexed_at) VALUES(?,?,?,?)').run('p','s',1,1);
  raw.prepare('INSERT INTO project_index_state VALUES(?,?)').run('p',1);
  raw.prepare('INSERT INTO content_source_revisions VALUES(?,?,?,?,?,?)').run('source-1','revision-1','p','notes.md','{}',1);
  raw.close();

  const result = store.maintainIndex('reset');
  assert.equal(result.operation, 'reset');
  assert.equal(store.searchMemory('violet').items[0].id, note.id, 'canonical memory remains searchable after its FTS table is rebuilt');
  assert.equal(store.getMemory('conversation:p:session-1').originalPinnedAt, 1234);
  assert.equal(store.getMemory(note.id).revision.body, 'violet telescope evidence');
  assert.equal((await store.analyze('SELECT count(*) AS n FROM content_meta')).rows[0].n, 0);
  assert.equal((await store.analyze('SELECT count(*) AS n FROM chat_search')).rows[0].n, 0);
  assert.equal((await store.analyze('SELECT count(*) AS n FROM content_source_revisions')).rows[0].n, 1);
  assert.equal(store.draft('p', 'draft').text, 'keep runtime state');
  store.saveDraft('p', 'after-reset', 'same store remains live', 0);
  const after = await stat(store.filename);
  assert.equal(after.dev, db.dev);
  assert.equal(after.ino, db.ino);
});

test('reset refuses unregistered schema objects without swapping or closing the database', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-index-reset-unknown-'));
  const store = createLocalDataStore(root);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(store.filename);
  raw.exec('CREATE TABLE unknown_owner_data(value TEXT)');
  raw.close();
  assert.throws(() => store.maintainIndex('reset'), /ownership is unknown/);
  assert.doesNotThrow(() => store.saveDraft('p', 'still-open', 'yes', 0));
});
