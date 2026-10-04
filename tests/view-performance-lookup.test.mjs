import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { modelRows } from '../shared/view.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { seedImportedChats } from './fixtures/imported-history.mjs';

test('modelRows indexed lookups preserve first-match evidence, roster, quota and outcomes', () => {
  const providers = [{ id: 'p', models: { a: { name: 'A', limit: { context: 10 } }, b: { name: 'B' } } }];
  const snapshot = {
    roster: { eligible_models: [
      { id: 'p/a', surface: 'first-surface' },
      { id: 'p/a', surface: 'second-surface' },
      { id: 'p/b', surface: 'b-surface' },
    ] },
    evidence: {
      alias_index: { 'p/a': 'missing-key' },
      models: {
        first: { aliases: ['p/a'], context: { input_tokens: 111 }, source_keys: ['s1'], last_researched_at: 'early' },
        second: { aliases: ['p/a'], context: { input_tokens: 222 }, source_keys: ['s2'], last_researched_at: 'late' },
        direct: { aliases: ['other'], context: { input_tokens: 333 } },
      },
      sources: { s1: { url: 'first' }, s2: { url: 'second' } },
    },
    usage: { providers: [
      { id: 'first-surface', availableRemaining: 0, fresh: true },
      { id: 'first-surface', availableRemaining: 9, fresh: false },
    ] },
    history: { entries: [
      { model: 'p/a', success: true, tests_passed: true, timestamp: '2026-01-01T00:00:00.000Z' },
      { model: 'p/a', success: true, tests_passed: false, timestamp: '2026-01-02T00:00:00.000Z' },
      { model: 'p/a', observation_kind: 'operational', success: false, timestamp: '2026-01-03T00:00:00.000Z' },
      { model: 'p/b', success: false, timestamp: '2026-01-04T00:00:00.000Z' },
    ] },
  };
  const rows = modelRows(providers, snapshot);
  const a = rows.find(row => row.id === 'p/a');
  assert.equal(a.surface, 'first-surface');
  assert.equal(a.availability, 'quota constrained');
  assert.equal(a.quota, 0);
  assert.equal(a.quotaFresh, true);
  assert.equal(a.evidenceContext, 111);
  assert.deepEqual(a.sources, [{ url: 'first' }]);
  assert.deepEqual(a.outcomes, { total: 2, validated: 1, failed: 0, partial: 1 });
  assert.equal(a.recent, '2026-01-02T00:00:00.000Z');
  assert.equal(rows.find(row => row.id === 'p/b').outcomes.failed, 1);
});

test('imported chat lookup reads the selected row instead of parsing every project chat', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-lookup-'));
  const store = createLocalDataStore(root);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  seedImportedChats(store, 'p', [
    { id: 'wanted', sourceID: 's1', title: 'Wanted', directory: root, time: { created: 1, updated: 2 }, source: { ok: true }, messages: [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
    ] },
    { id: 'unrelated', sourceID: 's2', title: 'Unrelated', directory: root, time: { created: 3, updated: 4 }, source: { ok: false }, messages: [] },
  ]);
  const db = new DatabaseSync(store.filename);
  try { db.prepare('UPDATE chatgpt_chats SET source_json=? WHERE project_id=? AND id=?').run('{not json', 'p', 'unrelated'); }
  finally { db.close(); }
  const chat = store.chatGPTChat('p', 'wanted');
  assert.equal(chat.title, 'Wanted');
  assert.equal(chat.messages[0].parts[0].text, 'hello');
  assert.throws(() => store.chatGPTChats('p'), /JSON/);
});
