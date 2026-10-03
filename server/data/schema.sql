-- Freelancer organization only. Native sessions/messages remain in OpenCode.
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT;
CREATE TABLE project_annotations (
  project_id TEXT PRIMARY KEY,
  archived_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE session_headers (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  native_archived_at INTEGER,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, session_id)
) STRICT;
CREATE INDEX session_headers_history ON session_headers(project_id, updated_at DESC, session_id);
CREATE INDEX session_headers_parent ON session_headers(project_id, parent_id);
CREATE TABLE session_annotations (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  pinned_at INTEGER,
  hidden_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, session_id),
  FOREIGN KEY (project_id, session_id) REFERENCES session_headers(project_id, session_id)
) STRICT;
CREATE TABLE drafts (
  project_id TEXT NOT NULL,
  conversation_key TEXT NOT NULL,
  text TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, conversation_key)
) STRICT;
INSERT INTO schema_migrations VALUES (1, 'organization-and-drafts', unixepoch() * 1000);
CREATE TABLE content_meta (
  project_key TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (project_key, key)
) STRICT;
CREATE TABLE content_sources (
  source_id INTEGER PRIMARY KEY,
  project_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  virtual_path TEXT NOT NULL,
  container_path TEXT NOT NULL,
  member_path TEXT NOT NULL DEFAULT '',
  extension TEXT NOT NULL,
  source_role TEXT NOT NULL,
  status TEXT NOT NULL,
  routing_rank INTEGER NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  modified_utc TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  unit_count INTEGER NOT NULL,
  locator_kind TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  extraction_status TEXT NOT NULL,
  text_chars INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  source_identity TEXT NOT NULL DEFAULT '',
  revision_identity TEXT NOT NULL DEFAULT '',
  UNIQUE(project_key, virtual_path)
) STRICT;
CREATE TABLE content_units (
  unit_id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES content_sources(source_id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL,
  locator TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  UNIQUE(source_id, unit_no)
) STRICT;
CREATE VIRTUAL TABLE content_units_fts USING fts5(
  project_key UNINDEXED,
  filename,
  virtual_path,
  source_role,
  status,
  heading,
  locator,
  text,
  tokenize='unicode61 remove_diacritics 2'
);
CREATE UNIQUE INDEX content_sources_identity ON content_sources(source_identity);
CREATE TABLE content_source_revisions (
  source_identity TEXT NOT NULL, revision_identity TEXT NOT NULL, project_key TEXT NOT NULL,
  virtual_path TEXT NOT NULL, metadata_json TEXT NOT NULL, captured_at INTEGER NOT NULL,
  PRIMARY KEY(source_identity,revision_identity)
) STRICT;
CREATE INDEX content_source_revisions_project ON content_source_revisions(project_key,virtual_path,captured_at DESC);
CREATE TABLE content_unit_revisions (
  source_identity TEXT NOT NULL, revision_identity TEXT NOT NULL, unit_no INTEGER NOT NULL,
  locator TEXT NOT NULL, heading TEXT NOT NULL, text TEXT NOT NULL, word_count INTEGER NOT NULL,
  char_count INTEGER NOT NULL, sha256 TEXT NOT NULL,
  PRIMARY KEY(source_identity,revision_identity,unit_no),
  FOREIGN KEY(source_identity,revision_identity) REFERENCES content_source_revisions(source_identity,revision_identity)
) STRICT;
CREATE INDEX content_unit_revisions_ref ON content_unit_revisions(source_identity,revision_identity,locator,sha256);
CREATE TABLE content_facts (
  fact_id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES content_sources(source_id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL,
  locator TEXT NOT NULL,
  fact_kind TEXT NOT NULL,
  family TEXT NOT NULL,
  label TEXT NOT NULL,
  label_norm TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value_num REAL,
  value_unit TEXT NOT NULL DEFAULT '',
  field_path TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL,
  confidence REAL NOT NULL
) STRICT;
CREATE TABLE content_fact_stats (
  project_key TEXT NOT NULL,
  family TEXT NOT NULL,
  label_norm TEXT NOT NULL,
  label TEXT NOT NULL,
  value_unit TEXT NOT NULL,
  fact_count INTEGER NOT NULL,
  distinct_value_count INTEGER NOT NULL,
  source_count INTEGER NOT NULL,
  numeric_count INTEGER NOT NULL,
  min_numeric REAL,
  max_numeric REAL,
  avg_numeric REAL,
  PRIMARY KEY(project_key, family, label_norm, value_unit)
) STRICT;
CREATE INDEX content_sources_project_route ON content_sources(project_key, source_role, status, routing_rank DESC);
CREATE INDEX content_units_source ON content_units(source_id, unit_no);
CREATE INDEX content_facts_family ON content_facts(family, source_id, unit_no);
CREATE INDEX content_facts_label ON content_facts(label_norm, source_id, unit_no);
CREATE INDEX content_facts_kind ON content_facts(fact_kind, family);

INSERT INTO schema_migrations VALUES (2, 'unified-content-index', unixepoch() * 1000);
CREATE VIRTUAL TABLE chat_search USING fts5(
  project_id UNINDEXED, session_id UNINDEXED, message_id UNINDEXED,
  role UNINDEXED, model_id UNINDEXED, updated_at UNINDEXED,
  title, body, tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE chat_search_state (
  project_id TEXT NOT NULL, session_id TEXT NOT NULL,
  native_updated_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, session_id)
) STRICT;
INSERT INTO schema_migrations VALUES (3, 'native-chat-search', unixepoch() * 1000);
CREATE TABLE model_catalog (
  model_id TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL,
  rating_json TEXT,
  updated_at INTEGER,
  source_model TEXT
) STRICT;
CREATE TABLE model_rating_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  targets_json TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
INSERT INTO schema_migrations VALUES (4, 'model-ratings', unixepoch() * 1000);
PRAGMA application_id = 1414482766;
ALTER TABLE model_rating_jobs ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE project_index_state (project_id TEXT PRIMARY KEY, ready_at INTEGER NOT NULL) STRICT;
INSERT INTO schema_migrations VALUES (5, 'configuration-progress', unixepoch() * 1000);
PRAGMA user_version = 5;

CREATE TABLE chatgpt_chats (
  project_id TEXT NOT NULL, id TEXT NOT NULL, source_id TEXT NOT NULL,
  title TEXT NOT NULL, directory TEXT NOT NULL, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, imported_at INTEGER NOT NULL, source_json TEXT NOT NULL,
  PRIMARY KEY(project_id,id), UNIQUE(project_id,source_id)
) STRICT;
CREATE TABLE chatgpt_messages (
  project_id TEXT NOT NULL, chat_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
  message_json TEXT NOT NULL, PRIMARY KEY(project_id,chat_id,ordinal),
  FOREIGN KEY(project_id,chat_id) REFERENCES chatgpt_chats(project_id,id)
) STRICT;
CREATE TABLE chatgpt_continuations (
  project_id TEXT NOT NULL, chat_id TEXT NOT NULL, native_id TEXT,
  status TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(project_id,chat_id), UNIQUE(project_id,native_id),
  FOREIGN KEY(project_id,chat_id) REFERENCES chatgpt_chats(project_id,id)
) STRICT;
CREATE TABLE project_onboarding (
  project_id TEXT PRIMARY KEY, completed_at INTEGER NOT NULL, imported_count INTEGER NOT NULL
) STRICT;
INSERT INTO schema_migrations VALUES (6, 'chatgpt-snapshots', unixepoch() * 1000);
-- Canonical homes for operational receipts and Freelancer domain documents.
CREATE TABLE operational_records (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1', collection TEXT NOT NULL,
  id TEXT NOT NULL, project_id TEXT, session_id TEXT,
  data TEXT NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(runtime_id,collection,id)
) STRICT;
CREATE INDEX operational_records_session ON operational_records(runtime_id,collection,project_id,session_id);
CREATE TABLE application_documents (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1',document_key TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(runtime_id,document_key)
) STRICT;
CREATE TABLE project_registrations (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1',project_id TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(runtime_id,project_id)
) STRICT;
CREATE TABLE runtime_settings (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1',setting_key TEXT NOT NULL,data TEXT NOT NULL,
  PRIMARY KEY(runtime_id,setting_key)
) STRICT;
CREATE TABLE settings_update_journal (
  runtime_id TEXT PRIMARY KEY, previous_revision INTEGER NOT NULL,
  next_revision INTEGER NOT NULL CHECK(next_revision > previous_revision),
  settings_json TEXT NOT NULL
) STRICT;
CREATE TABLE data_migration_runs (
  migration_id TEXT PRIMARY KEY, source_path TEXT NOT NULL,
  source_app_id INTEGER NOT NULL, source_schema_version INTEGER NOT NULL,
  source_sha256 TEXT NOT NULL, status TEXT NOT NULL, manifest_json TEXT NOT NULL,
  started_at INTEGER NOT NULL, completed_at INTEGER
) STRICT;
CREATE TABLE data_table_lifecycle (
  table_name TEXT PRIMARY KEY,
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('durable','derived')),
  owner TEXT NOT NULL,
  introduced_version INTEGER NOT NULL
) STRICT;
INSERT INTO data_table_lifecycle VALUES
  ('project_annotations','durable','history',1),('session_headers','durable','history-cache',1),
  ('session_annotations','durable','history',1),('drafts','durable','drafts',1),
  ('content_meta','derived','content-index',2),('content_sources','derived','content-index',2),
  ('content_units','derived','content-index',2),('content_units_fts','derived','content-index',2),
  ('content_facts','derived','content-index',2),('content_fact_stats','derived','content-index',2),
  ('chat_search','derived','chat-index',3),('chat_search_state','derived','chat-index',3),
  ('model_catalog','durable','model-ratings',4),('model_rating_jobs','durable','model-ratings',4),
  ('project_index_state','derived','content-index',5),
  ('chatgpt_chats','durable','imported-chats',6),('chatgpt_messages','durable','imported-chats',6),
  ('chatgpt_continuations','durable','imported-chats',6),('project_onboarding','durable','imported-chats',6),
  ('operational_records','durable','runtime-records',7),('application_documents','durable','application-settings-migration',7),
  ('project_registrations','durable','projects',7),('runtime_settings','durable','runtime-settings',12),
  ('settings_update_journal','durable','application-settings-recovery',12),
  ('data_migration_runs','durable','migration',7);

-- Provenance-aware memory, graph, and claim domain.
CREATE TABLE entities (
  entity_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX entities_lookup ON entities(entity_type,normalized_name);
CREATE TABLE entity_aliases (
  entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, PRIMARY KEY(entity_id,normalized_alias)
) STRICT;
CREATE INDEX entity_alias_lookup ON entity_aliases(normalized_alias);
CREATE TABLE memory_items (
  memory_id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT '', source_project_id TEXT, source_session_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;
CREATE TABLE memory_item_revisions (
  revision_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory_items(memory_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, body TEXT NOT NULL, provenance_json TEXT NOT NULL,
  capture_boundary_json TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(memory_id,revision)
) STRICT;
CREATE TABLE memory_pins (
  memory_id TEXT PRIMARY KEY REFERENCES memory_items(memory_id) ON DELETE CASCADE,
  pinned_at INTEGER NOT NULL, original_pinned_at INTEGER, rank INTEGER,
  revision INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE memory_members (
  revision_id TEXT NOT NULL REFERENCES memory_item_revisions(revision_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, member_kind TEXT NOT NULL, source_ref TEXT NOT NULL,
  source_revision TEXT, locator_json TEXT NOT NULL, content_hash TEXT, availability TEXT NOT NULL,
  PRIMARY KEY(revision_id,ordinal),
  UNIQUE(revision_id,member_kind,source_ref,source_revision,locator_json)
) STRICT;
CREATE TABLE claims (
  claim_id TEXT PRIMARY KEY, subject_entity_id TEXT REFERENCES entities(entity_id),
  predicate TEXT NOT NULL, object_entity_id TEXT REFERENCES entities(entity_id), value_json TEXT,
  origin TEXT NOT NULL, method TEXT NOT NULL, epistemic_state TEXT NOT NULL, scope_json TEXT NOT NULL,
  valid_from INTEGER, valid_to INTEGER, observed_at INTEGER, recorded_at INTEGER NOT NULL,
  superseded_at INTEGER, actor TEXT NOT NULL DEFAULT '', model_provider TEXT, model_id TEXT
) STRICT;
CREATE INDEX claims_subject_predicate ON claims(subject_entity_id,predicate,epistemic_state);
CREATE TABLE claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL, relation TEXT NOT NULL, evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY(claim_id,evidence_id,relation)
) STRICT;
CREATE TABLE entity_relations (
  relation_id TEXT PRIMARY KEY, from_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL, to_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  provenance_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  CHECK(from_entity_id <> to_entity_id), UNIQUE(from_entity_id,relation_type,to_entity_id)
) STRICT;
CREATE TABLE memory_changes (
  change_id TEXT PRIMARY KEY, memory_id TEXT, claim_id TEXT, change_type TEXT NOT NULL,
  prior_ref TEXT, new_ref TEXT, actor TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
) STRICT;
INSERT INTO data_table_lifecycle VALUES
 ('entities','durable','memory',8),('entity_aliases','durable','memory',8),
 ('memory_items','durable','memory',8),('memory_item_revisions','durable','memory',8),
 ('memory_pins','durable','memory',8),('memory_members','durable','memory',8),
 ('claims','durable','memory',8),('claim_evidence','durable','memory',8),
 ('entity_relations','durable','memory',8),('memory_changes','durable','memory',8);
CREATE TABLE judgment_definitions (
  definition_id TEXT NOT NULL, version INTEGER NOT NULL, question_id TEXT NOT NULL,
  primitive TEXT NOT NULL CHECK(primitive IN ('check','classify','score')),
  question_json TEXT NOT NULL, criteria_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(definition_id,version)
) STRICT;
CREATE TABLE judgment_runs (
  run_id TEXT PRIMARY KEY, definition_id TEXT NOT NULL, definition_version INTEGER NOT NULL,
  state_hash TEXT NOT NULL, candidate_set_hash TEXT NOT NULL, evidence_hash TEXT NOT NULL,
  candidate_ids_json TEXT NOT NULL, evidence_refs_json TEXT NOT NULL,
  requested_provider TEXT NOT NULL, requested_model TEXT NOT NULL DEFAULT '',
  reported_provider TEXT, reported_model TEXT, status TEXT NOT NULL,
  captured_at INTEGER NOT NULL, latency_ms INTEGER, usage_json TEXT,
  caller_decision_json TEXT, verified_outcome_json TEXT,
  FOREIGN KEY(definition_id,definition_version) REFERENCES judgment_definitions(definition_id,version)
) STRICT;
CREATE TABLE judgment_results (
  run_id TEXT NOT NULL REFERENCES judgment_runs(run_id) ON DELETE CASCADE,
  question_id TEXT NOT NULL, answer_json TEXT, probabilities_json TEXT,
  confidence REAL, derived_json TEXT,
  PRIMARY KEY(run_id,question_id)
) STRICT;
CREATE INDEX judgment_runs_cache ON judgment_runs(state_hash,candidate_set_hash,evidence_hash,definition_id,definition_version,requested_provider,requested_model,reported_provider,reported_model,status);
INSERT INTO data_table_lifecycle VALUES
 ('judgment_definitions','durable','judgments',14),
 ('judgment_runs','durable','judgments',14),
 ('judgment_results','durable','judgments',14);
INSERT INTO schema_migrations VALUES (14, 'typed-judgments', unixepoch() * 1000);
INSERT INTO schema_migrations VALUES (7, 'unified-operational-records', unixepoch() * 1000);
INSERT INTO schema_migrations VALUES (8, 'provenance-memory-and-claims', unixepoch() * 1000);
CREATE VIRTUAL TABLE memory_search_fts USING fts5(
  memory_id UNINDEXED, revision_id UNINDEXED, title, body,
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER memory_search_insert AFTER INSERT ON memory_item_revisions BEGIN
  INSERT INTO memory_search_fts(memory_id,revision_id,title,body)
  SELECT NEW.memory_id,NEW.revision_id,m.title,NEW.body FROM memory_items m WHERE m.memory_id=NEW.memory_id;
END;
CREATE TRIGGER memory_search_delete AFTER DELETE ON memory_item_revisions BEGIN
  DELETE FROM memory_search_fts WHERE revision_id=OLD.revision_id;
END;
CREATE TRIGGER memory_search_update AFTER UPDATE OF body,provenance_json,capture_boundary_json ON memory_item_revisions BEGIN
  DELETE FROM memory_search_fts WHERE revision_id=OLD.revision_id;
  INSERT INTO memory_search_fts(memory_id,revision_id,title,body)
  SELECT NEW.memory_id,NEW.revision_id,m.title,NEW.body FROM memory_items m WHERE m.memory_id=NEW.memory_id;
END;
CREATE TRIGGER memory_title_update AFTER UPDATE OF title ON memory_items BEGIN
  DELETE FROM memory_search_fts WHERE memory_id=NEW.memory_id;
  INSERT INTO memory_search_fts(memory_id,revision_id,title,body)
  SELECT m.memory_id,r.revision_id,m.title,r.body FROM memory_items m
  JOIN memory_item_revisions r ON r.memory_id=m.memory_id WHERE m.memory_id=NEW.memory_id;
END;
INSERT INTO data_table_lifecycle VALUES ('memory_search_fts','derived','memory-search',9);
CREATE TABLE memory_migration_runs (
  migration_id TEXT PRIMARY KEY, imported_count INTEGER NOT NULL,
  remaining_count INTEGER NOT NULL, completed_at INTEGER NOT NULL
) STRICT;
INSERT INTO data_table_lifecycle VALUES ('memory_migration_runs','durable','memory-migration',9);
INSERT INTO schema_migrations VALUES (9, 'memory-search-projection', unixepoch() * 1000);
CREATE VIEW knowledge_pinned_memories AS
SELECT m.memory_id,m.kind,m.title,m.status,m.source_system,m.source_project_id,m.source_session_id,
  p.pinned_at,p.original_pinned_at,p.rank,p.revision AS pin_revision,
  r.revision,r.revision_id,r.body,r.provenance_json,r.capture_boundary_json,r.created_at AS captured_revision_at
FROM memory_pins p JOIN memory_items m ON m.memory_id=p.memory_id
JOIN memory_item_revisions r ON r.memory_id=m.memory_id
  AND r.revision=(SELECT max(latest.revision) FROM memory_item_revisions latest WHERE latest.memory_id=m.memory_id)
WHERE m.deleted_at IS NULL;
CREATE TABLE runtime_instances (
  runtime_id TEXT PRIMARY KEY,source_path TEXT NOT NULL,source_app_id INTEGER NOT NULL,
  source_schema_version INTEGER NOT NULL,source_sha256 TEXT NOT NULL,imported_at INTEGER NOT NULL
) STRICT;
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
CREATE TABLE runtime_collection_markers (
  runtime_id TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  PRIMARY KEY(runtime_id, collection_name)
) STRICT;
INSERT INTO data_table_lifecycle VALUES
 ('runtime_collection_markers','durable','runtime-cutover-markers',11);
INSERT INTO schema_migrations VALUES (11, 'runtime-cutover-markers', unixepoch() * 1000);
INSERT INTO schema_migrations VALUES (12, 'separate-application-settings', unixepoch() * 1000);
INSERT INTO schema_migrations VALUES (13, 'stable-content-source-identities', unixepoch() * 1000);
CREATE TABLE opencode_sources (
  source_system_id TEXT PRIMARY KEY, locator_sha256 TEXT NOT NULL,
  api_version TEXT, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
) STRICT;
CREATE TABLE opencode_ingest_runs (
  run_id TEXT PRIMARY KEY, source_system_id TEXT NOT NULL REFERENCES opencode_sources(source_system_id),
  project_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('refresh','backfill')),
  status TEXT NOT NULL CHECK(status IN ('running','partial','complete','failed')),
  cursor_json TEXT, discovered_sessions INTEGER NOT NULL DEFAULT 0,
  captured_sessions INTEGER NOT NULL DEFAULT 0, captured_messages INTEGER NOT NULL DEFAULT 0,
  failed_sessions INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  completed_at INTEGER, error TEXT
) STRICT;
CREATE TABLE opencode_ingest_cursors (
  source_system_id TEXT NOT NULL REFERENCES opencode_sources(source_system_id), project_id TEXT NOT NULL,
  cursor_json TEXT, state TEXT NOT NULL CHECK(state IN ('incomplete','complete')),
  discovered_sessions INTEGER NOT NULL, captured_sessions INTEGER NOT NULL,
  captured_messages INTEGER NOT NULL, failed_sessions INTEGER NOT NULL,
  latest_run_id TEXT NOT NULL REFERENCES opencode_ingest_runs(run_id), updated_at INTEGER NOT NULL,
  PRIMARY KEY(source_system_id,project_id)
) STRICT;
CREATE TABLE opencode_ingest_failures (
  run_id TEXT NOT NULL REFERENCES opencode_ingest_runs(run_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL, error TEXT NOT NULL, failed_at INTEGER NOT NULL,
  PRIMARY KEY(run_id,session_id)
) STRICT;
CREATE TABLE opencode_sessions (
  source_system_id TEXT NOT NULL REFERENCES opencode_sources(source_system_id),
  project_id TEXT NOT NULL, session_id TEXT NOT NULL, parent_id TEXT,
  title TEXT NOT NULL, directory_sha256 TEXT, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, archived_at INTEGER, current_revision_sha256 TEXT NOT NULL,
  seen_at INTEGER NOT NULL, PRIMARY KEY(source_system_id,project_id,session_id),
  FOREIGN KEY(source_system_id,project_id,session_id,current_revision_sha256)
    REFERENCES opencode_session_revisions(source_system_id,project_id,session_id,revision_sha256)
) STRICT;
CREATE TABLE opencode_session_revisions (
  source_system_id TEXT NOT NULL, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
  revision_sha256 TEXT NOT NULL, payload_json TEXT NOT NULL, captured_at INTEGER NOT NULL,
  PRIMARY KEY(source_system_id,project_id,session_id,revision_sha256)
) STRICT;
CREATE TABLE opencode_messages (
  source_system_id TEXT NOT NULL, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
  message_id TEXT NOT NULL, ordinal INTEGER NOT NULL, role TEXT NOT NULL,
  provider_id TEXT, model_id TEXT, created_at INTEGER, completed_at INTEGER,
  usage_json TEXT, current_revision_sha256 TEXT NOT NULL, seen_at INTEGER NOT NULL,
  PRIMARY KEY(source_system_id,project_id,session_id,message_id),
  FOREIGN KEY(source_system_id,project_id,session_id) REFERENCES opencode_sessions(source_system_id,project_id,session_id) ON DELETE CASCADE,
  FOREIGN KEY(source_system_id,project_id,session_id,message_id,current_revision_sha256)
    REFERENCES opencode_message_revisions(source_system_id,project_id,session_id,message_id,revision_sha256)
) STRICT;
CREATE TABLE opencode_message_revisions (
  source_system_id TEXT NOT NULL, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
  message_id TEXT NOT NULL, revision_sha256 TEXT NOT NULL, info_json TEXT NOT NULL,
  parts_json TEXT NOT NULL, captured_at INTEGER NOT NULL,
  PRIMARY KEY(source_system_id,project_id,session_id,message_id,revision_sha256),
  FOREIGN KEY(source_system_id,project_id,session_id) REFERENCES opencode_sessions(source_system_id,project_id,session_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX opencode_sessions_project_updated ON opencode_sessions(project_id,updated_at DESC,session_id);
CREATE INDEX opencode_messages_session_order ON opencode_messages(source_system_id,project_id,session_id,ordinal);
CREATE INDEX opencode_message_revisions_ref ON opencode_message_revisions(source_system_id,project_id,session_id,message_id,captured_at DESC);
CREATE INDEX opencode_ingest_runs_source ON opencode_ingest_runs(source_system_id,project_id,started_at DESC);
CREATE INDEX opencode_ingest_failures_session ON opencode_ingest_failures(session_id,failed_at DESC);
CREATE VIEW opencode_source_coverage AS
SELECT s.source_system_id,s.first_seen_at,s.last_seen_at,
 (SELECT count(*) FROM opencode_sessions x WHERE x.source_system_id=s.source_system_id) AS sessions,
 (SELECT count(*) FROM opencode_messages m WHERE m.source_system_id=s.source_system_id) AS messages,
 (SELECT count(*) FROM opencode_session_revisions r WHERE r.source_system_id=s.source_system_id) AS session_revisions,
 (SELECT count(*) FROM opencode_message_revisions r WHERE r.source_system_id=s.source_system_id) AS message_revisions
FROM opencode_sources s;
INSERT INTO data_table_lifecycle VALUES
 ('opencode_sources','durable','opencode-warehouse',15),
 ('opencode_ingest_runs','durable','opencode-ingestion',15),
 ('opencode_ingest_cursors','durable','opencode-ingestion',15),
 ('opencode_ingest_failures','durable','opencode-ingestion',15),
 ('opencode_sessions','durable','opencode-warehouse',15),
 ('opencode_session_revisions','durable','opencode-warehouse',15),
 ('opencode_messages','durable','opencode-warehouse',15),
 ('opencode_message_revisions','durable','opencode-warehouse',15),
 ('opencode_source_coverage','derived','opencode-warehouse-views',15);
INSERT INTO schema_migrations VALUES (15, 'opencode-native-source-revisions', unixepoch() * 1000);
INSERT INTO schema_migrations VALUES (16, 'versioned-judgment-definitions', unixepoch() * 1000);
INSERT INTO data_table_lifecycle VALUES
 ('content_source_revisions','durable','content-evidence-history',17),
 ('content_unit_revisions','durable','content-evidence-history',17);
INSERT INTO schema_migrations VALUES (17, 'durable-content-source-revisions', unixepoch() * 1000);
PRAGMA user_version = 17;

CREATE TABLE memory_capture_jobs (
  job_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory_items(memory_id),
  project_id TEXT NOT NULL, session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
  expected_revision INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT
) STRICT;
CREATE UNIQUE INDEX memory_capture_active ON memory_capture_jobs(memory_id)
  WHERE status IN ('queued','running');
INSERT INTO data_table_lifecycle VALUES ('memory_capture_jobs','durable','memory-capture',18);
INSERT INTO schema_migrations VALUES (18,'durable-memory-capture',unixepoch() * 1000);
PRAGMA user_version = 18;
