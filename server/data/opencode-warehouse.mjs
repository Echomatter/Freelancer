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
      const data=typeof part.data==='string'?part.data:'';
      value={id,type,mime:clip(part.mime,300),filename:clip(part.filename??part.name,1000),
        source:clip(part.source,1000),payloadSha256:data?hash(data):null,payloadBytes:data?Buffer.byteLength(data):0};
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

export function createOpenCodeWarehouse(db,tx) {
  const capture=db.prepare(`INSERT INTO opencode_sources(source_system_id,locator_sha256,api_version,first_seen_at,last_seen_at)
    VALUES(?,?,?,?,?) ON CONFLICT(source_system_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,api_version=COALESCE(excluded.api_version,opencode_sources.api_version)`);
  return {
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
      return db.prepare(`SELECT r.run_id AS runID,r.mode,r.status,r.cursor_json AS cursorJSON,r.discovered_sessions AS discoveredSessions,
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
    recordOpenCodeSnapshot({sourceSystemID,locatorSha256,apiVersion=null,projectID,session,messages}) {
      if(typeof sourceSystemID!=='string'||!sourceSystemID.startsWith('opencode:')||typeof locatorSha256!=='string'||!/^[a-f0-9]{64}$/.test(locatorSha256)) throw Error('A stable OpenCode source identity is required.');
      if(typeof projectID!=='string'||!projectID||projectID.length>200||typeof session?.id!=='string'||!session.id||session.id.length>200) throw Error('Registered project and native session identities are required.');
      if(!Array.isArray(messages)||messages.length>5000) throw Error('OpenCode session messages must be a bounded array.');
      const now=Date.now(), directoryKey=typeof session.directory==='string'&&process.platform==='win32'?session.directory.toLowerCase():session.directory;
      const directorySha256=typeof directoryKey==='string'?hash(directoryKey):null;
      const header={id:session.id,parentID:session.parentID??null,title:clip(session.title||'New chat',1000),
        createdAt:timestamp(session.time?.created)??0,updatedAt:timestamp(session.time?.updated)??timestamp(session.time?.created)??0,
        archivedAt:timestamp(session.time?.archived),directorySha256};
      const headerJSON=canonical(header),sessionRevision=hash(headerJSON);
      let captured=0,revisionsAdded=0,omittedParts=0;
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
      });
      return {sourceSystemID,projectID,sessionID:session.id,sessionRevisionSha256:sessionRevision,messages:captured,
        messageRevisionsAdded:revisionsAdded,omittedPartCount:omittedParts,capturedAt:now};
    },
    openCodeCoverage(sourceSystemID) {
      return db.prepare('SELECT * FROM opencode_source_coverage WHERE (? IS NULL OR source_system_id=?) ORDER BY source_system_id')
        .all(sourceSystemID??null,sourceSystemID??null);
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
  };
}
