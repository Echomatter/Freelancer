-- Exact retained revision inputs and pending publication are committed with the
-- source snapshot. Native notifications remain refresh hints, never a replay log.
ALTER TABLE opencode_sessions ADD COLUMN current_snapshot_sha256 TEXT;
ALTER TABLE opencode_sessions ADD COLUMN publication_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE opencode_derivation_jobs (
  job_id TEXT PRIMARY KEY,
  source_system_id TEXT NOT NULL, project_id TEXT NOT NULL, session_id TEXT NOT NULL,
  snapshot_revision_sha256 TEXT NOT NULL, derivation_version TEXT NOT NULL,
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  publication_revision INTEGER NOT NULL CHECK(publication_revision>0),
  revision_token INTEGER NOT NULL CHECK(revision_token>0),
  status TEXT NOT NULL CHECK(status IN ('pending','blocked','complete','superseded')),
  blocked_reason TEXT, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  next_attempt_at INTEGER, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
  UNIQUE(source_system_id,project_id,session_id,snapshot_revision_sha256,derivation_version),
  FOREIGN KEY(source_system_id,project_id,session_id)
    REFERENCES opencode_sessions(source_system_id,project_id,session_id)
) STRICT;
CREATE INDEX opencode_derivation_pending ON opencode_derivation_jobs(status,next_attempt_at,created_at,job_id);
CREATE INDEX opencode_derivation_session ON opencode_derivation_jobs(source_system_id,project_id,session_id,publication_revision);
CREATE TRIGGER opencode_derivation_inputs_immutable BEFORE UPDATE OF
  source_system_id,project_id,session_id,snapshot_revision_sha256,derivation_version,manifest_json
  ON opencode_derivation_jobs
WHEN NEW.source_system_id IS NOT OLD.source_system_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.session_id IS NOT OLD.session_id OR NEW.snapshot_revision_sha256 IS NOT OLD.snapshot_revision_sha256
  OR NEW.derivation_version IS NOT OLD.derivation_version OR NEW.manifest_json IS NOT OLD.manifest_json
BEGIN SELECT RAISE(ABORT,'Warehouse derivation inputs are immutable.'); END;

-- Cleared rows retain their token. Delete/reinsert would let an old worker clear
-- a later hint whose revision had restarted at one.
CREATE TABLE opencode_refresh_needed (
  refresh_id TEXT PRIMARY KEY, source_system_id TEXT NOT NULL,
  project_id TEXT, session_id TEXT, revision INTEGER NOT NULL CHECK(revision>0),
  state TEXT NOT NULL CHECK(state IN ('pending','blocked','cleared')),
  reason TEXT NOT NULL CHECK(reason IN ('event-hint','snapshot-failed','stream-failed','stream-ended','overflow','unaddressable-hint','reconnect','manual')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at INTEGER, error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cleared_at INTEGER,
  CHECK(session_id IS NULL OR project_id IS NOT NULL)
) STRICT;
CREATE INDEX opencode_refresh_pending ON opencode_refresh_needed(state,next_attempt_at,updated_at,refresh_id);
CREATE INDEX opencode_refresh_scope ON opencode_refresh_needed(source_system_id,project_id,session_id);

INSERT INTO data_table_lifecycle VALUES
  ('opencode_derivation_jobs','durable','opencode-derivation',21),
  ('opencode_refresh_needed','durable','opencode-refresh',21);
INSERT INTO schema_migrations VALUES (21,'durable-warehouse-publication-and-refresh',unixepoch() * 1000);
PRAGMA user_version = 21;
