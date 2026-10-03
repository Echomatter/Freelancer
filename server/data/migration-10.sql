-- Queryable, documented warehouse projections. These contain no new authority.
CREATE TABLE runtime_instances (
  runtime_id TEXT PRIMARY KEY, source_path TEXT NOT NULL,
  source_app_id INTEGER NOT NULL, source_schema_version INTEGER NOT NULL,
  source_sha256 TEXT NOT NULL, imported_at INTEGER NOT NULL
) STRICT;

CREATE TABLE operational_records_v10 (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1', collection TEXT NOT NULL,
  id TEXT NOT NULL, project_id TEXT, session_id TEXT,
  data TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(runtime_id,collection,id)
) STRICT;
INSERT INTO operational_records_v10(runtime_id,collection,id,project_id,session_id,data,summary)
SELECT 'legacy-runtime-v1',collection,id,project_id,session_id,data,summary FROM operational_records;
DROP INDEX operational_records_session;
DROP TABLE operational_records;
ALTER TABLE operational_records_v10 RENAME TO operational_records;
CREATE INDEX operational_records_session ON operational_records(runtime_id,collection,project_id,session_id);

CREATE TABLE application_documents_v10 (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1',document_key TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(runtime_id,document_key)
) STRICT;
INSERT INTO application_documents_v10(runtime_id,document_key,data)
SELECT 'legacy-runtime-v1',document_key,data FROM application_documents;
DROP TABLE application_documents;
ALTER TABLE application_documents_v10 RENAME TO application_documents;

CREATE TABLE project_registrations_v10 (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1',project_id TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(runtime_id,project_id)
) STRICT;
INSERT INTO project_registrations_v10(runtime_id,project_id,data)
SELECT 'legacy-runtime-v1',project_id,data FROM project_registrations;
DROP TABLE project_registrations;
ALTER TABLE project_registrations_v10 RENAME TO project_registrations;

CREATE TABLE application_settings_v10 (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1',setting_key TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(runtime_id,setting_key)
) STRICT;
INSERT INTO application_settings_v10(runtime_id,setting_key,data)
SELECT 'legacy-runtime-v1',setting_key,data FROM application_settings;
DROP TABLE application_settings;
ALTER TABLE application_settings_v10 RENAME TO application_settings;

UPDATE data_migration_runs SET migration_id='runtime-records:legacy-runtime-v1'
WHERE migration_id='runtime-records-v1';
INSERT INTO runtime_instances(runtime_id,source_path,source_app_id,source_schema_version,source_sha256,imported_at)
SELECT 'legacy-runtime-v1',source_path,source_app_id,source_schema_version,source_sha256,COALESCE(completed_at,started_at)
FROM data_migration_runs WHERE migration_id='runtime-records:legacy-runtime-v1';

CREATE VIEW knowledge_pinned_memories AS
SELECT m.memory_id,m.kind,m.title,m.status,m.source_system,m.source_project_id,m.source_session_id,
  p.pinned_at,p.original_pinned_at,p.rank,p.revision AS pin_revision,
  r.revision,r.revision_id,r.body,r.provenance_json,r.capture_boundary_json,r.created_at AS captured_revision_at
FROM memory_pins p JOIN memory_items m ON m.memory_id=p.memory_id
JOIN memory_item_revisions r ON r.memory_id=m.memory_id
  AND r.revision=(SELECT max(latest.revision) FROM memory_item_revisions latest WHERE latest.memory_id=m.memory_id)
WHERE m.deleted_at IS NULL;

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

CREATE VIEW knowledge_memory_evidence AS
SELECT m.memory_id,m.kind,m.title,r.revision,r.revision_id,mm.ordinal,mm.member_kind,mm.source_ref,
  mm.source_revision,mm.locator_json,mm.content_hash,mm.availability
FROM memory_items m JOIN memory_item_revisions r ON r.memory_id=m.memory_id
  AND r.revision=(SELECT max(latest.revision) FROM memory_item_revisions latest WHERE latest.memory_id=m.memory_id)
JOIN memory_members mm ON mm.revision_id=r.revision_id
WHERE m.deleted_at IS NULL;

CREATE VIEW knowledge_source_coverage AS
SELECT s.project_key,count(*) AS source_count,
  sum(CASE WHEN s.extraction_status='ok' THEN 1 ELSE 0 END) AS extracted_source_count,
  sum(CASE WHEN s.extraction_status<>'ok' THEN 1 ELSE 0 END) AS incomplete_source_count,
  sum(s.unit_count) AS declared_unit_count,
  (SELECT count(*) FROM content_units u JOIN content_sources sx ON sx.source_id=u.source_id WHERE sx.project_key=s.project_key) AS stored_unit_count,
  sum(s.word_count) AS extracted_word_count,
  max(s.modified_utc) AS latest_source_modified
FROM content_sources s GROUP BY s.project_key;

INSERT INTO data_table_lifecycle VALUES
 ('runtime_instances','durable','runtime-identity',10),
 ('knowledge_pinned_memories','derived','knowledge-views',10),
 ('knowledge_current_claims','derived','knowledge-views',10),
 ('knowledge_claim_evidence','derived','knowledge-views',10),
 ('knowledge_memory_evidence','derived','knowledge-views',10),
 ('knowledge_source_coverage','derived','knowledge-views',10);
INSERT INTO schema_migrations VALUES (10, 'documented-knowledge-views', unixepoch() * 1000);
PRAGMA user_version = 10;
