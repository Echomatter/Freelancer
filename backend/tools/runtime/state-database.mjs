import path from 'node:path';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { withRecordDatabase, recordDatabasePath } from './record-database.mjs';

// Legacy filenames are stable document keys, not runtime files. Import is
// committed once, including absence; subsequent reads use SQLite exclusively.
function location(file) {
  const absolute = path.resolve(file), parts = absolute.split(path.sep), at = parts.lastIndexOf('.state');
  return at >= 0 ? { root: parts.slice(0, at).join(path.sep), key: parts.slice(at + 1).join('/') }
    : { root: path.dirname(absolute), key: path.basename(absolute) };
}
const transaction = (db, action) => {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
};
const put = (db, key, value) => db.prepare('INSERT INTO records VALUES(?,?,NULL,NULL,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data')
  .run('documents', key, JSON.stringify(value), '{}');
function migrate(db, key, file) {
  const marker = `document:${key}`;
  if (db.prepare('SELECT 1 FROM collections WHERE name=?').get(marker)) return;
  let value;
  try { value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (value !== undefined) put(db, key, value);
  db.prepare('INSERT INTO collections VALUES(?)').run(marker);
}
export function updateState(file, change) {
  const { root, key } = location(file);
  return withRecordDatabase(root, true, db => transaction(db, () => {
    migrate(db, key, file);
    const row = db.prepare('SELECT data FROM records WHERE collection=? AND id=?').get('documents', key);
    const previous = row ? JSON.parse(row.data) : undefined;
    const next = change(previous);
    if (next !== undefined && JSON.stringify(next) !== row?.data) put(db, key, next);
    return next;
  }));
}
export function readState(file, fallback) {
  const { root, key } = location(file);
  if (existsSync(recordDatabasePath(root))) {
    const saved = withRecordDatabase(root, false, db => {
      if (!db.prepare('SELECT 1 FROM collections WHERE name=?').get(`document:${key}`)) return null;
      const row = db.prepare('SELECT data FROM records WHERE collection=? AND id=?').get('documents', key);
      return { value: row ? JSON.parse(row.data) : fallback };
    });
    if (saved) return saved.value;
  }
  return updateState(file, value => value) ?? fallback;
}
export async function readStateText(file) {
  const value = readState(file);
  if (value === undefined) throw Object.assign(Error('Document does not exist'), { code: 'ENOENT' });
  return JSON.stringify(value);
}
// Authored routing assets and native OpenCode credentials remain native files.
export async function readRuntimeText(file, encoding = 'utf8') {
  return path.resolve(file).split(path.sep).includes('.state') ? readStateText(file) : readFile(file, encoding);
}
export function writeState(file, value) { return updateState(file, () => value); }
export function removeState(file) {
  const { root, key } = location(file);
  withRecordDatabase(root, true, db => transaction(db, () => {
    migrate(db, key, file); db.prepare('DELETE FROM records WHERE collection=? AND id=?').run('documents', key);
  }));
}
export function stateFiles(directory) {
  const { root, key } = location(path.join(directory, '_'));
  const prefix = key.slice(0, -1), marker = `directory:${prefix}`;
  return withRecordDatabase(root, true, db => transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM collections WHERE name=?').get(marker)) {
      let names = [];
      try { names = readdirSync(directory).filter(name => name.endsWith('.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const name of names) migrate(db, prefix + name, path.join(directory, name));
      db.prepare('INSERT INTO collections VALUES(?)').run(marker);
    }
    return db.prepare('SELECT id FROM records WHERE collection=? AND substr(id,1,?)=?').all('documents', prefix.length, prefix)
      .map(row => row.id.slice(prefix.length)).filter(name => !name.includes('/'));
  }));
}
