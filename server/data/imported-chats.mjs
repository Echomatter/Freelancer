// Compatibility reads for snapshots saved before import was removed.
export function createImportedChats(db) {
  return {
    chatGPTChats(project) {
      return db.prepare('SELECT * FROM chatgpt_chats WHERE project_id=? ORDER BY updated_at DESC').all(project).map(row => ({
        id: row.id, title: row.title, directory: row.directory, imported: true, sourceID: row.source_id,
        time: { created: row.created_at, updated: row.updated_at }, source: JSON.parse(row.source_json),
      }));
    },
    chatGPTChat(project, id) {
      const row = db.prepare('SELECT * FROM chatgpt_chats WHERE project_id=? AND id=?').get(project, id);
      const chat = row && {
        id: row.id, title: row.title, directory: row.directory, imported: true, sourceID: row.source_id,
        time: { created: row.created_at, updated: row.updated_at }, source: JSON.parse(row.source_json),
      };
      if (!chat) return null;
      return { ...chat, messages: db.prepare('SELECT message_json FROM chatgpt_messages WHERE project_id=? AND chat_id=? ORDER BY ordinal')
        .all(project, id).map(row => JSON.parse(row.message_json)) };
    },
    chatGPTSource(project, nativeID) {
      const row = db.prepare('SELECT chat_id FROM chatgpt_continuations WHERE project_id=? AND native_id=?').get(project, nativeID);
      return row ? this.chatGPTChat(project, row.chat_id) : null;
    },
  };
}
