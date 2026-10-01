import { chmodSync,existsSync,lstatSync,mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const APP_ID = 1179796804;
const require = createRequire(import.meta.url);
// OpenCode plugins run in Bun; the application server runs in Node. Resolve
// only the host's built-in driver (https://bun.sh/docs/runtime/sqlite).
function openDatabase(filename, write) {
  if (process.versions.bun) {
    const { Database } = require('bun:sqlite');
    return new Database(filename, { readonly: !write, create: write });
  }
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(filename, { readOnly: !write });
}
export const recordDatabasePath = root => path.join(root, '.state/webpage/records.sqlite');

// Runtime authority belongs to this checkout, separate from rebuildable search.
// Connections are short-lived so native tools and disposable fixtures own no handles.
export function withRecordDatabase(root, write, action) {
  const filename = recordDatabasePath(root);
  if (existsSync(filename) && (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink()))
    throw Error('Runtime records must be a regular database file.');
  if (write) mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = openDatabase(filename, write);
  try {
    db.exec('PRAGMA busy_timeout=10000');
    let version = db.prepare('PRAGMA user_version').get().user_version;
    let appID = db.prepare('PRAGMA application_id').get().application_id;
    if (write && version === 0 && appID === 0) {
      db.exec('BEGIN IMMEDIATE');
      try {
        // Another process may have initialized while this connection waited.
        version = db.prepare('PRAGMA user_version').get().user_version;
        appID = db.prepare('PRAGMA application_id').get().application_id;
        if (version === 0 && appID === 0 && !db.prepare('SELECT name FROM sqlite_master').get()) {
          db.exec(`
        CREATE TABLE collections (name TEXT PRIMARY KEY);
        CREATE TABLE records (
          collection TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT, session_id TEXT,
          data TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(collection,id)
        );
        CREATE INDEX records_session ON records(collection,project_id,session_id);
        PRAGMA application_id=${APP_ID}; PRAGMA user_version=1;`);
          version = 1; appID = APP_ID;
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (version !== 1 || appID !== APP_ID) {
      throw Error('Unsupported runtime records database; existing data was preserved.');
    }
    if (write) {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
      if (process.platform !== 'win32') chmodSync(filename, 0o600);
    }
    return action(db);
  } finally { db.close(); }
}

export function requestSummary({ agent, workflow: _workflow, catalog: _catalog,
  catalogModels: _models, catalogConnected: _connected, ...row }) {
  return { ...row, agent: agent ? { id: agent.id, name: agent.name } : null };
}

// Native and web readers share the same one-time import and database authority.
export async function readRuntimeRequest(root, id) {
  const { createRecordStore } = await import('./record-store.mjs');
  return createRecordStore(root).get('requests', id ?? '');
}
