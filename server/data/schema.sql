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
PRAGMA user_version = 6;
