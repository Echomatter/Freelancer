import { contentMatch } from '../../domain/content-query.mjs';
import { createHash } from 'node:crypto';
const plain = row => row && { ...row };
const evidenceHit = (row, matchKind) => {
  const { sourceSystemID, snapshotRevisionSha256, sessionRevisionSha256, ...hit } = row;
  return { ...hit, matchKind, sourceUpdatedAt: hit.updatedAt, origin: sourceSystemID ? 'opencode-capture' : 'local-index',
    evidenceAvailability: sourceSystemID && snapshotRevisionSha256 ? 'retained' : 'unavailable',
    evidence: sourceSystemID && snapshotRevisionSha256 ? { kind: 'opencode-snapshot', sourceSystemID,
      projectID: hit.project, sessionID: hit.session, snapshotRevisionSha256, sessionRevisionSha256 } : null };
};
const evidenceJoin = `LEFT JOIN chat_search_state cs ON cs.project_id=chat_search.project_id AND cs.session_id=chat_search.session_id
  LEFT JOIN opencode_derivation_jobs j ON j.job_id=cs.derivation_job_id AND j.project_id=chat_search.project_id AND j.session_id=chat_search.session_id
  LEFT JOIN opencode_session_revisions sr ON sr.source_system_id=j.source_system_id AND sr.project_id=j.project_id
    AND sr.session_id=j.session_id AND sr.revision_sha256=json_extract(j.manifest_json,'$.sessionRevisionSha256')`;
const evidenceColumns = `cs.indexed_at AS indexedAt,cs.indexed_text_sha256 AS indexedTextSha256,j.created_at AS capturedAt,j.created_at AS observedAt,j.source_system_id AS sourceSystemID,
  j.snapshot_revision_sha256 AS snapshotRevisionSha256,json_extract(j.manifest_json,'$.sessionRevisionSha256') AS sessionRevisionSha256`;

export function createChatSearch(db, tx) {
  return {
    remember(project, sessions) {
      const upsert =
        db.prepare(`INSERT INTO session_headers VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(project_id,session_id) DO UPDATE SET
        parent_id=excluded.parent_id,title=excluded.title,created_at=excluded.created_at,updated_at=excluded.updated_at,native_archived_at=excluded.native_archived_at,seen_at=excluded.seen_at
        WHERE session_headers.parent_id IS NOT excluded.parent_id OR session_headers.title <> excluded.title
        OR session_headers.created_at <> excluded.created_at OR session_headers.updated_at <> excluded.updated_at
        OR session_headers.native_archived_at IS NOT excluded.native_archived_at OR session_headers.seen_at < excluded.seen_at - 60000`);
      tx(() => {
        for (const s of sessions)
          upsert.run(
            project,
            s.id,
            s.parentID ?? null,
            String(s.title || "New chat").slice(0, 500),
            Math.trunc(s.time?.created || 0),
            Math.trunc(s.time?.updated || s.time?.created || 0),
            s.time?.archived || null,
            Date.now(),
          );
      });
    },
    headers(project) {
      return db
        .prepare(
          `SELECT session_id AS id,parent_id AS parentID,title,created_at AS createdAt,updated_at AS updatedAt,native_archived_at AS nativeArchivedAt,seen_at AS seenAt
      FROM session_headers WHERE project_id=? ORDER BY updated_at DESC,session_id`,
        )
        .all(project)
        .map(plain);
    },
    chatIndexState(project) {
      return Object.fromEntries(db.prepare(
        "SELECT session_id AS id,native_updated_at AS updatedAt FROM chat_search_state WHERE project_id=?",
      ).all(project).map((row) => [row.id, row.updatedAt]));
    },
    indexChat(project, session, messages, { derivationJobID = null } = {}) {
      const updated = Math.trunc(session.time?.updated || session.time?.created || 0);
      const title = String(session.title || "New chat").slice(0, 500);
      const textHash = createHash('sha256').update(JSON.stringify([project,session.id,title]));
      this.remember(project, [session]);
      tx(() => {
        db.prepare("DELETE FROM chat_search WHERE project_id=? AND session_id=?").run(project, session.id);
        const insert = db.prepare("INSERT INTO chat_search(project_id,session_id,message_id,role,model_id,updated_at,title,body) VALUES(?,?,?,?,?,?,?,?)");
        // The title is indexed once, even for empty conversations.
        insert.run(project, session.id, "", "title", "", updated, title, "");
        for (const message of messages) {
          const role = message.info?.role;
          if (role !== "user" && role !== "assistant") continue;
          const body = (message.parts ?? []).filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => part.text).join("\n").slice(0, 500000);
          if (!body.trim()) continue;
          const nativeModel = message.info?.model;
          const model = typeof nativeModel === "object"
            ? `${nativeModel.providerID || ""}/${nativeModel.modelID || ""}`
            : typeof nativeModel === "string" ? nativeModel
              : message.info?.providerID && message.info?.modelID
                ? `${message.info.providerID}/${message.info.modelID}` : "";
          insert.run(project, session.id, String(message.info?.id || ""), role, model, updated, "", body);
          textHash.update(JSON.stringify([String(message.info?.id || ""),role,model,body]));
        }
        db.prepare(`INSERT INTO chat_search_state(project_id,session_id,native_updated_at,indexed_at,derivation_job_id,indexed_text_sha256) VALUES(?,?,?,?,?,?)
          ON CONFLICT(project_id,session_id) DO UPDATE SET native_updated_at=excluded.native_updated_at,indexed_at=excluded.indexed_at,derivation_job_id=excluded.derivation_job_id,indexed_text_sha256=excluded.indexed_text_sha256`)
          .run(project, session.id, updated, Date.now(), derivationJobID, textHash.digest('hex'));
      });
    },
    removeChatIndex(project, ids) {
      tx(() => {
        const erase = db.prepare("DELETE FROM chat_search WHERE project_id=? AND session_id=?");
        const state = db.prepare("DELETE FROM chat_search_state WHERE project_id=? AND session_id=?");
        for (const id of ids) { erase.run(project, id); state.run(project, id); }
      });
    },
    searchChats(query, { project = "",projectIDs, model = "", phrase = false, limit = 50, offset = 0 } = {}) {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw Error('Conversation query offset must be an integer from 0 to 100000.');
      const match = contentMatch(String(query),{phrase});
      if (!match) return [];
      if (projectIDs && (!Array.isArray(projectIDs)||!projectIDs.length)) return [];
      const scoped=projectIDs ? `AND chat_search.project_id IN (${projectIDs.map(()=>'?').join(',')})` : '';
      const bounds=[project,project,model,model,...(projectIDs??[])];
      const scope=`AND NOT EXISTS (SELECT 1 FROM model_rating_jobs j WHERE j.project_id=chat_search.project_id AND j.session_id=chat_search.session_id)
        AND (? = '' OR chat_search.project_id = ?) AND (? = '' OR model_id = ?) ${scoped}`;
      const identity=String(query).trim();
      const exact=db.prepare(`SELECT 1 FROM chat_search WHERE (session_id=? OR message_id=?) ${scope} LIMIT 1`)
        .get(identity,identity,...bounds);
      if(exact) return db.prepare(`SELECT chat_search.project_id AS project,chat_search.session_id AS session,message_id AS message,
        role,model_id AS model,chat_search.updated_at AS updatedAt,COALESCE(json_extract(sr.payload_json,'$.title'),h.title,chat_search.title) AS title,
        substr(body,1,240) AS excerpt,0 AS rank,${evidenceColumns} FROM chat_search
        LEFT JOIN session_headers h ON h.project_id=chat_search.project_id AND h.session_id=chat_search.session_id
        ${evidenceJoin}
        WHERE (chat_search.session_id=? OR message_id=?) ${scope}
        ORDER BY chat_search.project_id,chat_search.session_id,message_id,chat_search.rowid LIMIT ? OFFSET ?`)
        .all(identity,identity,...bounds,Math.min(201,Math.max(1,Number(limit)||50)),offset).map(row=>evidenceHit(row,'exact-id'));
      return db.prepare(`SELECT chat_search.project_id AS project,chat_search.session_id AS session,message_id AS message,
        role,model_id AS model,chat_search.updated_at AS updatedAt,COALESCE(json_extract(sr.payload_json,'$.title'),h.title,chat_search.title) AS title,
        snippet(chat_search,7,'','',' … ',24) AS excerpt,
        bm25(chat_search,0,0,0,0,0,0,2,1) AS rank,${evidenceColumns}
        FROM chat_search LEFT JOIN session_headers h ON h.project_id=chat_search.project_id AND h.session_id=chat_search.session_id
        ${evidenceJoin}
        WHERE chat_search MATCH ?
        AND NOT EXISTS (SELECT 1 FROM model_rating_jobs j WHERE j.project_id=chat_search.project_id AND j.session_id=chat_search.session_id)
        AND (? = '' OR chat_search.project_id = ?) AND (? = '' OR model_id = ?)
        ${scoped} ORDER BY rank,chat_search.project_id,chat_search.session_id,message_id,chat_search.rowid
        LIMIT ? OFFSET ?`).all(match, project, project, model, model,...(projectIDs??[]), Math.min(201, Math.max(1, Number(limit) || 50)),offset).map(row=>evidenceHit(row,'fts'));
    },
  };
}
