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
