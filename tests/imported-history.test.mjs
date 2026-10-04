import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { importedHistoryFixture } from './fixtures/imported-history.mjs';

test('retained imported snapshots share read-only chat, history, search and export without an importer', async t => {
  const f = await localDataFixture(); t.after(() => f.close());
  const saved = importedHistoryFixture(f), project = f.project.id;
  const nativeBefore = await readFile(f.nativeFile);
  const folders = await f.api('projects/folders?' + new URLSearchParams({ directory: f.root }));
  assert.ok(folders.folders.some(row => row.path === f.directory));
  assert.equal(f.app.chatgpt, undefined);
  assert.deepEqual(Object.keys(f.app.importedHistory).sort(), ['get', 'list', 'source']);
  for (const [route, body] of [
    ['projects/import-preview', { directory: f.directory }],
    ['projects/setup', { token: 'retired', selected: ['codex-exact'] }],
    ['chat/imported/continue', { project, session: saved.id }],
  ]) await assert.rejects(f.api(route, body), error => error.status === 404);
  const bootstrap = await f.api('bootstrap?' + new URLSearchParams({ project }));
  const imported = bootstrap.sessions.find(row => row.imported);
  assert.ok(imported); assert.equal(imported.organization.archived, false, 'source archive remains provenance');
  const chat = await f.api('chat?' + new URLSearchParams({ project, session: imported.id }));
  assert.equal(chat.messages[0].parts[0].text, 'Fix the turquoise widget');
  assert.equal(chat.messages[1].parts[0].state.output, 'Recorded widget source');
  await f.app.history.rebuildChatSearch({ projectID: project });
  const search = await f.api('history/search?' + new URLSearchParams({ project, q: 'turquoise' }));
  assert.ok(search.results.some(row => row.session === imported.id));
  const exported = await f.api('history/export', { project, sessions: [imported.id], includeWorkers: true, format: 'json' });
  assert.equal(JSON.parse(exported.content).sessions[0].messages.length, 3);
  assert.equal(f.exports.length, 0);
  const pin = await f.api('history/pin', { project, session: imported.id, pinned: true, revision: 0 }, 'PUT');
  const archive = await f.api('history/archive', { project, session: imported.id, archived: true, revision: pin.revision }, 'PUT');
  await f.api('history/archive', { project, session: imported.id, archived: false, revision: archive.annotation.revision }, 'PUT');
  await assert.rejects(f.app.send(project, imported.id, { text: 'Continue', model: 'opencode/free' }), /read-only/);
  assert.deepEqual(f.app.importedHistory.get(project, saved.id).messages, saved.messages);
  const db = new DatabaseSync(f.app.localData.get().filename);
  try { db.prepare('INSERT INTO chatgpt_continuations VALUES(?,?,?,?,?)').run(project, saved.id, 'ses_history', 'ready', 1); }
  finally { db.close(); }
  const continued = await f.app.chat(project, 'ses_history');
  assert.equal(continued.messages[0].parts[0].text, 'Fix the turquoise widget');
  assert.equal(continued.continuation.application, 'ChatGPT / Codex');
  await f.app.send(project, 'ses_history', { text: 'Next step', model: 'opencode/free', agentID: 'engineer' });
  const parts = f.calls.filter(call => call.route.endsWith('/prompt_async')).at(-1).options.body.parts;
  assert.deepEqual(parts, [{ type: 'text', text: 'Next step' }], 'retired orientation is not injected');
  assert.deepEqual(await readFile(f.nativeFile), nativeBefore);
  await f.store.update('settings', settings => ({ ...settings, projects: [...settings.projects,
    { id: 'foreign', directory: f.directory + '-other', name: 'Other project' }] }));
  await assert.rejects(f.app.chat('foreign', imported.id), /another project/);
});
