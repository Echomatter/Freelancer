import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import {
  mkdirSync,
  readFileSync,
  existsSync,
  lstatSync,
  chmodSync,
  renameSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const APP_ID = 1414482766;
const SCHEMA = 6;
const plain = (row) => row && { ...row };
export function isLocalDataUnavailable(error) {
  const message = String(error?.message ?? "");
  const code = Number(error?.errcode);
  // SQLITE_BUSY/LOCKED is transient contention, not evidence that the
  // application's data is unavailable or corrupt.
  if ([5, 6].includes(code & 0xff) || /database (?:table )?is locked/i.test(message))
    return false;
  return String(error?.code ?? "").startsWith("ERR_SQLITE") ||
    /malformed database|database disk image is malformed|invalid rootpage|unsupported local data database/i.test(message);
}
export function conflict(
  message = "This item changed in another window. Reload before saving.",
) {
  return Object.assign(new Error(message), { status: 409 });
}
export function createLocalDataService(directory) {
  let store;
  let maintenance = false;
  let closed = false;
  return {
    get() {
      if (closed) throw Error("Local data service is closed.");
      if (maintenance)
        throw Object.assign(Error("Local SQLite maintenance is in progress. Retry shortly."), {
          code: "ERR_SQLITE_MAINTENANCE",
        });
      return (store ??= createLocalDataStore(directory));
    },
    beginMaintenance() {
      if (closed) throw Error("Local data service is closed.");
      if (maintenance) throw Error("Another local SQLite maintenance operation is running.");
      maintenance = true;
      store?.close();
      store = undefined;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        maintenance = false;
      };
    },
    close() {
      closed = true;
      store?.close();
      store = undefined;
      maintenance = false;
    },
  };
}
export function createLocalDataStore(directory) {
  if (!path.isAbsolute(directory))
    throw Error("The local data folder must be an absolute path.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, "freelancer.sqlite");
  const legacyFilename = path.join(directory, "library.sqlite");
  if (!existsSync(filename) && existsSync(legacyFilename)) {
    if (!lstatSync(legacyFilename).isFile() || lstatSync(legacyFilename).isSymbolicLink())
      throw Error("The legacy local data database is not a regular file.");
    renameSync(legacyFilename, filename);
  }
  if (
    existsSync(filename) &&
    (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink())
  )
    throw Error("Choose a regular local data file, not a link.");
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    throw Error(
      "Local data requires Node.js 22.13 or newer. Update Node and restart Freelancer. Existing files were not changed.",
    );
  }
  const db = new DatabaseSync(filename);
  let closed = false;
  try {
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const appID = db.prepare("PRAGMA application_id").get().application_id;
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();
    if (
      (appID !== 0 && appID !== APP_ID) ||
      (version && (version > SCHEMA || appID !== APP_ID)) ||
      (!version && tables.length)
    )
      throw Error(
        "Unsupported local data database. Existing data was not changed.",
      );
    // Match the separate index-publisher connection so short app writes wait
    // through its transactional publication instead of surfacing SQLITE_BUSY.
    db.exec("PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;");
    if (!version) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } else {
      for (let next = version + 1; next <= SCHEMA; next++) {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.exec(readFileSync(new URL(`./migration-${next}.sql`, import.meta.url), "utf8"));
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      }
    }
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    // Match the native OpenCode store's startup maintenance: fold any frames
    // left by an unclean previous exit without waiting for active readers.
    // Closing the connection below remains responsible for the normal
    // connection lifecycle; startup never truncates a potentially busy WAL.
    db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
    if (process.platform !== "win32") chmodSync(filename, 0o600);
  } catch (e) {
    db.close();
    throw e;
  }
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const resetDerivedIndexes = () => {
    // A damaged FTS table cannot reliably be deleted in place. Build a clean
    // application database, copy only durable user-owned rows, then swap it
    // in after closing this worker's handle. Search copies are intentionally
    // omitted and rebuilt from the original project/native sources.
    const replacement = `${filename}.rebuilding-${randomUUID()}`;
    const backup = `${filename}.corrupt-${Date.now()}`;
    const durableTables = [
      "project_annotations", "session_headers", "session_annotations", "drafts",
      "model_catalog", "model_rating_jobs", "chatgpt_chats", "chatgpt_messages",
      "chatgpt_continuations", "project_onboarding",
    ];
    let clean;
    let moved = false;
    const movedSidecars = [];
    try {
      clean = new DatabaseSync(replacement);
      clean.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
      clean.exec("PRAGMA foreign_keys=OFF");
      const recovered = {};
      for (const table of durableTables) {
        try {
          // Read rows through the application connection first. A damaged page
          // may stop a cross-database INSERT even when readable durable rows
          // can still be returned. Keep the original file as a backup.
          const rows = db.prepare(`SELECT * FROM ${table} NOT INDEXED`).all();
          const columns = clean.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
          const insert = clean.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
          for (const row of rows) insert.run(...columns.map(column => row[column]));
          recovered[table] = rows.length;
        }
        catch (error) { throw Error(`Could not preserve ${table} during search-index reset: ${error.message}`, { cause: error }); }
      }
      clean.exec("PRAGMA foreign_keys=ON");
      const fk = clean.prepare("PRAGMA foreign_key_check").all();
      const integrity = clean.prepare("PRAGMA integrity_check").get().integrity_check;
      if (fk.length || integrity !== "ok") throw Error("Clean index recovery validation failed.");
      clean.close();
      clean = undefined;
      db.close();
      closed = true;
      renameSync(filename, backup);
      moved = true;
      // SQLite may leave WAL/SHM files after the last handle closes. They
      // belong to the original database and must not be opened with the
      // replacement file, which has different page and schema content.
      for (const suffix of ["-wal", "-shm"]) {
        if (existsSync(`${filename}${suffix}`)) {
          renameSync(`${filename}${suffix}`, `${backup}${suffix}`);
          movedSidecars.push(suffix);
        }
      }
      renameSync(replacement, filename);
      return { backup, recovered };
    } catch (error) {
      try { clean?.close(); } catch { /* best-effort cleanup */ }
      if (moved && !existsSync(filename) && existsSync(backup)) {
        for (const suffix of movedSidecars.reverse()) {
          try { renameSync(`${backup}${suffix}`, `${filename}${suffix}`); } catch { /* preserve original failure */ }
        }
        try { renameSync(backup, filename); } catch { /* preserve the original failure */ }
      }
      throw error;
    }
  };
  const draft = (project, key) =>
    plain(
      db
        .prepare(
          "SELECT text, revision, updated_at AS updatedAt FROM drafts WHERE project_id=? AND conversation_key=?",
        )
        .get(project, key),
    ) ?? { text: "", revision: 0, updatedAt: null };
  const putDraft = (project, key, text, revision) => {
    const current = draft(project, key);
    if (revision !== current.revision)
      throw conflict(
        "This draft changed in another window. Your text is still here; copy it or load the saved version.",
      );
    db.prepare(
      "INSERT INTO drafts VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id,conversation_key) DO UPDATE SET text=excluded.text, revision=excluded.revision, updated_at=excluded.updated_at",
    ).run(project, key, text, revision + 1, Date.now());
    return draft(project, key);
  };
  const annotation = (project, id) =>
    plain(
      db
        .prepare(
          "SELECT pinned_at AS pinnedAt, hidden_at AS hiddenAt, revision FROM session_annotations WHERE project_id=? AND session_id=?",
        )
        .get(project, id),
    ) ?? { pinnedAt: null, hiddenAt: null, revision: 0 };
  return {
    directory,
    filename,
    onboarding(project) { return plain(db.prepare('SELECT * FROM project_onboarding WHERE project_id=?').get(project)); },
    importChatGPT(project, chats) {
      return tx(() => {
        if (this.onboarding(project)) throw Error('Project setup is already complete. Import is available only during setup.');
        for (const chat of chats) {
          db.prepare('INSERT INTO chatgpt_chats VALUES(?,?,?,?,?,?,?,?,?)').run(project, chat.id, chat.sourceID,
            chat.title, chat.directory, chat.time.created, chat.time.updated, Date.now(), JSON.stringify(chat.source));
          const insert = db.prepare('INSERT INTO chatgpt_messages VALUES(?,?,?,?)');
          chat.messages.forEach((message, index) => insert.run(project, chat.id, index, JSON.stringify(message)));
          db.prepare('INSERT INTO session_headers VALUES(?,?,?,?,?,?,?,?)').run(project, chat.id, null,
            chat.title, chat.time.created, chat.time.updated, null, Date.now());
        }
        db.prepare('INSERT INTO project_onboarding VALUES(?,?,?)').run(project, Date.now(), chats.length);
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
      const chat = this.chatGPTChats(project).find(chat => chat.id === id);
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
    modelCatalog(rows) {
      tx(() => {
        const save = db.prepare(`INSERT INTO model_catalog(model_id,metadata_json) VALUES(?,?)
          ON CONFLICT(model_id) DO UPDATE SET metadata_json=excluded.metadata_json`);
        for (const row of rows) save.run(row.id, JSON.stringify(row));
      });
      return this.modelRatings();
    },
    modelRatings() {
      return Object.fromEntries(db.prepare('SELECT model_id, rating_json, updated_at, source_model FROM model_catalog').all()
        .map((row) => [row.model_id, { status: row.rating_json ? 'Updated' : 'Missing information',
          rating: row.rating_json ? JSON.parse(row.rating_json) : null,
          updatedAt: row.updated_at, sourceModel: row.source_model }]));
    },
    unratedModels() {
      return db.prepare('SELECT model_id, metadata_json FROM model_catalog ORDER BY (rating_json IS NOT NULL), updated_at, model_id').all()
        .map((row) => ({ id: row.model_id, ...JSON.parse(row.metadata_json) }));
    },
    saveModelRatings(rows, sourceModel) {
      tx(() => {
        const save = db.prepare('UPDATE model_catalog SET rating_json=?, updated_at=?, source_model=? WHERE model_id=?');
        for (const row of rows) if (save.run(JSON.stringify(row.rating), Date.now(), sourceModel, row.id).changes !== 1)
          throw Error('Model inventory changed during the ratings update. Refresh and try again.');
      });
    },
    ratingJob(id) {
      const row = db.prepare('SELECT * FROM model_rating_jobs WHERE id=?').get(id);
      return row && { id: row.id, project: row.project_id, session: row.session_id,
        model: row.model_id, targets: JSON.parse(row.targets_json), status: row.status,
        summary: row.summary, error: row.error, progress: JSON.parse(row.progress_json), createdAt: row.created_at, updatedAt: row.updated_at };
    },
    currentRatingJob() {
      const row = db.prepare('SELECT id FROM model_rating_jobs ORDER BY created_at DESC LIMIT 1').get();
      const job = row ? this.ratingJob(row.id) : null;
      return job?.status === 'dismissed' ? null : job;
    },
    systemSessions(project) {
      return new Set(db.prepare('SELECT session_id FROM model_rating_jobs WHERE project_id=?').all(project).map(row => row.session_id));
    },
    saveRatingJob(job) {
      db.prepare(`INSERT INTO model_rating_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, summary=excluded.summary,
        error=excluded.error, progress_json=excluded.progress_json, updated_at=excluded.updated_at`)
        .run(job.id, job.project, job.session, job.model, JSON.stringify(job.targets), job.status,
          job.summary, job.error ?? null, job.createdAt, Date.now(), JSON.stringify(job.progress ?? {}));
      return this.ratingJob(job.id);
    },
    info: () => ({
      schemaVersion: SCHEMA,
      filename,
      sessions: db.prepare("SELECT count(*) n FROM session_headers").get().n,
      drafts: db.prepare("SELECT count(*) n FROM drafts WHERE text <> ''").get()
        .n,
    }),
    indexStats() {
      const fileProjects = db.prepare(`WITH projects AS (
        SELECT project_key FROM content_sources UNION SELECT project_key FROM content_meta WHERE key='built_at_utc'
        ) SELECT p.project_key AS key,COUNT(s.source_id) AS sources,
        COALESCE(SUM(s.unit_count),0) AS units,
        MAX(m.value) AS builtAt
        FROM projects p LEFT JOIN content_sources s ON s.project_key=p.project_key LEFT JOIN content_meta m
          ON m.project_key=p.project_key AND m.key='built_at_utc'
        GROUP BY p.project_key`).all().map(plain);
      const chatProjects = db.prepare(`SELECT project_id AS id,COUNT(*) AS conversations,
        MAX(indexed_at) AS indexedAt FROM chat_search_state GROUP BY project_id`).all().map(plain);
      const chatMessages = db.prepare("SELECT COUNT(*) AS messages,COUNT(DISTINCT NULLIF(model_id,'')) AS models FROM chat_search WHERE role <> 'title'").get();
      const pageSize = db.prepare("PRAGMA page_size").get().page_size;
      const pageCount = db.prepare("PRAGMA page_count").get().page_count;
      const freePages = db.prepare("PRAGMA freelist_count").get().freelist_count;
      let walBytes = 0;
      try { walBytes = statSync(`${filename}-wal`).size; } catch { /* no WAL sidecar */ }
      return { fileProjects, chatProjects, chatMessages: plain(chatMessages),
        databaseBytes: pageSize * pageCount, reclaimableBytes: pageSize * freePages,
        walBytes };
    },
    projectIndexesReady(id) {
      return !!db.prepare('SELECT ready_at FROM project_index_state WHERE project_id=?').get(id);
    },
    markProjectIndexesReady(id) {
      db.prepare('INSERT INTO project_index_state VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET ready_at=excluded.ready_at').run(id, Date.now());
    },
    maintainIndex(operation) {
      if (operation === "optimize") {
        // These are independent maintenance hints. Avoid holding one write
        // transaction across all FTS optimization so normal app writes have
        // shorter windows in which to contend.
        db.exec("PRAGMA optimize");
        db.exec("INSERT INTO chat_search(chat_search) VALUES('optimize')");
        db.exec("INSERT INTO content_units_fts(content_units_fts) VALUES('optimize')");
        return { operation, message: "SQLite query plans and conversation search were optimized." };
      }
      if (operation === "check") {
        const findings = [];
        db.exec("BEGIN");
        try {
          findings.push(...db.prepare("PRAGMA quick_check").all().map((row) => String(Object.values(row)[0])));
          for (const table of ["chat_search", "content_units_fts"]) {
            try { db.exec(`INSERT INTO ${table}(${table}) VALUES('integrity-check')`); }
            catch (error) { findings.push(`${table}: ${error.message}`); }
          }
        } finally { db.exec("ROLLBACK"); }
        return { operation, healthy: findings.length === 1 && findings[0] === "ok", findings };
      }
      if (operation === "compact") {
        db.exec("VACUUM");
        const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
        return { operation, message: checkpoint.busy
          ? "SQLite compacted the database; an active reader kept the write-ahead log in place. Retry later to reclaim its space."
          : "SQLite compacted the database and cleared its write-ahead log." };
      }
      if (operation === "reset") {
        resetDerivedIndexes();
        return { operation, message: "Local search indexes were cleared. Rebuild file and conversation indexes to repopulate them." };
      }
      throw Error("Choose an index maintenance action.");
    },
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
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
    indexChat(project, session, messages) {
      const updated = Math.trunc(session.time?.updated || session.time?.created || 0);
      const title = String(session.title || "New chat").slice(0, 500);
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
        }
        db.prepare("INSERT INTO chat_search_state VALUES(?,?,?,?) ON CONFLICT(project_id,session_id) DO UPDATE SET native_updated_at=excluded.native_updated_at,indexed_at=excluded.indexed_at")
          .run(project, session.id, updated, Date.now());
      });
    },
    removeChatIndex(project, ids) {
      tx(() => {
        const erase = db.prepare("DELETE FROM chat_search WHERE project_id=? AND session_id=?");
        const state = db.prepare("DELETE FROM chat_search_state WHERE project_id=? AND session_id=?");
        for (const id of ids) { erase.run(project, id); state.run(project, id); }
      });
    },
    searchChats(query, { project = "", model = "", limit = 50 } = {}) {
      const terms = String(query).match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) ?? [];
      if (!terms.length || String(query).length > 200) return [];
      const match = terms.map((term) => `"${term}"`).join(" AND ");
      return db.prepare(`SELECT chat_search.project_id AS project,chat_search.session_id AS session,message_id AS message,
        role,model_id AS model,chat_search.updated_at AS updatedAt,COALESCE(h.title,chat_search.title) AS title,
        snippet(chat_search,7,'','',' … ',24) AS excerpt,
        bm25(chat_search,0,0,0,0,0,0,2,1) AS rank
        FROM chat_search LEFT JOIN session_headers h ON h.project_id=chat_search.project_id AND h.session_id=chat_search.session_id
        WHERE chat_search MATCH ?
        AND NOT EXISTS (SELECT 1 FROM model_rating_jobs j WHERE j.project_id=chat_search.project_id AND j.session_id=chat_search.session_id)
        AND (? = '' OR chat_search.project_id = ?) AND (? = '' OR model_id = ?)
        ORDER BY rank LIMIT ?`).all(match, project, project, model, model, Math.min(100, Math.max(1, Number(limit) || 50))).map(plain);
    },
    annotations(project) {
      return Object.fromEntries(
        db
          .prepare(
            "SELECT session_id AS id,pinned_at AS pinnedAt,hidden_at AS hiddenAt,revision FROM session_annotations WHERE project_id=?",
          )
          .all(project)
          .map(({ id, ...r }) => [id, r]),
      );
    },
    annotation,
    annotate(project, id, change, revision) {
      return tx(() => {
        const old = annotation(project, id);
        if (revision !== old.revision) throw conflict();
        db.prepare(
          "INSERT INTO session_annotations VALUES (?,?,?,?,?) ON CONFLICT(project_id,session_id) DO UPDATE SET pinned_at=excluded.pinned_at,hidden_at=excluded.hidden_at,revision=excluded.revision",
        ).run(
          project,
          id,
          "pinnedAt" in change ? change.pinnedAt : old.pinnedAt,
          "hiddenAt" in change ? change.hiddenAt : old.hiddenAt,
          revision + 1,
        );
        return annotation(project, id);
      });
    },
    projects() {
      return Object.fromEntries(
        db
          .prepare(
            "SELECT project_id AS id, archived_at AS archivedAt,revision FROM project_annotations",
          )
          .all()
          .map(({ id, ...r }) => [id, r]),
      );
    },
    archiveProject(project, archived, revision) {
      return tx(() => {
        const old = this.projects()[project] ?? { revision: 0 };
        if (revision !== old.revision) throw conflict();
        db.prepare(
          "INSERT INTO project_annotations VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET archived_at=excluded.archived_at,revision=excluded.revision",
        ).run(project, archived ? Date.now() : null, revision + 1);
        return this.projects()[project];
      });
    },
    draft,
    saveDraft(project, key, text, revision) {
      return tx(() => putDraft(project, key, text, revision));
    },
    rebindDraft(project, from, to, revision) {
      if (from === to) throw Error("Choose a different draft destination.");
      return tx(() => {
        const source = draft(project, from),
          target = draft(project, to);
        if (source.revision !== revision || target.text)
          throw conflict("The draft destination changed. Nothing was moved.");
        const destination = putDraft(project, to, source.text, target.revision);
        const origin = putDraft(project, from, "", source.revision);
        return { origin, destination };
      });
    },
  };
}
