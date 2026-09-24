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
PRAGMA user_version = 4;
