import { randomUUID } from 'node:crypto';
import { contentMatch } from '../../domain/content-query.mjs';

export function createKnowledgeQueries(db,tx) {
  function readClaim(id) {
    const row=db.prepare(`SELECT c.claim_id AS id,c.predicate,c.value_json AS valueJSON,c.origin,c.method,
      c.epistemic_state AS epistemicState,c.scope_json AS scopeJSON,c.valid_from AS validFrom,c.valid_to AS validTo,
      c.observed_at AS observedAt,c.recorded_at AS recordedAt,c.superseded_at AS supersededAt,
      s.canonical_name AS subjectName,o.canonical_name AS objectName FROM claims c
      LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
      WHERE c.claim_id=?`).get(id);
    if (!row) return null;
    const {valueJSON,scopeJSON,...item}=row;
    const evidence=db.prepare('SELECT evidence_id AS id,relation,evidence_json AS payload FROM claim_evidence WHERE claim_id=? ORDER BY evidence_id,relation')
      .all(id).map(({payload,...ref})=>({...JSON.parse(payload),...ref}));
    return {...item,value:valueJSON===null?null:JSON.parse(valueJSON),scope:JSON.parse(scopeJSON),evidence};
  }
  return {
    readClaim,
    searchClaims({query='',projectID,epistemicState,origin,model,modelProvider,phrase=false,includeHistorical=false,limit=50}={}) {
      if (typeof query!=='string'||query.length>200) throw Error('Claim search is limited to 200 characters.');
      for (const [name,value,max] of [['Project ID',projectID,2000],['Epistemic state',epistemicState,100],['Origin',origin,100],['Model',model,300],['Model provider',modelProvider,200]])
        if (value!==undefined && (typeof value!=='string'||value.length>max)) throw Error(`${name} filter is invalid or too long.`);
      const bounded=Math.max(1,Math.min(200,Number(limit)||50)),match=contentMatch(query,{phrase});
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
        WHERE ${clauses.join(' AND ')} ORDER BY c.recorded_at DESC,c.claim_id LIMIT ?`)
        .all(...params,bounded+1);
      const results=rows.slice(0,bounded).map(row=>readClaim(row.id));
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
