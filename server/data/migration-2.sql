CREATE TABLE content_meta (
  project_key TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (project_key, key)
) STRICT;
CREATE TABLE content_sources (
  source_id INTEGER PRIMARY KEY,
  project_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  virtual_path TEXT NOT NULL,
  container_path TEXT NOT NULL,
  member_path TEXT NOT NULL DEFAULT '',
  extension TEXT NOT NULL,
  source_role TEXT NOT NULL,
  status TEXT NOT NULL,
  routing_rank INTEGER NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  modified_utc TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  unit_count INTEGER NOT NULL,
  locator_kind TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  extraction_status TEXT NOT NULL,
  text_chars INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE(project_key, virtual_path)
) STRICT;
CREATE TABLE content_units (
  unit_id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES content_sources(source_id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL,
  locator TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  UNIQUE(source_id, unit_no)
) STRICT;
CREATE VIRTUAL TABLE content_units_fts USING fts5(
  project_key UNINDEXED,
  filename,
  virtual_path,
  source_role,
  status,
  heading,
  locator,
  text,
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE content_facts (
  fact_id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES content_sources(source_id) ON DELETE CASCADE,
  unit_no INTEGER NOT NULL,
  locator TEXT NOT NULL,
  fact_kind TEXT NOT NULL,
  family TEXT NOT NULL,
  label TEXT NOT NULL,
  label_norm TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value_num REAL,
  value_unit TEXT NOT NULL DEFAULT '',
  field_path TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL,
  confidence REAL NOT NULL
) STRICT;
CREATE TABLE content_fact_stats (
  project_key TEXT NOT NULL,
  family TEXT NOT NULL,
  label_norm TEXT NOT NULL,
  label TEXT NOT NULL,
  value_unit TEXT NOT NULL,
  fact_count INTEGER NOT NULL,
  distinct_value_count INTEGER NOT NULL,
  source_count INTEGER NOT NULL,
  numeric_count INTEGER NOT NULL,
  min_numeric REAL,
  max_numeric REAL,
  avg_numeric REAL,
  PRIMARY KEY(project_key, family, label_norm, value_unit)
) STRICT;
CREATE INDEX content_sources_project_route ON content_sources(project_key, source_role, status, routing_rank DESC);
CREATE INDEX content_units_source ON content_units(source_id, unit_no);
CREATE INDEX content_facts_family ON content_facts(family, source_id, unit_no);
CREATE INDEX content_facts_label ON content_facts(label_norm, source_id, unit_no);
CREATE INDEX content_facts_kind ON content_facts(fact_kind, family);

INSERT INTO schema_migrations VALUES (2, 'unified-content-index', unixepoch() * 1000);
PRAGMA user_version = 2;
