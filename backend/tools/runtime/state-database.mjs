import path from 'node:path';
import { readFileSync, readdirSync, existsSync, mkdirSync, openSync, writeFileSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { withRecordDatabase, recordDatabasePath } from './record-database.mjs';
import { markUnifiedCollection, unifiedConfig, withUnifiedDatabase, withUnifiedTransaction } from './unified-database.mjs';
import { readApplicationSettings, splitSettingsByAuthority, writeApplicationSettings } from '../../../server/application-settings.mjs';

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
const unifiedPut = (db, runtimeID, key, value) => db.prepare('INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?) ON CONFLICT(runtime_id,document_key) DO UPDATE SET data=excluded.data')
  .run(runtimeID, key, JSON.stringify(value));
function unifiedSettings(db, runtimeID, config) {
  const settings = Object.fromEntries(db.prepare('SELECT setting_key,data FROM runtime_settings WHERE runtime_id=?').all(runtimeID).map(row => [row.setting_key, JSON.parse(row.data)]));
  const projects = db.prepare('SELECT data FROM project_registrations WHERE runtime_id=? ORDER BY project_id').all(runtimeID).map(row => JSON.parse(row.data));
  const global = readApplicationSettings(config.dataHome);
  return { version:1, revision:global.revision, ...settings, ...global.values, projects };
}
function saveUnifiedSettings(db, runtimeID, value) {
  const { projects, domain, global } = splitSettingsByAuthority(value);
  db.prepare('DELETE FROM project_registrations WHERE runtime_id=?').run(runtimeID);
  const project = db.prepare('INSERT INTO project_registrations(runtime_id,project_id,data) VALUES(?,?,?)');
  for (const item of projects) {
    if (typeof item?.id !== 'string' || !item.id) throw Error('Runtime project registration has no stable ID.');
    project.run(runtimeID, item.id, JSON.stringify(item));
  }
  db.prepare('DELETE FROM runtime_settings WHERE runtime_id=?').run(runtimeID);
  const setting = db.prepare('INSERT INTO runtime_settings(runtime_id,setting_key,data) VALUES(?,?,?)');
  for (const [key, item] of Object.entries(domain)) setting.run(runtimeID, key, JSON.stringify(item));
  return global;
}
function recoverApplicationSettings(config) {
  const pending = withUnifiedDatabase(config, false, (db, runtimeID) =>
    db.prepare('SELECT previous_revision,next_revision,settings_json FROM settings_update_journal WHERE runtime_id=?').get(runtimeID));
  if (!pending) return;
  const desired = JSON.parse(pending.settings_json);
  const current = readApplicationSettings(config.dataHome, { allowMissing:true });
  if (current.revision === pending.previous_revision) writeApplicationSettings(config.dataHome, desired);
  else if (current.revision !== pending.next_revision || !isDeepStrictEqual(current, desired))
    throw Error('Application settings revision conflicts with an interrupted database update; existing settings were preserved.');
  withUnifiedTransaction(config, (db, runtimeID) => {
    db.prepare('DELETE FROM settings_update_journal WHERE runtime_id=? AND next_revision=? AND settings_json=?')
      .run(runtimeID, pending.next_revision, pending.settings_json);
  });
}
function migrate(db, key, file) {
  const marker = `document:${key}`;
  if (db.prepare('SELECT 1 FROM collections WHERE name=?').get(marker)) return;
  let value;
  try { value = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (value !== undefined) put(db, key, value);
  db.prepare('INSERT INTO collections VALUES(?)').run(marker);
}
const directoryMarker = key => `directory:${path.posix.dirname(key) === '.' ? '' : `${path.posix.dirname(key)}/`}`;
function requireUnifiedDirectory(db, runtimeID, key) {
  const marked = db.prepare('SELECT 1 FROM runtime_collection_markers WHERE runtime_id=? AND collection_name=?');
  const marker = directoryMarker(key);
  // Native session IDs are created after runtime activation. The registered
  // model-input collection owns their dynamic directories; it does not require
  // a separate migration for each new chat. Other directories still fail closed.
  const sessionInput = /^directory:model-input\/[\w-]+\/$/.test(marker);
  if (!marked.get(runtimeID, marker) &&
    !(sessionInput && marked.get(runtimeID, 'directory:model-input/')))
    throw Error(`Unified runtime directory for ${key} has no migration marker; cutover is incomplete.`);
}
function launchPath(root) { return path.join(root,'.state','webpage','launch.json'); }
function readLaunch(root,fallback) {
  try { return JSON.parse(readFileSync(launchPath(root),'utf8').replace(/^\uFEFF/,'')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
function writeLaunch(root,value) {
  const filename = launchPath(root), temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  let fd;
  try {
    fd = openSync(temporary,'wx',0o600);
    writeFileSync(fd,`${JSON.stringify(value)}\n`,'utf8'); closeSync(fd); fd = undefined;
    renameSync(temporary,filename);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}
export function updateState(file, change) {
  const { root, key } = location(file);
  const config = unifiedConfig(root);
  if (config) {
    if (key === 'webpage/launch.json') {
      const previous = readLaunch(root,undefined), next = change(previous);
      if (next !== undefined && !isDeepStrictEqual(next,previous)) writeLaunch(root,next);
      return next;
    }
    if (key === 'webpage/settings.json') recoverApplicationSettings(config);
    const result = withUnifiedTransaction(config, (db, runtimeID) => {
    const marked = db.prepare('SELECT 1 FROM runtime_collection_markers WHERE runtime_id=? AND collection_name=?').get(runtimeID, `document:${key}`);
    if (!marked) requireUnifiedDirectory(db, runtimeID, key);
    const previous = key === 'webpage/settings.json' ? (marked ? unifiedSettings(db, runtimeID, config) : undefined) :
      (() => { const row = db.prepare('SELECT data FROM application_documents WHERE runtime_id=? AND document_key=?').get(runtimeID, key); return row ? JSON.parse(row.data) : undefined; })();
    let next = change(previous);
    markUnifiedCollection(db, runtimeID, `document:${key}`);
    let settingsPending = false;
    if (next !== undefined && !isDeepStrictEqual(next, previous)) {
      if (key === 'webpage/settings.json') {
        if (!next || typeof next !== 'object' || Array.isArray(next)) throw Error('Runtime settings document is invalid.');
        if (!Number.isSafeInteger(next.revision) || next.revision <= (previous?.revision ?? -1))
          next = { ...next, revision:(previous?.revision ?? -1) + 1 };
        const currentGlobal = readApplicationSettings(config.dataHome, { allowMissing:true });
        const desiredGlobal = saveUnifiedSettings(db, runtimeID, next);
        if (desiredGlobal.revision !== next.revision) throw Error('Application settings revision is inconsistent.');
        if (!isDeepStrictEqual(currentGlobal, desiredGlobal)) {
          db.prepare(`INSERT INTO settings_update_journal(runtime_id,previous_revision,next_revision,settings_json)
            VALUES(?,?,?,?) ON CONFLICT(runtime_id) DO UPDATE SET previous_revision=excluded.previous_revision,
            next_revision=excluded.next_revision,settings_json=excluded.settings_json`)
            .run(runtimeID, currentGlobal.revision, desiredGlobal.revision, JSON.stringify(desiredGlobal));
          settingsPending = true;
        }
      } else unifiedPut(db, runtimeID, key, next);
    }
    return { next, settingsPending };
    });
    if (result.settingsPending) recoverApplicationSettings(config);
    return result.next;
  }
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
  const config = unifiedConfig(root);
  if (config) {
    if (key === 'webpage/launch.json') return readLaunch(root,fallback);
    if (key === 'webpage/settings.json') recoverApplicationSettings(config);
    return withUnifiedDatabase(config, false, (db, runtimeID) => {
    if (!db.prepare('SELECT 1 FROM runtime_collection_markers WHERE runtime_id=? AND collection_name=?').get(runtimeID, `document:${key}`)) {
      requireUnifiedDirectory(db, runtimeID, key);
      return fallback;
    }
    if (key === 'webpage/settings.json') return unifiedSettings(db, runtimeID, config);
    const row = db.prepare('SELECT data FROM application_documents WHERE runtime_id=? AND document_key=?').get(runtimeID, key);
    return row ? JSON.parse(row.data) : fallback;
    });
  }
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
  if (!path.resolve(file).split(path.sep).includes('.state')) return readFile(file, encoding);
  const { root } = location(file);
  const config = unifiedConfig(root);
  if (config) {
    const { key } = location(file);
    if (key === 'webpage/launch.json') {
      const value = readLaunch(root,undefined);
      if (value === undefined) throw Object.assign(Error('Document does not exist'),{code:'ENOENT'});
      return JSON.stringify(value);
    }
    if (key === 'webpage/settings.json') recoverApplicationSettings(config);
    return withUnifiedDatabase(config, false, (db, runtimeID) => {
      if (!db.prepare('SELECT 1 FROM runtime_collection_markers WHERE runtime_id=? AND collection_name=?').get(runtimeID, `document:${key}`)) {
        requireUnifiedDirectory(db, runtimeID, key);
        throw Object.assign(Error('Document does not exist'), { code:'ENOENT' });
      }
      if (key === 'webpage/settings.json') return JSON.stringify(unifiedSettings(db, runtimeID, config));
      const row = db.prepare('SELECT data FROM application_documents WHERE runtime_id=? AND document_key=?').get(runtimeID,key);
      if (!row) throw Object.assign(Error('Document does not exist'), { code:'ENOENT' });
      return row.data;
    });
  }
  return readStateText(file);
}
export function writeState(file, value) { return updateState(file, () => value); }
export function removeState(file) {
  const { root, key } = location(file);
  const config = unifiedConfig(root);
  if (config && key === 'webpage/launch.json') {
    try { unlinkSync(launchPath(root)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  if (config) return withUnifiedTransaction(config, (db, runtimeID) => {
    if (!db.prepare('SELECT 1 FROM runtime_collection_markers WHERE runtime_id=? AND collection_name=?').get(runtimeID, `document:${key}`))
      requireUnifiedDirectory(db, runtimeID, key);
    markUnifiedCollection(db, runtimeID, `document:${key}`);
    if (key === 'webpage/settings.json') throw Error('Reset the settings document through its revision-checked settings service.');
    else db.prepare('DELETE FROM application_documents WHERE runtime_id=? AND document_key=?').run(runtimeID, key);
  });
  withRecordDatabase(root, true, db => transaction(db, () => {
    migrate(db, key, file); db.prepare('DELETE FROM records WHERE collection=? AND id=?').run('documents', key);
  }));
}
export function stateFiles(directory) {
  const { root, key } = location(path.join(directory, '_'));
  const prefix = key.slice(0, -1), marker = `directory:${prefix}`;
  const config = unifiedConfig(root);
  if (config) return withUnifiedTransaction(config, (db, runtimeID) => {
    requireUnifiedDirectory(db, runtimeID, key);
    const names = new Set(db.prepare('SELECT document_key FROM application_documents WHERE runtime_id=? AND substr(document_key,1,?)=?').all(runtimeID, prefix.length, prefix)
      .map(row => row.document_key.slice(prefix.length)).filter(name => !name.includes('/')));
    if (prefix === 'webpage/' && db.prepare('SELECT 1 FROM runtime_collection_markers WHERE runtime_id=? AND collection_name=?').get(runtimeID,'document:webpage/settings.json')) names.add('settings.json');
    return [...names];
  });
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
