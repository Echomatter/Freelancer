-- A safe, normalized projection of recorded task outcomes. Keep execution
-- completion separate from verified task success and never expose full receipts.
CREATE VIEW knowledge_task_outcomes AS
WITH history_documents AS (
  SELECT runtime_id,
    CASE WHEN json_valid(data) THEN data ELSE '{"entries":[]}' END AS document
  FROM application_documents WHERE document_key='task-history.json'
), entries AS (
  SELECT h.runtime_id,e.value AS entry
  FROM history_documents h,json_each(
    CASE WHEN json_type(h.document,'$.entries')='array' THEN h.document ELSE '{"entries":[]}' END,'$.entries'
  ) e WHERE e.type='object'
), normalized AS (
  SELECT runtime_id,
    json_extract(entry,'$.task_id') AS task_id,
    COALESCE(json_extract(entry,'$.user_task_id'),json_extract(entry,'$.task_id')) AS user_task_id,
    COALESCE(json_extract(entry,'$.timestamp'),json_extract(entry,'$.recorded_at')) AS recorded_at,
    COALESCE(json_extract(entry,'$.repo'),'') AS repo,
    COALESCE(json_extract(entry,'$.model'),json_extract(entry,'$.observed_model'),json_extract(entry,'$.selected_model'),'') AS model,
    CASE WHEN json_type(entry,'$.success') IN ('true','false') THEN json_extract(entry,'$.success') ELSE NULL END AS execution_success,
    lower(trim(COALESCE(json_extract(entry,'$.verification_status'),''))) AS verification_status,
    entry
  FROM entries
), classified AS (
  SELECT n.*,CASE verification_status
      WHEN 'passed' THEN 'passed' WHEN 'failed' THEN 'failed' WHEN 'skipped' THEN 'skipped'
      WHEN 'unavailable' THEN 'unavailable' WHEN 'not-run' THEN 'not-run' WHEN 'cancelled' THEN 'cancelled'
      ELSE 'unknown' END AS outcome_status
  FROM normalized n
), typed AS (
  SELECT DISTINCT n.*,COALESCE(NULLIF(trim(CAST(t.value AS TEXT)),''),'unknown') AS task_type
  FROM classified n LEFT JOIN json_each(
    CASE WHEN json_type(n.entry,'$.task_type')='array' THEN json_extract(n.entry,'$.task_type') ELSE '[]' END
  ) t ON true
)
SELECT t.runtime_id,t.task_id,t.user_task_id,t.task_type,t.model,t.repo,t.recorded_at,
  t.execution_success,
  CASE WHEN t.outcome_status='unknown' AND (json_extract(r.data,'$.status')='cancelled' OR
       json_extract(r.data,'$.attempts[#-1].status')='cancelled') THEN 'cancelled' ELSE t.outcome_status END AS outcome_status,
  CASE WHEN length(t.task_id)=64 AND t.task_id NOT GLOB '*[^a-fA-F0-9]*' THEN json_extract(r.data,'$.status') ELSE NULL END AS native_worker_status,
  CASE WHEN length(t.task_id)=64 AND t.task_id NOT GLOB '*[^a-fA-F0-9]*' THEN json_extract(r.data,'$.attempts[#-1].status') ELSE NULL END AS native_worker_attempt_status,
  CASE WHEN length(t.task_id)=64 AND t.task_id NOT GLOB '*[^a-fA-F0-9]*' THEN json_extract(r.data,'$.attempts[#-1].observed_model') ELSE NULL END AS native_worker_observed_model
FROM typed t LEFT JOIN (
  SELECT runtime_id,document_key,
    CASE WHEN json_valid(data) THEN data ELSE '{}' END AS data
  FROM application_documents
) r
  ON r.runtime_id=t.runtime_id AND length(t.task_id)=64 AND t.task_id NOT GLOB '*[^a-fA-F0-9]*'
  AND r.document_key='delegation/'||t.task_id||'.json';

CREATE VIEW knowledge_outcome_summary AS
SELECT runtime_id,task_type,model,COUNT(*) AS total,
  SUM(outcome_status='passed') AS passed,
  SUM(outcome_status='failed') AS failed,
  SUM(outcome_status='skipped') AS skipped,
  SUM(outcome_status='unavailable') AS unavailable,
  SUM(outcome_status='not-run') AS not_run,
  SUM(outcome_status='unknown') AS unknown,
  SUM(outcome_status='cancelled') AS cancelled,
  SUM(CASE WHEN outcome_status IN ('passed','failed') THEN 1 ELSE 0 END) AS verified_denominator,
  SUM(CASE WHEN outcome_status='passed' THEN 1 ELSE 0 END) AS verified_passes,
  SUM(CASE WHEN execution_success=1 THEN 1 ELSE 0 END) AS execution_successes,
  SUM(CASE WHEN execution_success=0 THEN 1 ELSE 0 END) AS execution_failures,
  SUM(CASE WHEN execution_success IS NULL THEN 1 ELSE 0 END) AS execution_unknown
FROM knowledge_task_outcomes
GROUP BY runtime_id,task_type,model;

INSERT INTO data_table_lifecycle VALUES
  ('knowledge_task_outcomes','derived','task-outcomes',20),
  ('knowledge_outcome_summary','derived','task-outcomes',20);

INSERT INTO schema_migrations VALUES (20,'task-outcome-evidence-views',unixepoch() * 1000);
PRAGMA user_version = 20;
