-- Provenance-aware memory, graph, and claim domain.
CREATE TABLE entities (
  entity_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX entities_lookup ON entities(entity_type,normalized_name);
CREATE TABLE entity_aliases (
  entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, PRIMARY KEY(entity_id,normalized_alias)
) STRICT;
CREATE INDEX entity_alias_lookup ON entity_aliases(normalized_alias);
CREATE TABLE memory_items (
  memory_id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT '', source_project_id TEXT, source_session_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
) STRICT;
CREATE TABLE memory_item_revisions (
  revision_id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory_items(memory_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL, body TEXT NOT NULL, provenance_json TEXT NOT NULL,
  capture_boundary_json TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(memory_id,revision)
) STRICT;
CREATE TABLE memory_pins (
  memory_id TEXT PRIMARY KEY REFERENCES memory_items(memory_id) ON DELETE CASCADE,
  pinned_at INTEGER NOT NULL, original_pinned_at INTEGER, rank INTEGER,
  revision INTEGER NOT NULL DEFAULT 1
) STRICT;
CREATE TABLE memory_members (
  revision_id TEXT NOT NULL REFERENCES memory_item_revisions(revision_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, member_kind TEXT NOT NULL, source_ref TEXT NOT NULL,
  source_revision TEXT, locator_json TEXT NOT NULL, content_hash TEXT, availability TEXT NOT NULL,
  PRIMARY KEY(revision_id,ordinal),
  UNIQUE(revision_id,member_kind,source_ref,source_revision,locator_json)
) STRICT;
CREATE TABLE claims (
  claim_id TEXT PRIMARY KEY, subject_entity_id TEXT REFERENCES entities(entity_id),
  predicate TEXT NOT NULL, object_entity_id TEXT REFERENCES entities(entity_id), value_json TEXT,
  origin TEXT NOT NULL, method TEXT NOT NULL, epistemic_state TEXT NOT NULL, scope_json TEXT NOT NULL,
  valid_from INTEGER, valid_to INTEGER, observed_at INTEGER, recorded_at INTEGER NOT NULL,
  superseded_at INTEGER, actor TEXT NOT NULL DEFAULT '', model_provider TEXT, model_id TEXT
) STRICT;
CREATE INDEX claims_subject_predicate ON claims(subject_entity_id,predicate,epistemic_state);
CREATE TABLE claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL, relation TEXT NOT NULL, evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY(claim_id,evidence_id,relation)
) STRICT;
CREATE TABLE entity_relations (
  relation_id TEXT PRIMARY KEY, from_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL, to_entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  provenance_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  CHECK(from_entity_id <> to_entity_id), UNIQUE(from_entity_id,relation_type,to_entity_id)
) STRICT;
CREATE TABLE memory_changes (
  change_id TEXT PRIMARY KEY, memory_id TEXT, claim_id TEXT, change_type TEXT NOT NULL,
  prior_ref TEXT, new_ref TEXT, actor TEXT NOT NULL, source_ref TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
) STRICT;
INSERT INTO data_table_lifecycle VALUES
 ('entities','durable','memory',8),('entity_aliases','durable','memory',8),
 ('memory_items','durable','memory',8),('memory_item_revisions','durable','memory',8),
 ('memory_pins','durable','memory',8),('memory_members','durable','memory',8),
 ('claims','durable','memory',8),('claim_evidence','durable','memory',8),
 ('entity_relations','durable','memory',8),('memory_changes','durable','memory',8);
INSERT INTO schema_migrations VALUES (8, 'provenance-memory-and-claims', unixepoch() * 1000);
PRAGMA user_version = 8;
