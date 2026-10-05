import { LOCAL_DATA_SCHEMA_VERSION } from '../../shared/data-contract.mjs';
import { assertLocalStoragePath } from '../../shared/local-storage-path.mjs';
import { createChatSearch } from './chat-search.mjs';
import { createModelRatings } from './model-ratings.mjs';
import { createModelDataStore } from './model-data.mjs';
import { createImportedChats } from './imported-chats.mjs';
import { createMemoryService } from './memory.mjs';
import { createMemoryCaptureService } from './memory-capture.mjs';
import { createOpenCodeWarehouse } from './opencode-warehouse.mjs';
import { createJudgmentEvidenceResolver } from './judgment-evidence.mjs';
import { createAnalyticsService } from './analytics.mjs';
import { contentSubstring, contentOffset } from '../../domain/content-query.mjs';
import { readApplicationSettings, readSettingsProfile, splitSettingsByAuthority, writeApplicationSettings, writeSettingsProfile } from '../application-settings.mjs';
import { normalizePlans } from '../../domain/costs.mjs';
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  lstatSync,
  chmodSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

const APP_ID = 1414482766;
const SCHEMA = LOCAL_DATA_SCHEMA_VERSION;
const plain = (row) => row && { ...row };
const stableJSON = value => JSON.stringify(value, (_key, item) => {
  if (!item || Array.isArray(item) || typeof item !== 'object') return item;
  return Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]]));
});
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

const freshRuntimeHash = (runtimeID, sourcePath) =>
  createHash('sha256').update(JSON.stringify(['fresh-empty-runtime', runtimeID, sourcePath, APP_ID])).digest('hex');

function onlyUnrefreshedModelDataSeeds(db) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='model_data_sources'").get();
  if (!exists) return true;
  const rows = db.prepare(`SELECT source,generation,status,current_snapshot_id,current_job_id,last_refresh_at,last_attempt_at,
    retry_at,record_count,version,error,quota_json,metadata_json FROM model_data_sources ORDER BY source`).all();
  if (rows.length !== 2) return false;
  return rows.every((row, index) => row.source === ['artificial-analysis','modelsdev'][index] &&
    row.generation === 0 && row.status === 'never-refreshed' && row.current_snapshot_id === null && row.current_job_id === null &&
    row.last_refresh_at === null && row.last_attempt_at === null && row.retry_at === null && row.record_count === 0 &&
    row.version === null && row.error === null && row.quota_json === null && row.metadata_json === '{}');
}

/** Reject anything already in a fresh namespace before opening SQLite writable. */
export function assertFreshRuntimeRoot(directory, runtimeID) {
  assertLocalStoragePath(directory);
  if (!path.isAbsolute(directory)) throw Error('The local data folder must be an absolute path.');
  const sourcePath = path.resolve(directory);
  if (!existsSync(directory)) return;
  const root = lstatSync(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw Error('Fresh Freelancer data root must be a regular directory.');
  const filename = path.join(directory, 'freelancer.sqlite');
  const allowed = new Set(['freelancer.sqlite', 'freelancer.sqlite-wal', 'freelancer.sqlite-shm', 'application-settings.json']);
  const extras = readdirSync(directory).filter(name => !allowed.has(name) && !/^application-settings-[a-f0-9]{24}\.json$/.test(name));
  if (extras.length) throw Error('Fresh Freelancer data root contains unregistered files; refusing to open or import prior data.');
  if (!existsSync(filename)) {
    if (readdirSync(directory).length) throw Error('Fresh Freelancer data root is not empty; refusing to import prior data.');
    return;
  }
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Choose a regular local data file, not a link.');
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); }
  catch { throw Error('Local data requires Node.js 24.10 or newer.'); }
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    // Native launch helpers may inspect the runtime while its last writer finishes.
    // Apply the same bounded wait used by the writable store before metadata reads.
    db.exec('PRAGMA busy_timeout = 10000');
    const appID = db.prepare('PRAGMA application_id').get().application_id;
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const runtime = tables.has('runtime_instances')
      ? db.prepare('SELECT * FROM runtime_instances WHERE runtime_id=?').get(runtimeID)
      : undefined;
    const migrationID = `fresh-runtime:${runtimeID}`;
    const run = tables.has('data_migration_runs')
      ? db.prepare('SELECT * FROM data_migration_runs WHERE migration_id=?').get(migrationID)
      : undefined;
    if (!runtime && !run && !existsSync(path.join(directory, 'application-settings.json'))) {
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const ownedTables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
        AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations','data_table_lifecycle')
        AND name NOT GLOB 'content_units_fts_*' AND name NOT GLOB 'chat_search_*'
        AND name NOT GLOB 'memory_search_fts_*' AND name NOT GLOB 'claims_search_fts_*'`).all();
      if ((appID === 0 && tables.size === 0) || (appID === APP_ID && version > 0 && version <= SCHEMA)) {
        for (const { name } of ownedTables) {
          if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name))
            throw Error('Fresh Freelancer data root contains unregistered data; refusing to open or import prior data.');
          const hasData = name === 'model_data_sources' ? !onlyUnrefreshedModelDataSeeds(db)
            : !!db.prepare(`SELECT 1 FROM "${name}" LIMIT 1`).get();
          if (hasData)
            throw Error('Fresh Freelancer data root contains unregistered data; refusing to open or import prior data.');
        }
        return; // interrupted clean schema initialization; no user data was committed
      }
    }
    if (appID !== APP_ID || !tables.has('runtime_instances') || !tables.has('data_migration_runs') || !tables.has('runtime_collection_markers'))
      throw Error('Fresh Freelancer data root contains an unregistered database; refusing to open or import prior data.');
    const hash = freshRuntimeHash(runtimeID, sourcePath);
    if (!runtime || !run || run.status !== 'fresh-bootstrap' || runtime.source_path !== sourcePath ||
        runtime.source_app_id !== APP_ID || runtime.source_sha256 !== hash || run.source_sha256 !== hash ||
        runtime.source_schema_version > SCHEMA)
      throw Error('Fresh Freelancer data root is not a matching registered runtime; refusing to open or import prior data.');
  } finally { db.close(); }
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
export function createLocalDataStore(directory, { readOnly = false } = {}) {
  assertLocalStoragePath(directory);
  if (!path.isAbsolute(directory))
    throw Error("The local data folder must be an absolute path.");
  if (!readOnly) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, "freelancer.sqlite");
  if (readOnly && !existsSync(filename)) throw Error('A registered Freelancer database is required; no database was created.');
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
      "Local data requires Node.js 24.10 or newer. Update Node and restart Freelancer. Existing files were not changed.",
    );
  }
  const db = new DatabaseSync(filename, {readOnly});
  let closed = false;
  try {
    // Startup metadata reads also contend with transactional publication.
    // Install the existing wait policy before the first database read.
    db.exec("PRAGMA busy_timeout = 10000;");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const appID = db.prepare("PRAGMA application_id").get().application_id;
    if (readOnly && (version !== SCHEMA || appID !== APP_ID)) throw Error('Read-only queries require the current registered Freelancer schema. Start Freelancer to upgrade it explicitly.');
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
    db.exec("PRAGMA foreign_keys = ON;");
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
    if (!readOnly) db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    // Match the native OpenCode store's startup maintenance: fold any frames
    // left by an unclean previous exit without waiting for active readers.
    // Closing the connection below remains responsible for the normal
    // connection lifecycle; startup never truncates a potentially busy WAL.
    try {
      if (!readOnly) db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
    } catch (error) {
      // A passive checkpoint is opportunistic. Legacy FTS schemas can leave a
      // virtual-table schema lock after an otherwise committed migration; WAL
      // remains valid and must not make the upgraded database unavailable.
      if (![5, 6].includes(error.errcode)) throw error;
    }
    if (!readOnly && process.platform !== "win32") chmodSync(filename, 0o600);
  } catch (e) {
    db.close();
    throw e;
  }
  let transactionDepth = 0;
  const tx = (fn) => {
    const nested=transactionDepth>0,savepoint=`local_data_${transactionDepth}`;
    db.exec(nested?`SAVEPOINT ${savepoint}`:"BEGIN IMMEDIATE");
    transactionDepth++;
    try {
      const result = fn();
      db.exec(nested?`RELEASE SAVEPOINT ${savepoint}`:"COMMIT");
      return result;
    } catch (e) {
      try {
        if(nested){db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);db.exec(`RELEASE SAVEPOINT ${savepoint}`);}
        else db.exec("ROLLBACK");
      } catch { /* preserve the original write failure */ }
      throw e;
    } finally { transactionDepth--; }
  };
  const assertJudgmentEvidence = createJudgmentEvidenceResolver(db);
  const analytics = createAnalyticsService(filename);
  const warehouse = createOpenCodeWarehouse(db, tx);
  const chatSearch = createChatSearch(db, tx);
  const modelData = createModelDataStore(db, tx);
  if (!readOnly) {
    try { warehouse.initializeWarehouseDerivations(); }
    catch(error) { analytics.close();db.close();throw error; }
  }
  const resetDerivedIndexes = () => {
    const lifecycle = db.prepare("SELECT table_name AS tableName,lifecycle FROM data_table_lifecycle ORDER BY table_name").all();
    const actualTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'").all().map(row => row.name));
    const registeredTables = new Set(lifecycle.map(row => row.tableName));
    const ftsShadow = name => [...registeredTables].some(table =>
      (table.endsWith("_fts") || table === "chat_search") &&
      ["_data", "_idx", "_content", "_docsize", "_config"].some(suffix => name === `${table}${suffix}`));
    const unregistered = [...actualTables].filter(name => !registeredTables.has(name) &&
      name !== "schema_migrations" && name !== "data_table_lifecycle" && !ftsShadow(name));
    if (unregistered.length) throw Error(`Index repair stopped because durable-table ownership is unknown: ${unregistered.join(", ")}.`);
    const expectedDerived = new Set([
      "content_meta", "content_sources", "content_units", "content_units_fts",
      "content_facts", "content_fact_stats", "chat_search", "chat_search_state",
      "project_index_state", "memory_search_fts", "claims_search_fts",
      "claims", "claim_evidence", "knowledge_claim_evidence", "knowledge_current_claims", "knowledge_memory_evidence",
      "knowledge_pinned_memories", "knowledge_source_coverage", "opencode_source_coverage",
      "knowledge_task_outcomes", "knowledge_outcome_summary",
    ]);
    const derivedViews = new Set([
      "claims", "claim_evidence", "knowledge_claim_evidence", "knowledge_current_claims", "knowledge_memory_evidence",
      "knowledge_pinned_memories", "knowledge_source_coverage", "opencode_source_coverage",
      "knowledge_task_outcomes", "knowledge_outcome_summary",
    ]);
    const registeredDerived = new Set(lifecycle.filter(row => row.lifecycle === "derived").map(row => row.tableName));
    const unsupported = [...registeredDerived].filter(name => !expectedDerived.has(name));
    if (unsupported.length) throw Error(`Index repair stopped because derived-table repair is not defined for: ${unsupported.join(", ")}.`);
    for (const name of expectedDerived) {
      if (!registeredDerived.has(name)) throw Error(`Index repair stopped because expected derived table ${name} is not registered.`);
      if (derivedViews.has(name) && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='view' AND name=?").get(name))
        throw Error(`Index repair stopped because expected derived view ${name} is missing.`);
      if (!derivedViews.has(name) && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
        throw Error(`Index repair stopped because expected derived table ${name} is missing.`);
    }
    // A normal reset is deliberately in-place: operational evidence and
    // uncertainty, durable memory, the SQLite handle and file identity
    // remain intact. Corrupt-database recovery is a separate operation.
    return tx(() => {
      db.exec(`DELETE FROM content_facts;
        DELETE FROM content_fact_stats;
        DELETE FROM content_units;
        DELETE FROM content_sources;
        DELETE FROM content_meta;
        DELETE FROM chat_search_state;
        DELETE FROM project_index_state;
        DROP TABLE chat_search;
        CREATE VIRTUAL TABLE chat_search USING fts5(
          project_id UNINDEXED, session_id UNINDEXED, message_id UNINDEXED,
          role UNINDEXED, model_id UNINDEXED, updated_at UNINDEXED,
          title, body, tokenize='unicode61 remove_diacritics 2'
        );
        DROP TABLE content_units_fts;
        CREATE VIRTUAL TABLE content_units_fts USING fts5(
          project_key UNINDEXED, filename, virtual_path, source_role, status,
          heading, locator, text, tokenize='unicode61 remove_diacritics 2'
        );
        `);
      // Schema24 owns both projections. Repair reuses their exact columns and
      // backfill SQL while retained memory revisions/evidence remain untouched.
      const memorySchema = readFileSync(new URL('./migration-24.sql', import.meta.url), 'utf8');
      for (const section of ['canonical-memory-search','compatibility-claim-search']) {
        const start = memorySchema.indexOf(`-- BEGIN ${section}`);
        const end = memorySchema.indexOf(`-- END ${section}`, start);
        if (start < 0 || end < 0) throw Error('Canonical memory search repair contract is missing.');
        db.exec(memorySchema.slice(start, end));
      }
      // The source manifests and failures remain durable. A repaired FTS needs
      // a fresh publication receipt even when its source hash is unchanged.
      warehouse.requeueWarehouseDerivations();
      return { reset: [...expectedDerived] };
    });
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
          `SELECT a.hidden_at AS hiddenAt,a.revision
            FROM session_annotations a WHERE a.project_id=? AND a.session_id=?`,
        )
        .get(project, id),
    ) ?? { hiddenAt: null, revision: 0 };
  return {
    directory,
    filename,
    initializeFreshRuntime(runtimeID) {
      if (typeof runtimeID !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runtimeID))
        throw Error('Fresh runtime initialization requires a stable runtime ID.');
      const sourcePath = path.resolve(directory);
      const migrationID = `fresh-runtime:${runtimeID}`;
      const sourceHash = freshRuntimeHash(runtimeID, sourcePath);
      const directories = [
        'directory:',
        'directory:webpage/',
        'directory:delegation/',
        'directory:delegation/workers/',
        'directory:delegation/bindings/',
        'directory:delegation/decisions/',
        'directory:delegation/blocks/',
        'directory:delegation/dispatch-locks/',
        'directory:model-input/',
        'directory:preferences/',
        'directory:measurements/',
      ];
      const now = Date.now();
      const registration = tx(() => {
        const runtime = db.prepare('SELECT * FROM runtime_instances WHERE runtime_id=?').get(runtimeID);
        const prior = db.prepare('SELECT * FROM data_migration_runs WHERE migration_id=?').get(migrationID);
        if (runtime || prior) {
          if (!runtime || !prior || prior.status !== 'fresh-bootstrap' ||
              runtime.source_path !== sourcePath || runtime.source_app_id !== APP_ID ||
              runtime.source_schema_version > SCHEMA || runtime.source_sha256 !== sourceHash || prior.source_sha256 !== sourceHash)
            throw Error('Fresh runtime registration is incomplete or belongs to another data source; no prior data was opened.');
          const markers = new Set(db.prepare('SELECT collection_name FROM runtime_collection_markers WHERE runtime_id=?').all(runtimeID).map(row => row.collection_name));
          if (!['requests', 'usage', ...directories].every(name => markers.has(name)))
            throw Error('Fresh runtime collection registration is incomplete; no prior data was opened.');
          return { created: false, runtimeID, status: prior.status };
        }
        const ownedTables = db.prepare(`SELECT name AS table_name FROM sqlite_master
          WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations','data_table_lifecycle')
            AND name NOT GLOB 'content_units_fts_*' AND name NOT GLOB 'chat_search_*'
            AND name NOT GLOB 'memory_search_fts_*' AND name NOT GLOB 'claims_search_fts_*' ORDER BY name`).all();
        for (const { table_name: table } of ownedTables) {
          if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(table)) throw Error('Invalid owned-table metadata in Freelancer database.');
          if (table === 'model_data_sources' && onlyUnrefreshedModelDataSeeds(db)) continue;
          if (db.prepare(`SELECT 1 FROM "${table}" LIMIT 1`).get())
            throw Error('Freelancer data root is not empty; refusing fresh activation or prior-data import.');
        }
        if (db.prepare('SELECT 1 FROM data_migration_runs LIMIT 1').get() || db.prepare('SELECT 1 FROM runtime_instances LIMIT 1').get())
          throw Error('Freelancer data root already has a runtime registration; refusing to import prior data.');
        db.prepare('INSERT INTO runtime_instances(runtime_id,source_path,source_app_id,source_schema_version,source_sha256,imported_at) VALUES(?,?,?,?,?,?)')
          .run(runtimeID, sourcePath, APP_ID, SCHEMA, sourceHash, now);
        db.prepare('INSERT INTO data_migration_runs VALUES(?,?,?,?,?,?,?,?,?)')
          .run(migrationID, sourcePath, APP_ID, SCHEMA, sourceHash, 'fresh-bootstrap', JSON.stringify({ mode:'fresh-empty', importedRows:0 }), now, now);
        const marker = db.prepare('INSERT INTO runtime_collection_markers(runtime_id,collection_name) VALUES(?,?)');
        for (const name of ['requests', 'usage', ...directories]) marker.run(runtimeID, name);
        return { created: true, runtimeID, status: 'fresh-bootstrap' };
      });
      const settings = readApplicationSettings(directory, { allowMissing:true });
      if (!existsSync(path.join(directory, 'application-settings.json'))) {
        writeApplicationSettings(directory, { version:1, revision:0, values:{ plans:normalizePlans(), monthlyPlans:{} } });
      } else {
        const values = { ...settings.values };
        let changed = false;
        if (!Object.hasOwn(values, 'plans')) { values.plans = normalizePlans(); changed = true; }
        if (!Object.hasOwn(values, 'monthlyPlans')) { values.monthlyPlans = {}; changed = true; }
        if (changed) writeApplicationSettings(directory, { ...settings, revision:settings.revision + 1, values });
      }
      return registration;
    },
    ...createImportedChats(db, tx),
    ...createModelRatings(db, tx),
    ...modelData,
    info: () => ({
      schemaVersion: SCHEMA,
      filename,
      sessions: db.prepare("SELECT count(*) n FROM session_headers").get().n,
      drafts: db.prepare("SELECT count(*) n FROM drafts WHERE text <> ''").get()
        .n,
    }),
    migrateRuntimeRecords(sourceFilename, { quiesced = false, runtimeID } = {}) {
      if (quiesced !== true)
        throw Error("Stop Freelancer, OpenCode plugins and runtime helpers before migrating records.");
      if (typeof runtimeID !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runtimeID))
        throw Error("Provide a stable runtime ID explicitly; do not infer it from the checkout name.");
      if (!path.isAbsolute(sourceFilename) || path.resolve(sourceFilename) === path.resolve(filename))
        throw Error("Choose the existing runtime records database as the migration source.");
      if (!existsSync(sourceFilename) || !lstatSync(sourceFilename).isFile() || lstatSync(sourceFilename).isSymbolicLink())
        throw Error("Runtime records source must be an existing regular database file.");
      const source = new DatabaseSync(sourceFilename, { readOnly: true });
      try {
        const appID = source.prepare("PRAGMA application_id").get().application_id;
        const version = source.prepare("PRAGMA user_version").get().user_version;
        if (appID !== 1179796804 || version !== 1)
          throw Error("Unsupported runtime records source. Existing data was preserved.");
        const tableNames = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
        if (!tableNames.has("collections") || !tableNames.has("records"))
          throw Error("Runtime records source is missing required tables.");
        const integrity = source.prepare("PRAGMA integrity_check").all().map(row => Object.values(row)[0]);
        if (integrity.length !== 1 || integrity[0] !== "ok")
          throw Error("Runtime records source failed integrity check. Existing data was preserved.");
        source.exec("BEGIN");
        const collectionRows = source.prepare("SELECT name FROM collections ORDER BY name").all();
        const rows = source.prepare("SELECT collection,id,project_id,session_id,data,summary FROM records ORDER BY rowid").all();
        const sourceHash = createHash("sha256").update(JSON.stringify([appID,version,collectionRows,rows])).digest("hex");
        const documentKeys = new Set(collectionRows.filter(row => row.name.startsWith("document:")).map(row => row.name.slice("document:".length)));
        const operationalCollections = new Set(collectionRows.map(row => row.name).filter(name => name !== "documents" && !name.startsWith("document:") && !name.startsWith("directory:")));
        const selected = rows.filter(row => (documentKeys.has(row.id) || row.id === 'settings.json' && documentKeys.has('webpage/settings.json')) && row.collection === "documents" || operationalCollections.has(row.collection));
        const settingsRow = selected.find(row => row.collection === 'documents' && ['settings.json','webpage/settings.json'].includes(row.id));
        const manifest = {
          sourceRecords: rows.length,
          sourceCollections: collectionRows.map(row => row.name),
          documentCount: selected.filter(row => row.collection === "documents" && !['settings.json','webpage/settings.json'].includes(row.id)).length,
          settingsCount: 0,
          globalSettingCount: 0,
          domainSettingCount: 0,
          settingsProfile: null,
          projectCount: 0,
          operationalCollections: [...operationalCollections].sort(),
          operationalRecordCount: selected.filter(row => row.collection !== "documents").length,
          ignoredRecords: rows.length - selected.length,
          markerCount: collectionRows.length + (collectionRows.some(row=>row.name==='document:settings.json') && !collectionRows.some(row=>row.name==='document:webpage/settings.json') ? 1 : 0),
          sha256: sourceHash,
        };
        if (manifest.ignoredRecords)
          throw Error(`Runtime records contain ${manifest.ignoredRecords} rows without a known collection marker; migration stopped without changes.`);
        const migrationID = `runtime-records:${runtimeID}`;
        if (db.prepare("SELECT 1 FROM data_migration_runs WHERE migration_id=?").get(migrationID) ||
            db.prepare('SELECT 1 FROM runtime_instances WHERE runtime_id=?').get(runtimeID))
          throw Error("Runtime records migration has already been recorded.");
        let settingsParts;
        if (settingsRow) {
          settingsParts = splitSettingsByAuthority(JSON.parse(settingsRow.data));
          manifest.settingsCount = Object.keys(JSON.parse(settingsRow.data)).filter(key => key !== 'projects').length;
          manifest.globalSettingCount = Object.keys(settingsParts.global.values).length;
          manifest.domainSettingCount = Object.keys(settingsParts.domain).length;
          const profile = writeSettingsProfile(path.dirname(filename), runtimeID, settingsParts.global);
          manifest.settingsProfile = { file: path.basename(profile.path), sha256: profile.sha256, byteCount: profile.byteCount };
        }
        const run = Date.now();
        tx(() => {
          const insertRuntime = db.prepare('INSERT INTO runtime_instances VALUES(?,?,?,?,?,?)');
          insertRuntime.run(runtimeID,path.resolve(sourceFilename),appID,version,sourceHash,run);
          const insertRecord = db.prepare("INSERT INTO operational_records(runtime_id,collection,id,project_id,session_id,data,summary) VALUES(?,?,?,?,?,?,?)");
          const insertDocument = db.prepare("INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?)");
          const insertMarker = db.prepare("INSERT INTO runtime_collection_markers(runtime_id,collection_name) VALUES(?,?)");
          const markerNames = new Set(collectionRows.map(({name})=>name));
          if (markerNames.has('document:settings.json') && !markerNames.has('document:webpage/settings.json')) markerNames.add('document:webpage/settings.json');
          for (const name of markerNames) insertMarker.run(runtimeID, name);
          for (const row of selected) {
            if (row.collection === "documents" && ['settings.json','webpage/settings.json'].includes(row.id)) {
              const saveProject = db.prepare("INSERT INTO project_registrations(runtime_id,project_id,data) VALUES(?,?,?)");
              for (const project of settingsParts.projects) {
                if (!project?.id || typeof project.id !== "string") throw Error("Legacy project registration has no stable ID; migration stopped.");
                saveProject.run(runtimeID,project.id,JSON.stringify(project));
                manifest.projectCount++;
              }
              const saveSetting = db.prepare("INSERT INTO runtime_settings(runtime_id,setting_key,data) VALUES(?,?,?)");
              for (const [key, value] of Object.entries(settingsParts.domain)) {
                saveSetting.run(runtimeID,key,JSON.stringify(value));
              }
            } else if (row.collection === "documents") insertDocument.run(runtimeID,row.id,row.data);
            else insertRecord.run(runtimeID,row.collection,row.id,row.project_id,row.session_id,row.data,row.summary);
          }
          const copiedRecords = db.prepare("SELECT count(*) n FROM operational_records WHERE runtime_id=?").get(runtimeID).n;
          const copiedDocuments = db.prepare("SELECT count(*) n FROM application_documents WHERE runtime_id=?").get(runtimeID).n;
          if (copiedRecords !== manifest.operationalRecordCount || copiedDocuments !== manifest.documentCount)
            throw Error("Copied row counts did not match the migration manifest.");
          if (db.prepare("SELECT count(*) n FROM runtime_collection_markers WHERE runtime_id=?").get(runtimeID).n !== manifest.markerCount)
            throw Error("Runtime import markers did not match the migration manifest.");
          if (db.prepare("SELECT count(*) n FROM project_registrations WHERE runtime_id=?").get(runtimeID).n !== manifest.projectCount ||
              db.prepare("SELECT count(*) n FROM runtime_settings WHERE runtime_id=?").get(runtimeID).n !== manifest.domainSettingCount)
            throw Error("Project or application setting counts did not match the migration manifest.");
          for (const collection of manifest.operationalCollections) {
            const sourceCount = selected.filter(row => row.collection === collection).length;
            const targetCount = db.prepare("SELECT count(*) n FROM operational_records WHERE runtime_id=? AND collection=?").get(runtimeID,collection).n;
            if (sourceCount !== targetCount) throw Error(`Copied count mismatch for runtime collection ${collection}.`);
          }
          for (const row of selected.filter(row => row.collection !== "documents")) {
            const copied = db.prepare("SELECT collection,id,project_id,session_id,data,summary FROM operational_records WHERE runtime_id=? AND collection=? AND id=?")
              .get(runtimeID,row.collection,row.id);
            if (!copied || copied.collection !== row.collection || copied.id !== row.id || copied.project_id !== row.project_id ||
                copied.session_id !== row.session_id || copied.data !== row.data || copied.summary !== row.summary)
              throw Error(`Copied operational payload mismatch for ${row.collection}/${row.id}.`);
          }
          for (const row of selected.filter(row => row.collection === "documents" && !['settings.json','webpage/settings.json'].includes(row.id))) {
            const copied = db.prepare("SELECT data FROM application_documents WHERE runtime_id=? AND document_key=?").get(runtimeID,row.id);
            if (copied?.data !== row.data) throw Error(`Copied document mismatch for ${row.id}.`);
          }
          if (settingsRow) {
            for (const project of settingsParts.projects) {
              const copied = db.prepare('SELECT data FROM project_registrations WHERE runtime_id=? AND project_id=?').get(runtimeID,project.id);
              if (copied?.data !== JSON.stringify(project)) throw Error(`Copied project registration mismatch for ${project.id}.`);
            }
            for (const [key,value] of Object.entries(settingsParts.domain)) {
              const copied = db.prepare('SELECT data FROM runtime_settings WHERE runtime_id=? AND setting_key=?').get(runtimeID,key);
              if (copied?.data !== JSON.stringify(value)) throw Error(`Copied runtime setting mismatch for ${key}.`);
            }
            if (manifest.settingsProfile) {
              const profile = readSettingsProfile(path.dirname(filename), runtimeID);
              if (JSON.stringify(profile.values) !== JSON.stringify(settingsParts.global.values) || profile.revision !== settingsParts.global.revision)
                throw Error('External application settings profile did not match the migration source.');
            }
          }
          const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
          const targetIntegrity = db.prepare("PRAGMA integrity_check").all().map(row => Object.values(row)[0]);
          if (foreignKeys.length || targetIntegrity.length !== 1 || targetIntegrity[0] !== "ok")
            throw Error("Target validation failed during copy. Preserve the source and inspect the target before retrying.");
          db.prepare("INSERT INTO data_migration_runs VALUES(?,?,?,?,?,?,?,?,?)").run(
            migrationID, path.resolve(sourceFilename), appID, version, sourceHash,
            "validated-copy", JSON.stringify(manifest), run, Date.now());
        });
        source.exec("COMMIT");
        return { status: "validated-copy", manifest };
      } finally { source.close(); }
    },
    migrateRuntimeStateFiles(runtimeRoot, { quiesced = false, runtimeID } = {}) {
      if (quiesced !== true)
        throw Error("Stop Freelancer, OpenCode plugins and runtime helpers before migrating standalone runtime state.");
      if (typeof runtimeID !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runtimeID))
        throw Error("Provide the registered runtime ID explicitly; do not infer it from a checkout name.");
      if (!path.isAbsolute(runtimeRoot) || !existsSync(runtimeRoot) || !lstatSync(runtimeRoot).isDirectory() || lstatSync(runtimeRoot).isSymbolicLink())
        throw Error("Runtime state source must be an existing absolute directory.");
      const runtime = db.prepare('SELECT 1 FROM runtime_instances WHERE runtime_id=?').get(runtimeID);
      const prior = db.prepare('SELECT 1 FROM data_migration_runs WHERE migration_id=?').get(`runtime-state-files:${runtimeID}`);
      if (!runtime || prior) throw Error("Import requires a registered runtime with no prior standalone-state import.");
      const stateRoot = path.join(path.resolve(runtimeRoot), '.state');
      if (existsSync(stateRoot) && lstatSync(stateRoot).isSymbolicLink()) throw Error('Runtime .state root must not be a symbolic link.');
      const skipped = [], files = [], directories = new Set(['']);
      const visit = relative => {
        const directory = path.join(stateRoot, ...relative.split('/').filter(Boolean));
        for (const entry of readdirSync(directory, { withFileTypes:true }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
          const key = relative ? `${relative}/${entry.name}` : entry.name;
          const absolute = path.join(directory,entry.name), stat = lstatSync(absolute);
          if (stat.isSymbolicLink()) throw Error(`Refusing symbolic link in runtime state source: ${key}`);
          if (entry.isDirectory()) { directories.add(key); visit(key); }
          else if (key === 'storage-runtime.json' || key === 'webpage/launch.json' || /^delegation\/dispatch-locks\/[^/]+\/owner\.json$/.test(key))
            skipped.push({key,kind:'file',reason:key === 'webpage/launch.json' ? 'live process rendezvous; stays on filesystem' : key === 'storage-runtime.json' ? 'authority pointer; never imported as data' : 'OS lock owner record; stays on filesystem'});
          else if (entry.isFile() && entry.name.endsWith('.json')) {
            const bytes = readFileSync(absolute);
            let value;
            try { value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')); }
            catch (error) { throw Error(`Invalid runtime state JSON at ${key}; no rows were imported.`,{cause:error}); }
            files.push({ key,value,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length });
          } else skipped.push({ key,kind:entry.isFile()?'file':'other',reason:entry.isFile()?'non-json runtime artifact':'unsupported filesystem entry' });
        }
      };
      try { if (existsSync(stateRoot)) visit(''); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const hashInput = files.map(({key,sha256,bytes})=>[key,sha256,bytes]);
      const sourceHash = createHash('sha256').update(JSON.stringify(hashInput)).digest('hex');
      const run = Date.now();
      const manifest = { runtimeID, root:path.resolve(runtimeRoot), fileCount:files.length, directoryCount:directories.size,
        bytes:files.reduce((sum,file)=>sum+file.bytes,0), skipped,
        sourceSha256:sourceHash, directories:[...directories].sort(), files:files.map(({key,sha256,bytes})=>({key,sha256,bytes})) };
      tx(() => {
        const insert = db.prepare('INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?)');
        for (const file of files) {
          if (file.key === 'webpage/settings.json') {
            const settings = Object.fromEntries(db.prepare('SELECT setting_key,data FROM runtime_settings WHERE runtime_id=?').all(runtimeID).map(row=>[row.setting_key,JSON.parse(row.data)]));
            const projects = db.prepare('SELECT data FROM project_registrations WHERE runtime_id=? ORDER BY project_id').all(runtimeID).map(row=>JSON.parse(row.data));
            const global = readSettingsProfile(path.dirname(filename),runtimeID);
            const reconstructed = { version:1,revision:global.revision,...settings,...global.values,projects };
            if (stableJSON(file.value) !== stableJSON(reconstructed)) throw Error('Standalone settings do not match the imported runtime/settings profile. Reconcile the selected profile before import.');
            continue;
          }
          const priorDocument = db.prepare('SELECT data FROM application_documents WHERE runtime_id=? AND document_key=?').get(runtimeID,file.key);
          const coreOwned = file.key === 'webpage/port.json' || file.key === 'remote-access.json';
          if (priorDocument && (coreOwned || priorDocument.data !== JSON.stringify(file.value)))
            throw Error(`Standalone state key ${file.key} conflicts with a migrated or core-owned document; resolve it before import.`);
          if (!priorDocument) insert.run(runtimeID,file.key,JSON.stringify(file.value));
        }
        const marker = db.prepare('INSERT INTO runtime_collection_markers(runtime_id,collection_name) VALUES(?,?) ON CONFLICT DO NOTHING');
        const present = new Set(db.prepare('SELECT collection_name FROM runtime_collection_markers WHERE runtime_id=?').all(runtimeID).map(row=>row.collection_name));
        for (const directory of directories) {
          const name = `directory:${directory ? `${directory}/` : ''}`;
          if (!present.has(name)) marker.run(runtimeID,name);
        }
        for (const file of files) {
          const name = `document:${file.key}`;
          if (present.has(name)) {
            if (file.key === 'webpage/settings.json') continue;
            const original = db.prepare('SELECT data FROM application_documents WHERE runtime_id=? AND document_key=?').get(runtimeID,file.key);
            if (!original || original.data !== JSON.stringify(file.value)) throw Error(`Document marker ${name} conflicts with the standalone source; import was rolled back.`);
            continue;
          }
          marker.run(runtimeID,name);
        }
        const checks = db.prepare('SELECT collection_name FROM runtime_collection_markers WHERE runtime_id=?');
        const markerExists = db.prepare('SELECT 1 FROM runtime_collection_markers WHERE runtime_id=? AND collection_name=?');
        for (const directory of directories) {
          const name = `directory:${directory ? `${directory}/` : ''}`;
          if (!markerExists.get(runtimeID,name)) throw Error(`Runtime directory marker validation failed for ${directory || '.'}.`);
        }
        for (const file of files) {
          const name = `document:${file.key}`;
          if (!markerExists.get(runtimeID,name)) throw Error(`Runtime document marker validation failed for ${file.key}.`);
          if (file.key !== 'webpage/settings.json') {
            const saved = db.prepare('SELECT data FROM application_documents WHERE runtime_id=? AND document_key=?').get(runtimeID,file.key);
            if (saved?.data !== JSON.stringify(file.value)) throw Error(`Runtime document readback failed for ${file.key}.`);
          }
        }
        const now = Date.now();
        db.prepare('INSERT INTO data_migration_runs VALUES(?,?,?,?,?,?,?,?,?)').run(`runtime-state-files:${runtimeID}`,path.resolve(runtimeRoot),APP_ID,SCHEMA,sourceHash,'validated-copy',JSON.stringify(manifest),run,now);
        const integrity = db.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]);
        if (integrity.length !== 1 || integrity[0] !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
          throw Error('Runtime state import integrity check failed; transaction rolled back.');
        manifest.registeredMarkers = checks.all().length;
      });
      return { status:'validated-copy',manifest };
    },
    migrateLegacyPins() {
      return { status: 'retired', imported: 0, remaining: 0 };
    },
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
      const memoryCoverage = db.prepare(`WITH current AS (
        SELECT m.status,r.revision_id FROM memory_items m JOIN memory_item_revisions r USING(memory_id)
        WHERE m.deleted_at IS NULL AND m.status<>'forgotten'
          AND r.revision=(SELECT max(x.revision) FROM memory_item_revisions x WHERE x.memory_id=m.memory_id)
        ) SELECT count(*) AS records,
          sum(CASE WHEN status='archived' THEN 1 ELSE 0 END) AS archived,
          sum(CASE WHEN EXISTS(SELECT 1 FROM memory_search_fts f WHERE f.revision_id=current.revision_id) THEN 1 ELSE 0 END) AS searchable
          FROM current`).get();
      const guidanceCoverage = db.prepare(`SELECT count(*) AS files,
        sum(CASE WHEN lower(virtual_path) LIKE 'backend/skills/%/skill.md' THEN 1 ELSE 0 END) AS skills,
        sum(CASE WHEN lower(virtual_path) LIKE 'backend/skills/%/references/%.md' THEN 1 ELSE 0 END) AS reference_files,
        sum(CASE WHEN lower(virtual_path) IN ('agents.md','backend/global/workstyle.md','backend/opencode/global-instructions.md') THEN 1 ELSE 0 END) AS instructions
        FROM content_sources WHERE lower(virtual_path) LIKE 'backend/skills/%/skill.md'
          OR lower(virtual_path) LIKE 'backend/skills/%/references/%.md'
          OR lower(virtual_path) IN ('agents.md','backend/global/workstyle.md','backend/opencode/global-instructions.md')`).get();
      const guidanceBuiltAt = db.prepare(`SELECT max(m.value) AS builtAt FROM content_meta m WHERE m.key='built_at_utc'
        AND EXISTS(SELECT 1 FROM content_sources s WHERE s.project_key=m.project_key AND (
          lower(s.virtual_path) LIKE 'backend/skills/%/skill.md' OR lower(s.virtual_path) LIKE 'backend/skills/%/references/%.md'
          OR lower(s.virtual_path) IN ('agents.md','backend/global/workstyle.md','backend/opencode/global-instructions.md')))`).get().builtAt;
      let walBytes = 0;
      try { walBytes = statSync(`${filename}-wal`).size; } catch { /* no WAL sidecar */ }
      return { fileProjects, chatProjects, chatMessages: plain(chatMessages),
        memories: { records:memoryCoverage.records, searchable:memoryCoverage.searchable ?? 0, archived:memoryCoverage.archived ?? 0 },
        guidance: { files:guidanceCoverage.files ?? 0, skills:guidanceCoverage.skills ?? 0,
          references:guidanceCoverage.reference_files ?? 0, instructions:guidanceCoverage.instructions ?? 0, builtAt:guidanceBuiltAt ?? null },
        databaseBytes: pageSize * pageCount, reclaimableBytes: pageSize * freePages,
        walBytes };
    },
    analyze(sql, params = {}, options = {}) { return analytics.analyze(sql, params, options); },
    searchFiles(match, projectKeys, filters = {}, limit = 50, offset = 0) {
      const start = contentOffset(offset);
      if (!Array.isArray(projectKeys) || !projectKeys.length) return [];
      const keys = [...new Set(projectKeys.filter((key) => typeof key === "string" && key))];
      if (!keys.length) return [];
      const where=[`content_units_fts MATCH ?`,`content_units_fts.project_key IN (${keys.map(() => "?").join(",")})`],params=[match,...keys];
      if(filters.source){where.push(`s.virtual_path LIKE ? ESCAPE '\\'`);params.push(contentSubstring(filters.source));}
      if(filters.role){where.push('s.source_role=?');params.push(filters.role);}
      if(filters.status){where.push('s.status=?');params.push(filters.status);}
      return db.prepare(`SELECT
        s.project_key AS projectKey,
        s.source_identity AS sourceIdentity,
        s.revision_identity AS revisionIdentity,
        s.virtual_path AS path,
        s.sha256 AS sourceSha256,
        s.modified_utc AS sourceModifiedAt,
        cr.captured_at AS capturedAt,
        (SELECT value FROM content_meta WHERE project_key=s.project_key AND key='built_at_utc') AS indexBuiltAt,
        CASE WHEN EXISTS(SELECT 1 FROM content_unit_revisions ur WHERE ur.source_identity=s.source_identity
          AND ur.revision_identity=s.revision_identity AND ur.unit_no=u.unit_no AND ur.sha256=u.sha256)
          THEN 'retained' ELSE 'unavailable' END AS evidenceAvailability,
        s.source_role AS role,
        s.status AS status,
        u.unit_no AS unit,
        u.locator AS locator,
        u.sha256 AS unitSha256,
        u.heading AS heading,
        snippet(content_units_fts, 7, '[', ']', ' … ', 26) AS excerpt,
        bm25(content_units_fts) AS score
        FROM content_units_fts
        JOIN content_units u ON u.unit_id=content_units_fts.rowid
        JOIN content_sources s ON s.source_id=u.source_id
        LEFT JOIN content_source_revisions cr ON cr.source_identity=s.source_identity AND cr.revision_identity=s.revision_identity
        WHERE ${where.join(' AND ')}
        ORDER BY bm25(content_units_fts), s.routing_rank DESC, s.project_key,s.virtual_path,u.unit_no,u.locator,u.unit_id
        LIMIT ? OFFSET ?`).all(...params, Math.max(1, Math.min(201, Number(limit)||50)), start).map(row => ({ ...row,
          observedAt: row.capturedAt ?? null, indexedAt: row.indexBuiltAt && Number.isFinite(Date.parse(row.indexBuiltAt)) ? Date.parse(row.indexBuiltAt) : null,
          sourceUpdatedAt: row.sourceModifiedAt && Number.isFinite(Date.parse(row.sourceModifiedAt)) ? Date.parse(row.sourceModifiedAt) : null }));
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
        db.exec("INSERT INTO memory_search_fts(memory_search_fts) VALUES('optimize')");
        db.exec("INSERT INTO claims_search_fts(claims_search_fts) VALUES('optimize')");
        return { operation, message: "SQLite query plans and conversation search were optimized." };
      }
      if (operation === "check") {
        const findings = [];
        db.exec("BEGIN");
        try {
          findings.push(...db.prepare("PRAGMA quick_check").all().map((row) => String(Object.values(row)[0])));
          for (const table of ["chat_search", "content_units_fts", "memory_search_fts", "claims_search_fts"]) {
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
      analytics.close();
      if (!closed) {
        closed = true;
        db.close();
      }
    },
    ...chatSearch,
    ...createMemoryService(db, tx),
    ...createMemoryCaptureService(db, tx),
    ...warehouse,
    publishWarehouseDerivationJob({id,revisionToken}={}) {
      return tx(()=>{
        const snapshot=warehouse.readWarehouseDerivationSnapshot({id,revisionToken});
        if(snapshot.status==='missing'||snapshot.status==='stale') return {published:false,status:'stale'};
        if(snapshot.job.status!=='pending') return {published:false,status:snapshot.job.status,reason:snapshot.job.blockedReason};
        if(!snapshot.isCurrent) {
          warehouse.completeWarehouseDerivationJob({id,revisionToken,status:'superseded'});
          return {published:false,status:'superseded'};
        }
        if(snapshot.status!=='ok'||!snapshot.projectionSafe) return {published:false,status:'blocked',reason:snapshot.reason||'unsafe-message-window'};
        // BEGIN IMMEDIATE holds the current-manifest check, FTS publication and
        // receipt together. No native read, extraction or model call runs here.
        chatSearch.indexChat(snapshot.job.projectID,snapshot.session,snapshot.messages,{derivationJobID:id});
        const outcome=warehouse.completeWarehouseDerivationJob({id,revisionToken,status:'complete'});
        if(!outcome.completed||outcome.status!=='complete') throw Error('Warehouse source changed before publication.');
        return {published:true,status:'complete',id,revisionToken,snapshotRevisionSha256:snapshot.snapshotRevisionSha256};
      });
    },
    createJudgmentDefinition({ id, version = 1, questionID, primitive, question, criteria = {} }) {
      if (typeof id !== 'string' || !id.trim() || id.length > 200) throw Error('Judgment definition ID is required.');
      if (!Number.isSafeInteger(version) || version < 1) throw Error('Judgment definition version must be positive.');
      if (typeof questionID !== 'string' || !questionID.trim() || questionID.length > 200) throw Error('Question ID is required.');
      if (!['check','classify','score'].includes(primitive)) throw Error('Choose a supported JEV primitive.');
      if (typeof question !== 'string' && (!question || typeof question !== 'object')) throw Error('Complete judgment question text is required.');
      if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) throw Error('Judgment criteria must be a JSON object.');
      const criteriaJson = stableJSON(criteria), questionJson = stableJSON(question);
      if (criteriaJson.length > 20_000 || questionJson.length > 20_000) throw Error('Judgment definition is too large.');
      return tx(() => {
        const previous = db.prepare('SELECT question_id,primitive,question_json,criteria_json FROM judgment_definitions WHERE definition_id=? AND version=?').get(id,version);
        if (previous) {
          if (previous.question_id !== questionID || previous.primitive !== primitive || previous.question_json !== questionJson || previous.criteria_json !== criteriaJson)
            throw Error('Judgment definition versions are immutable.');
          return { id, version, created:false };
        }
        const latest = db.prepare('SELECT max(version) AS version FROM judgment_definitions WHERE definition_id=?').get(id).version ?? 0;
        if (version !== latest + 1) throw Error('Judgment definition versions must be added sequentially.');
        db.prepare('INSERT INTO judgment_definitions VALUES(?,?,?,?,?,?,?)').run(id,version,questionID,primitive,questionJson,criteriaJson,Date.now());
        return { id, version, created:true };
      });
    },
    getJudgmentDefinition({ id, version } = {}) {
      if (typeof id !== 'string' || !id.trim() || !Number.isSafeInteger(version) || version < 1)
        throw Error('Judgment definition ID and version are required.');
      const row = db.prepare('SELECT definition_id AS id,version,question_id AS questionID,primitive,question_json AS questionJson,criteria_json AS criteriaJson FROM judgment_definitions WHERE definition_id=? AND version=?').get(id,version);
      return row ? { id:row.id, version:row.version, questionID:row.questionID, primitive:row.primitive,
        question:JSON.parse(row.questionJson), criteria:JSON.parse(row.criteriaJson) } : null;
    },
    recordJudgmentRun(input) {
      const required = (value, name) => { if (typeof value !== 'string' || !value.trim() || value.length > 20_000) throw Error(`${name} is required and bounded.`); return value; };
      const runID = input.runID ?? randomUUID(), stateHash = required(input.stateHash,'State hash').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(stateHash)) throw Error('State hash must be a SHA-256 hexadecimal digest.');
      const candidateIDs = input.candidateIDs ?? [], evidenceRefs = input.evidenceRefs ?? [];
      if (!Array.isArray(candidateIDs) || candidateIDs.length > 500 || !Array.isArray(evidenceRefs) || evidenceRefs.length > 1000) throw Error('Judgment candidate or evidence references exceed limits.');
      if (candidateIDs.some(id => typeof id !== 'string' || !id.trim() || id.length > 2000) || new Set(candidateIDs).size !== candidateIDs.length) throw Error('Candidate IDs must be unique bounded stable strings.');
      const jsonBounded = (value,name,max=200_000) => { const text=stableJSON(value ?? null); if(text.length>max) throw Error(`${name} exceeds its storage limit.`); return text; };
      const candidateIDsJson=jsonBounded(candidateIDs,'Candidate IDs'), evidenceRefsJson=jsonBounded(evidenceRefs,'Evidence references');
      const candidateSetHash=createHash('sha256').update(candidateIDsJson).digest('hex');
      const evidenceHash=createHash('sha256').update(evidenceRefsJson).digest('hex');
      const results=Array.isArray(input.results)?input.results:[];
      if (results.length > 100) throw Error('A judgment run can contain at most 100 typed results.');
      if (!['ok','provider-failed','unavailable','cancelled','invalid-response','evidence-changed'].includes(input.status)) throw Error('Judgment run status is invalid.');
      return tx(() => {
        const definition=db.prepare('SELECT question_id,primitive FROM judgment_definitions WHERE definition_id=? AND version=?').get(input.definitionID,input.definitionVersion);
        if (!definition) throw Error('Judgment definition version does not exist.');
        db.prepare(`INSERT INTO judgment_runs(run_id,definition_id,definition_version,state_hash,candidate_set_hash,evidence_hash,candidate_ids_json,evidence_refs_json,requested_provider,requested_model,reported_provider,reported_model,status,captured_at,latency_ms,usage_json,caller_decision_json,verified_outcome_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runID,input.definitionID,input.definitionVersion,stateHash,candidateSetHash,evidenceHash,candidateIDsJson,evidenceRefsJson,
          required(input.requestedProvider,'Requested provider'),String(input.requestedModel ?? '').slice(0,300),input.reportedProvider ? String(input.reportedProvider).slice(0,200) : null,input.reportedModel ? String(input.reportedModel).slice(0,300) : null,
          required(input.status,'Judgment status'),Date.now(),Number.isFinite(input.latencyMs)?Math.max(0,Math.floor(input.latencyMs)):null,
          input.usage===undefined?null:jsonBounded(input.usage,'Usage',20_000),input.callerDecision===undefined?null:jsonBounded(input.callerDecision,'Caller decision',20_000),
          input.verifiedOutcome===undefined?null:jsonBounded(input.verifiedOutcome,'Verified outcome',20_000));
        const save=db.prepare('INSERT INTO judgment_results VALUES(?,?,?,?,?,?)');
        for (const result of results) {
          const questionID=required(result.questionID,'Result question ID');
          if (questionID !== definition.question_id) throw Error('Judgment result does not match its immutable question definition.');
          if (result.confidence !== undefined && (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1)) throw Error('Provider confidence must be between zero and one.');
          save.run(runID,questionID,result.answer===undefined?null:jsonBounded(result.answer,'Answer'),
          result.probabilities===undefined?null:jsonBounded(result.probabilities,'Probabilities'),Number.isFinite(result.confidence)?result.confidence:null,
          result.derived===undefined?null:jsonBounded(result.derived,'Derived features'));
        }
        return { runID,status:input.status,candidateSetHash,evidenceHash,resultCount:results.length };
      });
    },
    recordJudgmentBatch({ runs } = {}) {
      if(!Array.isArray(runs)||!runs.length||runs.length>20) throw Error('A judgment receipt batch must contain between one and twenty runs.');
      return tx(()=>runs.map(run=>this.recordJudgmentRun(run)));
    },
    judgmentHistory({ definitionID, limit = 20 } = {}) {
      const count=Math.max(1,Math.min(100,Number(limit)||20));
      return db.prepare(`SELECT r.run_id AS runID,r.definition_id AS definitionID,r.definition_version AS definitionVersion,r.state_hash AS stateHash,
        r.candidate_set_hash AS candidateSetHash,r.evidence_hash AS evidenceHash,r.candidate_ids_json AS candidateIDsJson,r.evidence_refs_json AS evidenceRefsJson,
        r.requested_provider AS requestedProvider,r.requested_model AS requestedModel,r.reported_provider AS reportedProvider,r.reported_model AS reportedModel,
        r.status,r.captured_at AS capturedAt,r.latency_ms AS latencyMs,r.usage_json AS usageJson,r.caller_decision_json AS callerDecisionJson,r.verified_outcome_json AS verifiedOutcomeJson,
        q.question_id AS questionID,q.answer_json AS answerJson,q.probabilities_json AS probabilitiesJson,q.confidence,q.derived_json AS derivedJson
        FROM judgment_runs r LEFT JOIN judgment_results q USING(run_id) WHERE (? IS NULL OR r.definition_id=?)
        ORDER BY r.captured_at DESC,r.run_id,q.question_id LIMIT ?`).all(definitionID ?? null,definitionID ?? null,count).map(plain);
    },
    findCachedJudgment({ definitionID, definitionVersion, stateHash, candidateIDs = [], evidenceRefs = [], requestedProvider, requestedModel, reportedProvider, reportedModel } = {}) {
      if (typeof definitionID !== 'string' || !definitionID || !Number.isSafeInteger(definitionVersion) || definitionVersion < 1 ||
          typeof stateHash !== 'string' || !/^[a-f0-9]{64}$/i.test(stateHash) ||
          [requestedProvider,requestedModel,reportedProvider,reportedModel].some(value=>typeof value!=='string'||!value||value.length>300))
        throw Error('Cache lookup requires a SHA-256 state hash and exact requested/reported provider/model identities.');
      if (!Array.isArray(candidateIDs) || !Array.isArray(evidenceRefs) || candidateIDs.length > 500 || evidenceRefs.length > 1000)
        throw Error('Judgment cache candidates or evidence exceed limits.');
      if (candidateIDs.some(id => typeof id !== 'string' || !id.trim() || id.length > 2000) || new Set(candidateIDs).size !== candidateIDs.length)
        throw Error('Cache candidate IDs must be unique bounded stable strings.');
      const candidateJSON=stableJSON(candidateIDs), evidenceJSON=stableJSON(evidenceRefs);
      if(candidateJSON.length>200_000||evidenceJSON.length>200_000) throw Error('Judgment cache references exceed their storage limit.');
      if (evidenceRefs.some(ref => ref && typeof ref==='object' &&
          ['content-unit','opencode-text-part','memory-revision','claim-record'].includes(ref.kind))) {
        try { assertJudgmentEvidence.assertReferences({candidateIDs,evidenceRefs}); }
        catch { return {status:'miss',runID:null}; }
      }
      const candidateSetHash=createHash('sha256').update(candidateJSON).digest('hex');
      const evidenceHash=createHash('sha256').update(evidenceJSON).digest('hex');
      const row=db.prepare(`SELECT run_id FROM judgment_runs WHERE definition_id=? AND definition_version=? AND state_hash=?
        AND candidate_set_hash=? AND evidence_hash=? AND requested_provider=? AND requested_model=?
        AND reported_provider=? AND reported_model=? AND status='ok' ORDER BY captured_at DESC LIMIT 1`)
        .get(definitionID,definitionVersion,stateHash.toLowerCase(),candidateSetHash,evidenceHash,requestedProvider,requestedModel,reportedProvider,reportedModel);
      return row ? { status:'hit', runID:row.run_id } : { status:'miss',runID:null };
    },
    readCachedJudgment(input = {}) {
      const match=this.findCachedJudgment(input);
      if(match.status!=='hit') return { ...match, results:[] };
      const receipt=db.prepare(`SELECT candidate_set_hash AS candidateSetHash,evidence_hash AS evidenceHash,status
        FROM judgment_runs WHERE run_id=?`).get(match.runID);
      const rows=db.prepare(`SELECT q.question_id AS questionID,q.answer_json AS answerJson,q.probabilities_json AS probabilitiesJson,
        q.confidence,q.derived_json AS derivedJson FROM judgment_results q WHERE q.run_id=? ORDER BY q.question_id`).all(match.runID);
      return { ...match, ...receipt, status:'hit',runStatus:receipt.status,results:rows.map(row=>({questionID:row.questionID,
        ...(row.answerJson===null?{}:{answer:JSON.parse(row.answerJson)}),
        ...(row.probabilitiesJson===null?{}:{probabilities:JSON.parse(row.probabilitiesJson)}),
        ...(row.confidence===null?{}:{confidence:row.confidence}),
        ...(row.derivedJson===null?{}:{derived:JSON.parse(row.derivedJson)}),
      })) };
    },
    assertJudgmentEvidence(input) { return assertJudgmentEvidence(input); },
    queryJudgmentEvidence(input) { return assertJudgmentEvidence.packet(input); },
    assertJudgmentReferences(input) { return assertJudgmentEvidence.assertReferences(input); },
    annotations(project) {
      return Object.fromEntries(
        db
          .prepare(
            `SELECT a.session_id AS id,a.hidden_at AS hiddenAt,a.revision
              FROM session_annotations a WHERE a.project_id=?`,
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
          "INSERT INTO session_annotations VALUES (?,?,?,?,?) ON CONFLICT(project_id,session_id) DO UPDATE SET pinned_at=session_annotations.pinned_at,hidden_at=excluded.hidden_at,revision=excluded.revision",
        ).run(
          project,
          id,
          null,
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
