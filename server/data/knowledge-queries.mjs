import { randomUUID } from 'node:crypto';
import { contentMatch, contentOffset } from '../../domain/content-query.mjs';
import { createJudgmentRecordEvidence } from './judgment-record-evidence.mjs';

export function createKnowledgeQueries(db,tx) {
  const canonical = createJudgmentRecordEvidence(db);
  function hashContext() {
    const charged=new Set();
    const context={sources:new Map(),bytes:0,storedBytes:0,storedRows:0};
    const charge=(key,row)=>{
      if(charged.has(key)) return;
      if(!row) throw Error('Stored source record is unavailable.');
      if(row.bytes>4_000_000 || context.storedBytes+row.bytes>4_000_000 || context.storedRows+row.rows>8192)
        throw Object.assign(Error('Common query canonical hash work is bounded.'),{code:'KNOWLEDGE_HASH_LIMIT'});
      context.storedBytes+=row.bytes;context.storedRows+=row.rows;charged.add(key);
    };
    context.beforeClaim=id=>charge(`claim:${id}`,db.prepare(`SELECT
      length(CAST(COALESCE(c.value_json,'')||c.predicate||c.scope_json||c.method||c.origin||c.actor AS BLOB))
        +COALESCE((SELECT sum(length(CAST(e.evidence_json||e.evidence_id||e.relation AS BLOB))) FROM claim_evidence e WHERE e.claim_id=c.claim_id),0)
        +COALESCE((SELECT length(CAST(canonical_name||entity_type||normalized_name AS BLOB)) FROM entities WHERE entity_id=c.subject_entity_id),0)
        +COALESCE((SELECT length(CAST(canonical_name||entity_type||normalized_name AS BLOB)) FROM entities WHERE entity_id=c.object_entity_id),0) AS bytes,
      1+(SELECT count(*) FROM claim_evidence e WHERE e.claim_id=c.claim_id) AS rows
      FROM claims c WHERE c.claim_id=?`).get(id));
    context.beforeMemory=(id,revision)=>charge(`memory:${JSON.stringify([id,revision])}`,db.prepare(`SELECT
      length(CAST(r.body||r.provenance_json||r.capture_boundary_json||m.title||m.source_system AS BLOB))
        +COALESCE((SELECT sum(length(CAST(mm.source_ref||mm.locator_json||COALESCE(mm.source_revision,'')||COALESCE(mm.content_hash,'') AS BLOB))) FROM memory_members mm WHERE mm.revision_id=r.revision_id),0) AS bytes,
      1+(SELECT count(*) FROM memory_members mm WHERE mm.revision_id=r.revision_id) AS rows
      FROM memory_items m JOIN memory_item_revisions r USING(memory_id) WHERE m.memory_id=? AND r.revision=?`).get(id,revision));
    return context;
  }
  function readClaim(id, { summary=false, payloadBudget=1000000 }={}) {
    const sourceRefCount=summary?db.prepare('SELECT count(*) AS n FROM claim_evidence WHERE claim_id=?').get(id).n:0;
    const valueBudget=Math.min(100000,Math.floor(payloadBudget/2));
    const evidenceBudget=Math.min(8192,Math.floor(payloadBudget/2/Math.max(1,Math.min(32,sourceRefCount))));
    const row=db.prepare(`SELECT c.claim_id AS id,c.predicate,
      ${summary?`CASE WHEN length(CAST(c.value_json AS BLOB))<=${valueBudget} THEN c.value_json ELSE NULL END`:"c.value_json"} AS valueJSON,
      ${summary?`length(CAST(c.value_json AS BLOB))>${valueBudget}`:"0"} AS valueTruncated,c.origin,c.method,
      c.epistemic_state AS epistemicState,
      ${summary?`CASE WHEN length(CAST(c.scope_json AS BLOB))<=${payloadBudget} THEN c.scope_json ELSE json_object(
        'projectID',CASE WHEN json_type(c.scope_json,'$.projectID')='text' AND length(CAST(json_extract(c.scope_json,'$.projectID') AS BLOB))<=2000 THEN json_extract(c.scope_json,'$.projectID') ELSE NULL END,
        'project',CASE WHEN json_type(c.scope_json,'$.project')='text' AND length(CAST(json_extract(c.scope_json,'$.project') AS BLOB))<=2000 THEN json_extract(c.scope_json,'$.project') ELSE NULL END) END`:'c.scope_json'} AS scopeJSON,
      ${summary?`length(CAST(c.scope_json AS BLOB))>${payloadBudget}`:'0'} AS scopeTruncated,c.valid_from AS validFrom,c.valid_to AS validTo,
      c.observed_at AS observedAt,c.recorded_at AS recordedAt,c.superseded_at AS supersededAt,
      s.canonical_name AS subjectName,o.canonical_name AS objectName FROM claims c
      LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
      WHERE c.claim_id=?`).get(id);
    if (!row) return null;
    const {valueJSON,scopeJSON,valueTruncated,scopeTruncated,...item}=row;
    const evidence=db.prepare(`SELECT evidence_id AS id,relation,
      ${summary?`CASE WHEN length(CAST(evidence_json AS BLOB))<=${evidenceBudget} THEN evidence_json ELSE json_object('kind','recorded-provenance','summaryTruncated',json('true')) END`:"evidence_json"} AS payload
      FROM claim_evidence WHERE claim_id=? ORDER BY evidence_id,relation ${summary?'LIMIT 32':''}`)
      .all(id).map(({payload,...ref})=>({...JSON.parse(payload),...ref}));
    return {...item,value:valueJSON===null?null:JSON.parse(valueJSON),scope:JSON.parse(scopeJSON),evidence,
      ...(summary?{valueTruncated:!!valueTruncated,scopeTruncated:!!scopeTruncated,sourceRefCount,sourceRefsTruncated:sourceRefCount>evidence.length||evidence.some(ref=>ref.summaryTruncated)}: {})};
  }
  return {
    readClaim,
    searchClaims({query='',projectID,epistemicState,origin,model,modelProvider,phrase=false,includeHistorical=false,limit=50,offset=0}={}) {
      if (typeof query!=='string'||query.length>200) throw Error('Claim search is limited to 200 characters.');
      for (const [name,value,max] of [['Project ID',projectID,2000],['Epistemic state',epistemicState,100],['Origin',origin,100],['Model',model,300],['Model provider',modelProvider,200]])
        if (value!==undefined && (typeof value!=='string'||value.length>max)) throw Error(`${name} filter is invalid or too long.`);
      const bounded=Math.max(1,Math.min(200,Number(limit)||50)),match=contentMatch(query,{phrase});
      const start=contentOffset(offset);
      if (model && !modelProvider && model.includes('/')) [modelProvider,model]=[model.slice(0,model.indexOf('/')),model.slice(model.indexOf('/')+1)];
      const clauses=['(?=1 OR c.superseded_at IS NULL)','(? IS NULL OR c.epistemic_state=?)','(? IS NULL OR c.origin=?)',
        '(? IS NULL OR c.model_id=?)','(? IS NULL OR c.model_provider=?)','(? IS NULL OR f.project_key=?)'];
      const params=[includeHistorical?1:0,epistemicState??null,epistemicState??null,origin??null,origin??null,model??null,model??null,
        modelProvider??null,modelProvider??null,projectID??null,projectID??null];
      if (query.trim()) {
        if (db.prepare('SELECT 1 FROM claims WHERE claim_id=?').get(query.trim())) {
          clauses.push('c.claim_id=?'); params.push(query.trim());
        } else if (match) { clauses.push('claims_search_fts MATCH ?'); params.push(match); }
        else { clauses.push('0=1'); }
      }
      const rows=db.prepare(`SELECT c.claim_id AS id FROM claims_search_fts f
        JOIN claims c ON c.claim_id=f.claim_id
        WHERE ${clauses.join(' AND ')} ORDER BY c.recorded_at DESC,c.claim_id LIMIT ? OFFSET ?`)
        .all(...params,bounded+1,start);
      const context=hashContext(),selected=rows.slice(0,bounded),payloadBudget=Math.floor(1000000/Math.max(1,selected.length));
      const results=selected.map(row=>{
        const claim=readClaim(row.id,{summary:true,payloadBudget});
        let recordSha256=null,hashStatus='retained',hashUnavailableReason=null;
        try {recordSha256=canonical.claim(row.id,new Set(),context).ref.recordSha256;}
        catch(error) {
          const limited=error.code==='KNOWLEDGE_HASH_LIMIT'||/exceeds|exceed|bounded/.test(error.message);
          hashStatus=limited?'hash-limit':'unavailable';hashUnavailableReason=limited?'hash-work-limit':'source-unavailable';
        }
        const typed=claim.evidence.length>0&&claim.evidence.every(ref=>['memory','memory-revision','content-unit','opencode-text-part','claim-record'].includes(ref.kind));
        return {...claim,recordSha256,hashStatus,hashUnavailableReason,
          sourceEvidenceStatus:recordSha256?(typed?'retained':'recorded-provenance'):hashStatus,sourceRefs:claim.evidence,
          matchKind:query.trim()===claim.id?'exact-id':query.trim()?'fts':'browse',capturedAt:null,indexedAt:null};
      });
      return {status:results.length?'ok':'empty',results,truncated:rows.length>bounded,
        coverage:'Authored and source-backed claim revisions retained in this database. Origin and epistemic status are filtered independently from search relevance.'};
    },
    readContentEvidence({sourceIdentity,revisionIdentity,locator,unitHash}) {
      const row=db.prepare(`SELECT u.text,u.sha256 AS hash,u.locator,s.virtual_path AS path,s.project_key AS projectKey,
        s.revision_identity AS revisionIdentity FROM content_unit_revisions u JOIN content_source_revisions s
        ON s.source_identity=u.source_identity AND s.revision_identity=u.revision_identity
        WHERE u.source_identity=? AND u.revision_identity=? AND u.locator=? AND u.sha256=?`)
        .get(sourceIdentity,revisionIdentity,locator,unitHash);
      return row ? {...row,availability:'retained'} : {availability:'missing_source',sourceIdentity,revisionIdentity,locator};
    },
    memoryPinRevision(id) {
      return db.prepare("SELECT count(*) AS n FROM memory_changes WHERE memory_id=? AND change_type IN ('pin','unpin','legacy_pin_imported')").get(id).n;
    },
    setMemoryPin({id,pinned,expectedRevision,actor='user'}) {
      if (typeof pinned!=='boolean'||!Number.isSafeInteger(expectedRevision)) throw Error('Choose a pin action and revision.');
      return tx(()=>{
        const item=db.prepare('SELECT * FROM memory_items WHERE memory_id=? AND deleted_at IS NULL').get(id);
        if (!item) throw Error('Choose an available memory.');
        const current=this.memoryPinRevision(id);
        if (expectedRevision!==current) throw Object.assign(Error('Pin changed; reload before saving.'),{status:409});
        const now=Date.now();
        if (pinned) db.prepare('INSERT INTO memory_pins VALUES(?,?,?,NULL,?) ON CONFLICT(memory_id) DO UPDATE SET revision=excluded.revision')
          .run(id,now,now,current+1);
        else db.prepare('DELETE FROM memory_pins WHERE memory_id=?').run(id);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(),id,null,pinned?'pin':'unpin',null,null,actor,'','',now);
        if (item.kind==='conversation_snapshot') db.prepare('UPDATE session_annotations SET pinned_at=NULL,revision=revision+1 WHERE project_id=? AND session_id=?')
          .run(item.source_project_id,item.source_session_id);
        return {id,pinnedAt:pinned?db.prepare('SELECT pinned_at FROM memory_pins WHERE memory_id=?').get(id).pinned_at:null,pinRevision:current+1};
      });
    },
  };
}
