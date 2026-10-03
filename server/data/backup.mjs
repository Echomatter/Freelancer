import { LOCAL_DATA_SCHEMA_VERSION } from '../../shared/data-contract.mjs';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { settingsProfilePath } from '../application-settings.mjs';
import { FRESH_RUNTIME_ID } from '../runtime-config.mjs';

const APP_ID = 1414482766;
const SCHEMA = LOCAL_DATA_SCHEMA_VERSION;
const MANIFEST = 'manifest.json';
const DATA_FILES = new Set(['freelancer.sqlite','freelancer.sqlite-wal','freelancer.sqlite-shm','application-settings.json']);
const PROFILE = /^application-settings-([a-f0-9]{24})\.json$/;
const isDataFile = name => DATA_FILES.has(name) || PROFILE.test(name);

function regularFile(filename, label) {
  let stat;
  try { stat = lstatSync(filename); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`${label} must be a regular file.`);
  return true;
}

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function writeExclusive(filename, data) {
  let fd;
  try {
    fd = openSync(filename,'wx',0o600);
    writeFileSync(fd,data);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    if (process.platform !== 'win32') chmodSync(filename,0o600);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(filename); } catch {}
    throw error;
  }
}
function syncFile(filename) {
  const fd = openSync(filename,'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function settingsInfo(filename) {
  if (!regularFile(filename,'Application settings')) return null;
  const value = JSON.parse(readFileSync(filename,'utf8').replace(/^\uFEFF/,''));
  if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !value.values || typeof value.values !== 'object' || Array.isArray(value.values))
    throw Error('Application settings are invalid; backup stopped.');
  return { revision:value.revision };
}

function settingsProfileInfo(filename, expectedName = path.basename(filename)) {
  if (!regularFile(filename,'Runtime settings profile')) throw Error('Runtime settings profile was not found.');
  const value = JSON.parse(readFileSync(filename,'utf8').replace(/^\uFEFF/,''));
  if (value?.version !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.runtimeID ?? '') ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.values || typeof value.values !== 'object' || Array.isArray(value.values) ||
      path.basename(settingsProfilePath(path.dirname(filename),value.runtimeID)) !== expectedName)
    throw Error(`Runtime settings profile ${expectedName} is invalid or has a mismatched runtime identity.`);
  return { name:expectedName,runtimeID:value.runtimeID,revision:value.revision };
}

function validateDatabase(filename) {
  const db = new DatabaseSync(filename,{readOnly:true});
  try {
    const applicationID = db.prepare('PRAGMA application_id').get().application_id;
    const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
    if (applicationID !== APP_ID || schemaVersion !== SCHEMA)
      throw Error('Freelancer database identity or schema version is unsupported.');
    const integrity = db.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw Error('Freelancer database integrity check failed.');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Freelancer database foreign-key check failed.');
    const tableNames = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    if (tableNames.has('settings_update_journal') && db.prepare('SELECT count(*) AS n FROM settings_update_journal').get().n)
      throw Error('Application settings have an unfinished cross-store update. Recover it before backup or restore.');
    const counts = {};
    const inventoriedTables = new Set(['runtime_instances','runtime_collection_markers','operational_records','application_documents',
      'project_registrations','memory_items','memory_pins','claims','claim_evidence','opencode_sessions','opencode_messages']);
    if (tableNames.has('data_table_lifecycle')) for (const {table_name:table} of
        db.prepare("SELECT table_name FROM data_table_lifecycle WHERE lifecycle='durable' ORDER BY table_name").all()) {
      if (!/^[a-z][a-z0-9_]*$/.test(table) || !tableNames.has(table)) throw Error('Backup durable table inventory is invalid.');
      inventoriedTables.add(table);
    }
    for (const table of [...inventoriedTables].sort()) {
      if (tableNames.has(table)) counts[table] = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
    }
    const operational = {};
    if (tableNames.has('operational_records')) {
      const records = db.prepare('SELECT collection,data FROM operational_records ORDER BY runtime_id,collection,id').all();
      const states = new Set(['sending','submitted','uncertain','pending','queued','running','dispatching','awaiting_reconciliation']);
      for (const row of records) {
        let value;
        try { value = JSON.parse(row.data); } catch { continue; }
        const status = typeof value?.status === 'string' ? value.status.toLowerCase() : '';
        if (!states.has(status)) continue;
        operational[`${row.collection}:${status}`] = (operational[`${row.collection}:${status}`] ?? 0) + 1;
      }
    }
    return { applicationID,schemaVersion,counts,operational };
  } finally { db.close(); }
}

// Keep this formula in sync with store.mjs. A restored database is still the
// same fresh runtime, but its registered root must match its new data home.
const freshRuntimeHash = (runtimeID, sourcePath) =>
  createHash('sha256').update(JSON.stringify(['fresh-empty-runtime', runtimeID, sourcePath, APP_ID])).digest('hex');

function rebindRestoredFreshRuntime(filename, outputDataHome, manifest, manifestSha256) {
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const runtime = db.prepare('SELECT * FROM runtime_instances WHERE runtime_id=?').get(FRESH_RUNTIME_ID);
    const migrationID = `fresh-runtime:${FRESH_RUNTIME_ID}`;
    const bootstrap = db.prepare('SELECT * FROM data_migration_runs WHERE migration_id=?').get(migrationID);
    if (!runtime && !bootstrap) { db.exec('COMMIT'); return null; }
    if (!runtime || !bootstrap || bootstrap.status !== 'fresh-bootstrap' ||
        runtime.source_path !== bootstrap.source_path || runtime.source_sha256 !== bootstrap.source_sha256)
      throw Error('Backup has an incomplete fresh-runtime registration; restore stopped without changing its identity.');

    const original = {
      sourcePath:runtime.source_path,
      sourceSha256:runtime.source_sha256,
      sourceSchemaVersion:runtime.source_schema_version,
      sourceAppId:runtime.source_app_id,
    };
    const restoredPath = path.resolve(outputDataHome);
    const restoredHash = freshRuntimeHash(FRESH_RUNTIME_ID, restoredPath);
    const now = Date.now();
    const restoreID = `explicit-restore:${createHash('sha256').update(`${manifestSha256}\0${restoredPath}\0${now}`).digest('hex').slice(0,32)}`;
    const restoredManifest = JSON.stringify({
      mode:'explicit-restore',
      sourceManifestSha256:manifestSha256,
      sourceDatabaseSha256:manifest.files['freelancer.sqlite'].sha256,
      sourceRuntime:original,
      sourceBootstrapManifest:JSON.parse(bootstrap.manifest_json),
      restoredRuntime:{ runtimeID:FRESH_RUNTIME_ID,sourcePath:restoredPath,sourceSha256:restoredHash },
      uncertainOperationsPreserved:true,
      automaticReplay:false,
    });
    db.prepare('UPDATE runtime_instances SET source_path=?,source_sha256=? WHERE runtime_id=?')
      .run(restoredPath,restoredHash,FRESH_RUNTIME_ID);
    db.prepare('UPDATE data_migration_runs SET source_path=?,source_sha256=?,manifest_json=? WHERE migration_id=?')
      .run(restoredPath,restoredHash,JSON.stringify({
        ...JSON.parse(bootstrap.manifest_json),
        restoredFrom:{sourcePath:original.sourcePath,sourceSha256:original.sourceSha256,restoreID},
      }),migrationID);
    db.prepare(`INSERT INTO data_migration_runs
      (migration_id,source_path,source_app_id,source_schema_version,source_sha256,status,manifest_json,started_at,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(restoreID,original.sourcePath,original.sourceAppId,original.sourceSchemaVersion,
        manifestSha256,'explicit-restore',restoredManifest,now,now);
    db.exec('COMMIT');
    return { id:restoreID,status:'explicit-restore',sourceManifestSha256:manifestSha256 };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { db.close(); }
}

function existingArtifacts(dataHome) {
  const main = path.join(dataHome,'freelancer.sqlite');
  if (!regularFile(main,'Freelancer database')) throw Error('freelancer.sqlite was not found.');
  const files = ['freelancer.sqlite'];
  for (const suffix of ['-wal','-shm']) if (regularFile(`${main}${suffix}`,`SQLite ${suffix} sidecar`)) files.push(`freelancer.sqlite${suffix}`);
  const settings = path.join(dataHome,'application-settings.json');
  if (settingsInfo(settings)) files.push('application-settings.json');
  for (const name of readdirSync(dataHome).filter(item=>PROFILE.test(item)).sort()) {
    settingsProfileInfo(path.join(dataHome,name),name);
    files.push(name);
  }
  return files.sort();
}

function cleanupDirectory(directory, names) {
  for (const name of names) {
    try { unlinkSync(path.join(directory,name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { rmdirSync(directory); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function validateCopiedSet(directory, files) {
  const temporary = mkdtempSync(path.join(os.tmpdir(),'freelancer-backup-check-'));
  try {
    for (const name of files) copyFileSync(path.join(directory,name),path.join(temporary,name),1);
    const active = files.includes('application-settings.json') ? settingsInfo(path.join(temporary,'application-settings.json')) : null;
    const profiles = files.filter(name=>PROFILE.test(name)).map(name=>settingsProfileInfo(path.join(temporary,name),name));
    return {
      database:validateDatabase(path.join(temporary,'freelancer.sqlite')),
      settings:{ activeRevision:active?.revision ?? null, profiles },
    };
  } finally { cleanupDirectory(temporary,[...files,'freelancer.sqlite-wal','freelancer.sqlite-shm']); }
}

export async function backupLocalData(dataHome, outputDirectory, { quiesced = false } = {}) {
  if (quiesced !== true) throw Error('Stop Freelancer, OpenCode plugins and runtime helpers before backing up local data.');
  if (!path.isAbsolute(dataHome) || !path.isAbsolute(outputDirectory)) throw Error('Data and backup paths must be absolute.');
  dataHome = path.resolve(dataHome); outputDirectory = path.resolve(outputDirectory);
  if (dataHome === outputDirectory || outputDirectory.startsWith(`${dataHome}${path.sep}`))
    throw Error('Backup output must be outside the active data directory.');
  if (!existsSync(dataHome) || !lstatSync(dataHome).isDirectory() || lstatSync(dataHome).isSymbolicLink())
    throw Error('Freelancer data home must be an existing regular directory.');
  let created = false;
  const written = [];
  try {
    const files = existingArtifacts(dataHome);
    mkdirSync(outputDirectory,{recursive:false,mode:0o700}); created = true;
    if (process.platform !== 'win32') chmodSync(outputDirectory,0o700);
    for (const name of files) {
      copyFileSync(path.join(dataHome,name),path.join(outputDirectory,name),1);
      written.push(name);
      syncFile(path.join(outputDirectory,name));
      if (process.platform !== 'win32') chmodSync(path.join(outputDirectory,name),0o600);
    }
    const verified = validateCopiedSet(outputDirectory,files);
    const manifest = { version:1,createdAt:new Date().toISOString(),database:verified.database,settings:verified.settings,
      files:Object.fromEntries(await Promise.all(files.map(async name=>[name,{sha256:await sha256(path.join(outputDirectory,name)),bytes:lstatSync(path.join(outputDirectory,name)).size}])))};
    writeExclusive(path.join(outputDirectory,MANIFEST),`${JSON.stringify(manifest,null,2)}\n`);
    written.push(MANIFEST);
    return { status:'verified',directory:outputDirectory,manifest };
  } catch (error) {
    if (created) { try { cleanupDirectory(outputDirectory,[...written,...DATA_FILES,MANIFEST]); } catch {} }
    throw error;
  }
}

function readManifest(bundleDirectory) {
  const filename = path.join(bundleDirectory,MANIFEST);
  if (!regularFile(filename,'Backup manifest')) throw Error('Backup manifest was not found.');
  const manifest = JSON.parse(readFileSync(filename,'utf8').replace(/^\uFEFF/,''));
  if (manifest?.version !== 1 || manifest.database?.applicationID !== APP_ID || manifest.database?.schemaVersion !== SCHEMA ||
      !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) throw Error('Backup manifest is invalid or unsupported.');
  const names = Object.keys(manifest.files).sort();
  const profiles = names.filter(name=>PROFILE.test(name)).sort();
  if (!names.includes('freelancer.sqlite') || names.some(name=>!isDataFile(name)) ||
      !manifest.settings || (names.includes('application-settings.json') !== (manifest.settings.activeRevision !== null) ) ||
      JSON.stringify(profiles) !== JSON.stringify(manifest.settings.profiles?.map(row=>row.name).sort()))
    throw Error('Backup manifest file set is invalid.');
  return manifest;
}

async function validateBundle(bundleDirectory) {
  const manifest = readManifest(bundleDirectory);
  const names = Object.keys(manifest.files);
  const actual = readdirSync(bundleDirectory);
  const extras = actual.filter(name=>name !== MANIFEST && (!Object.hasOwn(manifest.files,name) || !isDataFile(name)));
  if (extras.length) throw Error(`Backup directory contains unmanifested files: ${extras.join(', ')}.`);
  for (const [name,expected] of Object.entries(manifest.files)) {
    const filename = path.join(bundleDirectory,name);
    if (!regularFile(filename,`Backup ${name}`) || lstatSync(filename).size !== expected.bytes || await sha256(filename) !== expected.sha256)
      throw Error(`Backup file ${name} failed size or SHA-256 verification.`);
  }
  const { database,settings } = validateCopiedSet(bundleDirectory,names);
  if (JSON.stringify(database) !== JSON.stringify(manifest.database)) throw Error('Backup database metadata differs from its manifest.');
  if (JSON.stringify(settings) !== JSON.stringify(manifest.settings)) throw Error('Backup settings revisions differ from their manifest.');
  return manifest;
}

export async function restoreLocalData(bundleDirectory, outputDataHome, { quiesced = false } = {}) {
  if (quiesced !== true) throw Error('Use a stopped runtime and restore into a new, empty data directory.');
  if (!path.isAbsolute(bundleDirectory) || !path.isAbsolute(outputDataHome)) throw Error('Backup and restore paths must be absolute.');
  bundleDirectory = path.resolve(bundleDirectory); outputDataHome = path.resolve(outputDataHome);
  if (outputDataHome === bundleDirectory || outputDataHome.startsWith(`${bundleDirectory}${path.sep}`))
    throw Error('Restore destination must be outside the backup directory.');
  if (!existsSync(bundleDirectory) || !lstatSync(bundleDirectory).isDirectory() || lstatSync(bundleDirectory).isSymbolicLink())
    throw Error('Backup bundle must be an existing regular directory.');
  const manifest = await validateBundle(bundleDirectory);
  let created = false;
  const written = [];
  try {
    mkdirSync(outputDataHome,{recursive:false,mode:0o700}); created = true;
    if (process.platform !== 'win32') chmodSync(outputDataHome,0o700);
    for (const name of Object.keys(manifest.files).sort()) {
      copyFileSync(path.join(bundleDirectory,name),path.join(outputDataHome,name),1);
      written.push(name);
      syncFile(path.join(outputDataHome,name));
      if (process.platform !== 'win32') chmodSync(path.join(outputDataHome,name),0o600);
    }
    const { database,settings } = validateCopiedSet(outputDataHome,Object.keys(manifest.files));
    if (JSON.stringify(database) !== JSON.stringify(manifest.database)) throw Error('Restored database validation differs from the backup manifest.');
    if (JSON.stringify(settings) !== JSON.stringify(manifest.settings)) throw Error('Restored settings differ from the backup manifest.');
    const manifestSha256 = createHash('sha256').update(readFileSync(path.join(bundleDirectory,MANIFEST))).digest('hex');
    const restore = rebindRestoredFreshRuntime(path.join(outputDataHome,'freelancer.sqlite'),outputDataHome,manifest,manifestSha256);
    syncFile(path.join(outputDataHome,'freelancer.sqlite'));
    const finalDatabase = validateDatabase(path.join(outputDataHome,'freelancer.sqlite'));
    const expectedCounts={...database.counts};
    if (restore) expectedCounts.data_migration_runs++;
    if (JSON.stringify(finalDatabase.counts) !== JSON.stringify(expectedCounts) ||
        JSON.stringify(finalDatabase.operational) !== JSON.stringify(database.operational))
      throw Error('Restored database operational state changed during identity rebinding.');
    return { status:'verified',directory:outputDataHome,manifestSha256,database:finalDatabase,settings,restore };
  } catch (error) {
    if (created) { try { cleanupDirectory(outputDataHome,[...written,'freelancer.sqlite-wal','freelancer.sqlite-shm']); } catch {} }
    throw error;
  }
}
