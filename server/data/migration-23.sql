-- Source-backed, immutable model catalogue snapshots and typed facts.
CREATE TABLE model_data_refresh_jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('running','cancelling','complete','completed','partial','failed','interrupted','cancelled','dismissed')),
  sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
  generations_json TEXT NOT NULL CHECK(json_valid(generations_json)),
  result_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(result_json)),
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
) STRICT;
CREATE INDEX model_data_refresh_jobs_recent ON model_data_refresh_jobs(created_at DESC,job_id);

CREATE TABLE model_data_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('modelsdev','artificial-analysis')),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  retrieved_at INTEGER NOT NULL,
  source_reference_json TEXT NOT NULL CHECK(json_valid(source_reference_json)),
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  record_count INTEGER NOT NULL CHECK(record_count>=0),
  publication_status TEXT NOT NULL DEFAULT 'complete' CHECK(publication_status IN ('staging','complete')),
  job_id TEXT REFERENCES model_data_refresh_jobs(job_id),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX model_data_snapshots_source_recent ON model_data_snapshots(source,retrieved_at DESC,snapshot_id);
CREATE INDEX model_data_snapshots_content ON model_data_snapshots(source,content_sha256,publication_status);

CREATE TABLE model_data_sources (
  source TEXT PRIMARY KEY CHECK(source IN ('modelsdev','artificial-analysis')),
  generation INTEGER NOT NULL DEFAULT 0 CHECK(generation>=0),
  status TEXT NOT NULL DEFAULT 'never-refreshed' CHECK(status IN ('not-loaded','never-refreshed','running','updating','needs-key','complete','completed','partial','failed','interrupted','cancelled','cancelling')),
  current_snapshot_id TEXT REFERENCES model_data_snapshots(snapshot_id),
  current_job_id TEXT REFERENCES model_data_refresh_jobs(job_id),
  last_refresh_at INTEGER,
  last_attempt_at INTEGER,
  retry_at INTEGER,
  record_count INTEGER NOT NULL DEFAULT 0 CHECK(record_count>=0),
  version TEXT,
  updated_at INTEGER NOT NULL,
  error TEXT,
  quota_json TEXT CHECK(quota_json IS NULL OR json_valid(quota_json)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))
) STRICT;

CREATE TABLE model_data_records (
  record_key TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES model_data_snapshots(snapshot_id),
  source TEXT NOT NULL CHECK(source IN ('modelsdev','artificial-analysis')),
  record_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('model','deployment','configuration')),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  provider TEXT,
  model_id TEXT,
  aliases_json TEXT NOT NULL CHECK(json_valid(aliases_json)),
  identifiers_json TEXT NOT NULL CHECK(json_valid(identifiers_json)),
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  source_reference_json TEXT NOT NULL CHECK(json_valid(source_reference_json)),
  source_dates_json TEXT NOT NULL CHECK(json_valid(source_dates_json)),
  field_presence_json TEXT NOT NULL CHECK(json_valid(field_presence_json)),
  raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),
  identity_status TEXT NOT NULL CHECK(identity_status IN ('unmatched','exact','documented-alias','reviewed')),
  search_text TEXT NOT NULL,
  UNIQUE(snapshot_id,record_id)
) STRICT;
CREATE INDEX model_data_records_snapshot_order ON model_data_records(snapshot_id,normalized_name,record_id);
CREATE INDEX model_data_records_source_kind ON model_data_records(source,kind,record_id);
CREATE INDEX model_data_records_identity ON model_data_records(identity_status,source,kind);

CREATE TABLE model_data_facts (
  fact_id TEXT PRIMARY KEY,
  record_key TEXT NOT NULL REFERENCES model_data_records(record_key),
  ordinal INTEGER NOT NULL CHECK(ordinal>=0),
  attribute TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  value_text TEXT,
  value_number REAL,
  units TEXT,
  scale_json TEXT CHECK(scale_json IS NULL OR json_valid(scale_json)),
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  source_ref_json TEXT NOT NULL CHECK(json_valid(source_ref_json)),
  dates_json TEXT NOT NULL CHECK(json_valid(dates_json)),
  identity_match_json TEXT NOT NULL CHECK(json_valid(identity_match_json)),
  UNIQUE(record_key,ordinal)
) STRICT;
CREATE INDEX model_data_facts_attribute ON model_data_facts(attribute,record_key,ordinal);
CREATE INDEX model_data_facts_value ON model_data_facts(attribute,value_text,record_key);

CREATE TABLE model_data_secrets (
  name TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

INSERT INTO model_data_sources(source,status,updated_at) VALUES
  ('modelsdev','never-refreshed',unixepoch() * 1000),
  ('artificial-analysis','never-refreshed',unixepoch() * 1000);
INSERT INTO data_table_lifecycle VALUES
  ('model_data_refresh_jobs','durable','model-data',23),
  ('model_data_snapshots','durable','model-data',23),
  ('model_data_sources','durable','model-data',23),
  ('model_data_records','durable','model-data',23),
  ('model_data_facts','durable','model-data',23),
  ('model_data_secrets','durable','model-data',23);

INSERT INTO schema_migrations VALUES (23,'source-backed-model-data',unixepoch() * 1000);
PRAGMA user_version = 23;
