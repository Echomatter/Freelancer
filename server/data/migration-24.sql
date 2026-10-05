-- One retained memory aggregate. This migration runs inside the store's
-- transaction with foreign keys enabled; existing IDs and evidence survive.
DROP TRIGGER IF EXISTS memory_search_insert;
DROP TRIGGER IF EXISTS memory_search_delete;
DROP TRIGGER IF EXISTS memory_search_update;
DROP TRIGGER IF EXISTS memory_title_update;
DROP TRIGGER IF EXISTS claims_search_insert;
DROP TRIGGER IF EXISTS claims_search_update;
DROP TRIGGER IF EXISTS claims_search_delete;
DROP TRIGGER IF EXISTS claims_search_evidence_insert;
DROP TRIGGER IF EXISTS claims_search_evidence_delete;
DROP TRIGGER IF EXISTS claims_search_evidence_update;

ALTER TABLE memory_item_revisions ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE memory_item_revisions ADD COLUMN data_json TEXT NOT NULL DEFAULT '{}'
  CHECK(json_valid(data_json) AND json_type(data_json)='object');
ALTER TABLE memory_item_revisions ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(evidence_json) AND json_type(evidence_json)='array');
UPDATE memory_item_revisions SET title=(SELECT title FROM memory_items m WHERE m.memory_id=memory_item_revisions.memory_id);

INSERT INTO memory_items(memory_id,kind,title,status,source_system,source_project_id,source_session_id,created_at,updated_at,deleted_at)
SELECT claim_id,'memory',predicate,'active','freelancer',
  CASE WHEN json_valid(scope_json) THEN COALESCE(
    CASE WHEN json_type(scope_json,'$.projectID')='text' AND length(CAST(json_extract(scope_json,'$.projectID') AS BLOB))<=2000
      AND trim(json_extract(scope_json,'$.projectID'))<>'' THEN json_extract(scope_json,'$.projectID') END,
    CASE WHEN json_type(scope_json,'$.project')='text' AND length(CAST(json_extract(scope_json,'$.project') AS BLOB))<=2000
      AND trim(json_extract(scope_json,'$.project'))<>'' THEN json_extract(scope_json,'$.project') END) END,NULL,
  recorded_at,COALESCE(superseded_at,recorded_at),NULL FROM claims;
INSERT INTO memory_item_revisions(revision_id,memory_id,revision,body,provenance_json,capture_boundary_json,created_at,title,data_json,evidence_json)
SELECT 'claim:'||c.claim_id||':1',c.claim_id,1,'',
  json_object('retainedFrom','claim','claimID',c.claim_id,'actor',c.actor,
    'internalCompatibility',json_object('claim',json_object('valueJSON',c.value_json,'scopeJSON',c.scope_json,
      'evidence',json(COALESCE((SELECT json_group_array(json_object('id',e.evidence_id,'relation',e.relation,
        'evidenceJSON',e.evidence_json,'createdAt',e.created_at))
        FROM (SELECT * FROM claim_evidence WHERE claim_id=c.claim_id ORDER BY evidence_id,relation) e),'[]'))))),
  json_object('status','authored','retainedFrom','claim'),c.recorded_at,c.predicate,
  json_object('predicate',c.predicate,'value',json(CASE WHEN c.value_json IS NULL THEN 'null' WHEN json_valid(c.value_json) THEN c.value_json ELSE json_quote(c.value_json) END),
    'origin',c.origin,'method',c.method,'epistemicState',c.epistemic_state,'scope',json(CASE WHEN json_valid(c.scope_json) THEN c.scope_json ELSE json_quote(c.scope_json) END),
    'validFrom',c.valid_from,'validTo',c.valid_to,'observedAt',c.observed_at,'recordedAt',c.recorded_at,
    'supersededAt',c.superseded_at,'subjectEntityID',c.subject_entity_id,'objectEntityID',c.object_entity_id,
    'actor',c.actor,'modelProvider',c.model_provider,'modelID',c.model_id),
  COALESCE((SELECT json_group_array(json(json_patch(
    CASE WHEN json_valid(e.evidence_json) AND json_type(e.evidence_json)='object' THEN e.evidence_json ELSE '{}' END,
    json_object('id',e.evidence_id,'relation',e.relation))))
    FROM (SELECT * FROM claim_evidence WHERE claim_id=c.claim_id ORDER BY evidence_id,relation) e),'[]')
FROM claims c;
-- The retained correction ledger still identifies every former record and its
-- replacement. Add canonical IDs without rewriting its historical references.
UPDATE memory_changes SET memory_id=claim_id WHERE memory_id IS NULL AND claim_id IN (SELECT memory_id FROM memory_items);

DROP VIEW knowledge_current_claims;
DROP VIEW knowledge_claim_evidence;
DROP TABLE claim_evidence;
DROP TABLE claims;
-- Compatibility is a read projection, never a second authored store.
CREATE VIEW claims AS
SELECT m.memory_id AS claim_id,
  json_extract(r.data_json,'$.subjectEntityID') AS subject_entity_id,
  json_extract(r.data_json,'$.predicate') AS predicate,
  json_extract(r.data_json,'$.objectEntityID') AS object_entity_id,
  CASE WHEN json_type(r.provenance_json,'$.internalCompatibility.claim.valueJSON') IS NOT NULL
    THEN json_extract(r.provenance_json,'$.internalCompatibility.claim.valueJSON') ELSE r.data_json -> '$.value' END AS value_json,
  json_extract(r.data_json,'$.origin') AS origin,COALESCE(json_extract(r.data_json,'$.method'),'manual') AS method,
  COALESCE(json_extract(r.data_json,'$.epistemicState'),'unverified') AS epistemic_state,
  CASE WHEN json_type(r.provenance_json,'$.internalCompatibility.claim.scopeJSON') IS NOT NULL
    THEN json_extract(r.provenance_json,'$.internalCompatibility.claim.scopeJSON') ELSE COALESCE(r.data_json -> '$.scope','{}') END AS scope_json,
  json_extract(r.data_json,'$.validFrom') AS valid_from,json_extract(r.data_json,'$.validTo') AS valid_to,
  json_extract(r.data_json,'$.observedAt') AS observed_at,COALESCE(json_extract(r.data_json,'$.recordedAt'),r.created_at) AS recorded_at,
  json_extract(r.data_json,'$.supersededAt') AS superseded_at,COALESCE(json_extract(r.data_json,'$.actor'),'') AS actor,
  json_extract(r.data_json,'$.modelProvider') AS model_provider,json_extract(r.data_json,'$.modelID') AS model_id
FROM memory_items m JOIN memory_item_revisions r USING(memory_id)
WHERE m.deleted_at IS NULL AND r.revision=(SELECT max(x.revision) FROM memory_item_revisions x WHERE x.memory_id=m.memory_id)
  AND json_type(r.data_json,'$.predicate')='text';
CREATE VIEW claim_evidence AS
SELECT c.claim_id,json_extract(e.value,'$.id') AS evidence_id,COALESCE(json_extract(e.value,'$.relation'),'supports') AS relation,
  COALESCE((SELECT json_extract(old.value,'$.evidenceJSON') FROM json_each(r.provenance_json,'$.internalCompatibility.claim.evidence') old
    WHERE json_extract(old.value,'$.id')=json_extract(e.value,'$.id')
      AND json_extract(old.value,'$.relation')=COALESCE(json_extract(e.value,'$.relation'),'supports')),e.value) AS evidence_json,
  COALESCE((SELECT json_extract(old.value,'$.createdAt') FROM json_each(r.provenance_json,'$.internalCompatibility.claim.evidence') old
    WHERE json_extract(old.value,'$.id')=json_extract(e.value,'$.id')
      AND json_extract(old.value,'$.relation')=COALESCE(json_extract(e.value,'$.relation'),'supports')),
    json_extract(e.value,'$.createdAt'),r.created_at) AS created_at
FROM claims c JOIN memory_item_revisions r ON r.memory_id=c.claim_id
  AND r.revision=(SELECT max(x.revision) FROM memory_item_revisions x WHERE x.memory_id=c.claim_id)
JOIN json_each(r.evidence_json) e WHERE json_type(e.value,'$.id')='text';
CREATE VIEW knowledge_current_claims AS
SELECT c.claim_id,c.subject_entity_id,se.canonical_name AS subject_name,c.predicate,
  c.object_entity_id,oe.canonical_name AS object_name,c.value_json,c.origin,c.method,c.epistemic_state,
  c.scope_json,c.valid_from,c.valid_to,c.observed_at,c.recorded_at,c.actor,c.model_provider,c.model_id,
  (SELECT count(*) FROM claim_evidence e WHERE e.claim_id=c.claim_id) AS evidence_count
FROM claims c LEFT JOIN entities se ON se.entity_id=c.subject_entity_id
LEFT JOIN entities oe ON oe.entity_id=c.object_entity_id
WHERE c.superseded_at IS NULL AND c.epistemic_state<>'superseded';
CREATE VIEW knowledge_claim_evidence AS
SELECT c.claim_id,c.predicate,c.epistemic_state,e.evidence_id,e.relation,e.evidence_json,e.created_at
FROM claims c JOIN claim_evidence e ON e.claim_id=c.claim_id;
DROP VIEW knowledge_memory_evidence;
CREATE VIEW knowledge_memory_evidence AS
SELECT m.memory_id,m.kind,r.title,r.revision,r.revision_id,mm.ordinal,mm.member_kind,mm.source_ref,
  mm.source_revision,mm.locator_json,mm.content_hash,mm.availability,r.data_json,r.evidence_json
FROM memory_items m JOIN memory_item_revisions r ON r.memory_id=m.memory_id
  AND r.revision=(SELECT max(latest.revision) FROM memory_item_revisions latest WHERE latest.memory_id=m.memory_id)
JOIN memory_members mm ON mm.revision_id=r.revision_id WHERE m.deleted_at IS NULL;
DROP VIEW knowledge_pinned_memories;
CREATE VIEW knowledge_pinned_memories AS
SELECT m.memory_id,m.kind,r.title,m.status,m.source_system,m.source_project_id,m.source_session_id,
  p.pinned_at,p.original_pinned_at,p.rank,p.revision AS pin_revision,
  r.revision,r.revision_id,r.body,r.provenance_json,r.capture_boundary_json,r.created_at AS captured_revision_at,r.data_json,r.evidence_json
FROM memory_pins p JOIN memory_items m ON m.memory_id=p.memory_id
JOIN memory_item_revisions r ON r.memory_id=m.memory_id
  AND r.revision=(SELECT max(latest.revision) FROM memory_item_revisions latest WHERE latest.memory_id=m.memory_id)
WHERE m.deleted_at IS NULL;
UPDATE data_table_lifecycle SET lifecycle='derived',owner='memory-compatibility'
WHERE table_name IN ('claims','claim_evidence');
CREATE INDEX memory_revision_subject ON memory_item_revisions(json_extract(data_json,'$.subjectEntityID'));
CREATE INDEX memory_revision_object ON memory_item_revisions(json_extract(data_json,'$.objectEntityID'));
CREATE TRIGGER memory_entity_reference_insert BEFORE INSERT ON memory_item_revisions
WHEN (json_extract(NEW.data_json,'$.subjectEntityID') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities WHERE entity_id=json_extract(NEW.data_json,'$.subjectEntityID')))
  OR (json_extract(NEW.data_json,'$.objectEntityID') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities WHERE entity_id=json_extract(NEW.data_json,'$.objectEntityID')))
BEGIN SELECT RAISE(ABORT,'Memory references a missing entity.'); END;
CREATE TRIGGER memory_entity_reference_update BEFORE UPDATE OF data_json ON memory_item_revisions
WHEN (json_extract(NEW.data_json,'$.subjectEntityID') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities WHERE entity_id=json_extract(NEW.data_json,'$.subjectEntityID')))
  OR (json_extract(NEW.data_json,'$.objectEntityID') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities WHERE entity_id=json_extract(NEW.data_json,'$.objectEntityID')))
BEGIN SELECT RAISE(ABORT,'Memory references a missing entity.'); END;
CREATE TRIGGER memory_entity_reference_delete BEFORE DELETE ON entities
WHEN EXISTS(SELECT 1 FROM memory_item_revisions r JOIN memory_items m USING(memory_id)
  WHERE m.deleted_at IS NULL AND (json_extract(r.data_json,'$.subjectEntityID')=OLD.entity_id OR json_extract(r.data_json,'$.objectEntityID')=OLD.entity_id))
BEGIN SELECT RAISE(ABORT,'Retained memories reference this entity.'); END;
-- Revisions are immutable apart from the existing explicit forget redaction.
CREATE TRIGGER memory_revision_immutable BEFORE UPDATE ON memory_item_revisions
WHEN EXISTS(SELECT 1 FROM memory_items m WHERE m.memory_id=OLD.memory_id AND m.status<>'forgotten')
BEGIN SELECT RAISE(ABORT,'Create a memory revision instead of changing retained history.'); END;

-- BEGIN canonical-memory-search (also used for derived-index repair)
DROP TABLE memory_search_fts;
CREATE VIRTUAL TABLE memory_search_fts USING fts5(
  memory_id UNINDEXED,revision_id UNINDEXED,title,body,data_text,evidence_text,entity_text,
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO memory_search_fts(memory_id,revision_id,title,body,data_text,evidence_text,entity_text)
SELECT r.memory_id,r.revision_id,r.title,r.body,r.data_json,r.evidence_json,
  COALESCE((SELECT group_concat(e.canonical_name||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=e.entity_id),''),' ')
    FROM entities e WHERE e.entity_id IN (json_extract(r.data_json,'$.subjectEntityID'),json_extract(r.data_json,'$.objectEntityID'))),'')
FROM memory_item_revisions r;
-- END canonical-memory-search
CREATE TRIGGER memory_search_insert AFTER INSERT ON memory_item_revisions BEGIN
  INSERT INTO memory_search_fts(memory_id,revision_id,title,body,data_text,evidence_text,entity_text)
  SELECT NEW.memory_id,NEW.revision_id,NEW.title,NEW.body,NEW.data_json,NEW.evidence_json,
    COALESCE((SELECT group_concat(e.canonical_name||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=e.entity_id),''),' ')
      FROM entities e WHERE e.entity_id IN (json_extract(NEW.data_json,'$.subjectEntityID'),json_extract(NEW.data_json,'$.objectEntityID'))),'');
END;
CREATE TRIGGER memory_search_delete AFTER DELETE ON memory_item_revisions BEGIN
  DELETE FROM memory_search_fts WHERE revision_id=OLD.revision_id;
END;
CREATE TRIGGER memory_search_update AFTER UPDATE OF title,body,data_json,evidence_json,provenance_json,capture_boundary_json ON memory_item_revisions BEGIN
  DELETE FROM memory_search_fts WHERE revision_id=OLD.revision_id;
  INSERT INTO memory_search_fts(memory_id,revision_id,title,body,data_text,evidence_text,entity_text)
  SELECT NEW.memory_id,NEW.revision_id,NEW.title,NEW.body,NEW.data_json,NEW.evidence_json,
    COALESCE((SELECT group_concat(e.canonical_name||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=e.entity_id),''),' ')
      FROM entities e WHERE e.entity_id IN (json_extract(NEW.data_json,'$.subjectEntityID'),json_extract(NEW.data_json,'$.objectEntityID'))),'');
END;

-- BEGIN compatibility-claim-search (derived from canonical memories)
DROP TABLE claims_search_fts;
CREATE VIRTUAL TABLE claims_search_fts USING fts5(
  claim_id UNINDEXED,project_key UNINDEXED,predicate,subject,object,value_text,origin,method,epistemic_state,
  scope_text,evidence_text,model_provider,model_id,tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
SELECT c.claim_id,CASE WHEN json_valid(c.scope_json) THEN COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),'') ELSE '' END,c.predicate,
  COALESCE(s.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
  COALESCE(o.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
  COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
  COALESCE((SELECT group_concat(e.evidence_id||' '||e.relation||' '||e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
  COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id;
-- END compatibility-claim-search

CREATE TRIGGER claims_memory_insert AFTER INSERT ON memory_item_revisions BEGIN
  DELETE FROM claims_search_fts WHERE claim_id=NEW.memory_id;
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
SELECT c.claim_id,CASE WHEN json_valid(c.scope_json) THEN COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),'') ELSE '' END,c.predicate,
  COALESCE(s.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
  COALESCE(o.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
  COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
  COALESCE((SELECT group_concat(e.evidence_id||' '||e.relation||' '||e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
  COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id WHERE c.claim_id=NEW.memory_id;
END;
CREATE TRIGGER claims_memory_delete AFTER DELETE ON memory_item_revisions BEGIN
  DELETE FROM claims_search_fts WHERE claim_id=OLD.memory_id;
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
SELECT c.claim_id,CASE WHEN json_valid(c.scope_json) THEN COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),'') ELSE '' END,c.predicate,
  COALESCE(s.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
  COALESCE(o.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
  COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
  COALESCE((SELECT group_concat(e.evidence_id||' '||e.relation||' '||e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
  COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id WHERE c.claim_id=OLD.memory_id;
END;
CREATE TRIGGER claims_memory_update AFTER UPDATE ON memory_item_revisions BEGIN
  DELETE FROM claims_search_fts WHERE claim_id=NEW.memory_id;
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
SELECT c.claim_id,CASE WHEN json_valid(c.scope_json) THEN COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),'') ELSE '' END,c.predicate,
  COALESCE(s.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
  COALESCE(o.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
  COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
  COALESCE((SELECT group_concat(e.evidence_id||' '||e.relation||' '||e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
  COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id WHERE c.claim_id=NEW.memory_id;
END;
CREATE TRIGGER claims_memory_lifecycle AFTER UPDATE OF deleted_at ON memory_items BEGIN
  DELETE FROM claims_search_fts WHERE claim_id=NEW.memory_id;
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
SELECT c.claim_id,CASE WHEN json_valid(c.scope_json) THEN COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),'') ELSE '' END,c.predicate,
  COALESCE(s.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
  COALESCE(o.canonical_name,'')||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
  COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
  COALESCE((SELECT group_concat(e.evidence_id||' '||e.relation||' '||e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
  COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id WHERE c.claim_id=NEW.memory_id;
END;
CREATE TRIGGER memory_search_entity_update AFTER UPDATE OF canonical_name ON entities BEGIN
  UPDATE memory_search_fts SET entity_text=(SELECT COALESCE(group_concat(e.canonical_name||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=e.entity_id),''),' '),'') FROM memory_item_revisions r JOIN entities e ON e.entity_id IN (json_extract(r.data_json,'$.subjectEntityID'),json_extract(r.data_json,'$.objectEntityID')) WHERE r.revision_id=memory_search_fts.revision_id)
  WHERE revision_id IN (SELECT r.revision_id FROM memory_item_revisions r WHERE (json_extract(r.data_json,'$.subjectEntityID')=NEW.entity_id OR json_extract(r.data_json,'$.objectEntityID')=NEW.entity_id));
END;
CREATE TRIGGER memory_search_alias_insert AFTER INSERT ON entity_aliases BEGIN
  UPDATE memory_search_fts SET entity_text=(SELECT COALESCE(group_concat(e.canonical_name||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=e.entity_id),''),' '),'') FROM memory_item_revisions r JOIN entities e ON e.entity_id IN (json_extract(r.data_json,'$.subjectEntityID'),json_extract(r.data_json,'$.objectEntityID')) WHERE r.revision_id=memory_search_fts.revision_id)
  WHERE revision_id IN (SELECT r.revision_id FROM memory_item_revisions r WHERE (json_extract(r.data_json,'$.subjectEntityID')=NEW.entity_id OR json_extract(r.data_json,'$.objectEntityID')=NEW.entity_id));
END;
CREATE TRIGGER memory_search_alias_delete AFTER DELETE ON entity_aliases BEGIN
  UPDATE memory_search_fts SET entity_text=(SELECT COALESCE(group_concat(e.canonical_name||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=e.entity_id),''),' '),'') FROM memory_item_revisions r JOIN entities e ON e.entity_id IN (json_extract(r.data_json,'$.subjectEntityID'),json_extract(r.data_json,'$.objectEntityID')) WHERE r.revision_id=memory_search_fts.revision_id)
  WHERE revision_id IN (SELECT r.revision_id FROM memory_item_revisions r WHERE (json_extract(r.data_json,'$.subjectEntityID')=OLD.entity_id OR json_extract(r.data_json,'$.objectEntityID')=OLD.entity_id));
END;
CREATE TRIGGER memory_search_alias_update AFTER UPDATE ON entity_aliases BEGIN
  UPDATE memory_search_fts SET entity_text=(SELECT COALESCE(group_concat(e.canonical_name||' '||COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=e.entity_id),''),' '),'') FROM memory_item_revisions r JOIN entities e ON e.entity_id IN (json_extract(r.data_json,'$.subjectEntityID'),json_extract(r.data_json,'$.objectEntityID')) WHERE r.revision_id=memory_search_fts.revision_id)
  WHERE revision_id IN (SELECT r.revision_id FROM memory_item_revisions r WHERE (json_extract(r.data_json,'$.subjectEntityID') IN (OLD.entity_id,NEW.entity_id) OR json_extract(r.data_json,'$.objectEntityID') IN (OLD.entity_id,NEW.entity_id)));
END;

DROP TRIGGER claims_search_entity_update;
DROP TRIGGER claims_search_alias_insert;
DROP TRIGGER claims_search_alias_delete;
DROP TRIGGER claims_search_alias_update;
CREATE TRIGGER claims_search_entity_update AFTER UPDATE OF canonical_name ON entities BEGIN
  DELETE FROM claims_search_fts WHERE claim_id IN (SELECT claim_id FROM claims WHERE subject_entity_id=NEW.entity_id OR object_entity_id=NEW.entity_id);
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,CASE WHEN json_valid(c.scope_json) THEN COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),'') ELSE '' END,c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.subject_entity_id=NEW.entity_id OR c.object_entity_id=NEW.entity_id;
END;
CREATE TRIGGER claims_search_alias_insert AFTER INSERT ON entity_aliases BEGIN
  DELETE FROM claims_search_fts WHERE claim_id IN (SELECT claim_id FROM claims WHERE subject_entity_id=NEW.entity_id OR object_entity_id=NEW.entity_id);
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,CASE WHEN json_valid(c.scope_json) THEN COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),'') ELSE '' END,c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.subject_entity_id=NEW.entity_id OR c.object_entity_id=NEW.entity_id;
END;
CREATE TRIGGER claims_search_alias_delete AFTER DELETE ON entity_aliases BEGIN
  DELETE FROM claims_search_fts WHERE claim_id IN (SELECT claim_id FROM claims WHERE subject_entity_id=OLD.entity_id OR object_entity_id=OLD.entity_id);
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,CASE WHEN json_valid(c.scope_json) THEN COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),'') ELSE '' END,c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.subject_entity_id=OLD.entity_id OR c.object_entity_id=OLD.entity_id;
END;
CREATE TRIGGER claims_search_alias_update AFTER UPDATE ON entity_aliases BEGIN
  DELETE FROM claims_search_fts WHERE claim_id IN (SELECT claim_id FROM claims WHERE subject_entity_id IN (OLD.entity_id,NEW.entity_id) OR object_entity_id IN (OLD.entity_id,NEW.entity_id));
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,CASE WHEN json_valid(c.scope_json) THEN COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),'') ELSE '' END,c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.subject_entity_id IN (OLD.entity_id,NEW.entity_id) OR c.object_entity_id IN (OLD.entity_id,NEW.entity_id);
END;

INSERT INTO schema_migrations VALUES(24,'unified-retained-memories',unixepoch()*1000);
PRAGMA user_version=24;
