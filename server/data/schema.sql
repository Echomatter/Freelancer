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
-- A safe, normalized projection of recorded task outcomes. Keep execution
-- completion separate from verified task success and never expose full receipts.
CREATE VIEW knowledge_task_outcomes AS
WITH history_documents AS (
  SELECT runtime_id,
    CASE WHEN json_valid(data) THEN data ELSE '{"entries":[]}' END AS document
  FROM application_documents WHERE document_key='task-history.json'
), entries AS (
  SELECT h.runtime_id,e.value AS entry
  FROM history_documents h,json_each(
    CASE WHEN json_type(h.document,'$.entries')='array' THEN h.document ELSE '{"entries":[]}' END,'$.entries'
  ) e WHERE e.type='object'
), normalized AS (
  SELECT runtime_id,
    json_extract(entry,'$.task_id') AS task_id,
    COALESCE(json_extract(entry,'$.user_task_id'),json_extract(entry,'$.task_id')) AS user_task_id,
    COALESCE(json_extract(entry,'$.timestamp'),json_extract(entry,'$.recorded_at')) AS recorded_at,
    COALESCE(json_extract(entry,'$.repo'),'') AS repo,
    COALESCE(json_extract(entry,'$.model'),json_extract(entry,'$.observed_model'),json_extract(entry,'$.selected_model'),'') AS model,
    CASE WHEN json_type(entry,'$.success') IN ('true','false') THEN json_extract(entry,'$.success') ELSE NULL END AS execution_success,
    lower(trim(COALESCE(json_extract(entry,'$.verification_status'),''))) AS verification_status,
    entry
  FROM entries
), classified AS (
  SELECT n.*,CASE verification_status
      WHEN 'passed' THEN 'passed' WHEN 'failed' THEN 'failed' WHEN 'skipped' THEN 'skipped'
      WHEN 'unavailable' THEN 'unavailable' WHEN 'not-run' THEN 'not-run' WHEN 'cancelled' THEN 'cancelled'
      ELSE 'unknown' END AS outcome_status
  FROM normalized n
), typed AS (
  SELECT DISTINCT n.*,COALESCE(NULLIF(trim(CAST(t.value AS TEXT)),''),'unknown') AS task_type
  FROM classified n LEFT JOIN json_each(
    CASE WHEN json_type(n.entry,'$.task_type')='array' THEN json_extract(n.entry,'$.task_type') ELSE '[]' END
  ) t ON true
)
SELECT t.runtime_id,t.task_id,t.user_task_id,t.task_type,t.model,t.repo,t.recorded_at,
  t.execution_success,
  CASE WHEN t.outcome_status='unknown' AND (json_extract(r.data,'$.status')='cancelled' OR
       json_extract(r.data,'$.attempts[#-1].status')='cancelled') THEN 'cancelled' ELSE t.outcome_status END AS outcome_status,
  CASE WHEN length(t.task_id)=64 AND t.task_id NOT GLOB '*[^a-fA-F0-9]*' THEN json_extract(r.data,'$.status') ELSE NULL END AS native_worker_status,
  CASE WHEN length(t.task_id)=64 AND t.task_id NOT GLOB '*[^a-fA-F0-9]*' THEN json_extract(r.data,'$.attempts[#-1].status') ELSE NULL END AS native_worker_attempt_status,
  CASE WHEN length(t.task_id)=64 AND t.task_id NOT GLOB '*[^a-fA-F0-9]*' THEN json_extract(r.data,'$.attempts[#-1].observed_model') ELSE NULL END AS native_worker_observed_model
FROM typed t LEFT JOIN (
  SELECT runtime_id,document_key,
    CASE WHEN json_valid(data) THEN data ELSE '{}' END AS data
  FROM application_documents
) r
  ON r.runtime_id=t.runtime_id AND length(t.task_id)=64 AND t.task_id NOT GLOB '*[^a-fA-F0-9]*'
  AND r.document_key='delegation/'||t.task_id||'.json';

CREATE VIEW knowledge_outcome_summary AS
SELECT runtime_id,task_type,model,COUNT(*) AS total,
  SUM(outcome_status='passed') AS passed,
  SUM(outcome_status='failed') AS failed,
  SUM(outcome_status='skipped') AS skipped,
  SUM(outcome_status='unavailable') AS unavailable,
  SUM(outcome_status='not-run') AS not_run,
  SUM(outcome_status='unknown') AS unknown,
  SUM(outcome_status='cancelled') AS cancelled,
  SUM(CASE WHEN outcome_status IN ('passed','failed') THEN 1 ELSE 0 END) AS verified_denominator,
  SUM(CASE WHEN outcome_status='passed' THEN 1 ELSE 0 END) AS verified_passes,
  SUM(CASE WHEN execution_success=1 THEN 1 ELSE 0 END) AS execution_successes,
  SUM(CASE WHEN execution_success=0 THEN 1 ELSE 0 END) AS execution_failures,
  SUM(CASE WHEN execution_success IS NULL THEN 1 ELSE 0 END) AS execution_unknown
FROM knowledge_task_outcomes
GROUP BY runtime_id,task_type,model;

INSERT INTO data_table_lifecycle VALUES
  ('knowledge_task_outcomes','derived','task-outcomes',20),
  ('knowledge_outcome_summary','derived','task-outcomes',20);

INSERT INTO schema_migrations VALUES (20,'task-outcome-evidence-views',unixepoch() * 1000);
PRAGMA user_version = 20;

-- Exact retained revision inputs and pending publication are committed with the
-- source snapshot. Native notifications remain refresh hints, never a replay log.
ALTER TABLE opencode_sessions ADD COLUMN current_snapshot_sha256 TEXT;
ALTER TABLE opencode_sessions ADD COLUMN publication_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE opencode_derivation_jobs (
  job_id TEXT PRIMARY KEY,
  source_system_id TEXT NOT NULL, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
  snapshot_revision_sha256 TEXT NOT NULL, derivation_version TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  publication_revision INTEGER NOT NULL CHECK(publication_revision>0),
  revision_token INTEGER NOT NULL CHECK(revision_token>0),
  status TEXT NOT NULL CHECK(status IN ('pending','blocked','complete','superseded')),
  blocked_reason TEXT, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at INTEGER, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
  UNIQUE(source_system_id,project_id,session_id,snapshot_revision_sha256,derivation_version),
  FOREIGN KEY(source_system_id,project_id,session_id)
    REFERENCES opencode_sessions(source_system_id,project_id,session_id)
) STRICT;
CREATE INDEX opencode_derivation_pending ON opencode_derivation_jobs(status,next_attempt_at,created_at,job_id);
CREATE INDEX opencode_derivation_session ON opencode_derivation_jobs(source_system_id,project_id,session_id,publication_revision);
CREATE TRIGGER opencode_derivation_inputs_immutable BEFORE UPDATE OF
  source_system_id,project_id,session_id,snapshot_revision_sha256,derivation_version,manifest_json
  ON opencode_derivation_jobs
WHEN NEW.source_system_id IS NOT OLD.source_system_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.session_id IS NOT OLD.session_id OR NEW.snapshot_revision_sha256 IS NOT OLD.snapshot_revision_sha256
  OR NEW.derivation_version IS NOT OLD.derivation_version OR NEW.manifest_json IS NOT OLD.manifest_json
BEGIN SELECT RAISE(ABORT,'Warehouse derivation inputs are immutable.'); END;

-- Cleared rows retain their token. Delete/reinsert would let an old worker clear
-- a later hint whose revision had restarted at one.
CREATE TABLE opencode_refresh_needed (
  refresh_id TEXT PRIMARY KEY, source_system_id TEXT NOT NULL,
  project_id TEXT, session_id TEXT, revision INTEGER NOT NULL CHECK(revision>0),
  state TEXT NOT NULL CHECK(state IN ('pending','blocked','cleared')),
  reason TEXT NOT NULL CHECK(reason IN ('event-hint','snapshot-failed','stream-failed','stream-ended','overflow','unaddressable-hint','reconnect','manual')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at INTEGER, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cleared_at INTEGER,
  CHECK(session_id IS NULL OR project_id IS NOT NULL)
) STRICT;
CREATE INDEX opencode_refresh_pending ON opencode_refresh_needed(state,next_attempt_at,updated_at,refresh_id);
CREATE INDEX opencode_refresh_scope ON opencode_refresh_needed(source_system_id,project_id,session_id);

INSERT INTO data_table_lifecycle VALUES
  ('opencode_derivation_jobs','durable','opencode-derivation',21),
  ('opencode_refresh_needed','durable','opencode-refresh',21);
INSERT INTO schema_migrations VALUES (21,'durable-warehouse-publication-and-refresh',unixepoch() * 1000);
PRAGMA user_version = 21;

ALTER TABLE chat_search_state ADD COLUMN derivation_job_id TEXT REFERENCES opencode_derivation_jobs(job_id);
ALTER TABLE chat_search_state ADD COLUMN indexed_text_sha256 TEXT;
INSERT INTO schema_migrations VALUES (22,'conversation-query-evidence',unixepoch() * 1000);
PRAGMA user_version = 22;
-- Source-backed, immutable model catalogue snapshots and typed facts.
CREATE TABLE model_data_refresh_jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('running','cancelling','complete','completed','partial','failed','interrupted','cancelled','dismissed')),
  sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
  generations_json TEXT NOT NULL CHECK(json_valid(generations_json)),
  result_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(result_json)),
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;
CREATE INDEX model_data_refresh_jobs_recent ON model_data_refresh_jobs(created_at DESC,job_id);

CREATE TABLE model_data_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('modelsdev','artificial-analysis')),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  retrieved_at INTEGER NOT NULL,
  source_reference_json TEXT NOT NULL CHECK(json_valid(source_reference_json)),
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  record_count INTEGER NOT NULL CHECK(record_count>=0),
  publication_status TEXT NOT NULL DEFAULT 'complete' CHECK(publication_status IN ('staging','complete')),
  job_id TEXT REFERENCES model_data_refresh_jobs(job_id),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX model_data_snapshots_source_recent ON model_data_snapshots(source,retrieved_at DESC,snapshot_id);
CREATE INDEX model_data_snapshots_content ON model_data_snapshots(source,content_sha256,publication_status);

CREATE TABLE model_data_sources (
  source TEXT PRIMARY KEY CHECK(source IN ('modelsdev','artificial-analysis')),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  status TEXT NOT NULL DEFAULT 'never-refreshed' CHECK(status IN ('not-loaded','never-refreshed','running','updating','needs-key','complete','completed','partial','failed','interrupted','cancelled','cancelling')),
  current_snapshot_id TEXT REFERENCES model_data_snapshots(snapshot_id),
  current_job_id TEXT REFERENCES model_data_refresh_jobs(job_id),
  last_refresh_at INTEGER,
  last_attempt_at INTEGER,
  retry_at INTEGER,
  record_count INTEGER NOT NULL DEFAULT 0 CHECK(record_count>=0),
  version TEXT,
  updated_at INTEGER NOT NULL,
  error TEXT,
  quota_json TEXT CHECK(quota_json IS NULL OR json_valid(quota_json)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))
) STRICT;

CREATE TABLE model_data_records (
  record_key TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES model_data_snapshots(snapshot_id),
  source TEXT NOT NULL CHECK(source IN ('modelsdev','artificial-analysis')),
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('model','deployment','configuration')),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  provider TEXT,
  model_id TEXT,
  aliases_json TEXT NOT NULL CHECK(json_valid(aliases_json)),
  identifiers_json TEXT NOT NULL CHECK(json_valid(identifiers_json)),
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  source_reference_json TEXT NOT NULL CHECK(json_valid(source_reference_json)),
  source_dates_json TEXT NOT NULL CHECK(json_valid(source_dates_json)),
  field_presence_json TEXT NOT NULL CHECK(json_valid(field_presence_json)),
  raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),
  identity_status TEXT NOT NULL CHECK(identity_status IN ('unmatched','exact','documented-alias','reviewed')),
  search_text TEXT NOT NULL,
  UNIQUE(snapshot_id,record_id)
) STRICT;
CREATE INDEX model_data_records_snapshot_order ON model_data_records(snapshot_id,normalized_name,record_id);
CREATE INDEX model_data_records_source_kind ON model_data_records(source,kind,record_id);
CREATE INDEX model_data_records_identity ON model_data_records(identity_status,source,kind);

CREATE TABLE model_data_facts (
  fact_id TEXT PRIMARY KEY,
  record_key TEXT NOT NULL REFERENCES model_data_records(record_key),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  attribute TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  value_text TEXT,
  value_number REAL,
  units TEXT,
  scale_json TEXT CHECK(scale_json IS NULL OR json_valid(scale_json)),
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  source_ref_json TEXT NOT NULL CHECK(json_valid(source_ref_json)),
  dates_json TEXT NOT NULL CHECK(json_valid(dates_json)),
  identity_match_json TEXT NOT NULL CHECK(json_valid(identity_match_json)),
  UNIQUE(record_key,ordinal)
) STRICT;
CREATE INDEX model_data_facts_attribute ON model_data_facts(attribute,record_key,ordinal);
CREATE INDEX model_data_facts_value ON model_data_facts(attribute,value_text,record_key);

CREATE TABLE model_data_secrets (
  name TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO model_data_sources(source,status,updated_at) VALUES
  ('modelsdev','never-refreshed',unixepoch() * 1000),
  ('artificial-analysis','never-refreshed',unixepoch() * 1000);
INSERT INTO data_table_lifecycle VALUES
  ('model_data_refresh_jobs','durable','model-data',23),
  ('model_data_snapshots','durable','model-data',23),
  ('model_data_sources','durable','model-data',23),
  ('model_data_records','durable','model-data',23),
  ('model_data_facts','durable','model-data',23),
  ('model_data_secrets','durable','model-data',23);

INSERT INTO schema_migrations VALUES (23,'source-backed-model-data',unixepoch() * 1000);
PRAGMA user_version = 23;

-- One retained memory aggregate. This migration runs inside the store's
-- transaction with foreign keys enabled; existing IDs and evidence survive.
DROP TRIGGER memory_search_insert;
DROP TRIGGER memory_search_delete;
DROP TRIGGER memory_search_update;
DROP TRIGGER memory_title_update;
DROP TRIGGER claims_search_insert;
DROP TRIGGER claims_search_update;
DROP TRIGGER claims_search_delete;
DROP TRIGGER claims_search_evidence_insert;
DROP TRIGGER claims_search_evidence_delete;
DROP TRIGGER claims_search_evidence_update;

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
