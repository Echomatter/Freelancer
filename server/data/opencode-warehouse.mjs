import { createHash, randomUUID } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const clip = (value, limit) => String(value ?? '').slice(0,limit);
const sensitiveKey = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret|authorization)/i;
function safeValue(value, depth = 0) {
  if (depth > 12) return '[depth-limit]';
  if (typeof value === 'string') return clip(value.replace(/\bBearer\s+[^\s"']+/gi,'Bearer [redacted]'),100_000);
  if (Array.isArray(value)) return value.slice(0,500).map(item => safeValue(item,depth+1));
  if (!value || typeof value !== 'object') return value;
  const result={};
  for (const [key,item] of Object.entries(value)) {
    if (sensitiveKey.test(key)) continue;
    if (key==='data' && typeof item==='string' && item.startsWith('data:')) continue;
    result[key]=safeValue(item,depth+1);
  }
  return result;
}
const canonical = value => JSON.stringify(value,(_key,item)=>
  item && typeof item==='object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
const timestamp = value => {
  if (Number.isFinite(value)) return Math.trunc(value);
  if (typeof value==='string') { const parsed=Date.parse(value); if(Number.isFinite(parsed)) return parsed; }
  return null;
};
function safeParts(parts) {
  const kept=[], omittedTypes={};
  for (let ordinal=0;ordinal<Math.min(parts.length,500);ordinal++) {
    const part=parts[ordinal]; if(!part||typeof part!=='object') continue;
    const type=String(part.type??'unknown'), id=typeof part.id==='string'?part.id:'';
    let value;
    if(type==='text') value={id,type,text:clip(part.text,500_000),truncated:String(part.text??'').length>500_000};
    else if(type==='tool') {
      const state=part.state&&typeof part.state==='object'?part.state:{};
      value={id,type,callID:clip(part.callID,500),tool:clip(part.tool,300),
        state:{status:clip(state.status,100),title:clip(state.title,1000),time:safeValue(state.time??{}),
          input:safeValue(state.input??{}),output:safeValue(state.output??{}),error:clip(state.error,10_000)}};
    } else if(type==='file') {
      const data=typeof part.data==='string'?part.data:'',url=typeof part.url==='string'?part.url:'';
      value={id,type,mime:clip(part.mime,300),filename:clip(part.filename??part.name,1000),
        source:safeValue(part.source ?? null),referenceSha256:url?hash(url):null,
        referenceKind:url.startsWith('data:')?'data-url':url?'external-reference':null,
        payloadSha256:data?hash(data):null,payloadBytes:data?Buffer.byteLength(data):null,
        availability:'metadata-only'};
    } else if(type==='patch') {
      const text=String(part.text??part.patch??'');
      value={id,type,text:clip(text,200_000),sha256:hash(text),truncated:text.length>200_000};
    } else if(type==='step-start') value={id,type,partID:clip(part.partID,500),snapshot:clip(part.snapshot,1000)};
    else if(type==='step-finish') value={id,type,reason:clip(part.reason,200),cost:Number.isFinite(part.cost)?part.cost:null,
      tokens:safeValue(part.tokens??{}),summary:clip(part.summary,2000)};
    else { omittedTypes[type]=(omittedTypes[type]??0)+1; continue; }
    kept.push({ordinal,...value});
  }
  if(parts.length>500) omittedTypes['[part-limit]']=parts.length-500;
  return {parts:kept,omittedTypes};
}
function safeInfo(info) {
  const value={};
  for(const key of ['id','role','parentID','providerID','modelID','agent','mode','time','cost','tokens','finish','summary','error'])
    if(info[key]!==undefined) value[key]=safeValue(info[key]);
  if(info.model!==undefined) value.model=safeValue(info.model);
  return value;
}

export function openCodeSourceIdentity(databasePath) {
  const locator=typeof databasePath==='string'&&databasePath.trim()?databasePath.trim():'opencode-api-default';
  const locatorKey = process.platform === 'win32' ? locator.toLowerCase() : locator;
  const locatorSha256=hash(locatorKey);
  return {sourceSystemID:`opencode:${locatorSha256.slice(0,32)}`,locatorSha256};
}

/** Build proof for an unpaginated message list belonging to an archived session. */
export function openCodeSnapshotProof(session, messages) {
  const archivedAt=timestamp(session?.time?.archived);
  if (typeof session?.id!=='string'||!session.id||archivedAt===null||!Array.isArray(messages)||messages.length>5000) return null;
  const messageIDs=messages.map(row=>typeof row?.info?.id==='string'?row.info.id:null);
  return {kind:'opencode-archived-session-messages',sessionID:session.id,archivedAt,
    messageCount:messages.length,messageIDsSha256:hash(canonical(messageIDs))};
}

const derivationVersion = 'chat-search-v1';
const projectionMemberLimit = 5000;
const projectionByteLimit = 8 * 1024 * 1024;
const refreshReasons = new Set(['event-hint','snapshot-failed','stream-failed','stream-ended','overflow','unaddressable-hint','reconnect','manual']);
const boundedLimit = value => Math.max(1,Math.min(500,Math.floor(Number(value)||50)));
const retryAt = (attempts, now) => now + Math.min(60_000,1000 * 2 ** Math.min(6,Math.max(0,attempts-1)));
const safeWorkError = error => {
  const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,80}$/.test(error.code)?` (${error.code})`:'';
  const status=Number.isInteger(error?.status)&&error.status>=300&&error.status<=599?` (HTTP ${error.status})`:'';
  return `Warehouse work failed; retry requires a valid source and project.${code}${status}`;
};
function scopeIdentity(sourceID, projectID=null, sessionID=null) {
  if(typeof sourceID!=='string'||!sourceID.startsWith('opencode:')||sourceID.length>200)
    throw Error('A stable OpenCode source identity is required.');
  for(const [name,value] of [['project',projectID],['session',sessionID]])
    if(value!==null&&(typeof value!=='string'||!value||value.length>200)) throw Error(`A bounded ${name} identity is required.`);
  if(sessionID!==null&&projectID===null) throw Error('A session refresh hint requires its registered project identity.');
  return {sourceID,projectID,sessionID};
}
const jobColumns = `job_id AS id,source_system_id AS sourceID,project_id AS projectID,session_id AS sessionID,
  snapshot_revision_sha256 AS snapshotRevisionSha256,derivation_version AS derivationVersion,
  publication_revision AS publicationRevision,revision_token AS revisionToken,status,blocked_reason AS blockedReason,
  attempts,next_attempt_at AS nextAttemptAt,error,created_at AS createdAt,updated_at AS updatedAt,completed_at AS completedAt`;
const refreshColumns = `refresh_id AS id,source_system_id AS sourceID,project_id AS projectID,session_id AS sessionID,
  revision,state,reason,attempts,next_attempt_at AS nextAttemptAt,error,created_at AS createdAt,updated_at AS updatedAt,cleared_at AS clearedAt`;

export function createOpenCodeWarehouse(db,tx) {
  const capture=db.prepare(`INSERT INTO opencode_sources(source_system_id,locator_sha256,api_version,first_seen_at,last_seen_at)
    VALUES(?,?,?,?,?) ON CONFLICT(source_system_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,api_version=COALESCE(excluded.api_version,opencode_sources.api_version)`);
  const readJob = id => db.prepare(`SELECT ${jobColumns},manifest_json AS manifestJSON FROM opencode_derivation_jobs WHERE job_id=?`).get(id);
  function enqueueDerivation({sourceSystemID,projectID,sessionID,snapshotCompleteness='partial',snapshotProof=null,projectionSafe=false,now=Date.now()}) {
    const current=db.prepare(`SELECT s.current_revision_sha256,s.current_snapshot_sha256,s.publication_revision,
      length(CAST(r.payload_json AS BLOB)) AS header_bytes FROM opencode_sessions s JOIN opencode_session_revisions r
      ON r.source_system_id=s.source_system_id AND r.project_id=s.project_id AND r.session_id=s.session_id
      AND r.revision_sha256=s.current_revision_sha256
      WHERE s.source_system_id=? AND s.project_id=? AND s.session_id=?`).get(sourceSystemID,projectID,sessionID);
    if(!current) throw Error('The retained OpenCode session is missing.');
    // Hash every current pointer, but retain bounded exact inputs only. An
    // oversized membership becomes a durable blocked receipt, never truncation
    // masquerading as a complete conversation or a published projection.
    const membershipHash=createHash('sha256'),refs=[];
    let messageCount=0,retainedPayloadBytes=Number(current.header_bytes);
    membershipHash.update('[');
    for(const row of db.prepare(`SELECT m.message_id AS messageID,m.ordinal,m.current_revision_sha256 AS revisionSha256,
      length(CAST(r.info_json AS BLOB))+length(CAST(r.parts_json AS BLOB)) AS payloadBytes
      FROM opencode_messages m JOIN opencode_message_revisions r ON r.source_system_id=m.source_system_id
      AND r.project_id=m.project_id AND r.session_id=m.session_id AND r.message_id=m.message_id AND r.revision_sha256=m.current_revision_sha256
      WHERE m.source_system_id=? AND m.project_id=? AND m.session_id=? ORDER BY m.ordinal,m.message_id`)
      .iterate(sourceSystemID,projectID,sessionID)) {
      const {payloadBytes,...ref}=row;
      if(messageCount) membershipHash.update(',');
      membershipHash.update(canonical(ref));
      if(messageCount<projectionMemberLimit) refs.push(ref);
      retainedPayloadBytes+=Number(payloadBytes);
      messageCount++;
    }
    membershipHash.update(']');
    const manifest={version:1,sessionRevisionSha256:current.current_revision_sha256,
      messageCount,retainedPayloadBytes,messageMembershipSha256:membershipHash.digest('hex'),
      messageRefs:messageCount<=projectionMemberLimit?refs:null,snapshotCompleteness,
      snapshotProof:snapshotProof??null,projectionSafe:projectionSafe===true};
    const manifestJSON=canonical(manifest),snapshotRevisionSha256=hash(manifestJSON);
    const id=hash(canonical([sourceSystemID,projectID,sessionID,snapshotRevisionSha256,derivationVersion]));
    const previous=readJob(id),changed=current.current_snapshot_sha256!==snapshotRevisionSha256;
    const publicationRevision=changed?current.publication_revision+1:current.publication_revision||1;
    if(!Number.isSafeInteger(publicationRevision)) throw Error('Warehouse publication revision exceeds its safe integer limit.');
    const blockedReason=messageCount>projectionMemberLimit?'message-limit':retainedPayloadBytes>projectionByteLimit?'byte-limit':!manifest.projectionSafe?'unsafe-message-window':null;
    db.prepare(`UPDATE opencode_derivation_jobs SET status='superseded',next_attempt_at=NULL,updated_at=?,completed_at=?
      WHERE source_system_id=? AND project_id=? AND session_id=? AND (snapshot_revision_sha256<>? OR derivation_version<>?)
      AND status IN ('pending','blocked')`).run(now,now,sourceSystemID,projectID,sessionID,snapshotRevisionSha256,derivationVersion);
    if(!previous) {
      db.prepare(`INSERT INTO opencode_derivation_jobs(job_id,source_system_id,project_id,session_id,snapshot_revision_sha256,derivation_version,
        manifest_json,publication_revision,revision_token,status,blocked_reason,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(id,sourceSystemID,projectID,sessionID,snapshotRevisionSha256,derivationVersion,
          manifestJSON,publicationRevision,blockedReason?'blocked':'pending',blockedReason,now,now);
    } else if(changed||previous.publicationRevision!==publicationRevision) {
      if(!Number.isSafeInteger(previous.revisionToken+1)) throw Error('Warehouse job revision exceeds its safe integer limit.');
      db.prepare(`UPDATE opencode_derivation_jobs SET publication_revision=?,revision_token=revision_token+1,
        status=?,blocked_reason=?,attempts=0,next_attempt_at=NULL,error=NULL,updated_at=?,completed_at=NULL WHERE job_id=?`)
        .run(publicationRevision,blockedReason?'blocked':'pending',blockedReason,now,id);
    }
    db.prepare(`UPDATE opencode_sessions SET current_snapshot_sha256=?,publication_revision=?
      WHERE source_system_id=? AND project_id=? AND session_id=?`)
      .run(snapshotRevisionSha256,publicationRevision,sourceSystemID,projectID,sessionID);
    const job=readJob(id);
    return {derivationJobID:id,derivationRevisionToken:job.revisionToken,snapshotRevisionSha256,
      derivationStatus:job.status,projectionSafe:manifest.projectionSafe,derivationBlockedReason:job.blockedReason};
  }
  return {
    initializeWarehouseDerivations() {
      // A schema-20 database has immutable source revisions but no publication
      // marker. Preserve its search copy until an explicitly safe refresh; the
      // null pointer makes this restart-safe if initialization is interrupted.
      let initialized=0;
      while(true) {
        const rows=db.prepare(`SELECT s.source_system_id AS sourceSystemID,s.project_id AS projectID,s.session_id AS sessionID,
          (SELECT j.manifest_json FROM opencode_derivation_jobs j WHERE j.source_system_id=s.source_system_id AND j.project_id=s.project_id
            AND j.session_id=s.session_id AND j.snapshot_revision_sha256=s.current_snapshot_sha256
            ORDER BY j.publication_revision DESC,j.created_at DESC,j.job_id LIMIT 1) AS priorManifestJSON
          FROM opencode_sessions s WHERE s.current_snapshot_sha256 IS NULL OR NOT EXISTS (
            SELECT 1 FROM opencode_derivation_jobs j WHERE j.source_system_id=s.source_system_id AND j.project_id=s.project_id
              AND j.session_id=s.session_id AND j.snapshot_revision_sha256=s.current_snapshot_sha256
              AND j.publication_revision=s.publication_revision AND j.derivation_version=?)
          ORDER BY s.source_system_id,s.project_id,s.session_id LIMIT 100`).all(derivationVersion);
        if(!rows.length) break;
        tx(()=>{for(const row of rows) {
          const previous=row.priorManifestJSON?JSON.parse(row.priorManifestJSON):null;
          enqueueDerivation({...row,projectionSafe:previous?.projectionSafe===true,
            snapshotCompleteness:previous?.snapshotCompleteness??'partial',snapshotProof:previous?.snapshotProof??null});
          initialized++;
        }});
      }
      return {initialized};
    },
    listWarehouseDerivationJobs({sourceID,projectID,limit=50,includeBlocked=false,includeDeferred=false}={}) {
      const statuses=includeBlocked?"('pending','blocked')":"('pending')";
      return db.prepare(`SELECT ${jobColumns} FROM opencode_derivation_jobs WHERE status IN ${statuses}
        AND (? IS NULL OR source_system_id=?) AND (? IS NULL OR project_id=?)
        AND (?=1 OR status='blocked' OR next_attempt_at IS NULL OR next_attempt_at<=?)
        ORDER BY COALESCE(next_attempt_at,updated_at),created_at,job_id LIMIT ?`)
        .all(sourceID??null,sourceID??null,projectID??null,projectID??null,Number(includeDeferred===true),Date.now(),boundedLimit(limit))
        .map(row=>({...row}));
    },
    readWarehouseDerivationSnapshot({id,revisionToken}={}) {
      const job=readJob(id);
      if(!job) return {status:'missing',id};
      if(!Number.isSafeInteger(revisionToken)||job.revisionToken!==revisionToken) return {status:'stale',id};
      const manifest=JSON.parse(job.manifestJSON),{manifestJSON:_ignored,...publicJob}=job;
      if(hash(job.manifestJSON)!==job.snapshotRevisionSha256) throw Error('Warehouse snapshot manifest hash does not match its immutable identity.');
      const current=db.prepare(`SELECT current_snapshot_sha256,publication_revision FROM opencode_sessions
        WHERE source_system_id=? AND project_id=? AND session_id=?`).get(job.sourceID,job.projectID,job.sessionID);
      const isCurrent=job.derivationVersion===derivationVersion&&current?.current_snapshot_sha256===job.snapshotRevisionSha256&&current.publication_revision===job.publicationRevision;
      if(manifest.messageRefs===null) return {status:'blocked',job:publicJob,jobStatus:job.status,isCurrent,
        reason:'message-limit',messageCount:manifest.messageCount,retainedPayloadBytes:manifest.retainedPayloadBytes};
      if(manifest.retainedPayloadBytes>projectionByteLimit) return {status:'blocked',job:publicJob,jobStatus:job.status,isCurrent,
        reason:'byte-limit',messageCount:manifest.messageCount,retainedPayloadBytes:manifest.retainedPayloadBytes};
      const headerRow=db.prepare(`SELECT payload_json,length(CAST(payload_json AS BLOB)) AS payloadBytes FROM opencode_session_revisions WHERE source_system_id=? AND project_id=?
        AND session_id=? AND revision_sha256=?`).get(job.sourceID,job.projectID,job.sessionID,manifest.sessionRevisionSha256);
      if(!headerRow) throw Error('An immutable warehouse session revision is missing.');
      let retainedPayloadBytes=Number(headerRow.payloadBytes);
      if(retainedPayloadBytes>projectionByteLimit) throw Error('Retained warehouse projection exceeds its byte limit.');
      const header=JSON.parse(headerRow.payload_json),messages=[];
      if(hash(headerRow.payload_json)!==manifest.sessionRevisionSha256) throw Error('Warehouse session revision content changed.');
      if(manifest.messageRefs.length!==manifest.messageCount||hash(canonical(manifest.messageRefs))!==manifest.messageMembershipSha256)
        throw Error('Warehouse snapshot membership does not match its retained identity.');
      for(const ref of manifest.messageRefs) {
        const row=db.prepare(`SELECT info_json,parts_json,length(CAST(info_json AS BLOB))+length(CAST(parts_json AS BLOB)) AS payloadBytes FROM opencode_message_revisions WHERE source_system_id=? AND project_id=?
          AND session_id=? AND message_id=? AND revision_sha256=?`).get(job.sourceID,job.projectID,job.sessionID,ref.messageID,ref.revisionSha256);
        if(!row) throw Error('An immutable warehouse message revision is missing.');
        retainedPayloadBytes+=Number(row.payloadBytes);
        if(retainedPayloadBytes>projectionByteLimit) throw Error('Retained warehouse projection exceeds its byte limit.');
        if(hash(`${row.info_json}\0${row.parts_json}`)!==ref.revisionSha256) throw Error('Warehouse message revision content changed.');
        const parts=JSON.parse(row.parts_json);
        messages.push({info:JSON.parse(row.info_json),parts:parts.parts,omittedPartTypes:parts.omittedTypes});
      }
      return {status:'ok',job:publicJob,jobStatus:job.status,isCurrent,projectionSafe:manifest.projectionSafe,
        snapshotCompleteness:manifest.snapshotCompleteness,snapshotRevisionSha256:job.snapshotRevisionSha256,retainedPayloadBytes,
        session:{id:header.id,parentID:header.parentID,title:header.title,directorySha256:header.directorySha256,
          time:{created:header.createdAt,updated:header.updatedAt,archived:header.archivedAt}},messages};
    },
    completeWarehouseDerivationJob({id,revisionToken,status='complete'}={}) {
      if(!['complete','superseded'].includes(status)) throw Error('Choose an explicit warehouse publication outcome.');
      if(!Number.isSafeInteger(revisionToken)||revisionToken<1) throw Error('An exact warehouse job revision is required.');
      return tx(()=>{
        const job=readJob(id);
        if(!job||job.revisionToken!==revisionToken||job.status!=='pending') return {completed:false,status:'stale'};
        const current=db.prepare(`SELECT current_snapshot_sha256,publication_revision FROM opencode_sessions
          WHERE source_system_id=? AND project_id=? AND session_id=?`).get(job.sourceID,job.projectID,job.sessionID);
        const outcome=status==='complete'&&job.derivationVersion===derivationVersion&&current?.current_snapshot_sha256===job.snapshotRevisionSha256&&current.publication_revision===job.publicationRevision?'complete':'superseded';
        db.prepare(`UPDATE opencode_derivation_jobs SET status=?,blocked_reason=NULL,next_attempt_at=NULL,error=NULL,
          updated_at=?,completed_at=? WHERE job_id=? AND revision_token=? AND status='pending'`)
          .run(outcome,Date.now(),Date.now(),id,revisionToken);
        return {completed:true,status:outcome};
      });
    },
    failWarehouseDerivationJob({id,revisionToken,error,blocked=false}={}) {
      return tx(()=>{
        const job=readJob(id);
        if(!job||job.revisionToken!==revisionToken||job.status!=='pending') return {failed:false,status:'stale'};
        const now=Date.now(),attempts=job.attempts+1,nextAttemptAt=blocked?null:retryAt(attempts,now);
        db.prepare(`UPDATE opencode_derivation_jobs SET status=?,blocked_reason=?,attempts=?,next_attempt_at=?,error=?,updated_at=?
          WHERE job_id=? AND revision_token=? AND status='pending'`).run(blocked?'blocked':'pending',blocked?'source-or-project-unavailable':null,
            attempts,nextAttemptAt,safeWorkError(error),now,id,revisionToken);
        return {failed:true,status:blocked?'blocked':'pending',attempts,nextAttemptAt};
      });
    },
    requeueWarehouseDerivations({sourceID,projectID,sessionID,includeComplete=true,wakeBlocked=false,preserveFailure=true}={}) {
      return tx(()=>{
        const now=Date.now();
        const rows=db.prepare(`SELECT j.job_id,j.revision_token,j.manifest_json,j.status,j.attempts,j.next_attempt_at,j.error FROM opencode_derivation_jobs j JOIN opencode_sessions s
          ON s.source_system_id=j.source_system_id AND s.project_id=j.project_id AND s.session_id=j.session_id
          AND s.current_snapshot_sha256=j.snapshot_revision_sha256 AND s.publication_revision=j.publication_revision
          WHERE j.derivation_version=? AND (? IS NULL OR j.source_system_id=?) AND (? IS NULL OR j.project_id=?) AND (? IS NULL OR j.session_id=?)`)
          .all(derivationVersion,sourceID??null,sourceID??null,projectID??null,projectID??null,sessionID??null,sessionID??null);
        let requeued=0;
        for(const row of rows) {
          const manifest=JSON.parse(row.manifest_json);
          if(!manifest.projectionSafe||manifest.messageRefs===null||manifest.retainedPayloadBytes>projectionByteLimit) continue;
          if(row.status==='blocked'&&!wakeBlocked||row.status==='complete'&&!includeComplete) continue;
          if(!includeComplete&&row.status==='pending'&&row.attempts===0&&row.next_attempt_at===null) continue;
          if(!Number.isSafeInteger(row.revision_token+1)) throw Error('Warehouse job revision exceeds its safe integer limit.');
          db.prepare(`UPDATE opencode_derivation_jobs SET status='pending',revision_token=revision_token+1,
            blocked_reason=NULL,attempts=?,next_attempt_at=?,error=?,updated_at=?,completed_at=NULL WHERE job_id=?`)
            .run(preserveFailure?row.attempts:0,preserveFailure?row.next_attempt_at:null,preserveFailure?row.error:null,now,row.job_id);
          requeued++;
        }
        return {requeued};
      });
    },
    markWarehouseRefreshNeeded({sourceID,projectID=null,sessionID=null,reason='event-hint'}={}) {
      scopeIdentity(sourceID,projectID,sessionID);
      if(!refreshReasons.has(reason)) throw Error('Choose a known warehouse refresh reason.');
      const id=hash(canonical([sourceID,projectID,sessionID])),now=Date.now();
      return tx(()=>{
        const previous=db.prepare('SELECT revision FROM opencode_refresh_needed WHERE refresh_id=?').get(id);
        if(previous&&!Number.isSafeInteger(previous.revision+1)) throw Error('Warehouse refresh revision exceeds its safe integer limit.');
        db.prepare(`INSERT INTO opencode_refresh_needed(refresh_id,source_system_id,project_id,session_id,revision,state,reason,created_at,updated_at)
          VALUES(?,?,?,?,1,'pending',?,?,?) ON CONFLICT(refresh_id) DO UPDATE SET revision=revision+1,state='pending',reason=excluded.reason,
          attempts=0,next_attempt_at=NULL,error=NULL,updated_at=excluded.updated_at,cleared_at=NULL`).run(id,sourceID,projectID,sessionID,reason,now,now);
        // A new authoritative-read hint can wake a safe publication previously
        // deferred by permissions or a transient store failure.
        if(projectID!==null&&sessionID!==null) this.requeueWarehouseDerivations({sourceID,projectID,sessionID,
          includeComplete:false,wakeBlocked:true,preserveFailure:false});
        return {...db.prepare(`SELECT ${refreshColumns} FROM opencode_refresh_needed WHERE refresh_id=?`).get(id)};
      });
    },
    listWarehouseRefreshNeeded({sourceID,projectID,limit=50,includeBlocked=false,includeDeferred=false}={}) {
      const states=includeBlocked?"('pending','blocked')":"('pending')";
      return db.prepare(`SELECT ${refreshColumns} FROM opencode_refresh_needed WHERE state IN ${states}
        AND (? IS NULL OR source_system_id=?) AND (? IS NULL OR project_id=?)
        AND (?=1 OR state='blocked' OR next_attempt_at IS NULL OR next_attempt_at<=?)
        ORDER BY COALESCE(next_attempt_at,updated_at),created_at,refresh_id LIMIT ?`)
        .all(sourceID??null,sourceID??null,projectID??null,projectID??null,Number(includeDeferred===true),Date.now(),boundedLimit(limit))
        .map(row=>({...row}));
    },
    clearWarehouseRefreshNeeded({id,revision}={}) {
      if(!Number.isSafeInteger(revision)||revision<1) throw Error('An exact refresh revision is required.');
      const result=db.prepare(`UPDATE opencode_refresh_needed SET state='cleared',next_attempt_at=NULL,error=NULL,
        updated_at=?,cleared_at=? WHERE refresh_id=? AND revision=? AND state='pending'`).run(Date.now(),Date.now(),id,revision);
      return {cleared:Number(result.changes)===1};
    },
    failWarehouseRefreshNeeded({id,revision,error,blocked=false}={}) {
      return tx(()=>{
        const row=db.prepare('SELECT attempts FROM opencode_refresh_needed WHERE refresh_id=? AND revision=? AND state=\'pending\'').get(id,revision);
        if(!row) return {failed:false,status:'stale'};
        const now=Date.now(),attempts=row.attempts+1,nextAttemptAt=blocked?null:retryAt(attempts,now);
        db.prepare(`UPDATE opencode_refresh_needed SET state=?,attempts=?,next_attempt_at=?,error=?,updated_at=? WHERE refresh_id=? AND revision=?`)
          .run(blocked?'blocked':'pending',attempts,nextAttemptAt,safeWorkError(error),now,id,revision);
        return {failed:true,status:blocked?'blocked':'pending',attempts,nextAttemptAt};
      });
    },
    beginOpenCodeIngest({sourceSystemID,locatorSha256,apiVersion=null,projectID,mode='backfill',resume=false}={}) {
      if(typeof sourceSystemID!=='string'||!sourceSystemID.startsWith('opencode:')||typeof locatorSha256!=='string'||!/^[a-f0-9]{64}$/.test(locatorSha256)) throw Error('A stable OpenCode source identity is required.');
      if(typeof projectID!=='string'||!projectID||projectID.length>200||!['backfill','refresh'].includes(mode)) throw Error('A registered project and ingest mode are required.');
      const now=Date.now(),runID=randomUUID();
      const prior=db.prepare('SELECT cursor_json,state FROM opencode_ingest_cursors WHERE source_system_id=? AND project_id=?').get(sourceSystemID,projectID);
      const cursor=resume&&prior?.state==='incomplete'?prior.cursor_json:null;
      tx(()=>{
        capture.run(sourceSystemID,locatorSha256,apiVersion,now,now);
        db.prepare(`INSERT INTO opencode_ingest_runs(run_id,source_system_id,project_id,mode,status,cursor_json,started_at,updated_at)
          VALUES(?,?,?,?,'running',?,?,?)`).run(runID,sourceSystemID,projectID,mode,cursor,now,now);
        db.prepare(`INSERT INTO opencode_ingest_cursors(source_system_id,project_id,cursor_json,state,discovered_sessions,captured_sessions,captured_messages,failed_sessions,latest_run_id,updated_at)
          VALUES(?,?,?,'incomplete',0,0,0,0,?,?) ON CONFLICT(source_system_id,project_id) DO UPDATE SET
          cursor_json=excluded.cursor_json,state='incomplete',discovered_sessions=0,captured_sessions=0,captured_messages=0,failed_sessions=0,
          latest_run_id=excluded.latest_run_id,updated_at=excluded.updated_at`).run(sourceSystemID,projectID,cursor,runID,now);
      });
      return {runID,cursor:cursor?JSON.parse(cursor):null,resumed:!!cursor};
    },
    checkpointOpenCodeIngest({runID,cursor,discoveredSessions,capturedSessions,capturedMessages,failedSessions=0,complete=false,status}={}) {
      const run=db.prepare('SELECT * FROM opencode_ingest_runs WHERE run_id=?').get(runID);
      if(!run||run.status!=='running') throw Error('OpenCode ingest run is not active.');
      for(const value of [discoveredSessions,capturedSessions,capturedMessages,failedSessions]) if(!Number.isSafeInteger(value)||value<0) throw Error('OpenCode ingest counters must be nonnegative integers.');
      if(complete&&(failedSessions||cursor)) throw Error('An ingest run with failures or a continuation cursor cannot be complete.');
      const now=Date.now(),state=complete?'complete':'incomplete',runStatus=status??(complete?'complete':'running');
      tx(()=>{
        const cursorJSON=cursor?(typeof cursor==='string'?cursor:canonical(cursor)):null;
        db.prepare(`UPDATE opencode_ingest_runs SET status=?,cursor_json=?,discovered_sessions=?,captured_sessions=?,captured_messages=?,failed_sessions=?,updated_at=?,completed_at=?
          WHERE run_id=?`).run(runStatus,cursorJSON,discoveredSessions,capturedSessions,capturedMessages,failedSessions,now,complete?now:null,runID);
        db.prepare(`UPDATE opencode_ingest_cursors SET cursor_json=?,state=?,discovered_sessions=?,captured_sessions=?,captured_messages=?,failed_sessions=?,latest_run_id=?,updated_at=?
          WHERE source_system_id=? AND project_id=?`).run(cursorJSON,state,discoveredSessions,capturedSessions,capturedMessages,failedSessions,runID,now,run.source_system_id,run.project_id);
      });
      return {runID,status:runStatus,state,cursor:cursor??null,discoveredSessions,capturedSessions,capturedMessages,failedSessions};
    },
    openCodeIngestStatus({sourceSystemID,projectID}={}) {
      return db.prepare(`SELECT r.run_id AS runID,r.source_system_id AS sourceID,r.project_id AS projectID,r.mode,r.status,r.cursor_json AS cursorJSON,r.discovered_sessions AS discoveredSessions,
        r.captured_sessions AS capturedSessions,r.captured_messages AS capturedMessages,r.failed_sessions AS failedSessions,
        r.started_at AS startedAt,r.updated_at AS updatedAt,r.completed_at AS completedAt,r.error,
        c.state AS coverageState FROM opencode_ingest_runs r LEFT JOIN opencode_ingest_cursors c
        ON c.source_system_id=r.source_system_id AND c.project_id=r.project_id AND c.latest_run_id=r.run_id
        WHERE (? IS NULL OR r.source_system_id=?) AND (? IS NULL OR r.project_id=?)
        ORDER BY r.started_at DESC LIMIT 100`).all(sourceSystemID??null,sourceSystemID??null,projectID??null,projectID??null)
        .map(row=>({...row,cursor:row.cursorJSON?JSON.parse(row.cursorJSON):null}));
    },
    recordOpenCodeIngestFailure({runID,sessionID,error}={}) {
      const run=db.prepare('SELECT status FROM opencode_ingest_runs WHERE run_id=?').get(runID);
      if(!run||run.status!=='running') throw Error('OpenCode ingest run is not active.');
      db.prepare(`INSERT INTO opencode_ingest_failures VALUES(?,?,?,?) ON CONFLICT(run_id,session_id)
        DO UPDATE SET error=excluded.error,failed_at=excluded.failed_at`).run(runID,clip(sessionID,200),clip(error,2000),Date.now());
      return {runID,sessionID};
    },
    openCodeIngestFailures({runID,limit=100}={}) {
      const count=Math.max(1,Math.min(500,Number(limit)||100));
      return db.prepare('SELECT run_id AS runID,session_id AS sessionID,error,failed_at AS failedAt FROM opencode_ingest_failures WHERE (? IS NULL OR run_id=?) ORDER BY failed_at DESC LIMIT ?')
        .all(runID??null,runID??null,count);
    },
    recordOpenCodeSnapshot({sourceSystemID,locatorSha256,apiVersion=null,projectID,session,messages,
      snapshotCompleteness='partial',snapshotProof=null,projectionSafe=false}) {
      if(typeof sourceSystemID!=='string'||!sourceSystemID.startsWith('opencode:')||typeof locatorSha256!=='string'||!/^[a-f0-9]{64}$/.test(locatorSha256)) throw Error('A stable OpenCode source identity is required.');
      if(typeof projectID!=='string'||!projectID||projectID.length>200||typeof session?.id!=='string'||!session.id||session.id.length>200) throw Error('Registered project and native session identities are required.');
      if(!Array.isArray(messages)||messages.length>5000) throw Error('OpenCode session messages must be a bounded array.');
      if(typeof projectionSafe!=='boolean') throw Error('Warehouse projection safety must be an explicit boolean.');
      if(!['partial','complete'].includes(snapshotCompleteness)) throw Error('OpenCode snapshot completeness must be explicit.');
      const verifiedProof=snapshotCompleteness==='complete'?openCodeSnapshotProof(session,messages):null;
      if(snapshotCompleteness==='complete'&&(!verifiedProof||canonical(snapshotProof)!==canonical(verifiedProof)))
        throw Error('Only a complete archived-session message snapshot with matching header and message IDs can reconcile current evidence.');
      if(snapshotCompleteness!=='complete'&&snapshotProof!==null)
        throw Error('A snapshot proof is only valid with complete snapshot status.');
      const now=Date.now(), directoryKey=typeof session.directory==='string'&&process.platform==='win32'?session.directory.toLowerCase():session.directory;
      const directorySha256=typeof directoryKey==='string'?hash(directoryKey):null;
      const header={id:session.id,parentID:session.parentID??null,title:clip(session.title||'New chat',1000),
        createdAt:timestamp(session.time?.created)??0,updatedAt:timestamp(session.time?.updated)??timestamp(session.time?.created)??0,
        archivedAt:timestamp(session.time?.archived),directorySha256};
      const headerJSON=canonical(header),sessionRevision=hash(headerJSON);
      let captured=0,revisionsAdded=0,omittedParts=0,messagesRemoved=0,derivation;
      const inputIDs=new Set();
      const validatedProjection=projectionSafe&&messages.every(row=> {
        const info=row?.info;
        if(!info||!['user','assistant'].includes(info.role)||typeof info.id!=='string'||!info.id||info.id.length>200||
          inputIDs.has(info.id)||info.sessionID!==undefined&&info.sessionID!==session.id||!Array.isArray(row.parts)) return false;
        inputIDs.add(info.id);return true;
      });
      const retainedMessageIDs=[];
      tx(()=>{
        capture.run(sourceSystemID,locatorSha256,apiVersion,now,now);
        db.prepare(`INSERT INTO opencode_session_revisions VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
          .run(sourceSystemID,projectID,session.id,sessionRevision,headerJSON,now);
        db.prepare(`INSERT INTO opencode_sessions(source_system_id,project_id,session_id,parent_id,title,directory_sha256,created_at,updated_at,archived_at,current_revision_sha256,seen_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_system_id,project_id,session_id) DO UPDATE SET parent_id=excluded.parent_id,title=excluded.title,
          directory_sha256=excluded.directory_sha256,created_at=excluded.created_at,updated_at=excluded.updated_at,archived_at=excluded.archived_at,
          current_revision_sha256=excluded.current_revision_sha256,seen_at=excluded.seen_at`)
          .run(sourceSystemID,projectID,session.id,header.parentID,header.title,directorySha256,header.createdAt,header.updatedAt,header.archivedAt,sessionRevision,now);
        const saveRevision=db.prepare(`INSERT INTO opencode_message_revisions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
        const saveMessage=db.prepare(`INSERT INTO opencode_messages(source_system_id,project_id,session_id,message_id,ordinal,role,provider_id,model_id,created_at,completed_at,usage_json,current_revision_sha256,seen_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_system_id,project_id,session_id,message_id) DO UPDATE SET ordinal=excluded.ordinal,role=excluded.role,
          provider_id=excluded.provider_id,model_id=excluded.model_id,created_at=excluded.created_at,completed_at=excluded.completed_at,
        usage_json=excluded.usage_json,current_revision_sha256=excluded.current_revision_sha256,seen_at=excluded.seen_at`);
        for(let ordinal=0;ordinal<messages.length;ordinal++) {
          const row=messages[ordinal], info=row?.info;
          if(!info||!['user','assistant'].includes(info.role)||typeof info.id!=='string'||!info.id) continue;
          retainedMessageIDs.push(info.id);
          const infoValue=safeInfo(info),normalized=safeParts(Array.isArray(row.parts)?row.parts:[]);
          omittedParts+=Object.values(normalized.omittedTypes).reduce((sum,n)=>sum+n,0);
          const infoJSON=canonical(infoValue),partsJSON=canonical(normalized),revision=hash(`${infoJSON}\0${partsJSON}`);
          const countBefore=db.prepare(`SELECT 1 FROM opencode_message_revisions WHERE source_system_id=? AND project_id=? AND session_id=? AND message_id=? AND revision_sha256=?`)
            .get(sourceSystemID,projectID,session.id,info.id,revision);
          saveRevision.run(sourceSystemID,projectID,session.id,info.id,revision,infoJSON,partsJSON,now);
          if(!countBefore) revisionsAdded++;
          const model=typeof info.model==='object'?info.model:{};
          const tokens = info.tokens === undefined ? null : canonical(safeValue(info.tokens));
          saveMessage.run(sourceSystemID,projectID,session.id,info.id,ordinal,info.role,
            info.providerID??model.providerID??null,info.modelID??model.modelID??null,
            timestamp(info.time?.created),timestamp(info.time?.completed),tokens,revision,now);
          captured++;
        }
        if(snapshotCompleteness==='complete') {
          const uniqueIDs=[...new Set(retainedMessageIDs)];
          const deletion=uniqueIDs.length
            ? db.prepare(`DELETE FROM opencode_messages WHERE source_system_id=? AND project_id=? AND session_id=?
                AND message_id NOT IN (${uniqueIDs.map(()=>'?').join(',')})`).run(sourceSystemID,projectID,session.id,...uniqueIDs)
            : db.prepare('DELETE FROM opencode_messages WHERE source_system_id=? AND project_id=? AND session_id=?').run(sourceSystemID,projectID,session.id);
          messagesRemoved=Number(deletion.changes);
        }
        derivation=enqueueDerivation({sourceSystemID,projectID,sessionID:session.id,snapshotCompleteness,
          snapshotProof:verifiedProof,projectionSafe:validatedProjection,now});
      });
      return {sourceSystemID,projectID,sessionID:session.id,sessionRevisionSha256:sessionRevision,messages:captured,
        messageRevisionsAdded:revisionsAdded,omittedPartCount:omittedParts,capturedAt:now,
        snapshotCompleteness,reconciled:snapshotCompleteness==='complete',messagesRemoved,...derivation};
    },
    openCodeCoverage(sourceSystemID) {
      return db.prepare(`WITH sources AS (
          SELECT source_system_id FROM opencode_sources UNION SELECT source_system_id FROM opencode_refresh_needed WHERE state<>'cleared'
        ) SELECT ids.source_system_id,c.first_seen_at,c.last_seen_at,COALESCE(c.sessions,0) AS sessions,
          COALESCE(c.messages,0) AS messages,COALESCE(c.session_revisions,0) AS session_revisions,COALESCE(c.message_revisions,0) AS message_revisions,
          (SELECT count(*) FROM opencode_derivation_jobs j WHERE j.source_system_id=ids.source_system_id AND j.status='pending') AS pendingDerivations,
          (SELECT count(*) FROM opencode_derivation_jobs j WHERE j.source_system_id=ids.source_system_id AND j.status='blocked') AS blockedDerivations,
          (SELECT count(*) FROM opencode_refresh_needed r WHERE r.source_system_id=ids.source_system_id AND r.state='pending') AS refreshNeeded,
          (SELECT count(*) FROM opencode_refresh_needed r WHERE r.source_system_id=ids.source_system_id AND r.state='blocked') AS blockedRefreshes
        FROM sources ids LEFT JOIN opencode_source_coverage c ON c.source_system_id=ids.source_system_id
        WHERE (? IS NULL OR ids.source_system_id=?) ORDER BY ids.source_system_id`)
        .all(sourceSystemID??null,sourceSystemID??null).map(row=>({...row}));
    },
    readOpenCodeSession({projectID,sessionID,sourceSystemID,limit=100}={}) {
      const session=db.prepare(`SELECT s.source_system_id AS sourceSystemID,s.project_id AS projectID,s.session_id AS sessionID,s.parent_id AS parentID,
        s.title,s.created_at AS createdAt,s.updated_at AS updatedAt,s.archived_at AS archivedAt,s.directory_sha256 AS directorySha256,
        s.current_revision_sha256 AS currentRevisionSha256,r.payload_json AS revisionPayload,r.captured_at AS capturedAt
        FROM opencode_sessions s JOIN opencode_session_revisions r ON r.source_system_id=s.source_system_id AND r.project_id=s.project_id
        AND r.session_id=s.session_id AND r.revision_sha256=s.current_revision_sha256
        WHERE s.project_id=? AND s.session_id=? AND (? IS NULL OR s.source_system_id=?)
        ORDER BY s.seen_at DESC LIMIT 1`).get(projectID,sessionID,sourceSystemID??null,sourceSystemID??null);
      if(!session) return {status:'missing',projectID,sessionID};
      const count=Math.max(1,Math.min(500,Number(limit)||100));
      const rows=db.prepare(`SELECT m.message_id AS messageID,m.ordinal,m.role,m.provider_id AS providerID,m.model_id AS modelID,
        m.created_at AS createdAt,m.completed_at AS completedAt,m.usage_json AS usageJSON,m.current_revision_sha256 AS revisionSha256,
        r.info_json AS infoJSON,r.parts_json AS partsJSON,r.captured_at AS capturedAt
        FROM opencode_messages m JOIN opencode_message_revisions r ON r.source_system_id=m.source_system_id AND r.project_id=m.project_id
        AND r.session_id=m.session_id AND r.message_id=m.message_id AND r.revision_sha256=m.current_revision_sha256
        WHERE m.source_system_id=? AND m.project_id=? AND m.session_id=? ORDER BY m.ordinal LIMIT ?`)
        .all(session.sourceSystemID,projectID,sessionID,count+1).map(row=>({...row,usage:row.usageJSON?JSON.parse(row.usageJSON):null,
          info:JSON.parse(row.infoJSON),parts:JSON.parse(row.partsJSON).parts,omittedPartTypes:JSON.parse(row.partsJSON).omittedTypes}));
      const truncated=rows.length>count;
      const messages=rows.slice(0,count).map(row=>({...row,sourceRef:`${session.sourceSystemID}/${projectID}/${sessionID}/${row.messageID}@${row.revisionSha256}`}));
      return {status:'ok',session:{...session,revisionPayload:JSON.parse(session.revisionPayload),sourceRef:`${session.sourceSystemID}/${projectID}/${sessionID}@${session.currentRevisionSha256}`},messages,
        truncated,coverage:this.openCodeCoverage(session.sourceSystemID)[0]??null};
    },
    openCodeMessageRefs({projectID,sessionID,sourceSystemID,limit=5000}={}) {
      if(typeof projectID!=='string'||!projectID||typeof sessionID!=='string'||!sessionID)
        throw Error('Registered project and native session identities are required.');
      const count=Math.max(1,Math.min(5000,Number(limit)||5000));
      const session=db.prepare(`SELECT source_system_id AS sourceSystemID FROM opencode_sessions
        WHERE project_id=? AND session_id=? AND (? IS NULL OR source_system_id=?)
        ORDER BY seen_at DESC LIMIT 1`).get(projectID,sessionID,sourceSystemID??null,sourceSystemID??null);
      if(!session) return {status:'missing',projectID,sessionID,messages:[],truncated:false};
      const rows=db.prepare(`SELECT message_id AS messageID,ordinal,provider_id AS providerID,model_id AS modelID,
        current_revision_sha256 AS revisionSha256 FROM opencode_messages
        WHERE source_system_id=? AND project_id=? AND session_id=? ORDER BY ordinal,message_id LIMIT ?`)
        .all(session.sourceSystemID,projectID,sessionID,count+1);
      const truncated=rows.length>count;
      return {status:'ok',sourceSystemID:session.sourceSystemID,projectID,sessionID,
        messages:rows.slice(0,count).map(row=>({...row})),truncated,
        coverage:this.openCodeCoverage(session.sourceSystemID)[0]??null};
    },
  };
}
