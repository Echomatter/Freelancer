import { LOCAL_DATA_SCHEMA_VERSION } from '../shared/data-contract.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from 'node:fs';
import path from "node:path";
import { fileURLToPath } from 'node:url';
import os from "node:os";
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from "node:sqlite";
import { createLocalDataService, createLocalDataStore, isLocalDataUnavailable } from "../server/data/store.mjs";
import { createHistoryService } from '../server/history.mjs';
import { backupLocalData, restoreLocalData } from '../server/data/backup.mjs';
import { openCodeSourceIdentity } from '../server/data/opencode-warehouse.mjs';
import { readState, updateState, writeState, removeState, stateFiles } from "../backend/tools/runtime/state-database.mjs";
import { createRecordStore } from "../backend/tools/runtime/record-store.mjs";
import { unifiedConfig } from "../backend/tools/runtime/unified-database.mjs";
import { readApplicationSettings, readSettingsProfile, updateApplicationSettings, writeApplicationSettings, writeSettingsProfile } from "../server/application-settings.mjs";
import { FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';
import {
  organizedSessions,
  nativeArchiveSupported,
  draftInput,
} from "../domain/history.mjs";
import { nativeDataTools } from "../server/native-data.mjs";
import { resolveDataRoot } from "../server/runtime-config.mjs";
import { localDataFixture } from "./fixtures/local-data-app.mjs";

async function localStore(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-sqlite-"));
  const store = createLocalDataStore(root);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store };
}
test('schema 6 baseline upgrades to current schema while preserving content, drafts, and indexed evidence', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-schema6-'));
  t.after(async()=>{await rm(root,{recursive:true,force:true});});
  const filename=path.join(root,'freelancer.sqlite'),db=new DatabaseSync(filename);
  db.exec(await readFile(new URL('./fixtures/local-data-schema-6.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO drafts VALUES(?,?,?,?,?)').run('project-six','new','schema six draft',4,1000);
  const source=db.prepare(`INSERT INTO content_sources(project_key,filename,virtual_path,container_path,member_path,extension,source_role,status,
    routing_rank,file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,notes)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('project-six','notes.md','notes.md','C:\\source\\notes.md','', '.md','documentation','current',10,18,
      '2026-09-30T00:00:00Z','a'.repeat(64),1,'line','plain-text','ok',18,3,'legacy fixture source');
  db.prepare('INSERT INTO content_units(source_id,unit_no,locator,heading,text,word_count,char_count,sha256) VALUES(?,?,?,?,?,?,?,?)')
    .run(Number(source.lastInsertRowid),0,'L1-L1','Legacy note','preserved source evidence',3,25,'b'.repeat(64));
  db.close();

  const migrated=createLocalDataStore(root);
  try {
    assert.equal(migrated.info().schemaVersion,LOCAL_DATA_SCHEMA_VERSION);
    const reader=new DatabaseSync(filename,{readOnly:true});
    assert.equal(reader.prepare('SELECT text FROM drafts WHERE project_id=?').get('project-six').text,'schema six draft');
    assert.equal(reader.prepare('SELECT count(*) n FROM content_sources').get().n,1);
    assert.equal(reader.prepare('SELECT count(*) n FROM content_source_revisions').get().n,1);
    assert.equal(reader.prepare('SELECT count(*) n FROM content_unit_revisions').get().n,1);
    const sourceRow=reader.prepare('SELECT source_identity,revision_identity FROM content_sources').get();
    assert.match(sourceRow.source_identity,/^content-source:/);
    assert.match(sourceRow.revision_identity,/^content-revision:/);
    assert.deepEqual(reader.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(reader.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    reader.close();
  } finally { migrated.close(); }
});
test("closed local data service cannot reopen SQLite during shutdown", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-service-close-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = createLocalDataService(root);
  service.get();
  service.close();
  assert.throws(() => service.get(), /closed/);
  assert.throws(() => service.beginMaintenance(), /closed/);
});
test("new data store is real SQLite with a versioned application-owned schema", async (t) => {
  const { store } = await localStore(t);
  assert.equal(
    (await readFile(store.filename)).subarray(0, 15).toString(),
    "SQLite format 3",
  );
  assert.equal(store.info().schemaVersion, LOCAL_DATA_SCHEMA_VERSION);
  const reader = new DatabaseSync(store.filename, { readOnly: true });
  assert.equal(reader.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(
    reader.prepare("SELECT count(*) n FROM schema_migrations").get().n,
    LOCAL_DATA_SCHEMA_VERSION,
  );
  reader.close();
});
test('schema 17 archives the current indexed source and unit when upgrading schema 16', async t => {
  const {root,store}=await localStore(t),db=new DatabaseSync(store.filename);
  const source=db.prepare(`INSERT INTO content_sources(project_key,filename,virtual_path,container_path,member_path,extension,source_role,status,routing_rank,
    file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,notes,source_identity,revision_identity)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('C:/fixture','notes.md','notes.md','notes.md','','.md','project_source','source',35,18,'2026-10-02T00:00:00Z','a'.repeat(64),1,'logical_unit','text-logical','ok',18,3,'','content-source:fixture','content-revision:fixture');
  db.prepare('INSERT INTO content_units(source_id,unit_no,locator,heading,text,word_count,char_count,sha256) VALUES(?,?,?,?,?,?,?,?)')
    .run(source.lastInsertRowid,1,'md:1','Fixture','Historic source sentence.',3,25,'b'.repeat(64));
  db.exec(`DROP TRIGGER opencode_derivation_inputs_immutable;
    ALTER TABLE chat_search_state DROP COLUMN derivation_job_id;
    ALTER TABLE chat_search_state DROP COLUMN indexed_text_sha256;
    DROP TABLE opencode_derivation_jobs; DROP TABLE opencode_refresh_needed;
    DELETE FROM data_table_lifecycle WHERE table_name IN ('opencode_derivation_jobs','opencode_refresh_needed');
    ALTER TABLE opencode_sessions DROP COLUMN current_snapshot_sha256;
    ALTER TABLE opencode_sessions DROP COLUMN publication_revision;
    DROP INDEX content_unit_revisions_ref; DROP INDEX content_source_revisions_project;
    DROP TABLE content_unit_revisions; DROP TABLE content_source_revisions;
    DELETE FROM data_table_lifecycle WHERE table_name IN ('content_unit_revisions','content_source_revisions');
    DELETE FROM schema_migrations WHERE version>=17; DROP VIEW IF EXISTS knowledge_outcome_summary; DROP VIEW IF EXISTS knowledge_task_outcomes; DELETE FROM data_table_lifecycle WHERE table_name IN ('knowledge_outcome_summary','knowledge_task_outcomes'); DROP TRIGGER claims_search_insert; DROP TRIGGER claims_search_update; DROP TRIGGER claims_search_delete; DROP TRIGGER claims_search_evidence_insert; DROP TRIGGER claims_search_evidence_delete; DROP TRIGGER claims_search_evidence_update; DROP TRIGGER claims_search_entity_update; DROP TRIGGER claims_search_alias_insert; DROP TRIGGER claims_search_alias_delete; DROP TRIGGER claims_search_alias_update; DROP TABLE claims_search_fts; DROP TABLE entity_relation_revisions; DELETE FROM data_table_lifecycle WHERE table_name IN ('claims_search_fts','entity_relation_revisions'); DROP TABLE memory_capture_jobs; DELETE FROM data_table_lifecycle WHERE table_name='memory_capture_jobs'; PRAGMA user_version=16;`);
  db.close();store.close();
  const upgraded=createLocalDataStore(root);
  try {
    const reader=new DatabaseSync(upgraded.filename,{readOnly:true});
    const row=reader.prepare('SELECT text FROM content_unit_revisions WHERE source_identity=? AND revision_identity=? AND unit_no=?')
      .get('content-source:fixture','content-revision:fixture',1);
    assert.equal(row.text,'Historic source sentence.');
    assert.deepEqual(reader.prepare('PRAGMA foreign_key_check').all(),[]);
    reader.close();
  } finally { upgraded.close(); }
});
test('application settings updates use revisions and retain launcher preferences outside SQLite', async t => {
  const { root } = await localStore(t);
  const saved = updateApplicationSettings(root, current => ({
    ...current,
    values:{ ...current.values, launcher:{ startIn:'browser' }, appearance:{ theme:'dark' } },
  }));
  assert.equal(saved.revision,1);
  assert.deepEqual(readApplicationSettings(root).values,
    { launcher:{startIn:'browser'}, appearance:{theme:'dark'} });
  assert.throws(() => updateApplicationSettings(root, current => ({
    ...current, revision:current.revision + 1, values:current.values,
  })), /revision changed/);
});
test('offline backup and restore verify SQLite sidecars, settings revision and new-directory recovery', async t => {
  const base = await mkdtemp(path.join(os.tmpdir(),'freelancer-backup-'));
  t.after(()=>rm(base,{recursive:true,force:true}));
  const dataHome = path.join(base,'data'), bundle = path.join(base,'backup-bundle'), restored = path.join(base,'restored');
  const store = createLocalDataStore(dataHome);
  t.after(()=>store.close());
  writeApplicationSettings(dataHome,{version:1,revision:7,values:{appearance:{theme:'dark'},launcher:{startIn:'browser'}}});
  writeSettingsProfile(dataHome,'runtime-fixture',{version:1,revision:4,values:{gitProjects:{p1:{preset:'review'}}}});
  const writer = new DatabaseSync(path.join(dataHome,'freelancer.sqlite'));
  writer.prepare('INSERT INTO operational_records(runtime_id,collection,id,project_id,session_id,data,summary) VALUES(?,?,?,?,?,?,?)')
    .run(FRESH_RUNTIME_ID,'requests','request-uncertain',null,null,JSON.stringify({id:'request-uncertain',status:'uncertain'}),'{}');
  writer.close();
  await assert.rejects(backupLocalData(dataHome,bundle),/Stop Freelancer/);
  store.close();
  const result = await backupLocalData(dataHome,bundle,{quiesced:true});
  assert.equal(result.status,'verified');
  assert.equal(result.manifest.settings.activeRevision,7);
  assert.equal(result.manifest.database.operational['requests:uncertain'],1);
  assert.deepEqual(result.manifest.settings.profiles,[{name:result.manifest.settings.profiles[0].name,runtimeID:'runtime-fixture',revision:4}]);
  assert.ok(result.manifest.files['freelancer.sqlite'].sha256);
  assert.deepEqual(Object.keys(result.manifest.files).sort(),['application-settings.json',result.manifest.settings.profiles[0].name,'freelancer.sqlite'].sort());
  writeApplicationSettings(dataHome,{version:1,revision:8,values:{appearance:{theme:'light'}}});
  const restoredResult = await restoreLocalData(bundle,restored,{quiesced:true});
  assert.equal(restoredResult.status,'verified');
  assert.deepEqual(readApplicationSettings(restored),{version:1,revision:7,values:{appearance:{theme:'dark'},launcher:{startIn:'browser'}}});
  assert.deepEqual(readSettingsProfile(restored,'runtime-fixture'),{version:1,revision:4,values:{gitProjects:{p1:{preset:'review'}}},runtimeID:'runtime-fixture'});
  const restoredDb = new DatabaseSync(path.join(restored,'freelancer.sqlite'),{readOnly:true});
  assert.equal(restoredDb.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(restoredDb.prepare("SELECT json_extract(data,'$.status') AS status FROM operational_records WHERE id='request-uncertain'").get().status,'uncertain');
  restoredDb.close();
  const protectedTarget = path.join(base,'existing');
  await import('node:fs/promises').then(fs=>fs.mkdir(protectedTarget));
  await writeFile(path.join(protectedTarget,'keep.txt'),'keep');
  await assert.rejects(restoreLocalData(bundle,protectedTarget,{quiesced:true}),/already exists/);
  assert.equal(await readFile(path.join(protectedTarget,'keep.txt'),'utf8'),'keep');
  await writeFile(path.join(bundle,'application-settings.json'),'corrupt');
  await assert.rejects(restoreLocalData(bundle,path.join(base,'bad-restore'),{quiesced:true}),/SHA-256 verification/);
});
test('PowerShell settings CLI reads and revision-updates the resolved external settings document', async t => {
  const { root } = await localStore(t);
  const cli = fileURLToPath(new URL('../backend/tools/runtime/application-settings-cli.mjs', import.meta.url));
  const env = { ...process.env, FREELANCER_DATA_HOME:root };
  const read = spawnSync(process.execPath, [cli, 'read'], { encoding:'utf8', env });
  assert.equal(read.status,0,read.stderr);
  assert.deepEqual(JSON.parse(read.stdout),{version:1,revision:0,values:{}});
  const update = spawnSync(process.execPath,[cli,'update-launcher'],{
    input:Buffer.from(JSON.stringify({launcher:{startIn:'browser'}})).toString('base64'),
    encoding:'utf8',env,
  });
  assert.equal(update.status,0,update.stderr);
  const saved = JSON.parse(update.stdout);
  assert.equal(saved.version,1);
  assert.equal(saved.revision,1);
  assert.deepEqual(saved.values.launcher,{startIn:'browser'});
  assert.equal(saved.values.plans.currency,'USD');
  assert.deepEqual(saved.values.monthlyPlans,{});
  const db = new DatabaseSync(path.join(root,'freelancer.sqlite'),{readOnly:true});
  try {
    assert.equal(db.prepare('SELECT status FROM data_migration_runs WHERE migration_id=?').get(`fresh-runtime:${FRESH_RUNTIME_ID}`)?.status,'fresh-bootstrap');
  } finally { db.close(); }
});
test('pre-server state CLI bootstraps the fresh runtime without creating the legacy records database', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(),'freelancer-state-cli-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const appRoot = path.join(root,'app');
  const stateFile = path.join(appRoot,'backend','.state','webpage','launch.json');
  const dataRoot = path.join(root,'user-data');
  await mkdir(path.dirname(stateFile),{recursive:true});
  const cli = fileURLToPath(new URL('../backend/tools/runtime/state-cli.mjs',import.meta.url));
  const env = { ...process.env, FREELANCER_APP_ROOT:appRoot, FREELANCER_DATA_HOME:dataRoot };
  delete env.FREELANCER_RUNTIME_DATA_MODE;
  delete env.FREELANCER_RUNTIME_ROOT;
  delete env.FREELANCER_RUNTIME_ID;
  const result = spawnSync(process.execPath,[cli,'read',stateFile],{encoding:'utf8',env});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,'null');
  assert.equal(existsSync(path.join(dataRoot,'freelancer.sqlite')),true);
  assert.equal(existsSync(path.join(appRoot,'backend','.state','webpage','records.sqlite')),false);
  const db = new DatabaseSync(path.join(dataRoot,'freelancer.sqlite'),{readOnly:true});
  try {
    assert.equal(db.prepare('SELECT status FROM data_migration_runs WHERE migration_id=?').get(`fresh-runtime:${FRESH_RUNTIME_ID}`)?.status,'fresh-bootstrap');
  } finally { db.close(); }
});
test("runtime records migrate transactionally with documents, receipts and an audit manifest", async (t) => {
  const { root, store } = await localStore(t);
  const legacyPath = path.join(root, 'records.sqlite');
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`CREATE TABLE collections (name TEXT PRIMARY KEY);
    CREATE TABLE records (collection TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,session_id TEXT,data TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(collection,id));
    INSERT INTO collections VALUES ('requests'),('usage'),('documents'),('document:settings.json'),('document:goals.json'),('directory:webpage/');
    INSERT INTO records VALUES ('requests','req-1','p','s','{"id":"req-1","status":"uncertain"}','{"id":"req-1"}');
    INSERT INTO records VALUES ('requests','req-z','p','s','{"id":"req-z","status":"observed"}','{"id":"req-z"}');
    INSERT INTO records VALUES ('requests','req-a','p','s','{"id":"req-a","status":"observed"}','{"id":"req-a"}');
    INSERT INTO records VALUES ('usage','use-1','p','s','{"id":"use-1","tokens":null}','{}');
    INSERT INTO records VALUES ('documents','settings.json',NULL,NULL,'{"version":1,"revision":2,"projects":[{"id":"p1","directory":"C:/projects/p1"}],"appearance":{"theme":"dark"},"gitProjects":{"p1":{"revision":3}},"gitDefaults":{"preset":"review"}}','{}');
    INSERT INTO records VALUES ('documents','goals.json',NULL,NULL,'{"version":1,"records":{"g":{"status":"paused"}}}','{}');
    PRAGMA application_id=1179796804; PRAGMA user_version=1;`);
  legacy.close();
  assert.throws(() => store.migrateRuntimeRecords(legacyPath), /Stop Freelancer/);
  assert.throws(() => store.migrateRuntimeRecords(legacyPath, { quiesced: true }), /stable runtime ID/);
  const result = store.migrateRuntimeRecords(legacyPath, { quiesced: true, runtimeID: 'install-a' });
  assert.equal(result.status, 'validated-copy');
  assert.equal(result.manifest.operationalRecordCount, 4);
  assert.equal(result.manifest.documentCount, 1);
  assert.equal(result.manifest.projectCount, 1);
  assert.equal(result.manifest.settingsCount, 5);
  assert.equal(result.manifest.globalSettingCount, 2);
  assert.equal(result.manifest.domainSettingCount, 1);
  assert.ok(result.manifest.settingsProfile.sha256);
  assert.equal(result.manifest.ignoredRecords, 0);
  const reader = new DatabaseSync(store.filename, { readOnly: true });
  assert.equal(reader.prepare("SELECT data FROM operational_records WHERE runtime_id='install-a' AND collection='requests' AND id='req-1'").get().data, '{"id":"req-1","status":"uncertain"}');
  assert.deepEqual(reader.prepare("SELECT id FROM operational_records WHERE runtime_id='install-a' AND collection='requests' ORDER BY rowid").all().map(row => row.id), ['req-1','req-z','req-a']);
  assert.equal(reader.prepare("SELECT data FROM application_documents WHERE runtime_id='install-a' AND document_key='goals.json'").get().data, '{"version":1,"records":{"g":{"status":"paused"}}}');
  assert.deepEqual(JSON.parse(reader.prepare('SELECT data FROM project_registrations WHERE runtime_id=? AND project_id=?').get('install-a','p1').data), { id: 'p1', directory: 'C:/projects/p1' });
  assert.equal(reader.prepare("SELECT data FROM runtime_settings WHERE runtime_id='install-a' AND setting_key='gitProjects'").get().data, '{"p1":{"revision":3}}');
  assert.equal(reader.prepare("SELECT data FROM runtime_settings WHERE runtime_id='install-a' AND setting_key='appearance'").get(), undefined);
  const profile = readSettingsProfile(store.directory, 'install-a');
  assert.deepEqual(profile.values, { appearance:{theme:'dark'}, gitDefaults:{preset:'review'} });
  assert.equal(profile.revision, 2);
  assert.equal(reader.prepare('SELECT source_sha256,status FROM data_migration_runs WHERE migration_id=?').get('runtime-records:install-a').status, 'validated-copy');
  assert.equal(reader.prepare("SELECT count(*) n FROM runtime_collection_markers WHERE runtime_id='install-a'").get().n, 7);
  assert.equal(reader.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  reader.close();
  assert.throws(() => store.migrateRuntimeRecords(legacyPath, { quiesced: true, runtimeID: 'install-a' }), /already been recorded/);
  assert.equal(store.info().schemaVersion, LOCAL_DATA_SCHEMA_VERSION);
});
test('runtime migration keeps overlapping native IDs isolated by explicit runtime identity', async t => {
  const { root, store } = await localStore(t);
  for (const [runtimeID, status, goals] of [['install-a','uncertain','paused'],['install-b','observed','running']]) {
    const filename = path.join(root, `${runtimeID}.sqlite`), source = new DatabaseSync(filename);
    source.exec(`CREATE TABLE collections(name TEXT PRIMARY KEY); CREATE TABLE records(collection TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,session_id TEXT,data TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(collection,id));
      INSERT INTO collections VALUES('requests'),('documents'),('document:goals.json');
      PRAGMA application_id=1179796804; PRAGMA user_version=1;`);
    source.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run('requests','same-id','same-project','same-session',JSON.stringify({ id:'same-id',status }),JSON.stringify({ id:'same-id' }));
    source.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run('documents','goals.json',null,null,JSON.stringify({ version:1,records:{ goal:{ status:goals } } }),'{}');
    source.close();
    assert.equal(store.migrateRuntimeRecords(filename,{quiesced:true,runtimeID}).status,'validated-copy');
  }
  const db = new DatabaseSync(store.filename,{readOnly:true});
  assert.equal(db.prepare("SELECT count(*) n FROM operational_records WHERE collection='requests' AND id='same-id'").get().n,2);
  assert.equal(db.prepare('SELECT data FROM operational_records WHERE runtime_id=? AND collection=? AND id=?').get('install-a','requests','same-id').data,'{"id":"same-id","status":"uncertain"}');
  assert.equal(db.prepare('SELECT data FROM operational_records WHERE runtime_id=? AND collection=? AND id=?').get('install-b','requests','same-id').data,'{"id":"same-id","status":"observed"}');
  assert.equal(db.prepare('SELECT count(*) n FROM runtime_instances').get().n,2);
  assert.equal(db.prepare('SELECT count(*) n FROM data_migration_runs').get().n,2);
  db.close();
});
test('unified runtime adapter preserves document markers, settings, records and isolation', async t => {
  const { root, store } = await localStore(t);
  const legacyRoot = path.join(root, 'runtime');
  const runtimeDir = path.join(legacyRoot, '.state', 'webpage');
  await import('node:fs/promises').then(fs => fs.mkdir(runtimeDir, { recursive: true }));
  await writeFile(path.join(runtimeDir, 'goals.json'), JSON.stringify({ version:1, records:{ kept:{ status:'paused' } } }));
  await writeFile(path.join(runtimeDir, 'settings.json'), JSON.stringify({ version:1, revision:2, projects:[{id:'p1',directory:'C:/p'}], appearance:{theme:'dark'} }));
  await writeFile(path.join(runtimeDir, 'requests.json'), JSON.stringify({ version:1, records:{ r1:{ id:'r1',status:'legacy-file-decoy' } } }));
  const old = new DatabaseSync(path.join(runtimeDir, 'records.sqlite'));
  old.exec(`CREATE TABLE collections(name TEXT PRIMARY KEY); CREATE TABLE records(collection TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,session_id TEXT,data TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(collection,id));
    INSERT INTO collections VALUES('documents'),('document:webpage/goals.json'),('document:webpage/settings.json'),('document:webpage/deleted.json'),('directory:webpage/'),('requests');
    INSERT INTO records VALUES('documents','webpage/goals.json',NULL,NULL,'{"version":1,"records":{"kept":{"status":"paused"}}}','{}');
    INSERT INTO records VALUES('documents','webpage/settings.json',NULL,NULL,'{"version":1,"revision":2,"projects":[{"id":"p1","directory":"C:/p"}],"appearance":{"theme":"dark"}}','{}');
    INSERT INTO records VALUES('requests','r1','p1','s1','{"id":"r1","status":"uncertain"}','{"id":"r1"}');
    PRAGMA application_id=1179796804; PRAGMA user_version=1;`);
  old.close();
  store.migrateRuntimeRecords(path.join(runtimeDir,'records.sqlite'), { quiesced:true, runtimeID:'adapter-a' });
  const profile = readSettingsProfile(store.directory, 'adapter-a');
  writeApplicationSettings(store.directory, { version:profile.version, revision:profile.revision, values:profile.values });
  await writeFile(path.join(legacyRoot, '.state', 'storage-runtime.json'), JSON.stringify({ version:1, mode:'unified', runtimeID:'adapter-a' }));
  const prior = { FREELANCER_RUNTIME_DATA_MODE:process.env.FREELANCER_RUNTIME_DATA_MODE,
    FREELANCER_DATA_HOME:process.env.FREELANCER_DATA_HOME, FREELANCER_RUNTIME_ID:process.env.FREELANCER_RUNTIME_ID };
  delete process.env.FREELANCER_RUNTIME_DATA_MODE;
  delete process.env.FREELANCER_RUNTIME_ID;
  process.env.FREELANCER_DATA_HOME = store.directory;
  try {
    const goals = path.join(legacyRoot,'.state','webpage','goals.json');
    const settings = path.join(legacyRoot,'.state','webpage','settings.json');
    const deleted = path.join(legacyRoot,'.state','webpage','deleted.json');
    assert.deepEqual(readState(goals), { version:1, records:{ kept:{status:'paused'} } });
    assert.deepEqual(readState(settings).projects, [{id:'p1',directory:'C:/p'}]);
    assert.equal(readState(deleted,'absent'),'absent');
    assert.deepEqual(stateFiles(path.dirname(goals)).sort(),['goals.json','settings.json']);
    updateState(goals, value=>({ ...value, records:{ ...value.records, next:{status:'running'} } }));
    removeState(goals);
    assert.equal(readState(goals,'removed'),'removed');
    const records=createRecordStore(legacyRoot);
    assert.equal((await records.get('requests','r1')).status,'uncertain');
    await records.mutate('requests',[['r1', row=>({...row,status:'observed'})]]);
    assert.equal((await records.get('requests','r1')).status,'observed');
    assert.equal(readState(settings).appearance.theme,'dark');
    updateState(settings, value=>({ ...value, appearance:{ theme:'light' } }));
    assert.equal(readState(settings).revision,3);
    assert.deepEqual(readApplicationSettings(store.directory).values, { appearance:{theme:'light'} });
    const separated = new DatabaseSync(store.filename);
    assert.equal(separated.prepare("SELECT data FROM runtime_settings WHERE runtime_id=? AND setting_key='appearance'").get('adapter-a'), undefined);
    separated.prepare('INSERT INTO settings_update_journal VALUES(?,?,?,?)').run('adapter-a',3,4,JSON.stringify({version:1,revision:4,values:{appearance:{theme:'blue'}}}));
    separated.close();
    assert.equal(readState(settings).appearance.theme,'blue');
    assert.equal(readApplicationSettings(store.directory).revision,4);
    const recovered = new DatabaseSync(store.filename,{readOnly:true});
    assert.equal(recovered.prepare('SELECT count(*) n FROM settings_update_journal').get().n,0);
    recovered.close();
    const incomplete = new DatabaseSync(store.filename);
    incomplete.prepare("DELETE FROM runtime_collection_markers WHERE runtime_id=? AND collection_name='requests'").run('adapter-a');
    incomplete.prepare("DELETE FROM runtime_collection_markers WHERE runtime_id=? AND collection_name='directory:webpage/'").run('adapter-a');
    incomplete.close();
    await assert.rejects(records.get('requests','r1'), /no migration marker/);
    assert.throws(() => stateFiles(path.dirname(goals)), /no migration marker/);
  } finally {
    for (const [key,value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key]=value;
  }
});
test('standalone runtime state import is quiescence-gated, hashed, conflict-safe and registers nested directories', async t => {
  const { root, store } = await localStore(t);
  const source = path.join(root,'runtime-source'), state = path.join(source,'.state');
  await import('node:fs/promises').then(fs=>fs.mkdir(path.join(state,'delegation','decisions'),{recursive:true}));
  await import('node:fs/promises').then(fs=>fs.mkdir(path.join(state,'webpage'),{recursive:true}));
  await writeFile(path.join(state,'preferences.json'),'{"schemaVersion":1,"sessions":{}}');
  await writeFile(path.join(state,'delegation','decisions','choice.json'),'{"sessionID":"ses_fixture","userMessageID":"msg_fixture"}');
  await writeFile(path.join(state,'webpage','launch.json'),JSON.stringify({url:'http://127.0.0.1:58633',shutdownToken:'fixture-secret'}));
  const sourceDB = new DatabaseSync(path.join(root,'runtime-records.sqlite'));
  sourceDB.exec(`CREATE TABLE collections(name TEXT PRIMARY KEY); CREATE TABLE records(collection TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,session_id TEXT,data TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(collection,id));
    INSERT INTO collections VALUES('requests'); PRAGMA application_id=1179796804; PRAGMA user_version=1;`);
  sourceDB.close();
  store.migrateRuntimeRecords(path.join(root,'runtime-records.sqlite'),{quiesced:true,runtimeID:'state-import'});
  assert.throws(()=>store.migrateRuntimeStateFiles(source,{runtimeID:'state-import'}),/Stop Freelancer/);
  const conflictDb = new DatabaseSync(store.filename);
  conflictDb.prepare('INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?)').run('state-import','preferences.json','{"different":true}');
  conflictDb.prepare('INSERT INTO runtime_collection_markers(runtime_id,collection_name) VALUES(?,?)').run('state-import','document:preferences.json');
  conflictDb.close();
  assert.throws(()=>store.migrateRuntimeStateFiles(source,{quiesced:true,runtimeID:'state-import'}),/conflicts with a migrated/);
  const afterConflict = new DatabaseSync(store.filename,{readOnly:true});
  assert.equal(afterConflict.prepare('SELECT count(*) n FROM data_migration_runs WHERE migration_id=?').get('runtime-state-files:state-import').n,0);
  afterConflict.close();
  const clearConflict = new DatabaseSync(store.filename);
  clearConflict.prepare('DELETE FROM application_documents WHERE runtime_id=? AND document_key=?').run('state-import','preferences.json');
  clearConflict.prepare('DELETE FROM runtime_collection_markers WHERE runtime_id=? AND collection_name=?').run('state-import','document:preferences.json');
  clearConflict.close();
  const imported = store.migrateRuntimeStateFiles(source,{quiesced:true,runtimeID:'state-import'});
  assert.equal(imported.status,'validated-copy');
  assert.equal(imported.manifest.fileCount,2);
  assert.ok(imported.manifest.skipped.some(row=>row.key==='webpage/launch.json'));
  assert.ok(imported.manifest.sourceSha256);
  const db = new DatabaseSync(store.filename,{readOnly:true});
  assert.equal(db.prepare('SELECT status FROM data_migration_runs WHERE migration_id=?').get('runtime-state-files:state-import').status,'validated-copy');
  db.close();
  await writeFile(path.join(source,'.state','storage-runtime.json'),JSON.stringify({version:1,mode:'unified',runtimeID:'state-import'}));
  const prior = { FREELANCER_RUNTIME_DATA_MODE:process.env.FREELANCER_RUNTIME_DATA_MODE,
    FREELANCER_DATA_HOME:process.env.FREELANCER_DATA_HOME,FREELANCER_RUNTIME_ID:process.env.FREELANCER_RUNTIME_ID };
  delete process.env.FREELANCER_RUNTIME_DATA_MODE; delete process.env.FREELANCER_RUNTIME_ID;
  process.env.FREELANCER_DATA_HOME=store.directory;
  try {
    assert.deepEqual(stateFiles(path.join(state,'delegation','decisions')).sort(),['choice.json']);
    assert.equal(readState(path.join(state,'preferences.json')).schemaVersion,1);
    assert.equal(readState(path.join(state,'webpage','launch.json')).shutdownToken,'fixture-secret');
    writeState(path.join(state,'webpage','launch.json'),{url:'http://127.0.0.1:58634',shutdownToken:'rotated'});
    assert.equal(JSON.parse(await readFile(path.join(state,'webpage','launch.json'),'utf8')).shutdownToken,'rotated');
    removeState(path.join(state,'webpage','launch.json'));
    assert.equal(readState(path.join(state,'webpage','launch.json'),'missing'),'missing');
    assert.throws(()=>store.migrateRuntimeStateFiles(source,{quiesced:true,runtimeID:'state-import'}),/no prior standalone-state import/);
  } finally { for(const [key,value] of Object.entries(prior)) value===undefined?delete process.env[key]:process.env[key]=value; }
});
test('durable runtime storage pointer is opt-in and validated', async t => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'freelancer-runtime-pointer-'));
  t.after(() => rm(runtimeRoot, { recursive:true, force:true }));
  const state = path.join(runtimeRoot, '.state');
  await import('node:fs/promises').then(fs => fs.mkdir(state, { recursive:true }));
  const env = { FREELANCER_DATA_HOME:path.join(runtimeRoot, 'user-data') };
  assert.equal(unifiedConfig(runtimeRoot, env), null);
  const pointer = path.join(state, 'storage-runtime.json');
  await writeFile(pointer, JSON.stringify({ version:1, mode:'unified', runtimeID:'pointer-runtime' }));
  assert.deepEqual(unifiedConfig(runtimeRoot, env), { dataHome:path.join(runtimeRoot, 'user-data'), runtimeID:'pointer-runtime' });
  await writeFile(pointer, JSON.stringify({ version:1, mode:'legacy', runtimeID:'pointer-runtime' }));
  assert.throws(() => unifiedConfig(runtimeRoot, env), /pointer is invalid/);
});
test('schema 9 upgrade assigns legacy runtime identity without losing copied state', async t => {
  const { root, store } = await localStore(t);
  const filename = store.filename;
  store.close();
  const db = new DatabaseSync(filename);
  db.exec(`DROP TRIGGER opencode_derivation_inputs_immutable;
    ALTER TABLE chat_search_state DROP COLUMN derivation_job_id;
    ALTER TABLE chat_search_state DROP COLUMN indexed_text_sha256;
    DROP TABLE opencode_derivation_jobs; DROP TABLE opencode_refresh_needed;
    DELETE FROM data_table_lifecycle WHERE table_name IN ('opencode_derivation_jobs','opencode_refresh_needed');
    DROP VIEW IF EXISTS knowledge_outcome_summary; DROP VIEW IF EXISTS knowledge_task_outcomes; DELETE FROM data_table_lifecycle WHERE table_name IN ('knowledge_outcome_summary','knowledge_task_outcomes'); DROP VIEW knowledge_pinned_memories; DROP VIEW knowledge_current_claims; DROP VIEW knowledge_claim_evidence; DROP VIEW knowledge_memory_evidence; DROP VIEW knowledge_source_coverage;
    DELETE FROM data_table_lifecycle WHERE table_name IN ('runtime_instances','knowledge_pinned_memories','knowledge_current_claims','knowledge_claim_evidence','knowledge_memory_evidence','knowledge_source_coverage');
    DROP TABLE runtime_instances;
    CREATE TABLE operational_records_v9(collection TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,session_id TEXT,data TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(collection,id)) STRICT;
    INSERT INTO operational_records_v9 SELECT collection,id,project_id,session_id,data,summary FROM operational_records;
    DROP TABLE operational_records; ALTER TABLE operational_records_v9 RENAME TO operational_records;
    CREATE INDEX operational_records_session ON operational_records(collection,project_id,session_id);
    CREATE TABLE application_documents_v9(document_key TEXT PRIMARY KEY,data TEXT NOT NULL) STRICT;
    INSERT INTO application_documents_v9(document_key,data) SELECT document_key,data FROM application_documents;
    DROP TABLE application_documents; ALTER TABLE application_documents_v9 RENAME TO application_documents;
    CREATE TABLE project_registrations_v9(project_id TEXT PRIMARY KEY,data TEXT NOT NULL) STRICT;
    INSERT INTO project_registrations_v9(project_id,data) SELECT project_id,data FROM project_registrations;
    DROP TABLE project_registrations; ALTER TABLE project_registrations_v9 RENAME TO project_registrations;
    CREATE TABLE application_settings_v9(setting_key TEXT PRIMARY KEY,data TEXT NOT NULL) STRICT;
    INSERT INTO application_settings_v9(setting_key,data) SELECT setting_key,data FROM runtime_settings;
    DROP TABLE runtime_settings; DROP TABLE settings_update_journal;
    DELETE FROM data_table_lifecycle WHERE table_name IN ('runtime_settings','settings_update_journal');
    ALTER TABLE application_settings_v9 RENAME TO application_settings;
    INSERT INTO operational_records VALUES('requests','old-id','p','s','{"status":"uncertain"}','{}');
    INSERT INTO application_documents VALUES('goals.json','{"version":1,"records":{"g":{"status":"paused"}}}');
    INSERT INTO project_registrations VALUES('p','{"id":"p"}');
    INSERT INTO application_settings VALUES('appearance','{"theme":"dark"}');
    INSERT INTO data_migration_runs VALUES('runtime-records-v1','C:/old-runtime/records.sqlite',1179796804,1,'source-hash','validated-copy','{}',100,200);
    DROP INDEX judgment_runs_cache; DROP TABLE judgment_results; DROP TABLE judgment_runs; DROP TABLE judgment_definitions;
    DELETE FROM schema_migrations WHERE version>=10; DROP VIEW IF EXISTS knowledge_outcome_summary; DROP VIEW IF EXISTS knowledge_task_outcomes; DELETE FROM data_table_lifecycle WHERE table_name IN ('knowledge_outcome_summary','knowledge_task_outcomes'); DROP TRIGGER claims_search_insert; DROP TRIGGER claims_search_update; DROP TRIGGER claims_search_delete; DROP TRIGGER claims_search_evidence_insert; DROP TRIGGER claims_search_evidence_delete; DROP TRIGGER claims_search_evidence_update; DROP TRIGGER claims_search_entity_update; DROP TRIGGER claims_search_alias_insert; DROP TRIGGER claims_search_alias_delete; DROP TRIGGER claims_search_alias_update; DROP TABLE claims_search_fts; DROP TABLE entity_relation_revisions; DELETE FROM data_table_lifecycle WHERE table_name IN ('claims_search_fts','entity_relation_revisions'); DROP TABLE memory_capture_jobs; DELETE FROM data_table_lifecycle WHERE table_name='memory_capture_jobs'; DELETE FROM data_table_lifecycle WHERE table_name IN ('runtime_instances','knowledge_pinned_memories','knowledge_current_claims','knowledge_claim_evidence','knowledge_memory_evidence','knowledge_source_coverage','runtime_collection_markers','judgment_definitions','judgment_runs','judgment_results','opencode_sources','opencode_ingest_runs','opencode_ingest_cursors','opencode_ingest_failures','opencode_sessions','opencode_session_revisions','opencode_messages','opencode_message_revisions','opencode_source_coverage'); DROP VIEW opencode_source_coverage; DROP TABLE opencode_ingest_failures; DROP TABLE opencode_ingest_cursors; DROP TABLE opencode_ingest_runs; DROP TABLE opencode_message_revisions; DROP TABLE opencode_messages; DROP TABLE opencode_session_revisions; DROP TABLE opencode_sessions; DROP TABLE opencode_sources; DROP TABLE runtime_collection_markers; DROP INDEX content_unit_revisions_ref; DROP INDEX content_source_revisions_project; DROP TABLE content_unit_revisions; DROP TABLE content_source_revisions; DELETE FROM data_table_lifecycle WHERE table_name IN ('content_unit_revisions','content_source_revisions'); DROP INDEX content_sources_identity; ALTER TABLE content_sources DROP COLUMN revision_identity; ALTER TABLE content_sources DROP COLUMN source_identity; PRAGMA user_version=9;`);
  db.close();
  const upgraded = createLocalDataStore(root);
  const result = new DatabaseSync(upgraded.filename,{readOnly:true});
  assert.equal(upgraded.info().schemaVersion,LOCAL_DATA_SCHEMA_VERSION);
  assert.equal(result.prepare('SELECT data FROM operational_records WHERE runtime_id=? AND id=?').get('legacy-runtime-v1','old-id').data,'{"status":"uncertain"}');
  assert.equal(result.prepare('SELECT data FROM application_documents WHERE runtime_id=? AND document_key=?').get('legacy-runtime-v1','goals.json').data,'{"version":1,"records":{"g":{"status":"paused"}}}');
  assert.equal(result.prepare('SELECT data FROM project_registrations WHERE runtime_id=? AND project_id=?').get('legacy-runtime-v1','p').data,'{"id":"p"}');
  assert.equal(result.prepare('SELECT data FROM runtime_settings WHERE runtime_id=? AND setting_key=?').get('legacy-runtime-v1','appearance').data,'{"theme":"dark"}');
  assert.equal(result.prepare('SELECT source_path FROM runtime_instances WHERE runtime_id=?').get('legacy-runtime-v1').source_path,'C:/old-runtime/records.sqlite');
  assert.equal(result.prepare('SELECT count(*) n FROM data_migration_runs WHERE migration_id=?').get('runtime-records:legacy-runtime-v1').n,1);
  assert.equal(result.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='runtime_collection_markers'").get().n,1);
  assert.equal(result.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  result.close();
  upgraded.close();
});
test("runtime record migration fails closed when a source row lacks a marker", async (t) => {
  const { root, store } = await localStore(t);
  const legacyPath = path.join(root, 'records.sqlite');
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(`CREATE TABLE collections (name TEXT PRIMARY KEY);
    CREATE TABLE records (collection TEXT NOT NULL,id TEXT NOT NULL,project_id TEXT,session_id TEXT,data TEXT NOT NULL,summary TEXT NOT NULL,PRIMARY KEY(collection,id));
    INSERT INTO records VALUES ('mystery','row-1',NULL,NULL,'{}','{}');
    PRAGMA application_id=1179796804; PRAGMA user_version=1;`);
  legacy.close();
  assert.throws(() => store.migrateRuntimeRecords(legacyPath, { quiesced: true, runtimeID: 'install-invalid' }), /without a known collection marker/);
  const reader = new DatabaseSync(store.filename, { readOnly: true });
  assert.equal(reader.prepare('SELECT count(*) n FROM operational_records').get().n, 0);
  assert.equal(reader.prepare('SELECT count(*) n FROM data_migration_runs').get().n, 0);
  reader.close();
});
test("bounded analytical SQL is read-only, parameterized, columnar and reports truncation", async (t) => {
  const { store } = await localStore(t);
  store.saveDraft('p', 'new', 'alpha', 0);
  store.saveDraft('p', 'other', 'beta', 0);
  const result = await store.analyze('WITH selected AS (SELECT conversation_key, text FROM drafts WHERE project_id = $project) SELECT conversation_key AS key, text FROM selected ORDER BY key', { $project: 'p' }, { maxRows: 1 });
  assert.deepEqual(result.columns, ['key', 'text']);
  assert.deepEqual(result.rows, [{ key: 'new', text: 'alpha' }]);
  assert.equal(result.truncated, true);
  assert.equal(result.partial, false);
  assert.throws(() => store.analyze('DELETE FROM drafts'), /read-only SELECT or CTE/);
  assert.throws(() => store.analyze('SELECT 1; SELECT 2'), /read-only SELECT or CTE/);
  assert.throws(() => store.analyze('PRAGMA table_info(drafts)'), /read-only SELECT or CTE/);
  assert.throws(() => store.analyze('SELECT load_extension($path)', { $path: 'extension' }), /not authorized|unsafe use|no such function|read-only/i);
  assert.equal(store.draft('p', 'new').text, 'alpha');
});
test('documented source coverage view keeps source and segment counts independent', async t => {
  const { store } = await localStore(t);
  const db = new DatabaseSync(store.filename);
  db.prepare(`INSERT INTO content_sources(source_id,project_key,filename,virtual_path,container_path,extension,source_role,status,
    routing_rank,file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count)
    VALUES(1,'p','notes.md','notes.md','notes.md','.md','project','active',1,120,'2026-10-01T12:00:00Z','hash',2,'line','test','ok',80,12)`).run();
  db.prepare("INSERT INTO content_units(unit_id,source_id,unit_no,locator,heading,text,word_count,char_count,sha256) VALUES(1,1,0,'L1','One','alpha',6,40,'u1'),(2,1,1,'L2','Two','beta',6,40,'u2')").run();
  db.close();
  assert.deepEqual((await store.analyze('SELECT source_count,extracted_source_count,declared_unit_count,stored_unit_count,extracted_word_count FROM knowledge_source_coverage WHERE project_key=$project', { $project: 'p' })).rows[0],
    { source_count: 1, extracted_source_count: 1, declared_unit_count: 2, stored_unit_count: 2, extracted_word_count: 12 });
});
test("analytical SQL cancellation is checked before opening a query", async (t) => {
  const { store } = await localStore(t);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => store.analyze('SELECT 1 AS value', {}, { signal: controller.signal }), { name: 'AbortError' });
});
test("index repair preserves schema-registered operational and settings records", async (t) => {
  const { store } = await localStore(t);
  const db = new DatabaseSync(store.filename);
  db.prepare('INSERT INTO operational_records(runtime_id,collection,id,project_id,session_id,data,summary) VALUES(?,?,?,?,?,?,?)').run('runtime-a','requests','uncertain-1','p','s','{"status":"uncertain"}','{}');
  db.prepare('INSERT INTO runtime_settings(runtime_id,setting_key,data) VALUES(?,?,?)').run('runtime-a','appearance','{"theme":"dark"}');
  db.prepare('INSERT INTO project_registrations(runtime_id,project_id,data) VALUES(?,?,?)').run('runtime-a','p','{"id":"p"}');
  db.close();
  const result = store.maintainIndex('reset');
  assert.ok(result.message.includes('cleared'));
  const check = new DatabaseSync(store.filename, { readOnly: true });
  assert.equal(check.prepare('SELECT data FROM operational_records WHERE id=?').get('uncertain-1').data, '{"status":"uncertain"}');
  assert.equal(check.prepare('SELECT data FROM runtime_settings WHERE setting_key=?').get('appearance').data, '{"theme":"dark"}');
  assert.equal(check.prepare('SELECT data FROM project_registrations WHERE project_id=?').get('p').data, '{"id":"p"}');
  check.close();
});
test('index repair rebuilds memory search from durable revisions', async t => {
  const { root, store } = await localStore(t);
  const saved = store.createMemory({ kind:'note',title:'The comet',body:'Café aurora archive', source: { projectID: 'project-one', sessionID: 'session-one' }, provenance: { sessionID: 'session-one' } });
  const hit = store.searchMemory('aurora').items[0];
  assert.equal(hit.id, saved.id);
  assert.deepEqual(hit.source, { system: 'freelancer-project', projectID: 'project-one', sessionID: 'session-one' });
  store.maintainIndex('reset');
  const reopened = createLocalDataStore(root);
  assert.equal(reopened.searchMemory('aurora').items[0].id, saved.id);
  assert.equal((await reopened.analyze('SELECT count(*) AS views FROM sqlite_master WHERE type=$type AND name LIKE $prefix', { $type: 'view', $prefix: 'knowledge_%' })).rows[0].views, 7);
  assert.equal(reopened.maintainIndex('check').healthy, true);
  reopened.close();
});
test('OpenCode warehouse snapshots are durable, deduplicated by content revision, and omit private reasoning', async t => {
  const {store}=await localStore(t);
  const source=openCodeSourceIdentity('C:\\OpenCode\\native.sqlite'),projectID='warehouse-project';
  const session={id:'ses_warehouse',parentID:null,title:'Synthetic warehouse fixture',directory:'C:\\Projects\\fixture',time:{created:100,updated:200}};
  const messages=[
    {info:{id:'msg_user',role:'user',time:{created:101}},parts:[{id:'part_user',type:'text',text:'Synthetic request'}]},
    {info:{id:'msg_assistant',role:'assistant',providerID:'jev',modelID:'jev-latest',time:{created:102,completed:103},tokens:{input:20,output:4}},parts:[
      {id:'part_text',type:'text',text:'Synthetic result'},
      {id:'part_reasoning',type:'reasoning',text:'private reasoning must not be captured'},
      {id:'part_tool',type:'tool',callID:'call_1',tool:'fixture',state:{status:'completed',input:{apiKey:'never-store-this',query:'bounded'},output:'Bearer secret-value'}},
    ]},
  ];
  const first=store.recordOpenCodeSnapshot({...source,projectID,session,messages});
  assert.equal(first.messages,2);assert.equal(first.messageRevisionsAdded,2);assert.equal(first.omittedPartCount,1);
  const duplicate=store.recordOpenCodeSnapshot({...source,projectID,session,messages});
  assert.equal(duplicate.messageRevisionsAdded,0);
  const changed=structuredClone(messages);changed[1].parts[0].text='Updated synthetic result';
  const next=store.recordOpenCodeSnapshot({...source,projectID,session:{...session,time:{...session.time,updated:300}},messages:changed});
  assert.equal(next.messageRevisionsAdded,1);
  const snapshot=store.readOpenCodeSession({projectID,sessionID:session.id});
  assert.equal(snapshot.status,'ok');assert.equal(snapshot.session.sourceSystemID,source.sourceSystemID);
  assert.equal(snapshot.messages.find(row=>row.messageID==='msg_assistant').parts.find(row=>row.id==='part_text').text,'Updated synthetic result');
  const parts=JSON.stringify(snapshot.messages.find(row=>row.messageID==='msg_assistant').parts);
  assert.doesNotMatch(parts,/private reasoning|never-store-this|secret-value/);
  assert.match(parts,/Bearer \[redacted\]/);
  assert.match(snapshot.messages[1].sourceRef,/@/);
  const db=new DatabaseSync(store.filename,{readOnly:true});
  assert.equal(db.prepare('SELECT count(*) n FROM opencode_message_revisions').get().n,3);
  assert.equal(db.prepare('SELECT message_revisions FROM opencode_source_coverage WHERE source_system_id=?').get(source.sourceSystemID).message_revisions,3);
  assert.equal(db.prepare('SELECT count(*) n FROM opencode_session_revisions WHERE payload_json LIKE ?').get('%C:\\Projects\\fixture%').n,0);
  db.close();
});

function nativeBackfillPage(route,options,sessions,directory,requests) {
  assert.ok(route.startsWith('/experimental/session?'));
  assert.equal(options.responseMetadata,true);
  const url=new URL(route,'http://localhost'),params=url.searchParams;
  assert.equal(params.get('directory'),directory);assert.equal(params.get('archived'),'true');
  const start=params.has('start')?Number(params.get('start')):null,cursor=params.has('cursor')?Number(params.get('cursor')):null,limit=Number(params.get('limit'));
  requests?.push({start,cursor,limit});
  const ordered=sessions.filter(row=>(start===null||row.time.updated>=start)&&(cursor===null||row.time.updated<cursor))
    .sort((a,b)=>b.time.updated-a.time.updated||(a.id<b.id?1:a.id>b.id?-1:0));
  const body=ordered.slice(0,limit);
  return {body,metadata:{'x-next-cursor':ordered.length>limit?String(body.at(-1).time.updated):null}};
}

test('OpenCode warehouse backfill records a failed timestamp cursor and resumes without losing later sessions', async t => {
  const {root,store}=await localStore(t),directory=path.join(os.tmpdir(),'warehouse-project');
  const project={id:'warehouse-backfill-project',directory,name:'Synthetic backfill'};
  const sessions=['ses_a','ses_b','ses_c'].map((id,index)=>({id,directory,title:id,time:{created:100+index,updated:900-index*100}}));
  let failB=true,failDerivedB=true,activeStore=store,history,clock=Date.now();const pages=[];
  t.mock.method(Date,'now',()=>clock);
  const publish=store.publishWarehouseDerivationJob.bind(store);
  store.publishWarehouseDerivationJob=input=>{
    const snapshot=store.readWarehouseDerivationSnapshot(input);
    if(snapshot.job?.sessionID==='ses_b'&&failDerivedB){failDerivedB=false;throw Error('synthetic derived index failure');}
    return publish(input);
  };
  const app={store:{async read(){return {projects:[project]};}},async project(id){assert.equal(id,project.id);return project;},indexJobs:null};
  const host={async databasePath(){return 'C:\\Synthetic\\opencode.db';},async request(route,options){
    if(route.startsWith('/experimental/session?')) return nativeBackfillPage(route,options,sessions,directory,pages);
    const id=decodeURIComponent(route.split('/')[2]);if(id==='ses_b'&&failB){failB=false;throw Error('synthetic temporary failure');}
    return [{info:{id:`msg_${id}`,role:'user'},parts:[{id:`part_${id}`,type:'text',text:`captured ${id}`}]}];
  }};
  const createHistory=()=>createHistoryService({app,host,backendRoot:directory,dataRoot:directory,localData:{get:()=>activeStore}});
  history=createHistory();
  try {
  const first=await history.backfillOpenCode({projectID:project.id,pageSize:2});
  assert.equal(first.results[0].status,'partial');assert.equal(first.results[0].cursor.contract,'opencode-updated-v1');
  assert.equal(first.results[0].cursor.before,null);assert.deepEqual(first.results[0].cursor.retryIDs,['ses_b']);assert.equal(first.results[0].failedSessions,1);
  assert.equal(store.readOpenCodeSession({projectID:project.id,sessionID:'ses_c'}).status,'ok');
  assert.equal(store.openCodeIngestFailures({runID:first.results[0].runID})[0].sessionID,'ses_b');
  const beforeResume=store.openCodeIngestStatus({projectID:project.id});assert.equal(beforeResume[0].coverageState,'incomplete');
  clock++;
  const second=await history.backfillOpenCode({projectID:project.id,pageSize:2,resume:true});
  assert.equal(second.results[0].status,'complete');assert.equal(second.results[0].cursor,null);
  assert.equal(second.results[0].failedSessions,0,'Publication failure is separate from authoritative source capture.');
  assert.equal(store.readOpenCodeSession({projectID:project.id,sessionID:'ses_b'}).status,'ok','Immutable source capture precedes derived indexing.');
  assert.equal(store.searchChats('ses_b',{project:project.id}).length,0);
  assert.equal(store.openCodeIngestFailures({runID:second.results[0].runID}).length,0,'A search publication error is not reported as a native source failure.');
  const pending=store.listWarehouseDerivationJobs({projectID:project.id,includeDeferred:true});
  assert.equal(pending.length,1);assert.equal(pending[0].sessionID,'ses_b');assert.equal(pending[0].status,'pending');
  assert.equal(pending[0].attempts,1);assert.ok(pending[0].nextAttemptAt>clock);
  assert.doesNotMatch(pending[0].error,/synthetic derived index failure/,'Failure receipts retain safe metadata.');
  assert.equal((await history.processWarehouseDerivationJobs({projectID:project.id})).processed,0,'Retry waits for its recorded deadline.');
  await history.close();activeStore.close();activeStore=createLocalDataStore(root);history=createHistory();
  const recovered=activeStore.listWarehouseDerivationJobs({projectID:project.id,includeDeferred:true});
  assert.deepEqual(recovered.map(job=>[job.id,job.revisionToken,job.attempts,job.nextAttemptAt]),
    pending.map(job=>[job.id,job.revisionToken,job.attempts,job.nextAttemptAt]),'Pending publication and retry state survive SQLite reopen.');
  clock=pending[0].nextAttemptAt;
  const third=await history.backfillOpenCode({projectID:project.id,pageSize:2,resume:true});
  assert.equal(third.results[0].status,'complete');assert.equal(third.results[0].capturedSessions,3);
  assert.equal(third.results[0].capturedMessages,3);assert.equal(third.results[0].cursor,null);
  assert.ok(activeStore.searchChats('ses_b',{project:project.id}).some(hit=>hit.session==='ses_b'));
  assert.equal(activeStore.listWarehouseDerivationJobs({projectID:project.id,includeDeferred:true}).length,0);
  const capturedDB=new DatabaseSync(activeStore.filename,{readOnly:true});
  assert.equal(capturedDB.prepare('SELECT count(*) n FROM opencode_message_revisions').get().n,3,'Retry keeps exact source revisions deduplicated.');
  capturedDB.close();
  assert.ok(pages.some(row=>row.cursor===800&&row.start===null));
  assert.ok(pages.some(row=>row.cursor===801&&row.start===800));
  assert.equal(activeStore.openCodeIngestStatus({projectID:project.id})[0].coverageState,'complete');
  assert.equal(activeStore.openCodeCoverage()[0].sessions,3);
  } finally {await history?.close();activeStore.close();}
});

test('OpenCode warehouse backfill discards legacy offsets and reconciles head insertion before claiming complete coverage', async t => {
  const {store}=await localStore(t),directory=path.join(os.tmpdir(),'warehouse-project-shifting');
  const project={id:'warehouse-shifting-project',directory,name:'Synthetic shifting inventory'};
  const sessions=['ses_a','ses_b','ses_c'].map((id,index)=>({id,directory,title:id,time:{created:100+index,updated:900-index*100}}));
  let insertBeforeNextPage=true;const captured=[];
  const app={store:{async read(){return {projects:[project]};}},async project(id){assert.equal(id,project.id);return project;},indexJobs:null};
  const source=openCodeSourceIdentity('C:\\Synthetic\\opencode-shifting.db');
  const old=store.beginOpenCodeIngest({...source,projectID:project.id,mode:'backfill'});
  store.checkpointOpenCodeIngest({runID:old.runID,cursor:{start:2,previousID:'ses_b'},discoveredSessions:2,capturedSessions:2,capturedMessages:2,failedSessions:0,status:'partial'});
  const host={async databasePath(){return 'C:\\Synthetic\\opencode-shifting.db';},async request(route,options){
    if(route.startsWith('/experimental/session?')) return nativeBackfillPage(route,options,sessions,directory);
    const id=decodeURIComponent(route.split('/')[2]);captured.push(id);
    if(id==='ses_b'&&insertBeforeNextPage){insertBeforeNextPage=false;sessions.unshift({id:'ses_new',directory,title:'ses_new',time:{created:99,updated:1000}});}
    return [{info:{id:`msg_${id}`,role:'user'},parts:[{id:`part_${id}`,type:'text',text:`captured ${id}`}]}];
  }};
  const history=createHistoryService({app,host,backendRoot:directory,dataRoot:directory,localData:{get:()=>store}});
  const first=await history.backfillOpenCode({projectID:project.id,pageSize:2});
  assert.equal(first.results[0].status,'partial');assert.equal(first.results[0].cursor.before,null);
  assert.equal(first.results[0].cursor.contract,'opencode-updated-v1');assert.equal(Object.hasOwn(first.results[0].cursor,'start'),false);
  assert.match(first.results[0].error,/inventory changed during backfill/);
  assert.equal(store.openCodeIngestStatus({projectID:project.id})[0].coverageState,'incomplete');
  const second=await history.backfillOpenCode({projectID:project.id,pageSize:2,resume:true});
  assert.equal(second.results[0].status,'complete');assert.equal(store.openCodeIngestStatus({projectID:project.id})[0].coverageState,'complete');
  assert.deepEqual([...new Set(captured)].sort(),['ses_a','ses_b','ses_c','ses_new']);
  assert.equal(store.openCodeCoverage()[0].sessions,4);
});

test('OpenCode warehouse backfill drains exact same-time siblings including archived and child sessions before advancing', async t => {
  const {store}=await localStore(t),directory=path.join(os.tmpdir(),'warehouse-project-ties');
  const project={id:'warehouse-tie-project',directory,name:'Synthetic timestamp ties'};
  const sessions=['ses_a','ses_b','ses_c','ses_d','ses_e'].map((id,index)=>({id,directory,title:id,
    ...(id==='ses_c'?{parentID:'ses_a'}:{}),time:{created:100+index,updated:index===0?900:index===4?700:800,...(id==='ses_b'?{archived:850}:{})}}));
  const pages=[],captured=[];let insertSameTime=false,initialBackfill=true,checkpointProofs=0;
  const app={store:{async read(){return {projects:[project]};}},async project(){return project;},indexJobs:null};
  const host={async databasePath(){return 'C:\\Synthetic\\opencode-ties.db';},async request(route,options){
    if(route.startsWith('/experimental/session?')) return nativeBackfillPage(route,options,sessions,directory,pages);
    const id=decodeURIComponent(route.split('/')[2]);captured.push(id);
    if(insertSameTime&&id==='ses_e') {insertSameTime=false;sessions.push({id:'ses_aa',directory,title:'Hidden same-time insertion',time:{created:150,updated:800}});}
    return [{info:{id:`msg_${id}`,role:'user'},parts:[{id:`part_${id}`,type:'text',text:`captured ${id}`}]}];
  }};
  const original=store.checkpointOpenCodeIngest.bind(store);
  store.checkpointOpenCodeIngest=options=>{
    if(initialBackfill&&options.cursor?.before===800) for(const id of ['ses_a','ses_b','ses_c','ses_d']) {
      assert.equal(store.readOpenCodeSession({projectID:project.id,sessionID:id}).status,'ok');
      const job=store.listWarehouseDerivationJobs({projectID:project.id,includeDeferred:true}).find(row=>row.sessionID===id);
      assert.ok(job,'The source snapshot commits its pending publication before cursor advance.');
      const snapshot=store.readWarehouseDerivationSnapshot(job);
      assert.equal(snapshot.isCurrent,true);assert.equal(snapshot.projectionSafe,true);
      assert.equal(snapshot.messages[0].info.id,`msg_${id}`);
      checkpointProofs++;
    }
    return original(options);
  };
  const history=createHistoryService({app,host,backendRoot:directory,dataRoot:directory,localData:{get:()=>store}});
  t.after(()=>history.close());
  const result=await history.backfillOpenCode({projectID:project.id,pageSize:2});
  initialBackfill=false;
  assert.equal(result.results[0].status,'complete');assert.equal(result.results[0].capturedSessions,5);
  assert.ok(checkpointProofs>=4,'The timestamp checkpoint inspected every retained boundary source and queued publication.');
  for(const session of sessions) assert.ok(store.searchChats(session.id,{project:project.id}).some(hit=>hit.session===session.id),
    'The drained derivation worker publishes every captured session after the source checkpoints.');
  assert.deepEqual(captured,['ses_a','ses_d','ses_c','ses_b','ses_e']);
  assert.deepEqual(pages.filter(row=>row.start===800),[
    {start:800,cursor:801,limit:5000},
    {start:800,cursor:801,limit:5000},
  ]);
  assert.equal(store.openCodeCoverage()[0].sessions,5);
  assert.equal(store.readOpenCodeSession({projectID:project.id,sessionID:'ses_c'}).session.parentID,'ses_a');
  insertSameTime=true;
  const changed=await history.backfillOpenCode({projectID:project.id,pageSize:2,resume:false});
  assert.equal(changed.results[0].status,'partial');assert.equal(changed.results[0].cursor.before,null);
  assert.match(changed.results[0].error,/inventory changed during backfill/);
  assert.deepEqual(sessions.toSorted((a,b)=>b.time.updated-a.time.updated||(a.id<b.id?1:-1)).slice(0,2).map(row=>row.id),['ses_a','ses_d'],
    'The newest-page prefix did not change; its expanded boundary bucket must detect the insertion.');
  const reconciled=await history.backfillOpenCode({projectID:project.id,pageSize:2});
  assert.equal(reconciled.results[0].status,'complete');assert.equal(store.openCodeCoverage()[0].sessions,6);
  assert.equal(store.readOpenCodeSession({projectID:project.id,sessionID:'ses_aa'}).status,'ok');
});

test('OpenCode warehouse backfill bounds an oversized timestamp bucket without advancing or claiming complete coverage', async t => {
  const directory=path.join(os.tmpdir(),'warehouse-capped-unit-fixture'),project={id:'capped-unit-project',name:'Bounded bucket fixture',directory};
  const sessions=Array.from({length:5001},(_,index)=>({id:`ses_${String(index).padStart(5,'0')}`,directory,title:'Capped fixture',time:{created:100,updated:800}}));
  const pages=[],capturedIDs=new Set();let lastCheckpoint;
  // A lightweight capture sink isolates paging bounds; the preceding contracts
  // and disposable native smoke cover actual SQLite commit/reopen behavior.
  const data={resumeMemoryCaptures:()=>[],beginOpenCodeIngest:()=>({runID:'bounded-unit-run',cursor:null}),
    checkpointOpenCodeIngest(value){assert.notEqual(value.cursor?.before,800);lastCheckpoint=structuredClone(value);return value;},
    recordOpenCodeSnapshot({session,messages}){capturedIDs.add(session.id);return {messages:messages.length};},
    indexChat(){},recordOpenCodeIngestFailure(){assert.fail('No capture failure expected.');},openCodeCoverage:()=>[]};
  const app={store:{async read(){return {projects:[project]};}},async project(){return project;}};
  const host={async databasePath(){return 'C:\\Synthetic\\bounded-unit.db';},async request(route,options){
    if(route.startsWith('/experimental/session?'))return nativeBackfillPage(route,options,sessions,directory,pages);
    return [];
  }};
  const history=createHistoryService({app,host,backendRoot:directory,dataRoot:directory,localData:{get:()=>data}});
  t.after(()=>history.close());
  const result=await history.backfillOpenCode({projectID:project.id,pageSize:2});
  assert.equal(result.results[0].status,'partial');assert.match(result.results[0].error,/more than 5000 sessions/);
  assert.deepEqual(lastCheckpoint.cursor.bucket,{updatedAt:800,limit:5000});assert.equal(lastCheckpoint.cursor.before,null);
  assert.equal(lastCheckpoint.complete,undefined);assert.equal(capturedIDs.size,5000);
  assert.ok(pages.every(row=>row.limit<=5000));assert.equal(pages.at(-1).limit,5000);
  assert.equal(lastCheckpoint.cursor.head.length,64,'Every checkpoint retains a bounded head hash.');
});

test("memory entities, relations and evidence-backed claims are duplicate safe and transactional", async (t) => {
  const { store } = await localStore(t);
  const a = store.createEntity({ type: 'project', name: 'Freelancer', aliases: ['Freelancer app'] });
  const duplicate = store.createEntity({ type: 'project', name: '  freelancer  ', aliases: ['The toolkit'] });
  assert.equal(duplicate.id, a.id);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(store.findEntity('the toolkit').map(row => row.id), [a.id]);
  const b = store.createEntity({ type: 'component', name: 'OpenCode' });
  assert.throws(() => store.addRelation({ from: a.id, to: 'missing', type: 'uses' }), /endpoints must exist/);
  const relation = store.addRelation({ from: a.id, to: b.id, type: 'uses', provenance: { source: 'manual' } });
  assert.equal(relation.created, true);
  assert.equal(store.addRelation({ from: a.id, to: b.id, type: 'uses' }).created, false);
  assert.deepEqual(store.listRelations({ entityID:a.id }).map(row=>row.id),[relation.id]);
  assert.throws(() => store.addClaim({ predicate: 'uses', origin: 'source-reported', epistemicState: 'supported', evidence: [] }), /evidence reference/);
  const claim = store.addClaim({ subjectEntityID: a.id, objectEntityID: b.id, predicate: 'uses', origin: 'source-reported', method: 'manual', epistemicState: 'supported', scope: { version: 'current' }, evidence: [{ id: 'doc:1#L1', relation: 'supports' }] });
  assert.equal(claim.created, true);
  assert.equal(store.addClaim({ subjectEntityID: a.id, objectEntityID: b.id, predicate: 'uses', origin: 'source-reported', method: 'manual', epistemicState: 'supported', scope: { version: 'current' }, evidence: [{ id: 'doc:2#L3', relation: 'supports' }] }).id, claim.id);
  const evidenceDB = new DatabaseSync(store.filename, { readOnly: true });
  assert.equal(evidenceDB.prepare('SELECT count(*) n FROM claim_evidence WHERE claim_id=?').get(claim.id).n, 2);
  evidenceDB.close();
  const corrected = store.correctClaim({ id: claim.id, expectedEpistemicState: 'supported', predicate: 'integrates with', subjectEntityID: a.id, objectEntityID: b.id,
    origin: 'source-reported', method: 'manual', epistemicState: 'supported', scope: { version: 'current' }, evidence: [{ id: 'doc:2#L4', relation: 'supports' }], actor: 'user', reason: 'source correction' });
  assert.equal(corrected.corrected, true);
  assert.notEqual(corrected.id, claim.id);
  assert.throws(() => store.correctClaim({ id: claim.id, epistemicState: 'supported', evidence: [{ id: 'doc:3#L1' }] }), /already superseded/);
  const db = new DatabaseSync(store.filename, { readOnly: true });
  assert.equal(db.prepare('SELECT epistemic_state FROM claims WHERE claim_id=?').get(claim.id).epistemic_state, 'superseded');
  assert.equal(db.prepare('SELECT new_ref FROM memory_changes WHERE claim_id=? AND change_type=?').get(claim.id, 'claim_corrected').new_ref, corrected.id);
  assert.equal(db.prepare('SELECT evidence_id FROM claim_evidence WHERE claim_id=?').get(corrected.id).evidence_id, 'doc:2#L4');
  assert.equal((await store.analyze('SELECT epistemic_state,evidence_count FROM knowledge_current_claims WHERE claim_id=$id', { $id: corrected.id })).rows[0].evidence_count, 1);
  assert.equal((await store.analyze('SELECT count(*) AS n FROM knowledge_current_claims WHERE claim_id=$id', { $id: claim.id })).rows[0].n, 0);
  db.close();
  assert.deepEqual(store.deleteEntity({id:a.id,reason:'remove entity'}),{id:a.id,deleted:false,reason:'claims_reference_entity',claimsRetained:2});
  assert.deepEqual(store.deleteRelation({id:relation.id,reason:'remove graph edge'}),{id:relation.id,deleted:true});
  assert.deepEqual(store.deleteRelation({id:relation.id}),{id:relation.id,deleted:false});
  assert.deepEqual(store.listRelations({entityID:a.id}),[]);
  const removable=store.createEntity({type:'temporary',name:'Temporary node'});
  assert.deepEqual(store.deleteEntity({id:removable.id,reason:'fixture cleanup'}),{id:removable.id,deleted:true,relationsDeleted:0});
  assert.deepEqual(store.deleteEntity({id:removable.id}),{id:removable.id,deleted:false,relationsDeleted:0});
});
test("memories retain immutable provenance revisions and explicit forgotten tombstones", async (t) => {
  const { store } = await localStore(t);
  const saved = store.createMemory({ kind: 'note', title: 'Decision', body: 'Use SQLite', provenance: { source: 'user' }, boundary: { complete: true }, actor: 'user' });
  assert.equal(saved.revision, 1);
  const updated = store.reviseMemory({ id: saved.id, expectedRevision: 1, body: 'Use one SQLite database', provenance: { source: 'user', method: 'correction' }, reason: 'clarified' });
  assert.equal(updated.revision, 2);
  assert.throws(() => store.reviseMemory({ id: saved.id, expectedRevision: 1, body: 'stale' }), /changed/);
  assert.equal(store.getMemory(saved.id).revision.body, 'Use one SQLite database');
  assert.equal(store.searchMemory('SQLite database').items[0].id, saved.id);
  assert.equal(store.searchMemory('?!?#').status, 'empty');
  assert.equal(store.searchMemory(saved.id).items[0].id, saved.id);
  assert.equal(store.forgetMemory({ id: saved.id, reason: 'requested' }).forgotten, true);
  assert.equal(store.getMemory(saved.id), null);
  assert.equal(store.searchMemory('SQLite database').items.length, 0);
  const db = new DatabaseSync(store.filename, { readOnly: true });
  assert.equal(db.prepare('SELECT status,deleted_at FROM memory_items WHERE memory_id=?').get(saved.id).status, 'forgotten');
  assert.equal(db.prepare('SELECT count(*) n FROM memory_item_revisions WHERE memory_id=?').get(saved.id).n, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_item_revisions WHERE memory_id=? AND body<>\'\'').get(saved.id).n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_search_fts WHERE memory_id=? AND body MATCH \'"SQLite"\'').get(saved.id).n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM memory_changes WHERE memory_id=? AND change_type='forgotten'").get(saved.id).n, 1);
  db.close();
});
test("legacy conversation pins become idempotent metadata-only memories with original time", async t => {
  const { store } = await localStore(t);
  const originalPinnedAt = 1_700_000_000_000;
  store.remember('p', [{ id: 'ses_saved', title: 'Saved title', time: { created: 10, updated: 20 } }]);
  const first = store.pinConversationSnapshot({ projectID:'p',sessionID:'ses_saved',title:'Saved title',originalPinnedAt,annotationRevision:3 });
  const again = store.pinConversationSnapshot({ projectID:'p',sessionID:'ses_saved',title:'Saved title',originalPinnedAt,annotationRevision:4 });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.originalPinnedAt, originalPinnedAt);
  const memory = store.getMemory(first.id);
  assert.equal(memory.revision.captureBoundary.status, 'metadata_only');
  assert.equal(memory.revision.captureBoundary.originallyPinnedAt, originalPinnedAt);
  assert.equal((await store.analyze('SELECT original_pinned_at FROM knowledge_pinned_memories WHERE memory_id=$id', { $id: first.id })).rows[0].original_pinned_at, originalPinnedAt);
  const missing = store.pinConversationSnapshot({ projectID:'p',sessionID:'ses_missing',title:'Known title',originalPinnedAt,annotationRevision:1 });
  assert.equal(missing.sourceStatus, 'missing_source');
  assert.equal(store.getMemory(missing.id).revision.captureBoundary.status, 'metadata_only');
  const db = new DatabaseSync(store.filename, { readOnly: true });
  assert.equal(db.prepare('SELECT original_pinned_at FROM memory_pins WHERE memory_id=?').get(first.id).original_pinned_at, originalPinnedAt);
  assert.equal(db.prepare("SELECT availability FROM memory_members WHERE revision_id=(SELECT revision_id FROM memory_item_revisions WHERE memory_id=?)").get(missing.id).availability, 'missing_source');
  db.close();
});
test('legacy pin import resumes by bounded batches and records terminal coverage', async t => {
  const { store } = await localStore(t);
  const db = new DatabaseSync(store.filename);
  db.prepare('INSERT INTO session_headers VALUES(?,?,?,?,?,?,?,?)').run('p','s1',null,'One',1,2,null,3);
  db.prepare('INSERT INTO session_headers VALUES(?,?,?,?,?,?,?,?)').run('p','s2',null,'Two',1,2,null,3);
  db.prepare('INSERT INTO session_annotations VALUES(?,?,?,?,?)').run('p','s1',101,null,4);
  db.prepare('INSERT INTO session_annotations VALUES(?,?,?,?,?)').run('p','s2',202,null,5);
  db.close();
  const one = store.migrateLegacyPins(1);
  assert.equal(one.status, 'incomplete');
  assert.equal(one.importedTotal, 1);
  const two = store.migrateLegacyPins(1);
  assert.equal(two.status, 'complete');
  assert.equal(two.importedTotal, 2);
  assert.deepEqual(store.migrateLegacyPins(1), { status: 'complete', imported: 2, remaining: 0 });
  const check = new DatabaseSync(store.filename, { readOnly:true });
  assert.equal(check.prepare('SELECT count(*) n FROM memory_pins').get().n,2);
  assert.equal(check.prepare('SELECT count(*) n FROM session_annotations WHERE pinned_at IS NOT NULL').get().n,0,
    'migration removes the old writable pin flags after transferring them');
  assert.equal(check.prepare('SELECT count(*) n FROM memory_migration_runs WHERE migration_id=? AND remaining_count=0').get('legacy-chat-pins-v1').n,1);
  check.close();
});
test('legacy pin reconciliation clears duplicate flags without resurrecting forgotten memories', async t => {
  const { store } = await localStore(t);
  store.remember('p',[{id:'already-pinned',title:'Existing snapshot'},{id:'forgotten',title:'Forgotten snapshot'}]);
  const existing=store.pinConversationSnapshot({projectID:'p',sessionID:'already-pinned',title:'Existing snapshot',originalPinnedAt:11});
  const forgotten=store.pinConversationSnapshot({projectID:'p',sessionID:'forgotten',title:'Forgotten snapshot',originalPinnedAt:22});
  store.forgetMemory({id:forgotten.id,reason:'forget before reconciliation'});
  const db=new DatabaseSync(store.filename);
  db.prepare('UPDATE session_annotations SET pinned_at=? WHERE project_id=? AND session_id=?').run(111,'p','already-pinned');
  db.prepare('UPDATE session_annotations SET pinned_at=? WHERE project_id=? AND session_id=?').run(222,'p','forgotten');
  db.close();
  assert.equal(store.migrateLegacyPins().status,'complete');
  const check=new DatabaseSync(store.filename,{readOnly:true});
  assert.equal(check.prepare('SELECT original_pinned_at FROM memory_pins WHERE memory_id=?').get(existing.id).original_pinned_at,11);
  assert.equal(check.prepare('SELECT count(*) n FROM memory_pins').get().n,1);
  assert.equal(check.prepare('SELECT count(*) n FROM session_annotations WHERE pinned_at IS NOT NULL').get().n,0);
  check.close();
});
test("transient SQLite locks are not reported as unavailable local data", () => {
  assert.equal(
    isLocalDataUnavailable({ code: "ERR_SQLITE_ERROR", errcode: 5, message: "database is locked" }),
    false,
  );
  assert.equal(
    isLocalDataUnavailable({ code: "ERR_SQLITE_ERROR", errcode: 6, message: "database table is locked" }),
    false,
  );
  assert.equal(
    isLocalDataUnavailable({ code: "ERR_SQLITE_ERROR", errcode: 11, message: "database disk image is malformed" }),
    true,
  );
});
test("fresh data setup leaves prior library.sqlite untouched", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-fresh-data-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = path.join(root, "library.sqlite");
  await writeFile(legacy, "do not import prior data");
  const store = createLocalDataStore(root);
  try {
    assert.equal(path.basename(store.filename), "freelancer.sqlite");
    assert.equal(store.info().schemaVersion, LOCAL_DATA_SCHEMA_VERSION);
    assert.equal(await readFile(legacy, "utf8"), "do not import prior data");
  } finally { store.close(); }
});

test("draft survives database reopen; stale revisions never replace newer text", async (t) => {
  const { root, store } = await localStore(t);
  assert.equal(store.saveDraft("project", "new", "Keep me", 0).revision, 1);
  const other = createLocalDataStore(root);
  try {
    assert.equal(other.draft("project", "new").text, "Keep me");
    assert.throws(
      () => other.saveDraft("project", "new", "Stale", 0),
      /another window/,
    );
    assert.equal(store.draft("project", "new").text, "Keep me");
  } finally {
    other.close();
  }
});
test("draft rebind is atomic and refuses a nonempty destination", async (t) => {
  const { store } = await localStore(t);
  store.saveDraft("p", "new", "Source", 0);
  store.saveDraft("p", "ses_a", "Destination", 0);
  assert.throws(
    () => store.rebindDraft("p", "new", "ses_a", 1),
    /Nothing was moved/,
  );
  assert.equal(store.draft("p", "new").text, "Source");
  const result = store.rebindDraft("p", "new", "ses_b", 1);
  assert.equal(result.origin.text, "");
  assert.equal(result.destination.text, "Source");
});
test("newer schema and corrupt databases fail closed without resetting data", async (t) => {
  const { root, store } = await localStore(t);
  store.close();
  const db = new DatabaseSync(store.filename);
  db.exec("PRAGMA user_version=99");
  db.close();
  const before = await readFile(store.filename);
  assert.throws(() => createLocalDataStore(root), /Unsupported/);
  assert.deepEqual(await readFile(store.filename), before);
  await writeFile(store.filename, "malformed private data");
  assert.throws(() => createLocalDataStore(root));
  assert.equal(
    await readFile(store.filename, "utf8"),
    "malformed private data",
  );
});
test("draft validation rejects oversized content and missing revisions", () => {
  assert.throws(
    () => draftInput({ text: "a".repeat(200001), revision: 0 }),
    /200,000/,
  );
  assert.throws(() => draftInput({ text: "x" }), /Reload/);
  assert.throws(() => draftInput({ text: {}, revision: 0 }));
});
test("archive inheritance preserves independent child state and pin ordering", () => {
  const rows = organizedSessions(
    [
      { id: "ses_parent", time: { updated: 1 } },
      { id: "ses_child", parentID: "ses_parent" },
      { id: "ses_later", time: { updated: 3 } },
    ],
    { ses_parent: { hiddenAt: 1, pinnedAt: 2 } },
  );
  assert.equal(rows[0].id, "ses_parent");
  assert.equal(
    rows.find((s) => s.id === "ses_child").organization.hiddenByParent,
    true,
  );
  assert.equal(
    rows.find((s) => s.id === "ses_later").organization.archived,
    false,
  );
});
test("numeric archive support alone does not authorize an irreversible native mutation", () => {
  assert.equal(nativeArchiveSupported({}), false);
  assert.equal(
    nativeArchiveSupported({
      paths: {
        "/session/{sessionID}": {
          patch: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    properties: {
                      time: { properties: { archived: { type: "number" } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    false,
  );
});
async function fixture(t) {
  const f = await localDataFixture();
  t.after(() => f.close());
  return f;
}
const historyQuery = (scope) =>
  `history?project=history_project&scope=${scope ?? "all"}`;
test("indexed worker hits retain identity and separate selectable parent pin and archive state", async (t) => {
  const f = await fixture(t);
  await f.api(historyQuery());
  await f.app.history.indexCurrent(f.project.id, "ses_worker", [
    { info: { id: "msg_worker", role: "user", time: { created: 300 } }, parts: [{ type: "text", text: "unique worker phrase" }] },
  ]);
  const search = () => f.api("history/search?q=unique%20worker%20phrase");
  const first = (await search()).results[0];
  assert.equal(first.session, "ses_worker");
  assert.equal(first.title, "Linked worker");
  assert.equal(first.navigationSession, "ses_history");
  assert.equal(first.navigationTitle, "Important conversation");
  assert.equal(first.organization.revision, 0);
  const pinned = await f.api("history/pin", { project: f.project.id, session: first.navigationSession, pinned: true, revision: 0 }, "PUT");
  assert.equal((await search()).results[0].organization.pinnedAt, pinned.pinnedAt);
  await f.api("history/archive", { project: f.project.id, session: first.navigationSession, archived: true, revision: pinned.revision }, "PUT");
  const pinState = new DatabaseSync(f.app.localData.get().filename,{readOnly:true});
  assert.equal(pinState.prepare('SELECT pinned_at FROM session_annotations WHERE project_id=? AND session_id=?').get(f.project.id,first.navigationSession).pinned_at,null);
  pinState.close();
  assert.equal((await search()).results[0].organization.archived, true);
});
test("archive and restore keep native history, workers, usage, source and Git settings intact", async (t) => {
  const f = await fixture(t);
  const settings = await f.store.read("settings"),
    native = await readFile(f.nativeFile),
    sessions = structuredClone(f.state.sessions);
  await f.api(historyQuery());
  await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: true,
      revision: 0,
    },
    "PUT",
  );
  assert.deepEqual(
    (await f.api(historyQuery("active"))).sessions.map((s) => s.id),
    ["ses_other"],
  );
  const archive = await f.api(historyQuery("archived"));
  assert.equal(archive.sessions[0].organization.archiveScope, "freelancer");
  await assert.rejects(
    f.app.history.ensureWritable(f.project.id, "ses_worker"),
    /archived/,
  );
  await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: false,
      revision: 1,
    },
    "PUT",
  );
  assert.equal((await f.api(historyQuery("active"))).sessions.length, 2);
  assert.deepEqual(f.state.sessions, sessions);
  assert.deepEqual(await f.store.read("settings"), settings);
  assert.deepEqual(await readFile(f.nativeFile), native);
  assert.equal(
    await readFile(path.join(f.directory, "source.txt"), "utf8"),
    "DO NOT MODIFY PROJECT FILES",
  );
  assert.equal(Object.keys((await f.store.read("usage")).records).length, 0);
});
test("active worker, unknown status and approvals block archive without aborting anything", async (t) => {
  const f = await fixture(t);
  const archive = () =>
    f.api(
      "history/archive",
      {
        project: f.project.id,
        session: "ses_history",
        archived: true,
        revision: 0,
      },
      "PUT",
    );
  f.state.status.ses_worker = { type: "busy" };
  await assert.rejects(archive(), /Finish or stop/);
  f.state.status = {};
  f.state.questions = [{ sessionID: "ses_worker" }];
  await assert.rejects(archive(), /pending/);
  f.state.questions = [];
  f.state.status = [];
  await assert.rejects(archive(), /unavailable/);
  assert.equal(
    f.calls.some((c) => c.route.endsWith("/abort")),
    false,
  );
});
test("queued delivery blocks archive and cannot be silently cancelled", async (t) => {
  const f = await fixture(t);
  f.state.status.ses_history = { type: "busy" };
  await f.sender.enqueue(f.project.id, "ses_history", {
    id: "history_queue_0001",
    kind: "queue",
    text: "Next turn",
    model: "opencode/free",
    agentID: "inherit",
    variant: "",
  });
  // Keep native execution busy so the real sender timer cannot drain this queue
  // while the archive request waits under a heavily loaded test run.
  await assert.rejects(
    f.api(
      "history/archive",
      {
        project: f.project.id,
        session: "ses_history",
        archived: true,
        revision: 0,
      },
      "PUT",
    ),
    /queued or uncertain/,
  );
  assert.equal(
    (await f.sender.list(f.project.id, "ses_history"))[0].text,
    "Next turn",
  );
});
test("project archive is reversible without changing the project registration or individual chat archives", async (t) => {
  const f = await fixture(t);
  await f.api(historyQuery());
  await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: true,
      revision: 0,
    },
    "PUT",
  );
  const rebuildFiles = f.app.rebuildContentIndex.bind(f.app);
  const rebuildChats = f.app.history.rebuildChatSearch.bind(f.app.history);
  f.app.rebuildContentIndex = options => options?.includeArchivedProject
    ? Promise.resolve({ projects: 1, sources: 0, units: 0, failures: [] }) : rebuildFiles(options);
  f.app.history.rebuildChatSearch = options => options?.includeArchivedProject
    ? Promise.resolve({ projects: 1, conversations: 0, messages: 0, failures: [] }) : rebuildChats(options);
  const before = await f.store.read("settings");
  await f.api(
    "history/project",
    { project: f.project.id, archived: true, revision: 0 },
    "PUT",
  );
  const registered = (await f.store.read("settings")).projects;
  assert.deepEqual(f.app.history.projectsToIndex(registered), [], 'global refreshes omit put-away projects');
  assert.throws(() => f.app.history.projectsToIndex(registered, f.project.id), /Restore this project/);
  assert.deepEqual(f.app.history.projectsToIndex(registered, f.project.id, true).map(row => row.id), [f.project.id],
    'the final pre-archive indexing pass may include its target');
  assert.equal((await f.app.rebuildContentIndex()).projects, 0, 'global file rebuild skips archived projects');
  assert.equal((await f.app.history.rebuildChatSearch()).projects, 0, 'global conversation rebuild skips archived projects');
  await assert.rejects(f.app.rebuildContentIndex({ projectID: f.project.id }), /Restore this project/);
  await assert.rejects(f.app.history.rebuildChatSearch({ projectID: f.project.id }), /Restore this project/);
  const beforeArchivedChatRead = f.app.localData.get().indexStats().chatMessages.messages;
  assert.equal(await f.app.history.indexCurrent(f.project.id, "ses_history", f.state.messages.ses_history), false,
    'opening an archived chat does not refresh its search copy');
  assert.equal(f.app.localData.get().indexStats().chatMessages.messages, beforeArchivedChatRead);
  await assert.rejects(
    f.api("chats", { project: f.project.id }),
    /Restore this project/,
  );
  assert.equal(
    (await f.api("bootstrap?project=" + f.project.id)).project.organization
      .archivedAt > 0,
    true,
  );
  await f.api(
    "history/project",
    { project: f.project.id, archived: false, revision: 1 },
    "PUT",
  );
  assert.deepEqual(f.app.history.projectsToIndex(registered).map(row => row.id), [f.project.id],
    'restored projects rejoin future refreshes');
  assert.equal(
    (await f.api(historyQuery("archived"))).sessions[0].id,
    "ses_history",
  );
  assert.deepEqual(await f.store.read("settings"), before);
});
test("pin is revision checked and survives reopening the data service", async (t) => {
  const f = await fixture(t);
  await f.api(historyQuery());
  await f.api(
    "history/pin",
    {
      project: f.project.id,
      session: "ses_history",
      pinned: true,
      revision: 0,
    },
    "PUT",
  );
  const pinned = new DatabaseSync(f.app.localData.get().filename, { readOnly: true });
  assert.equal(pinned.prepare('SELECT count(*) n FROM memory_pins').get().n, 1);
  assert.equal(pinned.prepare("SELECT source_session_id FROM memory_items WHERE kind='conversation_snapshot'").get().source_session_id, 'ses_history');
  assert.equal(pinned.prepare('SELECT pinned_at FROM session_annotations WHERE project_id=? AND session_id=?').get(f.project.id,'ses_history').pinned_at,null,
    'the compatibility annotation row no longer stores a second writable pin flag');
  pinned.close();
  f.app.history.close();
  assert.equal((await f.api(historyQuery())).sessions[0].id, "ses_history");
  await assert.rejects(
    f.api(
      "history/pin",
      {
        project: f.project.id,
        session: "ses_history",
        pinned: false,
        revision: 0,
      },
      "PUT",
    ),
    /changed/,
  );
  const annotation = f.app.localData.get().annotation(f.project.id,'ses_history');
  const unpinned = await f.api('history/pin',{project:f.project.id,session:'ses_history',pinned:false,revision:annotation.revision},'PUT');
  assert.equal(unpinned.pinnedAt,null);
  assert.equal(f.app.localData.get().getMemory(`conversation:${f.project.id}:ses_history`).status,'active',
    'unpin removes priority but retains the saved conversation memory');
  assert.equal(f.app.localData.get().memoryStatus().pinned,0);
});
test('forgetting an imported pin cannot make the legacy annotation pin reappear', async t => {
  const { store } = await localStore(t);
  store.remember('p',[{id:'s',title:'Saved'}]);
  store.annotate('p','s',{pinnedAt:123},0);
  assert.equal(store.migrateLegacyPins().status,'complete');
  const itemID='conversation:p:s';
  assert.equal(store.annotation('p','s').pinnedAt !== null,true);
  assert.equal(store.forgetMemory({id:itemID,reason:'user requested forgetting'}).forgotten,true);
  assert.equal(store.annotation('p','s').pinnedAt,null);
  assert.equal(store.memoryStatus().pinned,0);
});
test("native archive is used only with explicit clear support and is verified afterward", async (t) => {
  const f = await fixture(t);
  f.state.nativeArchive = true;
  const result = await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: true,
      revision: 0,
    },
    "PUT",
  );
  assert.equal(result.scope, "opencode");
  assert.ok(f.state.sessions[0].time.archived);
  await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: false,
      revision: 1,
    },
    "PUT",
  );
  assert.equal(f.state.sessions[0].time.archived, null);
});
test("cross-project session ownership is checked for organization, drafts and exports", async (t) => {
  const f = await fixture(t);
  f.state.sessions.push({
    id: "ses_foreign",
    directory: f.root,
    title: "Foreign",
  });
  assert.equal(
    (await f.api(historyQuery())).sessions.some((s) => s.id === "ses_foreign"),
    false,
  );
  for (const route of ["history/pin", "history/archive", "drafts"])
    await assert.rejects(
      f.api(
        route,
        {
          project: f.project.id,
          session: "ses_foreign",
          pinned: true,
          archived: true,
          revision: 0,
          text: "private",
        },
        "PUT",
      ),
      /another project/,
    );
  await assert.rejects(
    f.api("history/export", {
      project: f.project.id,
      sessions: ["ses_foreign"],
      format: "json",
      includeWorkers: false,
    }),
    /another project/,
  );
});
test("history can load beyond the old 1000-item window and exposes its coverage", async (t) => {
  const f = await fixture(t);
  f.state.sessions = Array.from({ length: 1100 }, (_, i) => ({
    id: "ses_" + i,
    directory: f.directory,
    title: "History " + i,
    time: { updated: i },
  }));
  const first = await f.api(historyQuery() + "&limit=1000");
  assert.equal(first.hasMore, true);
  assert.equal(first.sessions.length, 1000);
  const second = await f.api(historyQuery() + "&limit=2000");
  assert.equal(second.sessions.length, 1100);
  assert.match(second.coverage, /not a complete backup/);
  f.state.unavailable = true;
  await assert.rejects(f.api(historyQuery()), /unavailable/);
});
test("native JSON and Markdown exports include chosen workers without importing auth, files or drafts", async (t) => {
  const f = await fixture(t);
  await f.api(
    "drafts",
    {
      project: f.project.id,
      session: "ses_history",
      text: "UNSENT PRIVATE DRAFT",
      revision: 0,
    },
    "PUT",
  );
  const json = await f.api("history/export", {
    project: f.project.id,
    sessions: ["ses_history"],
    format: "json",
    includeWorkers: true,
  });
  const bundle = JSON.parse(json.content);
  assert.deepEqual(
    bundle.sessions.map((s) => s.info.id),
    ["ses_history", "ses_worker"],
  );
  assert.equal(
    bundle.sessions[0].messages[0].parts[0].text,
    "Original conversation text",
  );
  assert.match(bundle.notice, /not a full backup/);
  assert.doesNotMatch(json.content, /UNSENT PRIVATE DRAFT|DO NOT MODIFY/);
  const md = await f.api("history/export", {
    project: f.project.id,
    sessions: ["ses_history"],
    format: "markdown",
    includeWorkers: false,
  });
  assert.match(md.content, /Original conversation text/);
  assert.doesNotMatch(md.content, /Linked worker/);
});
test("data paths are resolved without guessing native location and Open folder is a fixed allowlist", async (t) => {
  const f = await fixture(t);
  const info = await f.api("storage");
  assert.equal(
    info.locations.find((l) => l.id === "native").path,
    f.nativeFile,
  );
  assert.match(info.locations[0].path, /user-data/);
  await assert.rejects(
    f.api("storage/open", { location: "../../anything" }),
    /Choose an available/,
  );
});
test("draft HTTP revisions preserve text after reload and reject stale tabs", async (t) => {
  const f = await fixture(t);
  await f.api(
    "drafts",
    {
      project: f.project.id,
      session: "",
      text: "New conversation draft",
      revision: 0,
    },
    "PUT",
  );
  f.app.history.close();
  const read = await f.api("drafts?project=" + f.project.id);
  assert.equal(read.text, "New conversation draft");
  await assert.rejects(
    f.api(
      "drafts",
      { project: f.project.id, session: "", text: "Stale tab", revision: 0 },
      "PUT",
    ),
    (e) => e.status === 409,
  );
});
test("history writes retain existing HTTP cross-origin protection", async (t) => {
  const f = await fixture(t);
  const response = await fetch(f.url + "/api/history/project", {
    method: "PUT",
    headers: {
      Origin: "https://foreign.example",
      "X-Freelancer-Client": "webpage",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project: f.project.id,
      archived: true,
      revision: 0,
    }),
  });
  assert.equal(response.status, 403);
});
test("native data commands are read-only fixed argv in the same environment", async () => {
  const calls = [],
    env = { XDG_DATA_HOME: "/native-home" };
  const tools = nativeDataTools({
    executable: "/native/opencode",
    env,
    execute: async (...args) => {
      calls.push(args);
      return {
        stdout:
          args[1][0] === "db"
            ? path.resolve("/native/opencode.db")
            : JSON.stringify({ info: { id: "ses_safe" }, messages: [] }),
      };
    },
  });
  await tools.exportSession("ses_safe", path.resolve("/project"));
  await tools.databasePath();
  assert.deepEqual(
    calls.map((c) => c[1]),
    [
      ["export", "ses_safe"],
      ["db", "path"],
    ],
  );
  assert.equal(calls[0][2].env, env);
  await assert.rejects(
    tools.exportSession("ses_safe; rm -rf /", "/project"),
    /Choose/,
  );
});
test("explicit per-user data location must be absolute", () => {
  assert.throws(
    () => resolveDataRoot({ FREELANCER_DATA_HOME: "relative" }),
    /absolute/,
  );
  assert.equal(
    resolveDataRoot({ FREELANCER_DATA_HOME: path.resolve("/test-local") }),
    path.resolve("/test-local"),
  );
  assert.equal(
    resolveDataRoot({}, "win32", "C:\\Users\\Example"),
    path.join("C:\\Users\\Example", "AppData", "Local", "Freelancer", "workspace-v2"),
  );
  assert.equal(
    resolveDataRoot({}, "darwin", "/Users/example"),
    path.join("/Users/example", "Library", "Application Support", "Freelancer", "workspace-v2"),
  );
});

test("archive fences the prompt acknowledgement gap and never cancels native work", async (t) => {
  const f = await fixture(t);
  let release;
  f.state.holdPrompt = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const sending = f.api("send", {
      project: f.project.id,
      session: "ses_history",
      text: "Request",
      model: "opencode/free",
      variant: "",
      agentID: "inherit",
    });
    while (!f.calls.some((c) => c.route.endsWith("/prompt_async")))
      await new Promise((resolve) => setTimeout(resolve, 2));
    const archiving = f.api(
      "history/archive",
      {
        project: f.project.id,
        session: "ses_history",
        archived: true,
        revision: 0,
      },
      "PUT",
    );
    // Attach rejection handling immediately so a fail-closed response cannot
    // become an unhandled rejection while the sender acknowledgement is held.
    const rejected = assert.rejects(archiving, /running chats|queued/);
    release();
    await sending;
    await rejected;
    assert.ok(!f.calls.some((c) => c.route.endsWith("/abort")));
    assert.equal(
      (await f.api(historyQuery())).sessions.find((s) => s.id === "ses_history")
        .organization.archived,
      false,
    );
  } finally {
    release();
  }
});

test("native archive acknowledgement without actual state change is not reported successful", async (t) => {
  const f = await fixture(t);
  f.state.nativeArchive = true;
  const original = f.host.request;
  f.host.request = async (route, options) =>
    options?.method === "PATCH"
      ? f.state.sessions[0]
      : original(route, options);
  await assert.rejects(
    f.api(
      "history/archive",
      {
        project: f.project.id,
        session: "ses_history",
        archived: true,
        revision: 0,
      },
      "PUT",
    ),
    /did not confirm/,
  );
  assert.equal(
    (await f.api(historyQuery())).sessions.find((s) => s.id === "ses_history")
      .organization.archived,
    false,
  );
});

test("history project HTTP rejects conflicting query and body project IDs", async (t) => {
  const f = await localDataFixture();
  t.after(() => f.close());
  const response = await fetch(`${f.url}/api/history/project?project=${f.project.id}`, {
    method: "PUT",
    headers: { "X-Freelancer-Client": "webpage", "Content-Type": "application/json" },
    body: JSON.stringify({ project: "another-project", archived: true, revision: 0 }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /does not match/);
  assert.notEqual((await f.api(`history?project=${f.project.id}`)).sessions[0].organization.projectArchived, true);
});

test("native export and database discovery fail without invented results", async (t) => {
  const f = await fixture(t);
  f.host.exportSession = undefined;
  f.host.databasePath = undefined;
  await assert.rejects(
    f.api("history/export", {
      project: f.project.id,
      sessions: ["ses_history"],
      format: "json",
      includeWorkers: false,
    }),
    /export is unavailable/,
  );
  const result = await f.api("storage");
  assert.equal(result.locations.find((l) => l.id === "native").path, null);
  assert.match(result.nativeWarning, /No location was guessed/);
});

test("export failure on a worker never returns a falsely complete conversation bundle", async (t) => {
  const f = await fixture(t);
  const exported = f.host.exportSession;
  f.host.exportSession = async (id, dir) => {
    if (id === "ses_worker") throw Error("Worker export unavailable");
    return exported(id, dir);
  };
  await assert.rejects(
    f.api("history/export", {
      project: f.project.id,
      sessions: ["ses_history"],
      format: "json",
      includeWorkers: true,
    }),
    /Worker export unavailable/,
  );
});

test("SQLite foreign-key failures roll back annotations and preserve existing drafts", async (t) => {
  const { store, root } = await localStore(t);
  store.saveDraft("p", "new", "Safe text", 0);
  assert.throws(
    () => store.annotate("p", "ses_missing", { pinnedAt: 1 }, 0),
    /FOREIGN KEY/,
  );
  assert.deepEqual(store.annotation("p", "ses_missing"), {
    pinnedAt: null,
    hiddenAt: null,
    revision: 0,
  });
  store.close();
  const reopened = createLocalDataStore(root);
  try {
    assert.equal(reopened.draft("p", "new").text, "Safe text");
  } finally {
    reopened.close();
  }
});

test("a foreign SQLite application ID is rejected even with an empty version-zero schema", async (t) => {
  const { root, store } = await localStore(t);
  const filename = store.filename;
  store.close();
  await rm(filename);
  const foreign = new DatabaseSync(filename);
  foreign.exec("PRAGMA application_id=1234");
  foreign.close();
  const before = await readFile(filename);
  assert.throws(() => createLocalDataStore(root), /Unsupported/);
  assert.deepEqual(await readFile(filename), before);
});
