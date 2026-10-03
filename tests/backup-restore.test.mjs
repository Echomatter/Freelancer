import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { backupLocalData, restoreLocalData } from '../server/data/backup.mjs';
import { createLocalDataStore, assertFreshRuntimeRoot } from '../server/data/store.mjs';
import { FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';
import { acknowledgeRestoreRecovery, readRestoreRecoveryState } from '../server/data/recovery.mjs';

test('restore rebinds fresh runtime identity and records immutable source evidence without replaying uncertain work', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-explicit-restore-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  const source = path.join(root, 'source-data');
  const bundle = path.join(root, 'verified-backup');
  const restored = path.join(root, 'restored-data');
  const store = createLocalDataStore(source);
  store.initializeFreshRuntime(FRESH_RUNTIME_ID);
  const writer = new DatabaseSync(store.filename);
  for (const [collection,id,status] of [
    ['requests','uncertain-request','uncertain'],
    ['git_projects','pending-git-action','pending'],
    ['scheduled_goals','running-goal','running'],
  ]) writer.prepare(`INSERT INTO operational_records(runtime_id,collection,id,project_id,session_id,data,summary)
    VALUES(?,?,?,NULL,NULL,?,?)`).run(FRESH_RUNTIME_ID,collection,id,JSON.stringify({id,status}), '{}');
  writer.close();
  const original = new DatabaseSync(store.filename, { readOnly:true });
  const beforeRuntime = original.prepare('SELECT source_path,source_sha256 FROM runtime_instances WHERE runtime_id=?').get(FRESH_RUNTIME_ID);
  const beforeBootstrap = original.prepare('SELECT manifest_json FROM data_migration_runs WHERE migration_id=?').get(`fresh-runtime:${FRESH_RUNTIME_ID}`);
  original.close();
  store.close();

  const backup = await backupLocalData(source, bundle, { quiesced:true });
  for (const table of ['memory_item_revisions','memory_members','memory_capture_jobs','memory_changes',
      'entities','entity_aliases','entity_relations','entity_relation_revisions','judgment_definitions','judgment_runs',
      'judgment_results','content_source_revisions','content_unit_revisions','opencode_session_revisions',
      'opencode_message_revisions','opencode_ingest_runs','opencode_ingest_cursors','opencode_ingest_failures'])
    assert.ok(Number.isSafeInteger(backup.manifest.database.counts[table]),`${table} is inventoried with an exact row count`);
  assert.equal(readRestoreRecoveryState(source).automaticWorkBlocked,false);
  const backupManifestBytes = await readFile(path.join(bundle,'manifest.json'));
  const backupManifestSha256 = createHash('sha256').update(backupManifestBytes).digest('hex');
  const restoredResult = await restoreLocalData(bundle, restored, { quiesced:true });
  assert.equal(restoredResult.status, 'verified');
  assert.equal(restoredResult.restore.status, 'explicit-restore');
  assert.equal(restoredResult.restore.sourceManifestSha256, backupManifestSha256);
  const recovery=readRestoreRecoveryState(restored);
  assert.equal(recovery.required,true);
  assert.equal(recovery.automaticWorkBlocked,true);
  assert.equal(recovery.reason,'explicit-restore-requires-manual-recovery');
  assert.equal(recovery.restoreID,restoredResult.restore.id);
  assert.equal(recovery.restore.id,restoredResult.restore.id);
  assert.equal(recovery.restore.sourceManifestSha256,backupManifestSha256);
  assert.equal(recovery.restore.runtimeID,FRESH_RUNTIME_ID);
  assert.ok(Number.isFinite(recovery.restore.restoredAt));
  const released=acknowledgeRestoreRecovery({dataHome:restored,restoreID:restoredResult.restore.id});
  assert.equal(released.reviewed,true);
  assert.equal(released.automaticWorkBlocked,false);
  assert.throws(()=>acknowledgeRestoreRecovery({dataHome:restored,restoreID:'explicit-restore:stale'}),{status:409});
  assert.equal(await readFile(path.join(bundle,'manifest.json'),'utf8'), backupManifestBytes.toString('utf8'));

  assertFreshRuntimeRoot(restored, FRESH_RUNTIME_ID);
  const db = new DatabaseSync(path.join(restored,'freelancer.sqlite'), { readOnly:true });
  const runtime = db.prepare('SELECT source_path,source_sha256 FROM runtime_instances WHERE runtime_id=?').get(FRESH_RUNTIME_ID);
  assert.equal(runtime.source_path, path.resolve(restored));
  assert.notEqual(runtime.source_path, beforeRuntime.source_path);
  const bootstrap = db.prepare('SELECT status,source_path,source_sha256,manifest_json FROM data_migration_runs WHERE migration_id=?')
    .get(`fresh-runtime:${FRESH_RUNTIME_ID}`);
  assert.equal(bootstrap.status, 'fresh-bootstrap');
  assert.equal(bootstrap.source_path, path.resolve(restored));
  assert.equal(bootstrap.source_sha256, runtime.source_sha256);
  const restoreEvent = db.prepare('SELECT source_path,source_sha256,status,manifest_json FROM data_migration_runs WHERE migration_id=?')
    .get(restoredResult.restore.id);
  assert.equal(restoreEvent.status, 'explicit-restore');
  assert.equal(restoreEvent.source_sha256, backupManifestSha256);
  assert.equal(restoreEvent.source_path, beforeRuntime.source_path);
  const event = JSON.parse(restoreEvent.manifest_json);
  assert.equal(event.sourceRuntime.sourceSha256, beforeRuntime.source_sha256);
  assert.deepEqual(event.sourceBootstrapManifest, JSON.parse(beforeBootstrap.manifest_json));
  assert.equal(event.automaticReplay, false);
  assert.equal(event.uncertainOperationsPreserved, true);
  assert.deepEqual(db.prepare(`SELECT collection,id,json_extract(data,'$.status') AS status FROM operational_records
    WHERE runtime_id=? ORDER BY collection,id`).all(FRESH_RUNTIME_ID).map(row=>({...row})), [
    { collection:'git_projects',id:'pending-git-action',status:'pending' },
    { collection:'requests',id:'uncertain-request',status:'uncertain' },
    { collection:'scheduled_goals',id:'running-goal',status:'running' },
  ]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();
  assert.equal(backup.manifest.database.operational['requests:uncertain'], 1);
});

test('restore review is monotonic and cannot release background work for a later restore', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-restore-review-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source'),bundle=path.join(root,'bundle'),first=path.join(root,'first'),second=path.join(root,'second');
  const store=createLocalDataStore(source);
  store.initializeFreshRuntime(FRESH_RUNTIME_ID);
  store.close();
  await backupLocalData(source,bundle,{quiesced:true});
  const firstRestore=await restoreLocalData(bundle,first,{quiesced:true});
  const reviewed=acknowledgeRestoreRecovery({dataHome:first,restoreID:firstRestore.restore.id});
  assert.equal(reviewed.automaticWorkBlocked,false);
  const secondRestore=await restoreLocalData(bundle,second,{quiesced:true});
  assert.notEqual(secondRestore.restore.id,firstRestore.restore.id);
  assert.equal(readRestoreRecoveryState(second).automaticWorkBlocked,true);
  assert.throws(()=>acknowledgeRestoreRecovery({dataHome:second,restoreID:firstRestore.restore.id}),{status:409});
  assert.equal(readRestoreRecoveryState(second).automaticWorkBlocked,true);
});
