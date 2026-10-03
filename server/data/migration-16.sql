CREATE TABLE judgment_definitions_new (
  definition_id TEXT NOT NULL, version INTEGER NOT NULL, question_id TEXT NOT NULL,
  primitive TEXT NOT NULL CHECK(primitive IN ('check','classify','score')),
  question_json TEXT NOT NULL, criteria_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(definition_id,version)
) STRICT;
INSERT INTO judgment_definitions_new SELECT definition_id,version,question_id,primitive,question_json,criteria_json,created_at
  FROM judgment_definitions;
CREATE TABLE judgment_runs_new (
  run_id TEXT PRIMARY KEY, definition_id TEXT NOT NULL, definition_version INTEGER NOT NULL,
  state_hash TEXT NOT NULL, candidate_set_hash TEXT NOT NULL, evidence_hash TEXT NOT NULL,
  candidate_ids_json TEXT NOT NULL, evidence_refs_json TEXT NOT NULL,
  requested_provider TEXT NOT NULL, requested_model TEXT NOT NULL DEFAULT '',
  reported_provider TEXT, reported_model TEXT, status TEXT NOT NULL,
  captured_at INTEGER NOT NULL, latency_ms INTEGER, usage_json TEXT,
  caller_decision_json TEXT, verified_outcome_json TEXT,
  FOREIGN KEY(definition_id,definition_version) REFERENCES judgment_definitions_new(definition_id,version)
) STRICT;
INSERT INTO judgment_runs_new SELECT * FROM judgment_runs;
CREATE TABLE judgment_results_new (
  run_id TEXT NOT NULL REFERENCES judgment_runs_new(run_id) ON DELETE CASCADE,
  question_id TEXT NOT NULL, answer_json TEXT, probabilities_json TEXT,
  confidence REAL, derived_json TEXT,
  PRIMARY KEY(run_id,question_id)
) STRICT;
INSERT INTO judgment_results_new SELECT * FROM judgment_results;
DROP TABLE judgment_results;
DROP TABLE judgment_runs;
DROP TABLE judgment_definitions;
ALTER TABLE judgment_definitions_new RENAME TO judgment_definitions;
ALTER TABLE judgment_runs_new RENAME TO judgment_runs;
ALTER TABLE judgment_results_new RENAME TO judgment_results;
CREATE INDEX judgment_runs_cache ON judgment_runs(state_hash,candidate_set_hash,evidence_hash,definition_id,definition_version,requested_provider,requested_model,reported_provider,reported_model,status);
INSERT INTO schema_migrations VALUES (16, 'versioned-judgment-definitions', unixepoch() * 1000);
PRAGMA user_version = 16;
