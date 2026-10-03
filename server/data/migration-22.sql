-- Bind a derived conversation hit to the immutable source window that produced
-- it. Old projections remain searchable with explicitly unavailable evidence.
ALTER TABLE chat_search_state ADD COLUMN derivation_job_id TEXT REFERENCES opencode_derivation_jobs(job_id);
ALTER TABLE chat_search_state ADD COLUMN indexed_text_sha256 TEXT;
INSERT INTO schema_migrations VALUES (22,'conversation-query-evidence',unixepoch() * 1000);
PRAGMA user_version = 22;
