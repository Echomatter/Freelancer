-- Searchable, rebuildable copies of native conversation text. OpenCode remains authoritative.
CREATE VIRTUAL TABLE chat_search USING fts5(
  project_id UNINDEXED,
  session_id UNINDEXED,
  message_id UNINDEXED,
  role UNINDEXED,
  model_id UNINDEXED,
  updated_at UNINDEXED,
  title,
  body,
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE chat_search_state (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  native_updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, session_id)
) STRICT;
INSERT INTO schema_migrations VALUES (3, 'native-chat-search', unixepoch() * 1000);
PRAGMA user_version = 3;
