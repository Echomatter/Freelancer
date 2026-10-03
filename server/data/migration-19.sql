CREATE TABLE entity_relation_revisions (
  revision_id TEXT PRIMARY KEY,
  relation_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  from_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  operation TEXT NOT NULL CHECK(operation IN ('created','revised','retracted')),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  UNIQUE(relation_id,revision)
) STRICT;
CREATE INDEX entity_relation_revision_history ON entity_relation_revisions(relation_id,revision);
CREATE INDEX entity_relation_revision_validity ON entity_relation_revisions(valid_from,valid_to);
INSERT INTO data_table_lifecycle VALUES ('entity_relation_revisions','durable','memory-relations',19);
INSERT INTO entity_relation_revisions(revision_id,relation_id,revision,from_entity_id,relation_type,to_entity_id,
  provenance_json,valid_from,valid_to,operation,actor,reason,recorded_at)
SELECT lower(hex(randomblob(16))),relation_id,1,from_entity_id,relation_type,to_entity_id,provenance_json,created_at,NULL,
  'created','migration','Migrated existing active relation into revision history.',created_at FROM entity_relations;

CREATE VIRTUAL TABLE claims_search_fts USING fts5(
  claim_id UNINDEXED, project_key UNINDEXED, predicate, subject, object,
  value_text, origin, method, epistemic_state, scope_text, evidence_text,
  model_provider, model_id, tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
  COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
  COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
  COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
  COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
  COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id;

CREATE TRIGGER claims_search_insert AFTER INSERT ON claims BEGIN
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.claim_id=NEW.claim_id;
END;
CREATE TRIGGER claims_search_update AFTER UPDATE ON claims BEGIN
  DELETE FROM claims_search_fts WHERE claim_id=OLD.claim_id;
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.claim_id=NEW.claim_id;
END;
CREATE TRIGGER claims_search_delete AFTER DELETE ON claims BEGIN
  DELETE FROM claims_search_fts WHERE claim_id=OLD.claim_id;
END;

CREATE TRIGGER claims_search_evidence_insert AFTER INSERT ON claim_evidence BEGIN
  DELETE FROM claims_search_fts WHERE claim_id=NEW.claim_id;
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.claim_id=NEW.claim_id;
END;
CREATE TRIGGER claims_search_evidence_delete AFTER DELETE ON claim_evidence BEGIN
  DELETE FROM claims_search_fts WHERE claim_id=OLD.claim_id;
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.claim_id=OLD.claim_id;
END;
CREATE TRIGGER claims_search_evidence_update AFTER UPDATE ON claim_evidence BEGIN
  DELETE FROM claims_search_fts WHERE claim_id IN (OLD.claim_id,NEW.claim_id);
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.claim_id IN (OLD.claim_id,NEW.claim_id);
END;

CREATE TRIGGER claims_search_entity_update AFTER UPDATE OF canonical_name ON entities BEGIN
  DELETE FROM claims_search_fts WHERE claim_id IN (SELECT claim_id FROM claims WHERE subject_entity_id=NEW.entity_id OR object_entity_id=NEW.entity_id);
  INSERT INTO claims_search_fts(claim_id,project_key,predicate,subject,object,value_text,origin,method,epistemic_state,scope_text,evidence_text,model_provider,model_id)
  SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
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
  SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
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
  SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
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
  SELECT c.claim_id,COALESCE(json_extract(c.scope_json,'$.projectID'),json_extract(c.scope_json,'$.project'),''),c.predicate,
    COALESCE(s.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=s.entity_id),''),
    COALESCE(o.canonical_name,'') || ' ' || COALESCE((SELECT group_concat(a.alias,' ') FROM entity_aliases a WHERE a.entity_id=o.entity_id),''),
    COALESCE(c.value_json,''),c.origin,c.method,c.epistemic_state,c.scope_json,
    COALESCE((SELECT group_concat(e.evidence_id || ' ' || e.relation || ' ' || e.evidence_json,' ') FROM claim_evidence e WHERE e.claim_id=c.claim_id),''),
    COALESCE(c.model_provider,''),COALESCE(c.model_id,'')
  FROM claims c LEFT JOIN entities s ON s.entity_id=c.subject_entity_id LEFT JOIN entities o ON o.entity_id=c.object_entity_id
  WHERE c.subject_entity_id IN (OLD.entity_id,NEW.entity_id) OR c.object_entity_id IN (OLD.entity_id,NEW.entity_id);
END;
INSERT INTO data_table_lifecycle VALUES ('claims_search_fts','derived','claim-search',19);
INSERT INTO schema_migrations VALUES (19,'temporal-memory-relations-and-claim-search',unixepoch() * 1000);
PRAGMA user_version = 19;
