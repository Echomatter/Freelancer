import path from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { LOCAL_DATA_SCHEMA_VERSION } from '../../shared/data-contract.mjs';

const APP_ID=1414482766;
const conflict=message=>Object.assign(Error(message),{status:409});

/**
 * Explicitly restored workspaces stay fail-closed for background dispatch.
 * The restore event is durable in data_migration_runs, so restarting the web
 * server cannot silently re-enable sender, goal, or schedule timers.
 */
export function readRestoreRecoveryState(dataHome) {
  if (typeof dataHome!=='string'||!path.isAbsolute(dataHome)) throw Error('Restore recovery requires an absolute data home.');
  dataHome=path.resolve(dataHome);
  if (!existsSync(dataHome)) return {required:false,automaticWorkBlocked:false,restoreID:null,restore:null};
  const root=lstatSync(dataHome);
  if (!root.isDirectory()||root.isSymbolicLink()) throw Error('Restore recovery data home must be a regular directory.');
  const filename=path.join(dataHome,'freelancer.sqlite');
  if (!existsSync(filename)) return {required:false,automaticWorkBlocked:false,restoreID:null,restore:null};
  const database=lstatSync(filename);
  if (!database.isFile()||database.isSymbolicLink()) throw Error('Restore recovery database must be a regular file.');
  const db=new DatabaseSync(filename,{readOnly:true});
  try {
    if(db.prepare('PRAGMA application_id').get().application_id!==APP_ID||
        db.prepare('PRAGMA user_version').get().user_version!==LOCAL_DATA_SCHEMA_VERSION)
      throw Error('Restore recovery requires the registered current Freelancer schema.');
    const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='data_migration_runs'").get();
    if (!table) return {required:false,automaticWorkBlocked:false,restoreID:null,restore:null};
    const row=db.prepare(`SELECT migration_id AS id,source_path AS sourcePath,source_app_id AS sourceAppId,
      source_schema_version AS sourceSchemaVersion,source_sha256 AS sourceManifestSha256,started_at AS restoredAt,manifest_json AS manifestJSON
      FROM data_migration_runs WHERE status='explicit-restore' ORDER BY started_at DESC,migration_id DESC LIMIT 1`).get();
    if (!row) return {required:false,automaticWorkBlocked:false,restoreID:null,restore:null};
    let manifest;
    try { manifest=JSON.parse(row.manifestJSON); }
    catch { throw Error('Explicit restore record is invalid; background work remains blocked.'); }
    if (manifest?.mode!=='explicit-restore'||manifest?.automaticReplay!==false||manifest?.uncertainOperationsPreserved!==true)
      throw Error('Explicit restore record lacks its no-replay safety contract; background work remains blocked.');
    const reviewRow=db.prepare('SELECT manifest_json AS manifestJSON,completed_at AS reviewedAt FROM data_migration_runs WHERE migration_id=? AND status=?')
      .get(`restore-recovery:${row.id}`,'restore-recovery-authorized');
    let reviewed=false;
    if(reviewRow) {
      let review;
      try { review=JSON.parse(reviewRow.manifestJSON); } catch { throw Error('Restore recovery review record is invalid; background work remains blocked.'); }
      reviewed=review?.mode==='restore-recovery-review'&&review.restoreID===row.id&&
        review.sourceManifestSha256===row.sourceManifestSha256&&review.automaticResumeAuthorized===true;
    }
    return {
      required:true,
      automaticWorkBlocked:!reviewed,
      reviewed,
      restoreID:row.id,
      reason:reviewed?'restore-recovery-reviewed':'explicit-restore-requires-manual-recovery',
      restore:{id:row.id,sourceManifestSha256:row.sourceManifestSha256,restoredAt:row.restoredAt,reviewedAt:reviewed?reviewRow.reviewedAt:null,
        runtimeID:manifest.restoredRuntime?.runtimeID??null},
    };
  } finally { db.close(); }
}

/** Explicitly release background continuation for the exact current restore. */
export function acknowledgeRestoreRecovery({dataHome,restoreID}={}) {
  if (typeof dataHome!=='string'||!path.isAbsolute(dataHome)||typeof restoreID!=='string'||!restoreID.startsWith('explicit-restore:'))
    throw Error('Restore review requires the current restore identity and an absolute data home.');
  dataHome=path.resolve(dataHome);
  const root=lstatSync(dataHome),filename=path.join(dataHome,'freelancer.sqlite');
  if(!root.isDirectory()||root.isSymbolicLink()) throw Error('Restore recovery data home must be a regular directory.');
  const database=lstatSync(filename);
  if(!database.isFile()||database.isSymbolicLink()) throw Error('Restore recovery database must be a regular file.');
  const db=new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const latest=db.prepare(`SELECT * FROM data_migration_runs WHERE status='explicit-restore'
      ORDER BY started_at DESC,migration_id DESC LIMIT 1`).get();
    if(!latest||latest.migration_id!==restoreID) throw conflict('This restore was superseded. Reload recovery status before continuing.');
    const existing=db.prepare('SELECT status,source_sha256,manifest_json FROM data_migration_runs WHERE migration_id=?').get(`restore-recovery:${restoreID}`);
    if(existing) {
      let parsed;
      try { parsed=JSON.parse(existing.manifest_json); } catch {}
      if(existing.status!=='restore-recovery-authorized'||existing.source_sha256!==latest.source_sha256||
          parsed?.restoreID!==restoreID||parsed?.sourceManifestSha256!==latest.source_sha256||parsed?.automaticResumeAuthorized!==true)
        throw Error('Restore recovery review record conflicts with the selected restore.');
      db.exec('COMMIT');
      return readRestoreRecoveryState(dataHome);
    }
    const now=Date.now(),reviewID=`restore-recovery:${restoreID}`;
    db.prepare(`INSERT INTO data_migration_runs
      (migration_id,source_path,source_app_id,source_schema_version,source_sha256,status,manifest_json,started_at,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(reviewID,path.resolve(dataHome),APP_ID,latest.source_schema_version,latest.source_sha256,
      'restore-recovery-authorized',JSON.stringify({mode:'restore-recovery-review',restoreID,sourceManifestSha256:latest.source_sha256,
        automaticResumeAuthorized:true,reviewedAt:now,reviewNonce:randomUUID()}),now,now);
    db.exec('COMMIT');
    return readRestoreRecoveryState(dataHome);
  } catch(error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { db.close(); }
}
