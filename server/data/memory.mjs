import { randomUUID, createHash } from 'node:crypto';
import { memorySourceType } from '../../domain/knowledge-input.mjs';
import { contentMatch, contentOffset } from '../../domain/content-query.mjs';
import { createKnowledgeQueries } from './knowledge-queries.mjs';
import { installKnowledgeResultFunctions } from './knowledge-result.mjs';

const normalize = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
const json = value => JSON.stringify(value ?? {});
const graphSearchDatabases = new WeakSet();
const requiredText = (value, name, limit = 4000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw Error(`${name} is required and must be at most ${limit} characters.`);
  return value.trim();
};
const objectValue = (value, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${name} must be an object.`);
  return value;
};
function boundedJSON(value, name, fallback, maxBytes = 1_000_000) {
  const input = value === undefined ? fallback : value;
  let encoded;
  try { encoded = JSON.stringify(input); } catch { throw Error(`${name} must contain JSON values.`); }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > maxBytes) throw Error(`${name} must be JSON under ${maxBytes} bytes.`);
  return encoded;
}
function memoryData(value = {}) {
  objectValue(value, 'Memory data');
  for (const key of ['validFrom','validTo','observedAt','recordedAt','supersededAt'])
    if (value[key] !== undefined && value[key] !== null && !Number.isSafeInteger(value[key])) throw Error(`${key} must be safe integer milliseconds or null.`);
  if (value.validFrom != null && value.validTo != null && value.validTo < value.validFrom) throw Error('Memory validity ends before it begins.');
  return boundedJSON(value, 'Memory data', {});
}
function memoryEvidence(value = []) {
  if (!Array.isArray(value) || value.length > 1000) throw Error('Memory evidence accepts at most 1000 references.');
  const entries = value.map(item => {
    objectValue(item, 'Memory evidence reference');
    const id = requiredText(item.id, 'Evidence ID', 2000);
    const relation=item.relation===undefined?undefined:requiredText(item.relation,'Evidence relation',200);
    return { ...item, id, ...(relation===undefined?{}:{relation}) };
  });
  return boundedJSON(entries, 'Memory evidence', []);
}
function memoryBody(value = '') {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1_000_000) throw Error('Memory body must be text under 1 MB.');
  return value;
}
const stableJSON = value => JSON.stringify(value, (_key,item) => item && !Array.isArray(item) && typeof item==='object'
  ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])) : item);
const safeIdentity = value => typeof value==='string' && value.trim() && Buffer.byteLength(value.trim())<=2000 ? value.trim() : null;
const memoryProjectSQL = `COALESCE(m.source_project_id,
  CASE WHEN json_type(r.data_json,'$.scope.projectID')='text' AND length(CAST(json_extract(r.data_json,'$.scope.projectID') AS BLOB))<=2000
    AND trim(json_extract(r.data_json,'$.scope.projectID'))<>'' THEN json_extract(r.data_json,'$.scope.projectID') END,
  CASE WHEN json_type(r.data_json,'$.scope.project')='text' AND length(CAST(json_extract(r.data_json,'$.scope.project') AS BLOB))<=2000
    AND trim(json_extract(r.data_json,'$.scope.project'))<>'' THEN json_extract(r.data_json,'$.scope.project') END)`;
const publicProvenance = value => Object.fromEntries(Object.entries(value).filter(([key])=>key!=='internalCompatibility'));
const utf8Prefix = value => {
  const bytes=Buffer.from(value);let end=bytes.length,index=end-1;
  while(index>=0&&(bytes[index]&0xc0)===0x80)index--;
  if(index>=0){const lead=bytes[index],width=lead<0x80?1:lead>=0xf0?4:lead>=0xe0?3:lead>=0xc0?2:1;if(end-index<width)end=index;}
  return bytes.subarray(0,end).toString('utf8');
};
const revisionInsert = `INSERT INTO memory_item_revisions(revision_id,memory_id,revision,body,provenance_json,capture_boundary_json,created_at,title,data_json,evidence_json)
  VALUES(?,?,?,?,?,?,?,?,?,?)`;

export function createMemoryService(db, tx) {
  installKnowledgeResultFunctions(db);
  if (!graphSearchDatabases.has(db)) {
    db.function('freelancer_memory_contains', { deterministic:true }, (value,query) =>
      typeof value==='string' && normalize(value).includes(normalize(query)) ? 1 : 0);
    graphSearchDatabases.add(db);
  }
  function rememberConversationSnapshotInTransaction({ projectID, sessionID, title, parentID = null, annotationRevision = 0, creationChange = 'snapshot_created', actor='user',provenance={} }) {
    if (!projectID || !sessionID) throw Error('Conversation identity is required.');
    const id = `conversation:${projectID}:${sessionID}`, now = Date.now(), revisionID = randomUUID();
    const existing = db.prepare('SELECT memory_id,kind,source_project_id,source_session_id,deleted_at FROM memory_items WHERE memory_id=?').get(id);
    if(existing&&(existing.kind!=='conversation_snapshot'||existing.source_project_id!==projectID||existing.source_session_id!==sessionID))throw Error('Conversation memory identity conflicts with a different retained object.');
    const header = db.prepare('SELECT created_at AS createdAt,updated_at AS updatedAt,title FROM session_headers WHERE project_id=? AND session_id=?').get(projectID,sessionID);
    const metadata = header ? { title: header.title, createdAt: header.createdAt, updatedAt: header.updatedAt, parentID } : { title: title || 'Missing conversation source', missingSource: true, parentID };
    if (!existing) {
      db.prepare('INSERT INTO memory_items VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(id,'conversation_snapshot',String(title || metadata.title).slice(0,1000),'active','opencode',projectID,sessionID,now,now);
      db.prepare(revisionInsert).run(revisionID,id,1,'',json({ ...publicProvenance(provenance),sourceSystem:'opencode', projectID, sessionID, title:metadata.title }),json({ status:'metadata_only', capturedAt:null, annotationRevision }),now,String(title || metadata.title).slice(0,1000),'{}','[]');
      db.prepare('INSERT INTO memory_members VALUES(?,?,?,?,?,?,?,?)').run(revisionID,0,'conversation',`${projectID}/${sessionID}`,null,json(metadata),null,header ? 'not_captured' : 'missing_source');
      db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,null,creationChange,null,revisionID,
        actor,`${projectID}/${sessionID}`,
        'Conversation snapshot placeholder created.',now);
    }
    if (existing?.deleted_at != null)
      {
        // Forget erased the former transcript. Remembering starts a new source
        // placeholder; its redacted revisions never become evidence again.
        const current=db.prepare('SELECT revision,revision_id FROM memory_item_revisions WHERE memory_id=? ORDER BY revision DESC LIMIT 1').get(id);
        const memoryTitle=String(title||metadata.title).slice(0,1000);
        db.prepare("UPDATE memory_items SET title=?,status='active',deleted_at=NULL,updated_at=? WHERE memory_id=?").run(memoryTitle,now,id);
        db.prepare(revisionInsert).run(revisionID,id,(current?.revision??0)+1,'',json({...publicProvenance(provenance),sourceSystem:'opencode',projectID,sessionID,title:metadata.title}),
          json({status:'metadata_only',capturedAt:null,annotationRevision}),now,memoryTitle,'{}','[]');
        db.prepare('INSERT INTO memory_members VALUES(?,?,?,?,?,?,?,?)').run(revisionID,0,'conversation',`${projectID}/${sessionID}`,null,json(metadata),null,header?'not_captured':'missing_source');
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,null,'snapshot_created',current?.revision_id??null,revisionID,
          actor,`${projectID}/${sessionID}`,'Created a fresh source placeholder after a forgotten snapshot was remembered again.',now);
      }
    return { id,sourceStatus:header ? 'metadata_only' : 'missing_source', created:!existing||existing.deleted_at!=null };
  }
  function createEntity({ id = randomUUID(), type, name, aliases = [], sourceRef = '' }) {
    const entityType = requiredText(type, 'Entity type', 200), canonicalName = requiredText(name, 'Entity name', 1000);
    const normalizedName = normalize(canonicalName), now = Date.now();
    return tx(() => {
      if (db.prepare('SELECT entity_id FROM entities WHERE entity_id=?').get(id)) return { id, created: false };
      const existing = db.prepare('SELECT entity_id FROM entities WHERE entity_type=? AND normalized_name=?').get(entityType, normalizedName);
      if (existing) {
        for (const alias of aliases) addAlias(existing.entity_id, alias, sourceRef);
        return { id: existing.entity_id, created: false, duplicate: true };
      }
      db.prepare('INSERT INTO entities VALUES(?,?,?,?,?,?)').run(id, entityType, canonicalName, normalizedName, now, now);
      for (const alias of aliases) addAlias(id, alias, sourceRef);
      return { id, created: true };
    });
  }
  function addAlias(id, value, sourceRef = '') {
    const alias = requiredText(value, 'Alias', 1000), key = normalize(alias);
    const owner = db.prepare('SELECT entity_id FROM entities WHERE entity_id=?').get(id);
    if (!owner) throw Error('Entity does not exist.');
    const collision = db.prepare('SELECT entity_id FROM entity_aliases WHERE normalized_alias=?').get(key);
    if (collision && collision.entity_id !== id) throw Error('Alias already identifies a different entity.');
    db.prepare('INSERT INTO entity_aliases VALUES(?,?,?,?,?) ON CONFLICT(entity_id,normalized_alias) DO NOTHING').run(id, alias, key, String(sourceRef), Date.now());
  }
  function latestRelationRevision(id) {
    return db.prepare('SELECT * FROM entity_relation_revisions WHERE relation_id=? ORDER BY revision DESC LIMIT 1').get(id);
  }
  function recordRelationRevision({ relationID, revision, from, type, to, provenance, validFrom, validTo,
    operation, actor = 'user', reason = '', recordedAt = Date.now() }) {
    const revisionID = randomUUID();
    db.prepare(`INSERT INTO entity_relation_revisions(revision_id,relation_id,revision,from_entity_id,relation_type,to_entity_id,
      provenance_json,valid_from,valid_to,operation,actor,reason,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(revisionID,relationID,revision,from,type,to,json(provenance),validFrom,validTo,operation,
        String(actor).slice(0,200),String(reason).slice(0,2000),recordedAt);
    return { revisionID, revision };
  }
  const relationTimes = (validFrom, validTo, fallback = Date.now()) => {
    const start = validFrom === undefined ? fallback : validFrom;
    const end = validTo === undefined ? null : validTo;
    if (!Number.isSafeInteger(start) || (end !== null && !Number.isSafeInteger(end)))
      throw Error('Relation validity timestamps must be safe integer milliseconds.');
    if (end !== null && end < start) throw Error('Relation validity ends before it begins.');
    return { validFrom: start, validTo: end };
  };
  const graphLimit = (value, fallback = 50, max = 100) => Math.max(1,Math.min(max,Number.isSafeInteger(value) ? value : fallback));
  const graphOffset = value => {
    if (value === undefined) return 0;
    if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) throw Error('Graph offset must be an integer from 0 to 100000.');
    return value;
  };
  const publicEntity = row => row ? ({ id:row.id,type:row.type,name:row.name,createdAt:row.createdAt,updatedAt:row.updatedAt }) : null;
  function entityRows(ids, limit = 500) {
    if (!ids.length) return {entities:[],truncated:false};
    const rows=db.prepare(`SELECT entity_id AS id,entity_type AS type,canonical_name AS name,created_at AS createdAt,updated_at AS updatedAt
      FROM entities WHERE entity_id IN (${ids.map(()=>'?').join(',')}) ORDER BY canonical_name,entity_id LIMIT ?`).all(...ids,limit+1);
    const bounded=rows.slice(0,limit);
    if(!bounded.length) return {entities:[],truncated:rows.length>limit};
    const aliases=db.prepare(`WITH ranked AS (
        SELECT entity_id,alias,row_number() OVER(PARTITION BY entity_id ORDER BY normalized_alias) AS row_no,
          count(*) OVER(PARTITION BY entity_id) AS total
        FROM entity_aliases WHERE entity_id IN (${bounded.map(()=>'?').join(',')})
      ) SELECT entity_id AS entityID,alias,total FROM ranked WHERE row_no<=20 ORDER BY entity_id,row_no`)
      .all(...bounded.map(row=>row.id));
    const byID=new Map(bounded.map(row=>[row.id,{...publicEntity(row),aliases:[],aliasesTruncated:false} ]));
    for (const row of aliases) {
      const entity=byID.get(row.entityID);
      if(entity) { entity.aliases.push(row.alias);entity.aliasesTruncated=row.total>20; }
    }
    return { entities:[...byID.values()], truncated:rows.length>limit };
  }
  function relationRows(ids, limit = 200) {
    const bounded=graphLimit(limit,200,200);
    const params=[];
    let where='1=1';
    if (ids) {
      if (!ids.length) return {relations:[],truncated:false};
      where=`(r.from_entity_id IN (${ids.map(()=>'?').join(',')}) OR r.to_entity_id IN (${ids.map(()=>'?').join(',')}))`;
      params.push(...ids,...ids);
    }
    const rows=db.prepare(`SELECT r.relation_id AS id,r.from_entity_id AS fromEntityID,r.relation_type AS type,r.to_entity_id AS toEntityID,
        CASE WHEN length(CAST(r.provenance_json AS BLOB))<=8192 THEN r.provenance_json ELSE '{"summaryTruncated":true}' END AS provenanceJSON,
        length(CAST(r.provenance_json AS BLOB))>8192 AS provenanceTruncated,r.created_at AS createdAt,h.revision,h.valid_from AS validFrom,h.valid_to AS validTo
      FROM entity_relations r JOIN entity_relation_revisions h ON h.relation_id=r.relation_id
        AND h.revision=(SELECT max(x.revision) FROM entity_relation_revisions x WHERE x.relation_id=r.relation_id)
      WHERE ${where} AND h.operation<>'retracted' ORDER BY r.created_at,r.relation_id LIMIT ?`).all(...params,bounded+1);
    return {relations:rows.slice(0,bounded).map(row=>({...row,provenance:JSON.parse(row.provenanceJSON),provenanceJSON:undefined,
      provenanceTruncated:!!row.provenanceTruncated})),truncated:rows.length>bounded};
  }
  function observationRows(entityIDs, {query='',limit=100}={}) {
    if (!entityIDs.length) return {observations:[],truncated:false};
    const bounded=graphLimit(limit,100,200),needle=query?normalize(query):'';
    const placeholders=entityIDs.map(()=>'?').join(',');
    const rows=db.prepare(`SELECT c.claim_id AS id,c.subject_entity_id AS subjectEntityID,c.predicate,c.object_entity_id AS objectEntityID,
        CASE WHEN length(CAST(COALESCE(c.value_json,'') AS BLOB))<=2000 THEN c.value_json ELSE NULL END AS valueJSON,
        substr(COALESCE(c.value_json,''),1,2000) AS valuePreview,length(CAST(COALESCE(c.value_json,'') AS BLOB))>2000 AS valueTruncated,
        c.origin,c.method,c.epistemic_state AS epistemicState,c.valid_from AS validFrom,c.valid_to AS validTo,
        c.observed_at AS observedAt,c.recorded_at AS recordedAt,
        (SELECT count(*) FROM claim_evidence e WHERE e.claim_id=c.claim_id) AS evidenceCount,
        (SELECT json_group_array(json_object('id',refs.evidence_id,'relation',refs.relation)) FROM
          (SELECT evidence_id,relation FROM claim_evidence WHERE claim_id=c.claim_id ORDER BY evidence_id,relation LIMIT 5) refs) AS evidenceRefsJSON,
        (SELECT count(*)>5 FROM claim_evidence e WHERE e.claim_id=c.claim_id) AS evidenceRefsTruncated
      FROM claims c WHERE c.superseded_at IS NULL AND c.epistemic_state<>'superseded'
        AND (c.subject_entity_id IN (${placeholders}) OR c.object_entity_id IN (${placeholders}))
        AND (?='' OR freelancer_memory_contains(c.predicate||' '||COALESCE(c.value_json,''),?)=1
          OR EXISTS(SELECT 1 FROM claim_evidence e WHERE e.claim_id=c.claim_id AND freelancer_memory_contains(e.evidence_json,?)=1))
      ORDER BY c.recorded_at DESC,c.claim_id LIMIT ?`).all(...entityIDs,...entityIDs,needle,needle,needle,bounded+1);
    return {observations:rows.slice(0,bounded).map(row=>{
      const {valueJSON,valuePreview,valueTruncated,evidenceRefsJSON,evidenceRefsTruncated,...claim}=row;
      let value=null;
      if(valueJSON!==null) { try {value=JSON.parse(valueJSON);} catch {value=valueJSON;} }
      return {...claim,value,evidenceRefs:JSON.parse(evidenceRefsJSON??'[]'),evidenceRefsTruncated:!!evidenceRefsTruncated,
        ...(valueTruncated?{valuePreview,valueTruncated:true}:{})};
    }),truncated:rows.length>bounded};
  }
  function graphObservationPage(offset,limit) {
    const bounded=graphLimit(limit,100,100),start=graphOffset(offset);
    const rows=db.prepare(`SELECT c.claim_id AS id,c.subject_entity_id AS subjectEntityID,c.predicate,c.object_entity_id AS objectEntityID,
        CASE WHEN length(CAST(COALESCE(c.value_json,'') AS BLOB))<=2000 THEN c.value_json ELSE NULL END AS valueJSON,
        substr(COALESCE(c.value_json,''),1,2000) AS valuePreview,length(CAST(COALESCE(c.value_json,'') AS BLOB))>2000 AS valueTruncated,
        c.origin,c.method,c.epistemic_state AS epistemicState,c.valid_from AS validFrom,c.valid_to AS validTo,
        c.observed_at AS observedAt,c.recorded_at AS recordedAt,
        (SELECT count(*) FROM claim_evidence e WHERE e.claim_id=c.claim_id) AS evidenceCount,
        (SELECT json_group_array(json_object('id',refs.evidence_id,'relation',refs.relation)) FROM
          (SELECT evidence_id,relation FROM claim_evidence WHERE claim_id=c.claim_id ORDER BY evidence_id,relation LIMIT 5) refs) AS evidenceRefsJSON,
        (SELECT count(*)>5 FROM claim_evidence e WHERE e.claim_id=c.claim_id) AS evidenceRefsTruncated
      FROM claims c WHERE c.superseded_at IS NULL AND c.epistemic_state<>'superseded'
      ORDER BY c.recorded_at DESC,c.claim_id LIMIT ? OFFSET ?`).all(bounded+1,start);
    const observations=rows.slice(0,bounded).map(row=>{
      const {valueJSON,valuePreview,valueTruncated,evidenceRefsJSON,evidenceRefsTruncated,...claim}=row;
      let value=null;
      if(valueJSON!==null) { try {value=JSON.parse(valueJSON);} catch {value=valueJSON;} }
      return {...claim,value,evidenceRefs:JSON.parse(evidenceRefsJSON??'[]'),evidenceRefsTruncated:!!evidenceRefsTruncated,
        ...(valueTruncated?{valuePreview,valueTruncated:true}:{})};
    });
    return {observations,truncated:rows.length>bounded,nextOffset:rows.length>bounded?start+bounded:null,offset:start};
  }
  function decorateEntity(entity) {
    if(!entity) return null;
    const aliases=db.prepare('SELECT alias FROM entity_aliases WHERE entity_id=? ORDER BY normalized_alias LIMIT 101').all(entity.id);
    const rels=relationRows([entity.id],200),obs=observationRows([entity.id],{limit:100});
    return {...entity,aliases:aliases.slice(0,100).map(row=>row.alias),aliasesTruncated:aliases.length>100,
      relations:rels.relations,relationsTruncated:rels.truncated,observations:obs.observations,observationsTruncated:obs.truncated};
  }
  return {
    ...createKnowledgeQueries(db,tx),
    createEntity,
    addAlias(id, alias, sourceRef = '') { return tx(() => { addAlias(id, alias, sourceRef); return { id, alias }; }); },
    deleteEntity({ id, actor = 'user', reason = '' }) {
      const entityID = requiredText(id, 'Entity ID', 2000);
      return tx(() => {
        const entity = db.prepare('SELECT entity_id FROM entities WHERE entity_id=?').get(entityID);
        if (!entity) return { id:entityID, deleted:false, relationsDeleted:0 };
        const memoryRefs = db.prepare(`SELECT count(DISTINCT r.memory_id) AS n FROM memory_item_revisions r JOIN memory_items m USING(memory_id)
          WHERE m.deleted_at IS NULL AND (json_extract(r.data_json,'$.subjectEntityID')=? OR json_extract(r.data_json,'$.objectEntityID')=?)`).get(entityID,entityID).n;
        if (memoryRefs) return { id:entityID, deleted:false, reason:'memories_reference_entity', memoriesRetained:memoryRefs };
        const relations = db.prepare('SELECT * FROM entity_relations WHERE from_entity_id=? OR to_entity_id=?').all(entityID,entityID);
        const relationsDeleted = relations.length, now = Date.now();
        for (const relation of relations) {
          const current = latestRelationRevision(relation.relation_id);
          const times = relationTimes(current?.valid_from, current?.valid_to, relation.created_at);
          recordRelationRevision({ relationID:relation.relation_id,revision:(current?.revision ?? 0)+1,
            from:relation.from_entity_id,type:relation.relation_type,to:relation.to_entity_id,
            provenance:JSON.parse(relation.provenance_json),validFrom:times.validFrom,
            validTo:times.validTo ?? Math.max(now,times.validFrom),operation:'retracted',actor,reason,recordedAt:now });
          db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(
            randomUUID(),null,null,'relation_deleted_with_entity',relation.relation_id,null,String(actor),
            `${relation.from_entity_id}/${relation.relation_type}/${relation.to_entity_id}`,String(reason),now);
        }
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(
          randomUUID(),null,null,'entity_deleted',entityID,null,String(actor),'',String(reason),now);
        db.prepare('DELETE FROM entities WHERE entity_id=?').run(entityID);
        return { id:entityID, deleted:true, relationsDeleted };
      });
    },
    findEntity(query) {
      const value = requiredText(query, 'Entity query', 1000), key = normalize(value);
      const exact = db.prepare(`SELECT entity_id AS id,entity_type AS type,canonical_name AS name FROM entities WHERE normalized_name=?
        UNION SELECT e.entity_id,e.entity_type,e.canonical_name FROM entity_aliases a JOIN entities e USING(entity_id) WHERE a.normalized_alias=? LIMIT 20`).all(key, key);
      return exact;
    },
    readEntity(id) {
      const entityID=requiredText(id,'Entity ID',2000);
      const row=db.prepare(`SELECT entity_id AS id,entity_type AS type,canonical_name AS name,created_at AS createdAt,updated_at AS updatedAt
        FROM entities WHERE entity_id=?`).get(entityID);
      return row ? {status:'ok',entity:decorateEntity(row)} : {status:'missing',id:entityID};
    },
    openNodes({ids=[],names=[],limit=100}={}) {
      if(!Array.isArray(ids)||!Array.isArray(names)||ids.length+names.length>100) throw Error('Open nodes accepts at most 100 entity IDs and names combined.');
      const requested=new Set();
      for(const id of ids) requested.add(requiredText(id,'Entity ID',2000));
      for(const name of names) for(const entity of this.findEntity(name)) {
        if(!requested.has(entity.id)&&requested.size>=100) throw Error('Open nodes resolves to more than 100 entity IDs.');
        requested.add(entity.id);
      }
      const requestedIDs=[...requested];
      if(!requestedIDs.length) return {status:'empty',entities:[],relations:[],observations:[],truncated:false};
      const relationLimit=graphLimit(limit,100,200),rels=relationRows(requestedIDs,relationLimit);
      const neighborIDs=new Set(requestedIDs);
      for(const relation of rels.relations) { neighborIDs.add(relation.fromEntityID); neighborIDs.add(relation.toEntityID); }
      const entityLimit=Math.min(500,Math.max(100,requestedIDs.length+relationLimit*2));
      const found=entityRows([...neighborIDs],entityLimit);
      const observations=observationRows([...neighborIDs],{limit:200});
      return {status:'ok',requestedEntityIDs:requestedIDs,entities:found.entities,relations:rels.relations,observations:observations.observations,
        truncated:rels.truncated||found.truncated||observations.truncated};
    },
    readGraph({entityOffset=0,relationOffset=0,observationOffset=0,limit=100}={}) {
      const bounded=graphLimit(limit,100,100),entityStart=graphOffset(entityOffset),relationStart=graphOffset(relationOffset);
      const entities=db.prepare(`SELECT entity_id AS id,entity_type AS type,canonical_name AS name,created_at AS createdAt,updated_at AS updatedAt
        FROM entities ORDER BY canonical_name,entity_id LIMIT ? OFFSET ?`).all(bounded+1,entityStart);
      const relations=db.prepare(`SELECT r.relation_id AS id,r.from_entity_id AS fromEntityID,r.relation_type AS type,r.to_entity_id AS toEntityID,
          CASE WHEN length(CAST(r.provenance_json AS BLOB))<=8192 THEN r.provenance_json ELSE '{"summaryTruncated":true}' END AS provenanceJSON,
          length(CAST(r.provenance_json AS BLOB))>8192 AS provenanceTruncated,r.created_at AS createdAt,h.revision,h.valid_from AS validFrom,h.valid_to AS validTo
        FROM entity_relations r JOIN entity_relation_revisions h ON h.relation_id=r.relation_id
          AND h.revision=(SELECT max(x.revision) FROM entity_relation_revisions x WHERE x.relation_id=r.relation_id)
        WHERE h.operation<>'retracted' ORDER BY r.created_at,r.relation_id LIMIT ? OFFSET ?`).all(bounded+1,relationStart);
      const entityRowsPage=entities.slice(0,bounded),entityPage=entityRows(entityRowsPage.map(row=>row.id),bounded),relationRowsPage=relations.slice(0,bounded).map(row=>({...row,
        provenance:JSON.parse(row.provenanceJSON),provenanceJSON:undefined,provenanceTruncated:!!row.provenanceTruncated}));
      const hasMoreEntities=entities.length>bounded,hasMoreRelations=relations.length>bounded;
      const observationPage=graphObservationPage(observationOffset,bounded);
      return {status:'ok',entities:entityPage.entities,relations:relationRowsPage,observations:observationPage.observations,
        entityOffset:entityStart,relationOffset:relationStart,observationOffset:observationPage.offset,
        nextEntityOffset:hasMoreEntities?entityStart+bounded:null,nextRelationOffset:hasMoreRelations?relationStart+bounded:null,
        nextObservationOffset:observationPage.nextOffset,
        truncated:hasMoreEntities||hasMoreRelations||entityPage.truncated||observationPage.truncated};
    },
    searchNodes(query,{limit=50}={}) {
      const text=requiredText(query,'Graph search query',200),needle=normalize(text),bounded=graphLimit(limit,50,100);
      const rows=db.prepare(`SELECT e.entity_id AS id,e.entity_type AS type,e.canonical_name AS name,
          e.created_at AS createdAt,e.updated_at AS updatedAt,
          CASE WHEN freelancer_memory_contains(e.canonical_name,?)=1 THEN 'name'
            WHEN freelancer_memory_contains(e.entity_type,?)=1 THEN 'type'
            WHEN EXISTS(SELECT 1 FROM entity_aliases a WHERE a.entity_id=e.entity_id AND freelancer_memory_contains(a.alias,?)=1) THEN 'alias'
            ELSE 'observation' END AS matchKind
        FROM entities e WHERE freelancer_memory_contains(e.canonical_name,?)=1 OR freelancer_memory_contains(e.entity_type,?)=1
          OR EXISTS(SELECT 1 FROM entity_aliases a WHERE a.entity_id=e.entity_id AND freelancer_memory_contains(a.alias,?)=1)
          OR EXISTS(SELECT 1 FROM claims c WHERE (c.subject_entity_id=e.entity_id OR c.object_entity_id=e.entity_id)
            AND c.superseded_at IS NULL AND c.epistemic_state<>'superseded'
            AND (freelancer_memory_contains(c.predicate||' '||COALESCE(c.value_json,''),?)=1 OR EXISTS(
              SELECT 1 FROM claim_evidence ce WHERE ce.claim_id=c.claim_id AND freelancer_memory_contains(ce.evidence_json,?)=1)))
        ORDER BY CASE WHEN freelancer_memory_contains(e.canonical_name,?)=1 THEN 0 WHEN freelancer_memory_contains(e.entity_type,?)=1 THEN 1 ELSE 2 END,
        e.canonical_name,e.entity_id LIMIT ?`).all(needle,needle,needle,needle,needle,needle,needle,needle,needle,needle,bounded+1);
      const selected=rows.slice(0,bounded),ids=selected.map(row=>row.id),rels=relationRows(ids,200),obs=observationRows(ids,{limit:200});
      const entities=entityRows(ids,bounded).entities.map(entity=>({...entity,matchKind:selected.find(row=>row.id===entity.id)?.matchKind ?? 'observation'}));
      return {status:entities.length?'ok':'empty',query:text,entities,relations:rels.relations,observations:obs.observations,
        truncated:rows.length>bounded||rels.truncated||obs.truncated};
    },
    addRelation({ id = randomUUID(), from, type, to, provenance = {}, validFrom, validTo, actor = 'user', reason = '' }) {
      const relationType = requiredText(type, 'Relation type', 200);
      if (!from || !to || from === to) throw Error('Choose two existing, distinct relation endpoints.');
      return tx(() => {
        if (!db.prepare('SELECT 1 FROM entities WHERE entity_id=?').get(from) || !db.prepare('SELECT 1 FROM entities WHERE entity_id=?').get(to))
          throw Error('Both relation endpoints must exist.');
        const prior = db.prepare('SELECT relation_id AS id FROM entity_relations WHERE from_entity_id=? AND relation_type=? AND to_entity_id=?').get(from, relationType, to);
        if (prior) return { id: prior.id, created: false, revision:latestRelationRevision(prior.id)?.revision ?? 1 };
        const now=Date.now(),times=relationTimes(validFrom,validTo,now);
        db.prepare('INSERT INTO entity_relations VALUES(?,?,?,?,?,?)').run(id, from, relationType, to, json(provenance), now);
        const saved=recordRelationRevision({relationID:id,revision:1,from,type:relationType,to,provenance,
          ...times,operation:'created',actor,reason,recordedAt:now});
        return { id, created: true, revision:saved.revision, validFrom:times.validFrom, validTo:times.validTo };
      });
    },
    reviseRelation({ id, expectedRevision, from, type, to, provenance, validFrom, validTo, actor='user', reason='' }) {
      const relationID=requiredText(id,'Relation ID',2000);
      if (!Number.isSafeInteger(expectedRevision)||expectedRevision<1) throw Error('Relation revision must be a positive integer.');
      return tx(()=>{
        const prior=db.prepare('SELECT * FROM entity_relations WHERE relation_id=?').get(relationID);
        const current=latestRelationRevision(relationID);
        if (!prior||!current||current.operation==='retracted') throw Error('Relation does not exist.');
        if (current.revision!==expectedRevision) throw Object.assign(Error('Relation changed; reload before revising it.'),{status:409});
        const next={from:from===undefined?prior.from_entity_id:requiredText(from,'From entity ID',2000),
          type:type===undefined?prior.relation_type:requiredText(type,'Relation type',200),
          to:to===undefined?prior.to_entity_id:requiredText(to,'To entity ID',2000),
          provenance:provenance===undefined?JSON.parse(prior.provenance_json):provenance};
        if(next.from===next.to) throw Error('Choose two existing, distinct relation endpoints.');
        if(!db.prepare('SELECT 1 FROM entities WHERE entity_id=?').get(next.from)||!db.prepare('SELECT 1 FROM entities WHERE entity_id=?').get(next.to))
          throw Error('Both relation endpoints must exist.');
        const duplicate=db.prepare('SELECT relation_id FROM entity_relations WHERE from_entity_id=? AND relation_type=? AND to_entity_id=? AND relation_id<>?')
          .get(next.from,next.type,next.to,relationID);
        if(duplicate) throw Error('Another relation already has these endpoints and type.');
        const times=relationTimes(validFrom===undefined?current.valid_from:validFrom,validTo===undefined?current.valid_to:validTo,current.valid_from);
        const now=Date.now();
        db.prepare('UPDATE entity_relations SET from_entity_id=?,relation_type=?,to_entity_id=?,provenance_json=? WHERE relation_id=?')
          .run(next.from,next.type,next.to,json(next.provenance),relationID);
        const saved=recordRelationRevision({relationID,revision:current.revision+1,...next,...times,
          operation:'revised',actor,reason,recordedAt:now});
        return {id:relationID,revision:saved.revision,updated:true,validFrom:times.validFrom,validTo:times.validTo};
      });
    },
    listRelations({ entityID, asOf, limit = 100 } = {}) {
      const bounded = Math.max(1,Math.min(500,Number(limit) || 100));
      if (entityID !== undefined) requiredText(entityID,'Entity ID',2000);
      if (asOf !== undefined) {
        if (!Number.isSafeInteger(asOf)) throw Error('Relation as-of time must be a safe integer in milliseconds.');
        const rows = db.prepare(`WITH qualified AS (
            SELECT h.*,row_number() OVER(PARTITION BY h.relation_id ORDER BY h.revision DESC) AS selected_revision
            FROM entity_relation_revisions h
            WHERE h.operation<>'retracted' AND h.valid_from<=? AND (h.valid_to IS NULL OR h.valid_to>?)
              AND NOT EXISTS (SELECT 1 FROM entity_relation_revisions deleted
                WHERE deleted.relation_id=h.relation_id AND deleted.operation='retracted' AND deleted.recorded_at<=?)
          ) SELECT relation_id AS id,from_entity_id AS fromEntityID,relation_type AS type,to_entity_id AS toEntityID,
            provenance_json AS provenance,(SELECT min(created.recorded_at) FROM entity_relation_revisions created
              WHERE created.relation_id=qualified.relation_id) AS createdAt,revision,valid_from AS validFrom,valid_to AS validTo
          FROM qualified WHERE selected_revision=1 AND (? IS NULL OR from_entity_id=? OR to_entity_id=?)
          ORDER BY createdAt,relation_id LIMIT ?`).all(asOf,asOf,asOf,entityID ?? null,entityID ?? null,entityID ?? null,bounded);
        return rows.map(row=>({...row,provenance:JSON.parse(row.provenance)}));
      }
      const rows = entityID === undefined
        ? db.prepare(`SELECT r.relation_id AS id,r.from_entity_id AS fromEntityID,r.relation_type AS type,r.to_entity_id AS toEntityID,
            r.provenance_json AS provenance,r.created_at AS createdAt,h.revision,h.valid_from AS validFrom,h.valid_to AS validTo
            FROM entity_relations r JOIN entity_relation_revisions h ON h.relation_id=r.relation_id
            AND h.revision=(SELECT max(x.revision) FROM entity_relation_revisions x WHERE x.relation_id=r.relation_id)
            WHERE h.operation<>'retracted' ORDER BY r.created_at,r.relation_id LIMIT ?`).all(bounded)
        : db.prepare(`SELECT r.relation_id AS id,r.from_entity_id AS fromEntityID,r.relation_type AS type,r.to_entity_id AS toEntityID,
            r.provenance_json AS provenance,r.created_at AS createdAt,h.revision,h.valid_from AS validFrom,h.valid_to AS validTo
            FROM entity_relations r JOIN entity_relation_revisions h ON h.relation_id=r.relation_id
            AND h.revision=(SELECT max(x.revision) FROM entity_relation_revisions x WHERE x.relation_id=r.relation_id)
            WHERE h.operation<>'retracted' AND (r.from_entity_id=? OR r.to_entity_id=?) ORDER BY r.created_at,r.relation_id LIMIT ?`).all(entityID,entityID,bounded);
      return rows.map(row=>({...row,provenance:JSON.parse(row.provenance)}));
    },
    relationHistory({id,limit=100}={}) {
      const relationID=requiredText(id,'Relation ID',2000),bounded=Math.max(1,Math.min(500,Number(limit)||100));
      const rows=db.prepare(`SELECT revision_id AS revisionID,relation_id AS relationID,revision,from_entity_id AS fromEntityID,
        relation_type AS type,to_entity_id AS toEntityID,provenance_json AS provenance,valid_from AS validFrom,valid_to AS validTo,
        operation,actor,reason,recorded_at AS recordedAt FROM entity_relation_revisions
        WHERE relation_id=? ORDER BY revision DESC LIMIT ?`).all(relationID,bounded);
      return rows.map(row=>({...row,provenance:JSON.parse(row.provenance)}));
    },
    deleteRelation({ id, actor = 'user', reason = '' }) {
      const relationID = requiredText(id,'Relation ID',2000);
      return tx(() => {
        const relation = db.prepare(`SELECT from_entity_id AS fromID,relation_type AS type,to_entity_id AS toID
          FROM entity_relations WHERE relation_id=?`).get(relationID);
        if (!relation) return { id:relationID, deleted:false };
        const current=latestRelationRevision(relationID),now=Date.now();
        const times=relationTimes(current?.valid_from,current?.valid_to);
        recordRelationRevision({relationID,revision:(current?.revision??0)+1,from:relation.fromID,type:relation.type,to:relation.toID,
          provenance:JSON.parse(db.prepare('SELECT provenance_json FROM entity_relations WHERE relation_id=?').get(relationID).provenance_json),
          validFrom:times.validFrom,validTo:times.validTo??Math.max(now,times.validFrom),operation:'retracted',actor,reason,recordedAt:now});
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(
          randomUUID(),null,null,'relation_deleted',relationID,null,String(actor),
          `${relation.fromID}/${relation.type}/${relation.toID}`,String(reason),now);
        db.prepare('DELETE FROM entity_relations WHERE relation_id=?').run(relationID);
        return { id:relationID, deleted:true };
      });
    },
    // Hidden compatibility adapters all write the same retained memory service.
    addClaim(input) {
      const predicate = requiredText(input.predicate, 'Claim predicate', 1000);
      const allowedOrigins = new Set(['human-authored','user-stated','source-reported','directly-observed','deterministically-extracted','model-inferred']);
      const allowedStates = new Set(['unverified','supported','disputed','superseded']);
      if (!allowedOrigins.has(input.origin) || !allowedStates.has(input.epistemicState)) throw Error('Claim origin or epistemic state is invalid.');
      if (!Array.isArray(input.evidence) || !input.evidence.length) throw Error('A claim needs 1 to 1000 evidence references.');
      if(input.evidence.some(entry=>entry.relation!==undefined&&!['supports','contradicts','qualifies','supersedes'].includes(entry.relation))) throw Error('Claim evidence relation is invalid.');
      const encodedEvidence = memoryEvidence(input.evidence), now = Date.now();
      return tx(() => {
        const duplicate = db.prepare(`SELECT c.claim_id AS id FROM claims c WHERE c.predicate=? AND c.origin=? AND c.method=? AND c.epistemic_state=?
          AND COALESCE(c.subject_entity_id,'')=? AND COALESCE(c.object_entity_id,'')=? AND COALESCE(c.value_json,'')=? AND c.scope_json=? LIMIT 1`)
          .get(predicate,input.origin,String(input.method ?? 'manual'),input.epistemicState,input.subjectEntityID ?? '',input.objectEntityID ?? '',
            input.value === undefined ? '' : json(input.value),json(input.scope));
        if (duplicate) {
          const current=this.getMemory(duplicate.id), entries=JSON.parse(encodedEvidence);
          const merged=new Map(current.revision.evidence.map(entry=>[JSON.stringify([entry.id,entry.relation??'supports']),entry]));
          for (const entry of entries) {
            const key=JSON.stringify([entry.id,entry.relation??'supports']);
            if(!merged.has(key)) merged.set(key,{...entry,createdAt:now});
          }
          if(merged.size!==current.revision.evidence.length)
            this.reviseMemory({id:duplicate.id,expectedRevision:current.revision.revision,evidence:[...merged.values()],actor:input.actor??'user',reason:'Additional retained evidence.'});
          return {id:duplicate.id,created:false};
        }
        const data={predicate,origin:input.origin,method:String(input.method??'manual'),epistemicState:input.epistemicState,
          scope:input.scope??{},validFrom:input.validFrom??null,validTo:input.validTo??null,observedAt:input.observedAt??null,
          recordedAt:now,supersededAt:input.epistemicState==='superseded'?now:null,subjectEntityID:input.subjectEntityID??null,
          objectEntityID:input.objectEntityID??null,actor:String(input.actor??''),modelProvider:input.modelProvider??null,modelID:input.modelID??null,
          ...(input.value===undefined?{}:{value:input.value})};
        return this.createMemory({id:input.id??randomUUID(),title:predicate,data,
          evidence:JSON.parse(encodedEvidence).map(entry=>({...entry,createdAt:now})),
          source:{system:'freelancer',projectID:data.scope.projectID??data.scope.project??null},actor:input.actor??'user'});
      });
    },
    correctClaim({id,expectedEpistemicState,expectedRevision,predicate,subjectEntityID,objectEntityID,value,
      origin,method,epistemicState,scope,validFrom,validTo,observedAt,evidence,actor='user',reason=''}) {
      if (!Array.isArray(evidence) || !evidence.length) throw Error('A claim correction needs 1 to 1000 evidence references.');
      if(evidence.some(entry=>entry.relation!==undefined&&!['supports','contradicts','qualifies','supersedes'].includes(entry.relation))) throw Error('Claim evidence relation is invalid.');
      if(!['unverified','supported','disputed'].includes(epistemicState)) throw Error('A correction must state its epistemic status.');
      return tx(()=>{
        const memory=this.getMemory(requiredText(id,'Claim ID',2000)),prior=memory?.revision.data;
        if(!prior?.predicate || prior.supersededAt!=null || prior.epistemicState==='superseded') throw Object.assign(Error('Claim is missing or already superseded.'),{status:409});
        if(expectedEpistemicState && prior.epistemicState!==expectedEpistemicState) throw Object.assign(Error('Claim changed; reload before correcting it.'),{status:409});
        const data={...prior,predicate:requiredText(predicate??prior.predicate,'Claim predicate',1000),epistemicState,
          subjectEntityID:subjectEntityID===undefined?prior.subjectEntityID:subjectEntityID,
          objectEntityID:objectEntityID===undefined?prior.objectEntityID:objectEntityID,
          origin:origin??prior.origin,method:method??prior.method,scope:scope===undefined?prior.scope:scope,
          validFrom:validFrom===undefined?prior.validFrom:validFrom,validTo:validTo===undefined?prior.validTo:validTo,
          observedAt:observedAt===undefined?prior.observedAt:observedAt,recordedAt:Date.now(),actor:String(actor),
          ...(value===undefined?{}:{value})};
        if(!['human-authored','user-stated','source-reported','directly-observed','deterministically-extracted','model-inferred'].includes(data.origin)) throw Error('Claim origin is invalid.');
        const receipt=this.reviseMemory({id,expectedRevision:expectedRevision??memory.revision.revision,title:data.predicate,data,
          evidence:JSON.parse(memoryEvidence(evidence)).map(entry=>({...entry,createdAt:Date.now()})),actor,reason});
        return {...receipt,priorID:id,corrected:true};
      });
    },
    createMemory({id=randomUUID(),kind='memory',title,body='',data={},evidence=[],provenance={},boundary={},source={},members=[],actor='user'}) {
      const memoryID=requiredText(id,'Memory ID',2000),memoryKind=requiredText(kind,'Memory kind',100),memoryTitle=requiredText(title,'Memory title',1000);
      const memoryText=memoryBody(body),dataJSON=memoryData(data),evidenceJSON=memoryEvidence(evidence);
      const provenanceJSON=boundedJSON(publicProvenance(objectValue(provenance,'Memory provenance')),'Memory provenance',{});
      const boundaryJSON=boundedJSON(objectValue(boundary,'Memory capture boundary'),'Memory capture boundary',{});
      if(!Array.isArray(members)||members.length>5000) throw Error('Memory accepts at most 5000 captured source members.');
      const now=Date.now(),revisionID=randomUUID();
      return tx(()=>{
        if(db.prepare('SELECT memory_id FROM memory_items WHERE memory_id=?').get(memoryID)) return {id:memoryID,created:false};
        for(const entityID of [data.subjectEntityID,data.objectEntityID].filter(Boolean))
          if(!db.prepare('SELECT 1 FROM entities WHERE entity_id=?').get(requiredText(entityID,'Memory entity ID',2000))) throw Error('Memory references a missing entity.');
        const projectID=source.projectID==null?safeIdentity(data.scope?.projectID)??safeIdentity(data.scope?.project):safeIdentity(source.projectID);
        if(source.projectID!=null&&!projectID) throw Error('Memory source project must be a bounded project ID.');
        db.prepare('INSERT INTO memory_items VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(memoryID,memoryKind,memoryTitle,'active',source.system??'',projectID,source.sessionID??null,now,now);
        db.prepare(revisionInsert).run(revisionID,memoryID,1,memoryText,provenanceJSON,boundaryJSON,now,memoryTitle,dataJSON,evidenceJSON);
        const save=db.prepare('INSERT INTO memory_members VALUES(?,?,?,?,?,?,?,?)');
        members.forEach((member,ordinal)=>save.run(revisionID,ordinal,requiredText(member.kind,'Member kind',100),requiredText(member.ref,'Member reference',2000),member.revision??null,json(member.locator),member.hash??null,member.availability??'available'));
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),memoryID,null,'created',null,revisionID,actor,String(source.ref??''),'',now);
        return {id:memoryID,revisionID,revision:1,created:true};
      });
    },
    rememberConversationSnapshot(input) {
      requiredText(input.projectID,'Source project ID',2000);requiredText(input.sessionID,'Source session ID',2000);
      return tx(()=>rememberConversationSnapshotInTransaction({...input,creationChange:'snapshot_created'}));
    },
    indexedFileSource(sourceIdentity,revisionIdentity) {
      requiredText(sourceIdentity,'Indexed file source identity',16_000);
      if(revisionIdentity!==undefined)requiredText(revisionIdentity,'Indexed file revision',2000);
      const row=revisionIdentity===undefined
        ?db.prepare(`SELECT r.* FROM content_sources s JOIN content_source_revisions r
          ON r.source_identity=s.source_identity AND r.revision_identity=s.revision_identity
          WHERE s.source_identity=?`).get(sourceIdentity)
        :db.prepare('SELECT * FROM content_source_revisions WHERE source_identity=? AND revision_identity=?').get(sourceIdentity,revisionIdentity);
      if(!row)throw Error('The selected indexed file revision is unavailable. Search the content index and use its returned source reference.');
      return {sourceIdentity:row.source_identity,revisionIdentity:row.revision_identity,projectKey:row.project_key,path:row.virtual_path,
        capturedAt:row.captured_at,metadata:JSON.parse(row.metadata_json)};
    },
    rememberFileSource({ref,projectID,title,body,data,evidence,expectedRevision,provenance={},actor='user'}) {
      const selected=this.indexedFileSource(ref.sourceIdentity,ref.revisionIdentity);
      if(ref.locator!==undefined&&!db.prepare('SELECT 1 FROM content_unit_revisions WHERE source_identity=? AND revision_identity=? AND locator=? AND sha256=?').get(ref.sourceIdentity,ref.revisionIdentity,ref.locator,ref.unitSha256))
        throw Error('The selected file passage does not belong to that exact indexed revision.');
      const id=`file:${createHash('sha256').update(ref.sourceIdentity).digest('hex')}`;
      const sourceRef={kind:'file',sourceIdentity:ref.sourceIdentity,revisionIdentity:ref.revisionIdentity,...(projectID?{projectID}:{})};
      const sourceFingerprint=createHash('sha256').update(stableJSON(['file',ref.sourceIdentity,ref.revisionIdentity])).digest('hex');
      const statistics=db.prepare('SELECT count(*) AS units,coalesce(sum(length(CAST(text AS BLOB))),0) AS bytes FROM content_unit_revisions WHERE source_identity=? AND revision_identity=?').get(ref.sourceIdentity,ref.revisionIdentity);
      const units=db.prepare(`WITH budget AS (
        SELECT unit_no,locator,heading,sha256,length(CAST(text AS BLOB)) AS sourceBytes,text,
          coalesce(sum(length(CAST(text AS BLOB))) OVER(ORDER BY unit_no ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS precedingBytes
        FROM content_unit_revisions WHERE source_identity=? AND revision_identity=?)
        SELECT unit_no,locator,substr(heading,1,1000) AS heading,sha256,sourceBytes,
          substr(CAST(text AS BLOB),1,min(200000,900000-precedingBytes)) AS textBytes
        FROM budget WHERE precedingBytes<900000 ORDER BY unit_no LIMIT 4999`).all(ref.sourceIdentity,ref.revisionIdentity)
          .map(({textBytes,...unit})=>({...unit,text:utf8Prefix(textBytes),retainedBytes:textBytes.byteLength}));
      const now=Date.now(),sourceTitle=String(selected.path.split(/[\\/]/).at(-1)||selected.path||'Indexed file').slice(0,1000);
      const members=[{kind:'source',ref:ref.sourceIdentity,revision:ref.revisionIdentity,hash:selected.metadata.sourceSha256??null,availability:'retained',
        locator:{sourceIdentity:ref.sourceIdentity,revisionIdentity:ref.revisionIdentity,path:selected.path,projectKey:selected.projectKey,extractionStatus:selected.metadata.extractionStatus??null}}];
      const retainedUnits=[];let memberBytes=Buffer.byteLength(json(members[0]));
      for(const unit of units){
        const member={kind:'content-unit',ref:ref.sourceIdentity,revision:ref.revisionIdentity,hash:unit.sha256,availability:'retained',
        locator:{sourceIdentity:ref.sourceIdentity,revisionIdentity:ref.revisionIdentity,locator:unit.locator,unitSha256:unit.sha256,
          unit:unit.unit_no,path:selected.path,projectKey:selected.projectKey,heading:unit.heading,text:unit.text,textTruncated:unit.retainedBytes<unit.sourceBytes}};
        const size=Buffer.byteLength(json(member));if(memberBytes+size>1_000_000)break;
        memberBytes+=size;members.push(member);retainedUnits.push(unit);
      }
      const capturedText=retainedUnits.map(unit=>unit.text).join('\n\n');
      const truncated=statistics.units>retainedUnits.length||retainedUnits.some(unit=>unit.retainedBytes<unit.sourceBytes);
      const captureBoundary={status:!retainedUnits.length?'metadata_only':truncated?'incomplete':'complete',truncated,capturedAt:now,sourceCapturedAt:selected.capturedAt,
        sourceUnitCount:statistics.units,unitCount:retainedUnits.length,sourceTextBytes:statistics.bytes,retainedTextBytes:Buffer.byteLength(capturedText),retainedMemberBytes:memberBytes,
        scope:'Indexed extracted text from the selected immutable file revision; binary data and unsupported content are excluded.'};
      const captureProvenance={...publicProvenance(provenance),rememberSource:sourceRef,sourceFingerprint,sourcePath:selected.path,
        sourceRevisionIdentity:ref.revisionIdentity,sourceSha256:selected.metadata.sourceSha256??null};
      return tx(()=>{
        const item=db.prepare('SELECT * FROM memory_items WHERE memory_id=?').get(id);
        if(item&&(item.kind!=='file_snapshot'||item.source_system!=='content-index'))throw Error('File memory identity conflicts with a different retained object.');
        const current=item?db.prepare('SELECT * FROM memory_item_revisions WHERE memory_id=? ORDER BY revision DESC LIMIT 1').get(id):null;
        if(item?.deleted_at===null&&[title,body,data,evidence].some(value=>value!==undefined)&&expectedRevision!==current.revision)
          throw Object.assign(Error('This source is already remembered. Read its current memory and supply expectedRevision before enriching it.'),{status:409});
        const currentProvenance=current?JSON.parse(current.provenance_json):{};
        const same=item?.deleted_at===null&&currentProvenance.sourceFingerprint===sourceFingerprint;
        const nextTitle=title===undefined?(item?.deleted_at===null?current.title:sourceTitle):requiredText(title,'Memory title',1000);
        const editedBody=body!==undefined||item?.deleted_at===null&&(currentProvenance.userEditedText===true||JSON.parse(current.capture_boundary_json).bodyEdited===true);
        const nextBody=body===undefined?(editedBody?current.body:capturedText):memoryBody(body);
        const nextData=data===undefined?(item?.deleted_at===null?current.data_json:'{}'):memoryData(data);
        const nextEvidence=evidence===undefined?(item?.deleted_at===null?current.evidence_json:'[]'):memoryEvidence(evidence);
        const structured=JSON.parse(nextData);
        for(const entityID of [structured.subjectEntityID,structured.objectEntityID].filter(Boolean))
          if(!db.prepare('SELECT 1 FROM entities WHERE entity_id=?').get(requiredText(entityID,'Memory entity ID',2000)))throw Error('Memory references a missing entity.');
        if(same&&nextTitle===current.title&&nextBody===current.body&&nextData===current.data_json&&nextEvidence===current.evidence_json)
          return {id,created:false,revision:current.revision,sourceType:'file',sourceCaptured:retainedUnits.length>0,captureChanged:false,coverage:captureBoundary.status,truncated};
        const revisionID=randomUUID(),revision=(current?.revision??0)+1;
        const nextProvenance={...(item?.deleted_at===null?currentProvenance:{}),...captureProvenance,...(editedBody?{userEditedText:true}: {})};
        const boundary={...captureBoundary,...(editedBody?{bodyEdited:true}: {})};
        if(!item)db.prepare('INSERT INTO memory_items VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(id,'file_snapshot',nextTitle,'active','content-index',projectID??null,null,now,now);
        else db.prepare("UPDATE memory_items SET title=?,status=CASE WHEN deleted_at IS NOT NULL THEN 'active' ELSE status END,deleted_at=NULL,updated_at=? WHERE memory_id=?").run(nextTitle,now,id);
        db.prepare(revisionInsert).run(revisionID,id,revision,memoryBody(nextBody),boundedJSON(nextProvenance,'Memory provenance',{}),boundedJSON(boundary,'Memory capture boundary',{}),now,nextTitle,nextData,nextEvidence);
        const save=db.prepare('INSERT INTO memory_members VALUES(?,?,?,?,?,?,?,?)');
        members.forEach((member,ordinal)=>save.run(revisionID,ordinal,member.kind,member.ref,member.revision,json(member.locator),member.hash,member.availability));
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,null,item?'captured':'created',current?.revision_id??null,revisionID,actor,ref.sourceIdentity,'Indexed file revision retained.',now);
        return {id,created:!item||item.deleted_at!=null,revision,revisionID,sourceType:'file',sourceCaptured:retainedUnits.length>0,captureChanged:!same,coverage:captureBoundary.status,truncated};
      });
    },
    reviseMemory({id,expectedRevision,title,body,data,evidence,provenance,boundary,actor='user',reason='',sourceCapture=false}) {
      const memoryID=requiredText(id,'Memory ID',2000);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1) throw Error('Choose the current memory revision before revising.');
      const suppliedTitle=title===undefined?undefined:requiredText(title,'Memory title',1000);
      const suppliedBody=body===undefined?undefined:memoryBody(body);
      const suppliedData=data===undefined?undefined:memoryData(data);
      const suppliedEvidence=evidence===undefined?undefined:memoryEvidence(evidence);
      if(provenance!==undefined) objectValue(provenance,'Memory provenance');
      if(boundary!==undefined) objectValue(boundary,'Memory capture boundary');
      return tx(()=>{
        const item=db.prepare('SELECT * FROM memory_items WHERE memory_id=? AND deleted_at IS NULL').get(memoryID);
        const current=db.prepare('SELECT * FROM memory_item_revisions WHERE memory_id=? ORDER BY revision DESC LIMIT 1').get(memoryID);
        if(!item||!current) throw Error('Memory does not exist.');
        if(current.revision!==expectedRevision) throw Object.assign(Error('Memory changed; reload before revising.'),{status:409});
        const nextData=suppliedData??current.data_json;
        const structured=JSON.parse(nextData);
        for(const entityID of [structured.subjectEntityID,structured.objectEntityID].filter(Boolean))
          if(!db.prepare('SELECT 1 FROM entities WHERE entity_id=?').get(requiredText(entityID,'Memory entity ID',2000))) throw Error('Memory references a missing entity.');
        const nextTitle=suppliedTitle??current.title,nextBody=suppliedBody??current.body;
        const storedProvenance=JSON.parse(current.provenance_json);
        const nextProvenance={...storedProvenance,...publicProvenance(provenance??{})};
        if(!sourceCapture&&['conversation_snapshot','file_snapshot'].includes(item.kind))for(const key of ['rememberSource','sourceFingerprint','sourceSystem','projectID','sessionID','sourcePath','sourceRevisionIdentity','sourceSha256','sourceTitle'])
          if(Object.hasOwn(storedProvenance,key))nextProvenance[key]=storedProvenance[key];
        const nextBoundary={...JSON.parse(current.capture_boundary_json),...boundary};
        if(['conversation_snapshot','file_snapshot'].includes(item.kind) && nextBody!==current.body) {
          // Sources remain retained, while the edited narrative is no longer
          // presented as their exact captured transcript.
          nextBoundary.bodyEdited=true;
          nextProvenance.userEditedText=true;
          nextBoundary.sourceSnapshotRevision=nextBoundary.sourceSnapshotRevision??current.revision;
          nextProvenance.sourceSnapshotHash=nextProvenance.sourceSnapshotHash??nextProvenance.snapshotHash??null;
          delete nextProvenance.snapshotHash;
        }
        const revisionID=randomUUID(),revision=current.revision+1,now=Date.now();
        const nextEvidence=suppliedEvidence??current.evidence_json;
        const compatibility=storedProvenance.internalCompatibility?.claim;
        if(compatibility) {
          const retained=structuredClone(compatibility),previous=JSON.parse(current.data_json);
          if(suppliedData!==undefined) {
            if(stableJSON(previous.value)!==stableJSON(structured.value)) delete retained.valueJSON;
            if(stableJSON(previous.scope)!==stableJSON(structured.scope)) delete retained.scopeJSON;
          }
          if(suppliedEvidence!==undefined) {
            const key=entry=>JSON.stringify([entry.id,entry.relation??'supports']);
            const prior=new Map(JSON.parse(current.evidence_json).map(entry=>[key(entry),entry]));
            const next=new Map(JSON.parse(nextEvidence).map(entry=>[key(entry),entry]));
            retained.evidence=(retained.evidence??[]).filter(entry=>prior.has(key(entry))&&next.has(key(entry))
              &&stableJSON(prior.get(key(entry)))===stableJSON(next.get(key(entry))));
          }
          nextProvenance.internalCompatibility={...storedProvenance.internalCompatibility,claim:retained};
        }
        const publicProvenanceJSON=boundedJSON(publicProvenance(nextProvenance),'Memory provenance',{});
        const storedProvenanceJSON=JSON.stringify({...JSON.parse(publicProvenanceJSON),
          ...(nextProvenance.internalCompatibility?{internalCompatibility:nextProvenance.internalCompatibility}:{})});
        db.prepare(revisionInsert).run(revisionID,memoryID,revision,nextBody,
          storedProvenanceJSON,boundedJSON(nextBoundary,'Memory capture boundary',{}),now,
          nextTitle,nextData,nextEvidence);
        db.prepare(`INSERT INTO memory_members(revision_id,ordinal,member_kind,source_ref,source_revision,locator_json,content_hash,availability)
          SELECT ?,ordinal,member_kind,source_ref,source_revision,locator_json,content_hash,availability FROM memory_members WHERE revision_id=?`).run(revisionID,current.revision_id);
        db.prepare('UPDATE memory_items SET title=?,updated_at=? WHERE memory_id=?').run(nextTitle,now,memoryID);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),memoryID,null,'revised',current.revision_id,revisionID,actor,'',String(reason),now);
        return {id:memoryID,revisionID,revision,created:true};
      });
    },
    getMemory(id, requestedRevision) {
      const item = db.prepare('SELECT * FROM memory_items WHERE memory_id=? AND deleted_at IS NULL').get(id);
      if (!item) return null;
      if (requestedRevision !== undefined && (!Number.isSafeInteger(requestedRevision) || requestedRevision < 1)) throw Error('Choose a valid memory revision.');
      const revision = requestedRevision === undefined
        ? db.prepare('SELECT * FROM memory_item_revisions WHERE memory_id=? ORDER BY revision DESC LIMIT 1').get(id)
        : db.prepare('SELECT * FROM memory_item_revisions WHERE memory_id=? AND revision=?').get(id,requestedRevision);
      if (!revision) return null;
      if(JSON.parse(revision.capture_boundary_json).status==='forgotten') return null;
      const members = db.prepare(`SELECT ordinal,member_kind AS kind,source_ref AS ref,source_revision AS revision,
        locator_json AS locator,content_hash AS hash,availability FROM memory_members WHERE revision_id=? ORDER BY ordinal`)
        .all(revision.revision_id).map(member => ({...member,locator:JSON.parse(member.locator)}));
      const revisions = db.prepare('SELECT revision,title,created_at AS createdAt FROM memory_item_revisions WHERE memory_id=? ORDER BY revision DESC').all(id);
      const archiveRevision=db.prepare("SELECT count(*) AS n FROM memory_changes WHERE memory_id=? AND change_type IN ('archived','restored')").get(id).n;
      const {data_json,evidence_json,provenance_json,capture_boundary_json,...captured}=revision;
      return { ...item, sourceType:memorySourceType(item),title:revision.title, archiveRevision, members, revisions,
        revision: { ...captured, data:JSON.parse(data_json), evidence:JSON.parse(evidence_json),
          provenance:publicProvenance(JSON.parse(provenance_json)),captureBoundary:JSON.parse(capture_boundary_json) } };
    },
    searchMemory(query = '', { kind, status, projectID, projectIDs, model, modelProvider, origin, epistemicState, includeHistorical=false, phrase = false, includeForgotten = false, includeArchived = false, limit = 25, offset = 0 } = {}) {
      if (typeof query !== 'string') throw Error('Memory search must be text.');
      const text = query.trim(), match = contentMatch(query,{phrase});
      const bounded = Math.max(1, Math.min(200, Number(limit) || 25));
      const start = contentOffset(offset);
      const where = ['r.revision=(SELECT max(x.revision) FROM memory_item_revisions x WHERE x.memory_id=m.memory_id)'], params = [];
      if (!includeForgotten) where.push('m.deleted_at IS NULL');
      if (!includeArchived) where.push("m.status<>'archived'");
      if (kind) { where.push('m.kind=?'); params.push(kind); }
      if (status) { where.push('m.status=?'); params.push(status); }
      if (!includeHistorical && epistemicState!=='superseded') where.push(`json_extract(r.data_json,'$.supersededAt') IS NULL AND COALESCE(json_extract(r.data_json,'$.epistemicState'),'')<>'superseded'`);
      const project=memoryProjectSQL;
      if (projectID) { where.push(project+'=?'); params.push(projectID); }
      else if(Array.isArray(projectIDs)) {
        const selected=[...new Set(projectIDs)];
        where.push(selected.length?`(${project} IS NULL OR ${project} IN (${selected.map(()=>'?').join(',')}))`:project+' IS NULL');
        params.push(...selected);
      }
      if(origin) { where.push(`json_extract(r.data_json,'$.origin')=?`);params.push(origin); }
      if(epistemicState) { where.push(`json_extract(r.data_json,'$.epistemicState')=?`);params.push(epistemicState); }
      let modelID=model,provider=modelProvider;
      if(typeof model==='string' && model.includes('/')) {
        const split=model.indexOf('/');
        if(!provider) {provider=model.slice(0,split);modelID=model.slice(split+1);}
        else if(model.startsWith(provider+'/')) modelID=model.slice(provider.length+1);
      }
      if (modelID) {
        where.push(`((json_extract(r.data_json,'$.modelID')=? ${provider?"AND json_extract(r.data_json,'$.modelProvider')=?":''}) OR EXISTS
          (SELECT 1 FROM memory_members mm WHERE mm.revision_id=r.revision_id AND json_extract(mm.locator_json,'$.modelID')=?
            ${provider?"AND json_extract(mm.locator_json,'$.providerID')=?":''}))`);
        params.push(modelID,...(provider?[provider]:[]),modelID,...(provider?[provider]:[]));
      } else if(provider) {
        where.push(`(json_extract(r.data_json,'$.modelProvider')=? OR EXISTS (SELECT 1 FROM memory_members mm WHERE mm.revision_id=r.revision_id AND json_extract(mm.locator_json,'$.providerID')=?))`);
        params.push(provider,provider);
      }
      const exact = text && db.prepare(`SELECT m.memory_id FROM memory_items m JOIN memory_item_revisions r USING(memory_id)
        WHERE m.memory_id=? AND ${where.join(' AND ')}`).get(text,...params);
      if (exact) { where.push('m.memory_id=?'); params.push(exact.memory_id); }
      if (text && !match) return { status:'empty',items:[],truncated:false };
      const useMatch = exact ? '' : match;
      if (useMatch) { where.push('memory_search_fts MATCH ?'); params.push(useMatch); }
      const rows = db.prepare(`WITH hits AS MATERIALIZED (
        SELECT r.revision_id,m.updated_at,m.memory_id,length(CAST(r.body AS BLOB)) AS bodyBytes,${useMatch ? 'bm25(memory_search_fts)' : '0'} AS score
        FROM memory_item_revisions r JOIN memory_items m USING(memory_id)
        ${useMatch ? 'JOIN memory_search_fts ON memory_search_fts.revision_id=r.revision_id' : ''}
        WHERE ${where.join(' AND ')} ORDER BY score,m.updated_at DESC,m.memory_id LIMIT ? OFFSET ?),
        budgeted AS MATERIALIZED (SELECT *,sum(bodyBytes) OVER(ORDER BY score,updated_at DESC,memory_id ROWS UNBOUNDED PRECEDING) AS hashBytes FROM hits)
        SELECT m.memory_id AS id,m.kind,r.title,m.status,${memoryProjectSQL} AS projectID,
        m.source_session_id AS sessionID,m.source_system AS sourceSystem,r.revision,r.revision_id AS revisionID,
        substr(r.body,1,240) AS body,length(r.body)>240 AS bodyTruncated,
        substr(COALESCE(NULLIF(r.body,''),r.data_json -> '$.value',''),1,240) AS structuredExcerpt,
        CASE WHEN length(CAST(r.data_json AS BLOB))<=min(8192,1000000/(SELECT count(*) FROM budgeted)/4)
          THEN r.data_json ELSE json_object('predicate',substr(json_extract(r.data_json,'$.predicate'),1,1000),
            'origin',substr(json_extract(r.data_json,'$.origin'),1,200),'epistemicState',substr(json_extract(r.data_json,'$.epistemicState'),1,100),
            'modelProvider',substr(json_extract(r.data_json,'$.modelProvider'),1,200),'modelID',substr(json_extract(r.data_json,'$.modelID'),1,200)) END AS dataJSON,
        length(CAST(r.data_json AS BLOB))>min(8192,1000000/(SELECT count(*) FROM budgeted)/4) AS dataTruncated,
        CASE WHEN length(CAST(r.evidence_json AS BLOB))<=min(8192,1000000/(SELECT count(*) FROM budgeted)/4)
          THEN r.evidence_json ELSE '[]' END AS evidenceJSON,
        length(CAST(r.evidence_json AS BLOB))>min(8192,1000000/(SELECT count(*) FROM budgeted)/4) AS evidenceTruncated,
        json_array_length(r.evidence_json) AS evidenceCount,
        substr(json_extract(r.data_json,'$.origin'),1,200) AS origin,substr(json_extract(r.data_json,'$.epistemicState'),1,100) AS epistemicState,
        substr(json_extract(r.data_json,'$.modelProvider'),1,200) AS modelProvider,substr(json_extract(r.data_json,'$.modelID'),1,200) AS modelID,
        length(COALESCE(json_extract(r.data_json,'$.origin'),''))>200 OR length(COALESCE(json_extract(r.data_json,'$.epistemicState'),''))>100
          OR length(COALESCE(json_extract(r.data_json,'$.modelProvider'),''))>200 OR length(COALESCE(json_extract(r.data_json,'$.modelID'),''))>200 AS structuredMetadataTruncated,
        json_extract(r.data_json,'$.observedAt') AS structuredObservedAt,
        CASE WHEN hits.hashBytes<=4000000 THEN freelancer_body_sha256(r.body) ELSE NULL END AS bodySha256,
        CASE WHEN hits.hashBytes>4000000 THEN 'hash-work-limit' ELSE NULL END AS bodyHashUnavailableReason,
        r.created_at AS revisionCreatedAt,m.created_at AS createdAt,m.updated_at AS updatedAt,
        (SELECT count(*) FROM memory_changes ch WHERE ch.memory_id=m.memory_id AND ch.change_type IN ('archived','restored')) AS archiveRevision,
        json_extract(r.provenance_json,'$.snapshotHash') AS snapshotHash,
        json_object('status',json_extract(r.capture_boundary_json,'$.status'),
          'capturedAt',json_extract(r.capture_boundary_json,'$.capturedAt'),
          'attemptedAt',json_extract(r.capture_boundary_json,'$.attemptedAt'),
          'snapshotCreatedAt',json_extract(r.capture_boundary_json,'$.snapshotCreatedAt'),
          'messageCount',json_extract(r.capture_boundary_json,'$.messageCount'),
          'truncated',json_extract(r.capture_boundary_json,'$.truncated'),'bodyEdited',json_extract(r.capture_boundary_json,'$.bodyEdited'),
          'sourceSnapshotRevision',json_extract(r.capture_boundary_json,'$.sourceSnapshotRevision')) AS boundaryJSON,
        (SELECT count(*) FROM memory_members mm WHERE mm.revision_id=r.revision_id) AS sourceRefCount,
        (SELECT count(*) FROM memory_members mm WHERE mm.revision_id=r.revision_id AND mm.availability='missing_source') AS missingSourceCount,
        (SELECT count(*) FROM memory_members mm WHERE mm.revision_id=r.revision_id AND mm.availability='unknown_source') AS unknownSourceCount,
        (SELECT count(*) FROM memory_members mm WHERE mm.revision_id=r.revision_id AND mm.availability='not_captured') AS uncapturedSourceCount,
        (SELECT count(*) FROM memory_members mm WHERE mm.revision_id=r.revision_id AND (mm.content_hash IS NULL OR mm.source_revision IS NULL)) AS unresolvedSourceCount,
        (SELECT json_group_array(json(CASE WHEN
          length(CAST(mr.member_kind||mr.source_ref||COALESCE(mr.source_revision,'')||COALESCE(mr.content_hash,'') AS BLOB))
            +length(CAST(COALESCE(json_extract(mr.safeLocator,'$.id'),'')||COALESCE(json_extract(mr.safeLocator,'$.providerID'),'')||COALESCE(json_extract(mr.safeLocator,'$.modelID'),'') AS BLOB))
              >1000000/(SELECT count(*) FROM budgeted)/32 OR mr.locatorOversized
          THEN json_object('ordinal',mr.ordinal,'kind',substr(mr.member_kind,1,100),'availability',substr(mr.availability,1,100),'summaryTruncated',json('true'))
          ELSE json_object('ordinal',mr.ordinal,'kind',mr.member_kind,'ref',mr.source_ref,
          'revision',mr.source_revision,'hash',mr.content_hash,'availability',mr.availability,
          'locator',json_object('messageID',json_extract(mr.locator_json,'$.id'),
            'providerID',json_extract(mr.locator_json,'$.providerID'),'modelID',json_extract(mr.locator_json,'$.modelID'))) END))
          FROM (SELECT *,CASE WHEN length(CAST(locator_json AS BLOB))<=8192 THEN locator_json ELSE '{}' END AS safeLocator,
            length(CAST(locator_json AS BLOB))>8192 AS locatorOversized
            FROM memory_members WHERE revision_id=r.revision_id ORDER BY ordinal LIMIT 32) mr) AS sourceRefsJSON,
        hits.score AS score
        FROM budgeted hits JOIN memory_item_revisions r USING(revision_id) JOIN memory_items m USING(memory_id)
        ORDER BY hits.score,m.updated_at DESC,m.memory_id`).all(...params,bounded+1,start);
      return { status: rows.length ? 'ok' : 'empty', truncated:rows.length>bounded,
        items: rows.slice(0,bounded).map(({boundaryJSON,sourceRefsJSON,dataJSON,evidenceJSON,structuredExcerpt,structuredObservedAt,...row}) => {
          const boundary=JSON.parse(boundaryJSON),sourceRefs=JSON.parse(sourceRefsJSON);
          const omitted=sourceRefs.some(ref=>ref.summaryTruncated),data=JSON.parse(dataJSON),evidence=JSON.parse(evidenceJSON);
          const metadataReasons=[...(omitted?['source-ref-byte-limit']:[]),...(row.dataTruncated?['data-byte-limit']:[]),...(row.evidenceTruncated?['evidence-byte-limit']:[]),...(row.structuredMetadataTruncated?['structured-field-limit']:[])];
          return {...row,sourceType:memorySourceType(row),data,evidence,dataTruncated:!!row.dataTruncated,evidenceTruncated:!!row.evidenceTruncated,structuredMetadataTruncated:!!row.structuredMetadataTruncated,
            evidenceAvailability:row.evidenceCount?'recorded-provenance':'not-recorded',bodyTruncated:!!row.bodyTruncated,excerpt:structuredExcerpt,boundary,messageCount:boundary.messageCount??0,
            sourceRefs,sourceRefsTruncated:row.sourceRefCount>sourceRefs.length||omitted,
            ...(metadataReasons.length?{metadataTruncated:true,metadataTruncationReasons:metadataReasons}:{}),
            matchKind:exact?'exact-id':useMatch?'fts':'browse',coverage:boundary.status??'authored',
            sourceAvailability:['missing_source','unknown_source','metadata_only'].includes(boundary.status)?boundary.status:
              row.missingSourceCount?'missing_source':row.unknownSourceCount?'unknown_source':row.uncapturedSourceCount?'not_captured':
                row.unresolvedSourceCount?'recorded-provenance':row.sourceRefCount?'retained':row.evidenceCount?'recorded-provenance':'authored',
            observedAt:structuredObservedAt??boundary.capturedAt??null,capturedAt:boundary.capturedAt??null,indexedAt:row.revisionCreatedAt,
            source: { system: row.sourceSystem || (row.projectID ? 'freelancer-project' : 'freelancer'),projectID:row.projectID,sessionID:row.sessionID }};
        }) };
    },
    memoryStatus() {
      return {
        entities: db.prepare('SELECT count(*) n FROM entities').get().n,
        memories: db.prepare("SELECT count(*) n FROM memory_items WHERE deleted_at IS NULL").get().n,
        archived: db.prepare("SELECT count(*) n FROM memory_items WHERE deleted_at IS NULL AND status='archived'").get().n,
        withData: db.prepare("SELECT count(*) n FROM memory_items m JOIN memory_item_revisions r USING(memory_id) WHERE m.deleted_at IS NULL AND r.revision=(SELECT max(x.revision) FROM memory_item_revisions x WHERE x.memory_id=m.memory_id) AND r.data_json<>'{}'").get().n,
        withEvidence: db.prepare("SELECT count(*) n FROM memory_items m JOIN memory_item_revisions r USING(memory_id) WHERE m.deleted_at IS NULL AND r.revision=(SELECT max(x.revision) FROM memory_item_revisions x WHERE x.memory_id=m.memory_id) AND json_array_length(r.evidence_json)>0").get().n,
      };
    },
    archiveMemory({id,expectedRevision,actor='user',reason=''}) {
      const memoryID=requiredText(id,'Memory ID',2000);
      return tx(()=>{
        const current=db.prepare("SELECT count(*) AS n FROM memory_changes WHERE memory_id=? AND change_type IN ('archived','restored')").get(memoryID).n;
        if(expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)) throw Error('Archive revision must be a non-negative integer.');
        if(expectedRevision!==undefined&&expectedRevision!==current) throw Object.assign(Error('Archive state changed; reload before saving.'),{status:409});
        const item=db.prepare('SELECT status,deleted_at AS deletedAt FROM memory_items WHERE memory_id=?').get(memoryID);
        if(!item||item.deletedAt!==null||item.status==='forgotten') return {id:memoryID,archived:false,archiveRevision:current};
        if(item.status==='archived') return {id:memoryID,archived:true,changed:false,archiveRevision:current};
        const now=Date.now();
        db.prepare("UPDATE memory_items SET status='archived',updated_at=? WHERE memory_id=?").run(now,memoryID);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(
          randomUUID(),memoryID,null,'archived',null,null,String(actor),'',String(reason),now);
        return {id:memoryID,archived:true,changed:true,archiveRevision:current+1};
      });
    },
    restoreMemory({id,expectedRevision,actor='user',reason=''}) {
      const memoryID=requiredText(id,'Memory ID',2000);
      return tx(()=>{
        const current=db.prepare("SELECT count(*) AS n FROM memory_changes WHERE memory_id=? AND change_type IN ('archived','restored')").get(memoryID).n;
        if(expectedRevision!==undefined&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)) throw Error('Archive revision must be a non-negative integer.');
        if(expectedRevision!==undefined&&expectedRevision!==current) throw Object.assign(Error('Archive state changed; reload before saving.'),{status:409});
        const item=db.prepare('SELECT status,deleted_at AS deletedAt FROM memory_items WHERE memory_id=?').get(memoryID);
        if(!item||item.deletedAt!==null||item.status==='forgotten') return {id:memoryID,restored:false,archiveRevision:current};
        if(item.status!=='archived') return {id:memoryID,restored:false,changed:false,archiveRevision:current};
        const now=Date.now();
        db.prepare("UPDATE memory_items SET status='active',updated_at=? WHERE memory_id=?").run(now,memoryID);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(
          randomUUID(),memoryID,null,'restored',null,null,String(actor),'',String(reason),now);
        return {id:memoryID,restored:true,changed:true,archiveRevision:current+1};
      });
    },
    forgetMemory({ id, actor = 'user', reason = '' }) {
      return tx(() => {
        const item = db.prepare('SELECT memory_id FROM memory_items WHERE memory_id=? AND deleted_at IS NULL').get(id);
        if (!item) return { id, forgotten: false };
        const now = Date.now();
        db.prepare('UPDATE memory_items SET status=?,deleted_at=?,updated_at=? WHERE memory_id=?').run('forgotten',now,now,id);
        db.prepare(`UPDATE memory_item_revisions SET title='',body='',data_json='{}',evidence_json='[]',provenance_json='{}',capture_boundary_json='{"status":"forgotten"}' WHERE memory_id=?`).run(id);
        db.prepare('DELETE FROM memory_members WHERE revision_id IN (SELECT revision_id FROM memory_item_revisions WHERE memory_id=?)').run(id);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,null,'forgotten',null,null,actor,'',String(reason),now);
        return { id, forgotten: true };
      });
    },
  };
}
