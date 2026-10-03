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
