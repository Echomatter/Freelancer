import { createChatSearch } from './chat-search.mjs';
import { createModelRatings } from './model-ratings.mjs';
import { createImportedChats } from './imported-chats.mjs';
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
    ...createImportedChats(db, tx),
    ...createModelRatings(db, tx),
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
    searchFiles(match, projectKeys, limit = 50) {
      if (!Array.isArray(projectKeys) || !projectKeys.length) return [];
      const keys = [...new Set(projectKeys.filter((key) => typeof key === "string" && key))];
      if (!keys.length) return [];
      return db.prepare(`SELECT
        s.project_key AS projectKey,
        s.virtual_path AS path,
        s.source_role AS role,
        s.status AS status,
        u.unit_no AS unit,
        u.locator AS locator,
        u.heading AS heading,
        snippet(content_units_fts, 7, '[', ']', ' … ', 26) AS excerpt,
        bm25(content_units_fts) AS score
        FROM content_units_fts
        JOIN content_units u ON u.unit_id=content_units_fts.rowid
        JOIN content_sources s ON s.source_id=u.source_id
        WHERE content_units_fts MATCH ?
          AND content_units_fts.project_key IN (${keys.map(() => "?").join(",")})
        ORDER BY bm25(content_units_fts), s.routing_rank DESC, s.virtual_path
        LIMIT ?`).all(match, ...keys, Math.max(1, Math.min(100, limit))).map(plain);
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
    ...createChatSearch(db, tx),
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
