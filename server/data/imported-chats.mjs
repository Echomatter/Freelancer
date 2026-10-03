const plain = row => row && { ...row };

export function createImportedChats(db, tx) {
  return {
    onboarding(project) { return plain(db.prepare(`SELECT p.*,
      (SELECT count(*) FROM chatgpt_chats WHERE project_id=p.project_id) AS stored_count
      FROM project_onboarding p WHERE project_id=?`).get(project)); },
    importChatGPT(project, chats) {
      return tx(() => {
        const prior=this.onboarding(project);
        if (prior?.imported_count>0 || db.prepare('SELECT 1 FROM chatgpt_chats WHERE project_id=? LIMIT 1').get(project))
          throw Error('History import is already complete. Its saved conversations were not changed.');
        if (prior && !chats.length) return { imported: 0, messages: 0 };
        for (const chat of chats) {
          db.prepare('INSERT INTO chatgpt_chats VALUES(?,?,?,?,?,?,?,?,?)').run(project, chat.id, chat.sourceID,
            chat.title, chat.directory, chat.time.created, chat.time.updated, Date.now(), JSON.stringify(chat.source));
          const insert = db.prepare('INSERT INTO chatgpt_messages VALUES(?,?,?,?)');
          chat.messages.forEach((message, index) => insert.run(project, chat.id, index, JSON.stringify(message)));
          db.prepare('INSERT INTO session_headers VALUES(?,?,?,?,?,?,?,?)').run(project, chat.id, null,
            chat.title, chat.time.created, chat.time.updated, null, Date.now());
        }
        db.prepare(`INSERT INTO project_onboarding VALUES(?,?,?) ON CONFLICT(project_id)
          DO UPDATE SET completed_at=excluded.completed_at,imported_count=excluded.imported_count`).run(project, Date.now(), chats.length);
        return { imported: chats.length, messages: chats.reduce((sum, chat) => sum + chat.messages.length, 0) };
      });
    },
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
    chatGPTContinuation(project, chat) {
      return plain(db.prepare('SELECT native_id AS nativeID,status FROM chatgpt_continuations WHERE project_id=? AND chat_id=?').get(project, chat));
    },
    beginChatGPTContinuation(project, chat) {
      db.prepare('INSERT INTO chatgpt_continuations VALUES(?,?,NULL,?,?)').run(project, chat, 'creating', Date.now());
    },
    finishChatGPTContinuation(project, chat, nativeID) {
      db.prepare('UPDATE chatgpt_continuations SET native_id=?,status=? WHERE project_id=? AND chat_id=?').run(nativeID, 'ready', project, chat);
    },
    chatGPTSource(project, nativeID) {
      const row = db.prepare('SELECT chat_id FROM chatgpt_continuations WHERE project_id=? AND native_id=?').get(project, nativeID);
      return row ? this.chatGPTChat(project, row.chat_id) : null;
    },
  };
}
