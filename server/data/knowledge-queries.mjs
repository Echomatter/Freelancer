import { createJudgmentRecordEvidence } from './judgment-record-evidence.mjs';

export function createKnowledgeQueries(db,tx) {
  const canonical = createJudgmentRecordEvidence(db);
  function hashContext() {
    const charged=new Set();
    const context={storedBytes:0,storedRows:0};
    const charge=(key,row)=>{
      if(charged.has(key)) return;
      if(!row) throw Error('Stored source record is unavailable.');
      if(row.bytes>4_000_000 || context.storedBytes+row.bytes>4_000_000 || context.storedRows+row.rows>8192)
        throw Object.assign(Error('Common query canonical hash work is bounded.'),{code:'KNOWLEDGE_HASH_LIMIT'});
      context.storedBytes+=row.bytes;context.storedRows+=row.rows;charged.add(key);
    };
    context.beforeMemory=(id,revision)=>charge(`memory:${JSON.stringify([id,revision])}`,db.prepare(`SELECT
      length(CAST(r.body||r.provenance_json||r.capture_boundary_json||r.title||r.data_json||r.evidence_json||m.title||m.source_system AS BLOB))
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
    hashMemoryResults(rows) {
      const context=hashContext();
      return rows.map(row=>{
        let recordSha256=null,hashStatus='retained',hashUnavailableReason=null;
        try {
          context.beforeMemory(row.id,row.revision);
          recordSha256=canonical.memory(row.id,row.revision).ref.recordSha256;
        }
        catch(error) {
          const limited=error.code==='KNOWLEDGE_HASH_LIMIT'||/exceeds|exceed|bounded/.test(error.message);
          hashStatus=limited?'hash-limit':'unavailable';hashUnavailableReason=limited?'hash-work-limit':'source-unavailable';
        }
        return {...row,recordSha256,hashStatus,hashUnavailableReason};
      });
    },
    searchClaims({query='',...options}={}) {
      // Former callers retain a read adapter, not a second index or record kind.
      const found=this.searchMemory(query,options);
      return {...found,domain:'memories',results:this.hashMemoryResults(found.items),
        coverage:'Retained memory revisions with optional structured assertions and evidence. Recorded origin and status do not prove current source truth.'};
    },
    readContentEvidence({sourceIdentity,revisionIdentity,locator,unitHash}) {
      const row=db.prepare(`SELECT u.text,u.sha256 AS hash,u.locator,s.virtual_path AS path,s.project_key AS projectKey,
        s.revision_identity AS revisionIdentity FROM content_unit_revisions u JOIN content_source_revisions s
        ON s.source_identity=u.source_identity AND s.revision_identity=u.revision_identity
        WHERE u.source_identity=? AND u.revision_identity=? AND u.locator=? AND u.sha256=?`)
        .get(sourceIdentity,revisionIdentity,locator,unitHash);
      return row ? {...row,availability:'retained'} : {availability:'missing_source',sourceIdentity,revisionIdentity,locator};
    },
  };
}
