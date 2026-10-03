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
PRAGMA user_version = 15;
