import { randomUUID } from 'node:crypto';
import { contentMatch } from '../../domain/content-query.mjs';
import { createMemoryCaptureService } from './memory-capture.mjs';
import { createKnowledgeQueries } from './knowledge-queries.mjs';

const normalize = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
const json = value => JSON.stringify(value ?? {});
const requiredText = (value, name, limit = 4000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw Error(`${name} is required and must be at most ${limit} characters.`);
  return value.trim();
};

export function createMemoryService(db, tx) {
  function pinConversationSnapshotInTransaction({ projectID, sessionID, title, parentID = null, originalPinnedAt, annotationRevision = 0 }) {
    if (!projectID || !sessionID || !Number.isFinite(originalPinnedAt)) throw Error('Pinned conversation identity and original timestamp are required.');
    const id = `conversation:${projectID}:${sessionID}`, now = Date.now(), revisionID = randomUUID();
    const existing = db.prepare('SELECT memory_id,deleted_at FROM memory_items WHERE memory_id=?').get(id);
    const header = db.prepare('SELECT created_at AS createdAt,updated_at AS updatedAt,title FROM session_headers WHERE project_id=? AND session_id=?').get(projectID,sessionID);
    const metadata = header ? { title: header.title, createdAt: header.createdAt, updatedAt: header.updatedAt, parentID } : { title: title || 'Missing conversation source', missingSource: true, parentID };
    if (!existing) {
      db.prepare('INSERT INTO memory_items VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(id,'conversation_snapshot',String(title || metadata.title).slice(0,1000),'active','opencode',projectID,sessionID,now,now);
      db.prepare('INSERT INTO memory_item_revisions VALUES(?,?,?,?,?,?,?)').run(revisionID,id,1,'',json({ sourceSystem:'opencode', projectID, sessionID, title:metadata.title }),json({ status:'metadata_only', capturedAt:null, originallyPinnedAt:originalPinnedAt, annotationRevision }),now);
      db.prepare('INSERT INTO memory_members VALUES(?,?,?,?,?,?,?,?)').run(revisionID,0,'conversation',`${projectID}/${sessionID}`,null,json(metadata),null,header ? 'not_captured' : 'missing_source');
      db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,null,'legacy_pin_imported',null,revisionID,'migration',`${projectID}/${sessionID}`,'Transcript snapshot was not present in the legacy pin record.',now);
    }
    if (existing?.deleted_at != null)
      db.prepare("UPDATE memory_items SET status='active',deleted_at=NULL,updated_at=? WHERE memory_id=?").run(now,id);
    db.prepare('INSERT INTO memory_pins VALUES(?,?,?,?,?) ON CONFLICT(memory_id) DO UPDATE SET original_pinned_at=COALESCE(memory_pins.original_pinned_at,excluded.original_pinned_at),revision=max(memory_pins.revision,excluded.revision)')
      .run(id,originalPinnedAt,originalPinnedAt,null,Math.max(1,annotationRevision));
    return { id, pinnedAt:originalPinnedAt, originalPinnedAt, sourceStatus:header ? 'metadata_only' : 'missing_source', created:!existing };
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
  return {
    ...createKnowledgeQueries(db,tx),
    createEntity,
    addAlias(id, alias, sourceRef = '') { return tx(() => { addAlias(id, alias, sourceRef); return { id, alias }; }); },
    deleteEntity({ id, actor = 'user', reason = '' }) {
      const entityID = requiredText(id, 'Entity ID', 2000);
      return tx(() => {
        const entity = db.prepare('SELECT entity_id FROM entities WHERE entity_id=?').get(entityID);
        if (!entity) return { id:entityID, deleted:false, relationsDeleted:0 };
        const claimRefs = db.prepare(`SELECT count(*) AS n FROM claims
          WHERE subject_entity_id=? OR object_entity_id=?`).get(entityID,entityID).n;
        if (claimRefs) return { id:entityID, deleted:false, reason:'claims_reference_entity', claimsRetained:claimRefs };
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
    addClaim(input) {
      const predicate = requiredText(input.predicate, 'Claim predicate', 1000);
      const allowedOrigins = new Set(['human-authored','user-stated','source-reported','directly-observed','deterministically-extracted','model-inferred']);
      const allowedStates = new Set(['unverified','supported','disputed','superseded']);
      if (!allowedOrigins.has(input.origin) || !allowedStates.has(input.epistemicState)) throw Error('Claim origin or epistemic state is invalid.');
      const id = input.id ?? randomUUID(), now = Date.now(), evidence = Array.isArray(input.evidence) ? input.evidence : [];
      if (!evidence.length || evidence.length > 1000) throw Error('A claim needs 1 to 1000 evidence references.');
      return tx(() => {
        for (const entityID of [input.subjectEntityID, input.objectEntityID].filter(Boolean))
          if (!db.prepare('SELECT 1 FROM entities WHERE entity_id=?').get(entityID)) throw Error('Claim references a missing entity.');
        const duplicate = db.prepare(`SELECT c.claim_id AS id FROM claims c WHERE c.predicate=? AND c.origin=? AND c.method=? AND c.epistemic_state=?
          AND COALESCE(c.subject_entity_id,'')=? AND COALESCE(c.object_entity_id,'')=? AND COALESCE(c.value_json,'')=? AND c.scope_json=? LIMIT 1`)
          .get(predicate, input.origin, String(input.method ?? 'manual'), input.epistemicState, input.subjectEntityID ?? '', input.objectEntityID ?? '', input.value === undefined ? '' : json(input.value), json(input.scope));
        const claimID = duplicate?.id ?? id;
        if (!duplicate) db.prepare('INSERT INTO claims VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
          id,input.subjectEntityID ?? null,predicate,input.objectEntityID ?? null,
          input.value === undefined ? null : json(input.value),input.origin,String(input.method ?? 'manual'),input.epistemicState,
          json(input.scope),input.validFrom ?? null,input.validTo ?? null,input.observedAt ?? null,now,null,
          String(input.actor ?? ''),input.modelProvider ?? null,input.modelID ?? null);
        const normalizedEvidence = evidence.map(item => ({ id: requiredText(item.id, 'Evidence ID', 2000), relation: item.relation ?? 'supports', value: json(item) }));
        if (normalizedEvidence.some(item => !['supports','contradicts','qualifies','supersedes'].includes(item.relation))) throw Error('Claim evidence relation is invalid.');
        const save = db.prepare('INSERT INTO claim_evidence VALUES(?,?,?,?,?) ON CONFLICT(claim_id,evidence_id,relation) DO NOTHING');
        for (const item of normalizedEvidence) save.run(claimID,item.id,item.relation,item.value,now);
        return { id: claimID, created: !duplicate };
      });
    },
    correctClaim({ id, expectedEpistemicState, predicate, subjectEntityID, objectEntityID, value,
      origin, method, epistemicState, scope, validFrom, validTo, observedAt, evidence, actor = 'user', reason = '' }) {
      const allowedOrigins = new Set(['human-authored','user-stated','source-reported','directly-observed','deterministically-extracted','model-inferred']);
      const allowedStates = new Set(['unverified','supported','disputed']);
      const items = Array.isArray(evidence) ? evidence : [];
      if (!items.length || items.length > 1000) throw Error('A claim correction needs 1 to 1000 evidence references.');
      if (!allowedStates.has(epistemicState)) throw Error('A correction must state its epistemic status.');
      const now = Date.now();
      return tx(() => {
        const prior = db.prepare('SELECT * FROM claims WHERE claim_id=?').get(requiredText(id, 'Claim ID', 2000));
        if (!prior || prior.superseded_at !== null || prior.epistemic_state === 'superseded') throw Object.assign(Error('Claim is missing or already superseded.'),{status:409});
        if (expectedEpistemicState && prior.epistemic_state !== expectedEpistemicState) throw Object.assign(Error('Claim changed; reload before correcting it.'),{status:409});
        const next = {
          predicate: requiredText(predicate ?? prior.predicate, 'Claim predicate', 1000),
          subjectEntityID: subjectEntityID === undefined ? prior.subject_entity_id : subjectEntityID,
          objectEntityID: objectEntityID === undefined ? prior.object_entity_id : objectEntityID,
          valueJSON: value === undefined ? prior.value_json : json(value),
          origin: origin ?? prior.origin, method: method ?? prior.method, epistemicState,
          scopeJSON: scope === undefined ? prior.scope_json : json(scope),
          validFrom: validFrom === undefined ? prior.valid_from : validFrom,
          validTo: validTo === undefined ? prior.valid_to : validTo,
          observedAt: observedAt === undefined ? prior.observed_at : observedAt,
        };
        if (!allowedOrigins.has(next.origin)) throw Error('Claim origin is invalid.');
        if (next.validFrom !== null && next.validTo !== null && next.validTo < next.validFrom) throw Error('Claim validity ends before it begins.');
        for (const entityID of [next.subjectEntityID, next.objectEntityID].filter(Boolean))
          if (!db.prepare('SELECT 1 FROM entities WHERE entity_id=?').get(entityID)) throw Error('Claim references a missing entity.');
        const normalizedEvidence = items.map(item => ({
          id: requiredText(item.id, 'Evidence ID', 2000),
          relation: item.relation ?? 'supports',
          json: json(item),
        }));
        if (normalizedEvidence.some(item => !['supports','contradicts','qualifies','supersedes'].includes(item.relation)))
          throw Error('Claim evidence relation is invalid.');
        const newID = randomUUID();
        const duplicate = db.prepare(`SELECT claim_id AS id FROM claims WHERE claim_id<>? AND predicate=? AND origin=? AND method=? AND epistemic_state=?
          AND COALESCE(subject_entity_id,'')=? AND COALESCE(object_entity_id,'')=? AND COALESCE(value_json,'')=? AND scope_json=?
          ORDER BY recorded_at,claim_id LIMIT 1`).get(prior.claim_id,next.predicate,next.origin,next.method,next.epistemicState,
            next.subjectEntityID ?? '',next.objectEntityID ?? '',next.valueJSON ?? '',next.scopeJSON);
        const replacementID = duplicate?.id ?? newID;
        db.prepare("UPDATE claims SET epistemic_state='superseded',superseded_at=? WHERE claim_id=?").run(now,prior.claim_id);
        if (!duplicate) {
          db.prepare('INSERT INTO claims VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
            newID,next.subjectEntityID ?? null,next.predicate,next.objectEntityID ?? null,next.valueJSON,
            next.origin,next.method,next.epistemicState,next.scopeJSON,next.validFrom,next.validTo,next.observedAt,
            now,null,String(actor),prior.model_provider,prior.model_id);
        }
        const saveEvidence = db.prepare('INSERT INTO claim_evidence VALUES(?,?,?,?,?) ON CONFLICT(claim_id,evidence_id,relation) DO NOTHING');
        for (const item of normalizedEvidence) saveEvidence.run(replacementID,item.id,item.relation,item.json,now);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(
          randomUUID(),null,prior.claim_id,'claim_corrected',prior.claim_id,replacementID,String(actor),
          normalizedEvidence.map(item => item.id).join(','),String(reason),now);
        return { id: replacementID, priorID: prior.claim_id, created: !duplicate, corrected: true };
      });
    },
    createMemory({ id = randomUUID(), kind, title, body, provenance = {}, boundary = {}, source = {}, members = [], actor = 'user' }) {
      const memoryKind = requiredText(kind, 'Memory kind', 100), memoryTitle = requiredText(title, 'Memory title', 1000);
      if (typeof body !== 'string' || body.length > 1_000_000) throw Error('Memory body must be text under 1 MB.');
      const now = Date.now(), revisionID = randomUUID();
      return tx(() => {
        const prior = db.prepare('SELECT memory_id FROM memory_items WHERE memory_id=?').get(id);
        if (prior) return { id, created: false };
        db.prepare('INSERT INTO memory_items VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(id,memoryKind,memoryTitle,'active',source.system ?? '',source.projectID ?? null,source.sessionID ?? null,now,now);
        db.prepare('INSERT INTO memory_item_revisions VALUES(?,?,?,?,?,?,?)').run(revisionID,id,1,body,json(provenance),json(boundary),now);
        const save = db.prepare('INSERT INTO memory_members VALUES(?,?,?,?,?,?,?,?)');
        members.forEach((member, ordinal) => save.run(revisionID,ordinal,requiredText(member.kind,'Member kind',100),requiredText(member.ref,'Member reference',2000),member.revision ?? null,json(member.locator),member.hash ?? null,member.availability ?? 'available'));
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,null,'created',null,revisionID,actor,String(source.ref ?? ''),'',now);
        return { id, revisionID, revision: 1, created: true };
      });
    },
    pinConversationSnapshot({ projectID, sessionID, title, parentID = null, originalPinnedAt, annotationRevision = 0 }) {
      return tx(() => pinConversationSnapshotInTransaction({ projectID,sessionID,title,parentID,originalPinnedAt,annotationRevision }));
    },
    setConversationPin({ projectID, sessionID, title, parentID = null, pinned, revision }) {
      if (!projectID || !sessionID || typeof pinned !== 'boolean' || !Number.isInteger(revision)) throw Error('Pinned conversation identity, action and revision are required.');
      return tx(() => {
        const old = db.prepare('SELECT pinned_at AS pinnedAt,hidden_at AS hiddenAt,revision FROM session_annotations WHERE project_id=? AND session_id=?').get(projectID,sessionID)
          ?? { pinnedAt:null,hiddenAt:null,revision:0 };
        if (revision !== old.revision) throw Object.assign(Error('This item changed in another window. Reload before saving.'),{status:409});
        const id = `conversation:${projectID}:${sessionID}`;
        if (pinned) pinConversationSnapshotInTransaction({ projectID,sessionID,title,parentID,
          originalPinnedAt:old.pinnedAt ?? Date.now(),annotationRevision:revision + 1 });
        else db.prepare('DELETE FROM memory_pins WHERE memory_id=?').run(id);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(),id,null,pinned?'pin':'unpin',null,null,'user',`${projectID}/${sessionID}`,'',Date.now());
        db.prepare('INSERT INTO session_annotations VALUES(?,?,?,?,?) ON CONFLICT(project_id,session_id) DO UPDATE SET pinned_at=NULL,hidden_at=excluded.hidden_at,revision=excluded.revision')
          .run(projectID,sessionID,null,old.hiddenAt,revision + 1);
        const capture = pinned ? createMemoryCaptureService(db,tx).queueMemoryCapture({memoryID:id,projectID,sessionID}) : undefined;
        return { capture,pinnedAt:pinned ? db.prepare('SELECT pinned_at FROM memory_pins WHERE memory_id=?').get(id).pinned_at : null,
          hiddenAt:old.hiddenAt,revision:revision + 1 };
      });
    },
    migrateLegacyPinsBatch({ limit = 250 } = {}) {
      const rows = db.prepare(`SELECT a.project_id AS projectID,a.session_id AS sessionID,a.pinned_at AS pinnedAt,a.revision AS revision,
        h.title,h.parent_id AS parentID FROM session_annotations a LEFT JOIN session_headers h
        ON h.project_id=a.project_id AND h.session_id=a.session_id WHERE a.pinned_at IS NOT NULL
        ORDER BY a.pinned_at,a.project_id,a.session_id LIMIT ?`).all(Math.max(1,Math.min(2000,Number(limit)||250)));
      let imported = 0;
      for (const row of rows) {
        const moved = tx(() => {
          const current = db.prepare('SELECT pinned_at FROM session_annotations WHERE project_id=? AND session_id=?')
            .get(row.projectID,row.sessionID);
          if (current?.pinned_at !== row.pinnedAt) return false;
          const memory = db.prepare(`SELECT m.deleted_at AS deletedAt,m.status,p.memory_id AS pinnedMemory
            FROM memory_items m LEFT JOIN memory_pins p USING(memory_id)
            WHERE m.kind='conversation_snapshot' AND m.source_project_id=? AND m.source_session_id=?`)
            .get(row.projectID,row.sessionID);
          if (memory?.status !== 'forgotten' && memory?.deletedAt == null)
            pinConversationSnapshotInTransaction({ ...row, originalPinnedAt:row.pinnedAt,annotationRevision:row.revision });
          db.prepare('UPDATE session_annotations SET pinned_at=NULL WHERE project_id=? AND session_id=? AND pinned_at=?')
            .run(row.projectID,row.sessionID,row.pinnedAt);
          const remaining = db.prepare('SELECT count(*) n FROM session_annotations WHERE pinned_at IS NOT NULL').get().n;
          db.prepare(`INSERT INTO memory_migration_runs VALUES('legacy-chat-pins-v1',1,?,?)
            ON CONFLICT(migration_id) DO UPDATE SET imported_count=memory_migration_runs.imported_count+1,
            remaining_count=excluded.remaining_count,completed_at=excluded.completed_at`)
            .run(remaining,remaining === 0 ? Date.now() : 0);
          return true;
        });
        if (moved) imported++;
      }
      const remaining = db.prepare('SELECT count(*) n FROM session_annotations WHERE pinned_at IS NOT NULL').get().n;
      if (!db.prepare("SELECT 1 FROM memory_migration_runs WHERE migration_id='legacy-chat-pins-v1'").get())
        db.prepare("INSERT INTO memory_migration_runs VALUES('legacy-chat-pins-v1',0,?,?)").run(remaining,remaining === 0 ? Date.now() : 0);
      return { status: remaining === 0 ? 'complete' : 'incomplete', imported, remaining };
    },
    reviseMemory({ id, expectedRevision, body, provenance = {}, boundary = {}, actor = 'user', reason = '' }) {
      if (typeof body !== 'string' || body.length > 1_000_000) throw Error('Memory body must be text under 1 MB.');
      return tx(() => {
        const item = db.prepare('SELECT updated_at FROM memory_items WHERE memory_id=? AND deleted_at IS NULL').get(id);
        const current = db.prepare('SELECT revision,revision_id AS revisionID FROM memory_item_revisions WHERE memory_id=? ORDER BY revision DESC LIMIT 1').get(id);
        if (!item || !current) throw Error('Memory does not exist.');
        if (current.revision !== expectedRevision) throw Object.assign(Error('Memory changed; reload before revising.'),{status:409});
        const revisionID = randomUUID(), revision = current.revision + 1, now = Date.now();
        db.prepare('INSERT INTO memory_item_revisions VALUES(?,?,?,?,?,?,?)').run(revisionID,id,revision,body,json(provenance),json(boundary),now);
        db.prepare('UPDATE memory_items SET updated_at=? WHERE memory_id=?').run(now,id);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,null,'revised',current.revisionID,revisionID,actor,'',String(reason),now);
        return { id, revisionID, revision, created: true };
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
      const members = db.prepare(`SELECT ordinal,member_kind AS kind,source_ref AS ref,source_revision AS revision,
        locator_json AS locator,content_hash AS hash,availability FROM memory_members WHERE revision_id=? ORDER BY ordinal`)
        .all(revision.revision_id).map(member => ({...member,locator:JSON.parse(member.locator)}));
      const revisions = db.prepare('SELECT revision,created_at AS createdAt FROM memory_item_revisions WHERE memory_id=? ORDER BY revision DESC').all(id);
      const pin = db.prepare('SELECT pinned_at AS pinnedAt,original_pinned_at AS originalPinnedAt,revision AS pinRevision FROM memory_pins WHERE memory_id=?').get(id);
      const archiveRevision=db.prepare("SELECT count(*) AS n FROM memory_changes WHERE memory_id=? AND change_type IN ('archived','restored')").get(id).n;
      return { ...item, ...pin,pinRevision:this.memoryPinRevision(id), archiveRevision, members, revisions, revision: { ...revision, provenance: JSON.parse(revision.provenance_json), captureBoundary: JSON.parse(revision.capture_boundary_json) } };
    },
    searchMemory(query = '', { kind, projectID, model, phrase = false, pinned = false, includeForgotten = false, includeArchived = false, limit = 25 } = {}) {
      if (typeof query !== 'string') throw Error('Memory search must be text.');
      const text = query.trim(), match = contentMatch(query,{phrase});
      const bounded = Math.max(1, Math.min(200, Number(limit) || 25));
      const where = ['r.revision=(SELECT max(x.revision) FROM memory_item_revisions x WHERE x.memory_id=m.memory_id)'], params = [];
      if (!includeForgotten) where.push('m.deleted_at IS NULL');
      if (!includeArchived) where.push("m.status<>'archived'");
      if (kind) { where.push('m.kind=?'); params.push(kind); }
      if (projectID) { where.push('m.source_project_id=?'); params.push(projectID); }
      if (pinned) where.push('p.memory_id IS NOT NULL');
      if (model) { where.push(`EXISTS (SELECT 1 FROM memory_members mm WHERE mm.revision_id=r.revision_id
        AND json_extract(mm.locator_json,'$.providerID') || '/' || json_extract(mm.locator_json,'$.modelID')=?)`); params.push(model); }
      const exact = text && db.prepare(`SELECT m.memory_id FROM memory_items m JOIN memory_item_revisions r USING(memory_id)
        LEFT JOIN memory_pins p USING(memory_id) WHERE m.memory_id=? AND ${where.join(' AND ')}`).get(text,...params);
      if (exact) return { status:'ok', items:[{ ...this.getMemory(exact.memory_id), id:exact.memory_id }],truncated:false };
      if (text && !match) return { status:'empty',items:[],truncated:false };
      if (match) { where.push('memory_search_fts MATCH ?'); params.push(match); }
      const rows = db.prepare(`SELECT m.memory_id AS id,m.kind,m.title,m.status,m.source_project_id AS projectID,
        m.source_session_id AS sessionID,r.revision,r.body,p.pinned_at AS pinnedAt,
        ${match ? "bm25(memory_search_fts)" : '0'} AS score
        FROM memory_item_revisions r JOIN memory_items m USING(memory_id) LEFT JOIN memory_pins p USING(memory_id)
        ${match ? 'JOIN memory_search_fts ON memory_search_fts.revision_id=r.revision_id' : ''}
        WHERE ${where.join(' AND ')} ORDER BY score,m.updated_at DESC,m.memory_id LIMIT ?`).all(...params,bounded+1);
      return { status: rows.length ? 'ok' : 'empty', truncated:rows.length>bounded,
        items: rows.slice(0,bounded).map(row => ({ ...row,excerpt:row.body.slice(0,240), source: { system: row.projectID ? 'freelancer-project' : 'freelancer', projectID: row.projectID, sessionID: row.sessionID } })) };
    },
    memoryStatus() {
      return {
        entities: db.prepare('SELECT count(*) n FROM entities').get().n,
        claims: db.prepare('SELECT count(*) n FROM claims').get().n,
        memories: db.prepare("SELECT count(*) n FROM memory_items WHERE deleted_at IS NULL").get().n,
        pinned: db.prepare('SELECT count(*) n FROM memory_pins p JOIN memory_items m USING(memory_id) WHERE m.deleted_at IS NULL').get().n,
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
        db.prepare('DELETE FROM memory_pins WHERE memory_id=?').run(id);
        const source = db.prepare('SELECT kind,source_project_id AS projectID,source_session_id AS sessionID FROM memory_items WHERE memory_id=?').get(id);
        if (source?.kind === 'conversation_snapshot' && source.projectID && source.sessionID)
          db.prepare('UPDATE session_annotations SET pinned_at=NULL,revision=revision+1 WHERE project_id=? AND session_id=?')
            .run(source.projectID,source.sessionID);
        db.prepare(`UPDATE memory_item_revisions SET body='',provenance_json='{}',capture_boundary_json='{"status":"forgotten"}' WHERE memory_id=?`).run(id);
        db.prepare('DELETE FROM memory_members WHERE revision_id IN (SELECT revision_id FROM memory_item_revisions WHERE memory_id=?)').run(id);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,null,'forgotten',null,null,actor,'',String(reason),now);
        return { id, forgotten: true };
      });
    },
  };
}
