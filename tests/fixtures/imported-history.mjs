import { DatabaseSync } from 'node:sqlite';

// Seed a database from the retired import feature without reviving its parser,
// filesystem scanning, application routes or continuation creation APIs.
export function seedImportedChats(store, project, chats, continuations = []) {
  const db = new DatabaseSync(store.filename);
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const chat of chats) {
      db.prepare('INSERT INTO chatgpt_chats VALUES(?,?,?,?,?,?,?,?,?)').run(project, chat.id, chat.sourceID,
        chat.title, chat.directory, chat.time.created, chat.time.updated, 1, JSON.stringify(chat.source));
      for (const [ordinal, message] of chat.messages.entries())
        db.prepare('INSERT INTO chatgpt_messages VALUES(?,?,?,?)').run(project, chat.id, ordinal, JSON.stringify(message));
      db.prepare('INSERT INTO session_headers VALUES(?,?,?,?,?,?,?,?)').run(project, chat.id, null,
        chat.title, chat.time.created, chat.time.updated, null, 1);
    }
    for (const { chatID, nativeID } of continuations)
      db.prepare('INSERT INTO chatgpt_continuations VALUES(?,?,?,?,?)').run(project, chatID, nativeID, 'ready', 1);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}

export function importedHistoryFixture(f) {
  const id = 'ses_chatgpt_0123456789abcdef0123456789abcdef';
  const info = (ordinal, role) => ({ id: `msg_imported_${ordinal}`, sessionID: id, role, imported: true,
    time: { created: 100 + ordinal } });
  const chat = { id, sourceID: 'codex-exact', title: 'Turquoise widget', directory: f.directory,
    time: { created: 100, updated: 200 }, source: { application: 'ChatGPT / Codex', format: 'codex-rollout',
      recordedDirectory: f.directory, importedAt: 1, archived: true }, messages: [
      { info: info(0, 'user'), parts: [{ id: 'prt_imported_0', type: 'text', text: 'Fix the turquoise widget' }] },
      { info: info(1, 'assistant'), parts: [{ id: 'prt_imported_1', type: 'tool', tool: 'read', callID: 'call_read',
        state: { status: 'completed', input: { path: 'widget.ts' }, output: 'Recorded widget source',
          title: 'read', metadata: { imported: true }, time: { start: 101, end: 101 } } }] },
      { info: info(2, 'assistant'), parts: [{ id: 'prt_imported_2', type: 'text', text: 'The turquoise widget needs a color fix.' }] },
    ] };
  seedImportedChats(f.app.localData.get(), f.project.id, [chat]);
  return chat;
}
