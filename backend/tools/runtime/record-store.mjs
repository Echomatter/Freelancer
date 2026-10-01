import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { withRecordDatabase, requestSummary, recordDatabasePath } from './record-database.mjs';

export const recordCollections = new Set(['requests', 'usage']);
const validate = value => {
  if (value?.version !== 1 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records) ||
      Object.values(value.records).some(row => !row || typeof row !== 'object' || Array.isArray(row)))
    throw Error('Invalid record collection');
};
function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
const save = db => db.prepare(`INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(collection,id)
  DO UPDATE SET project_id=excluded.project_id,session_id=excluded.session_id,data=excluded.data,summary=excluded.summary`);
function put(statement, name, id, value) {
  statement.run(name, id, value.projectID ?? null, value.sessionID ?? null,
    JSON.stringify(value), JSON.stringify(name === 'requests' ? requestSummary(value) : {}));
}

export function createRecordStore(root) {
  async function ready(name) {
    if (!recordCollections.has(name)) throw Error('Unknown record collection');
    try {
      if (withRecordDatabase(root, !existsSync(recordDatabasePath(root)), db => db.prepare('SELECT 1 FROM collections WHERE name=?').get(name))) return;
      let legacy = { version: 1, records: {} };
      try { legacy = JSON.parse(await readFile(path.join(root, '.state/webpage', `${name}.json`), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      validate(legacy);
      withRecordDatabase(root, true, db => transaction(db, () => {
        // Another opener may have completed migration while the file was read.
        if (db.prepare('SELECT 1 FROM collections WHERE name=?').get(name)) return;
        const insert = save(db);
        for (const [id, row] of Object.entries(legacy.records)) put(insert, name, id, row);
        db.prepare('INSERT INTO collections VALUES(?)').run(name);
      }));
      // Keep original JSON bytes as a recovery backup; the marker commits with rows.
    } catch (error) {
      throw Error(`Cannot read ${name}; your existing data was preserved.`, { cause: error });
    }
  }
  return {
    async get(name, id) { await ready(name); return withRecordDatabase(root, false, db => { const row = db.prepare('SELECT data FROM records WHERE collection=? AND id=?').get(name, id); return row ? JSON.parse(row.data) : null; }); },
    async read(name) {
      await ready(name);
      return withRecordDatabase(root, false, db => ({ version: 1, records: Object.fromEntries(
        db.prepare('SELECT id,data FROM records WHERE collection=? ORDER BY rowid').all(name).map(row => [row.id, JSON.parse(row.data)]),
      ) }));
    },
    async summaries(project, session) {
      await ready('requests');
      return withRecordDatabase(root, false, db => db.prepare(
        'SELECT summary FROM records WHERE collection=? AND project_id=? AND session_id=? ORDER BY rowid',
      ).all('requests', project, session).map(row => JSON.parse(row.summary)));
    },
    async mutate(name, changes) {
      await ready(name);
      return withRecordDatabase(root, true, db => transaction(db, () => {
        const read = db.prepare('SELECT data FROM records WHERE collection=? AND id=?');
        const insert = save(db);
        const results = new Map();
        for (const [id, change] of changes) {
          const row = read.get(name, id), previous = row ? JSON.parse(row.data) : undefined;
          const next = change(previous);
          if (next && !isDeepStrictEqual(previous, next)) put(insert, name, id, next);
          if (next) results.set(id, next);
        }
        return Object.fromEntries(results);
      }));
    },
    async replace(name, previous, next) {
      validate(next);
      await ready(name);
      withRecordDatabase(root, true, db => transaction(db, () => {
        const insert = save(db), remove = db.prepare('DELETE FROM records WHERE collection=? AND id=?');
        for (const id of Object.keys(previous.records)) if (!Object.hasOwn(next.records, id)) remove.run(name, id);
        for (const [id, row] of Object.entries(next.records))
          if (!isDeepStrictEqual(previous.records[id], row)) put(insert, name, id, row);
      }));
    },
  };
}
