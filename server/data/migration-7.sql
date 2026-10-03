-- Canonical homes for operational receipts and Freelancer domain documents.
-- Values retain their complete versioned JSON payload during the port.
CREATE TABLE operational_records (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1',
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT,
  data TEXT NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY(runtime_id,collection,id)
) STRICT;
CREATE INDEX operational_records_session
  ON operational_records(runtime_id,collection,project_id,session_id);
CREATE TABLE application_documents (
  runtime_id TEXT NOT NULL DEFAULT 'legacy-runtime-v1',
  document_key TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(runtime_id,document_key)
) STRICT;
CREATE TABLE project_registrations (
  project_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
) STRICT;
CREATE TABLE application_settings (
  setting_key TEXT PRIMARY KEY,
  data TEXT NOT NULL
) STRICT;
CREATE TABLE data_migration_runs (
  migration_id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  source_app_id INTEGER NOT NULL,
  source_schema_version INTEGER NOT NULL,
  source_sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;
CREATE TABLE data_table_lifecycle (
  table_name TEXT PRIMARY KEY,
  lifecycle TEXT NOT NULL CHECK(lifecycle IN ('durable','derived')),
  owner TEXT NOT NULL,
  introduced_version INTEGER NOT NULL
) STRICT;
INSERT INTO data_table_lifecycle VALUES
  ('project_annotations','durable','history',1),
  ('session_headers','durable','history-cache',1),
  ('session_annotations','durable','history',1),
  ('drafts','durable','drafts',1),
  ('content_meta','derived','content-index',2),
  ('content_sources','derived','content-index',2),
  ('content_units','derived','content-index',2),
  ('content_units_fts','derived','content-index',2),
  ('content_facts','derived','content-index',2),
  ('content_fact_stats','derived','content-index',2),
  ('chat_search','derived','chat-index',3),
  ('chat_search_state','derived','chat-index',3),
  ('model_catalog','durable','model-ratings',4),
  ('model_rating_jobs','durable','model-ratings',4),
  ('project_index_state','derived','content-index',5),
  ('chatgpt_chats','durable','imported-chats',6),
  ('chatgpt_messages','durable','imported-chats',6),
  ('chatgpt_continuations','durable','imported-chats',6),
  ('project_onboarding','durable','imported-chats',6),
  ('operational_records','durable','runtime-records',7),
  ('application_documents','durable','application-settings-migration',7),
  ('project_registrations','durable','projects',7),
  ('application_settings','durable','application-settings',7),
  ('data_migration_runs','durable','migration',7);
INSERT INTO schema_migrations VALUES (7, 'unified-operational-records', unixepoch() * 1000);
PRAGMA user_version = 7;
