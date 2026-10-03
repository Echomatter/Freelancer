import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveDataRoot } from '../../../server/runtime-config.mjs';

const require = createRequire(import.meta.url);
const APP_ID = 1414482766;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const open = (file, write) => process.versions.bun
  ? new (require('bun:sqlite').Database)(file, { readonly: !write, create: write })
  : new (require('node:sqlite').DatabaseSync)(file, { readOnly: !write });

export function unifiedConfig(runtimeRoot, env = process.env) {
  // Freelancer startup passes explicit env activation only after registering a
  // fresh empty runtime. A reviewed pointer remains available for managed
  // migration fixtures and runtimes that were explicitly cut over.
  if (typeof runtimeRoot === 'object' && runtimeRoot !== null) {
    env = runtimeRoot;
    runtimeRoot = env.FREELANCER_RUNTIME_ROOT;
  }
  let runtimeID;
  if (env.FREELANCER_RUNTIME_DATA_MODE === 'unified') runtimeID = env.FREELANCER_RUNTIME_ID;
  else if (runtimeRoot) {
    const pointer = path.join(runtimeRoot, '.state', 'storage-runtime.json');
    let stat;
    try { stat = lstatSync(pointer); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Runtime storage pointer must be a regular file.');
    let saved;
    try { saved = JSON.parse(readFileSync(pointer, 'utf8').replace(/^\uFEFF/, '')); }
    catch (error) { throw Error('Runtime storage pointer is invalid; legacy storage remains authoritative.', { cause: error }); }
    if (saved?.version !== 1 || saved?.mode !== 'unified' || !ID.test(saved.runtimeID ?? ''))
      throw Error('Runtime storage pointer is invalid; legacy storage remains authoritative.');
    runtimeID = saved.runtimeID;
  } else return null;
  const dataHome = env.FREELANCER_DATA_HOME || resolveDataRoot(env);
  if (!dataHome || !path.isAbsolute(dataHome) || !ID.test(runtimeID ?? ''))
    throw Error('Unified runtime storage requires an absolute data home and explicit runtime ID.');
  return { dataHome: path.resolve(dataHome), runtimeID };
}
export function withUnifiedDatabase(config, write, action) {
  const filename = path.join(config.dataHome, 'freelancer.sqlite');
  if (!existsSync(filename)) throw Error('Unified runtime storage is unavailable; legacy storage remains authoritative.');
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unified runtime database must be a regular file.');
  const db = open(filename, write);
  try {
    db.exec('PRAGMA busy_timeout=10000');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const appID = db.prepare('PRAGMA application_id').get().application_id;
    if (appID !== APP_ID || version !== 17) throw Error('Unified runtime database has an unsupported schema; existing data was preserved.');
    const registered = db.prepare('SELECT 1 FROM runtime_instances WHERE runtime_id=?').get(config.runtimeID);
    const ready = db.prepare(`SELECT 1 FROM data_migration_runs WHERE
      (migration_id=? AND status='validated-copy') OR (migration_id=? AND status='fresh-bootstrap')`)
      .get(`runtime-records:${config.runtimeID}`, `fresh-runtime:${config.runtimeID}`);
    if (!registered || !ready)
      throw Error('This runtime has no verified unified-storage registration.');
    if (write) db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    return action(db, config.runtimeID);
  } finally { db.close(); }
}
export function withUnifiedTransaction(config, action) {
  return withUnifiedDatabase(config, true, (db, runtimeID) => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(db, runtimeID); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  });
}
export function markUnifiedCollection(db, runtimeID, name) {
  db.prepare('INSERT INTO runtime_collection_markers(runtime_id,collection_name) VALUES(?,?) ON CONFLICT DO NOTHING').run(runtimeID, name);
}
