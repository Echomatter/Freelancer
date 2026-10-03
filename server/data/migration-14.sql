CREATE TABLE judgment_definitions (
  definition_id TEXT PRIMARY KEY, version INTEGER NOT NULL, question_id TEXT NOT NULL,
  primitive TEXT NOT NULL CHECK(primitive IN ('check','classify','score')),
  question_json TEXT NOT NULL, criteria_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(definition_id,version)
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
PRAGMA user_version = 14;
