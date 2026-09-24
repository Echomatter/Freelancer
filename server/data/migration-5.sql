ALTER TABLE model_rating_jobs ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}';
CREATE TABLE project_index_state (project_id TEXT PRIMARY KEY, ready_at INTEGER NOT NULL) STRICT;
INSERT INTO schema_migrations VALUES (5, 'configuration-progress', unixepoch() * 1000);
PRAGMA user_version = 5;
