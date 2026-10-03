CREATE VIRTUAL TABLE memory_search_fts USING fts5(
  memory_id UNINDEXED, revision_id UNINDEXED, title, body,
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER memory_search_insert AFTER INSERT ON memory_item_revisions BEGIN
  INSERT INTO memory_search_fts(memory_id,revision_id,title,body)
  SELECT NEW.memory_id,NEW.revision_id,m.title,NEW.body FROM memory_items m WHERE m.memory_id=NEW.memory_id;
END;
CREATE TRIGGER memory_search_delete AFTER DELETE ON memory_item_revisions BEGIN
  DELETE FROM memory_search_fts WHERE revision_id=OLD.revision_id;
END;
CREATE TRIGGER memory_search_update AFTER UPDATE OF body,provenance_json,capture_boundary_json ON memory_item_revisions BEGIN
  DELETE FROM memory_search_fts WHERE revision_id=OLD.revision_id;
  INSERT INTO memory_search_fts(memory_id,revision_id,title,body)
  SELECT NEW.memory_id,NEW.revision_id,m.title,NEW.body FROM memory_items m WHERE m.memory_id=NEW.memory_id;
END;
CREATE TRIGGER memory_title_update AFTER UPDATE OF title ON memory_items BEGIN
  DELETE FROM memory_search_fts WHERE memory_id=NEW.memory_id;
  INSERT INTO memory_search_fts(memory_id,revision_id,title,body)
  SELECT m.memory_id,r.revision_id,m.title,r.body FROM memory_items m
  JOIN memory_item_revisions r ON r.memory_id=m.memory_id WHERE m.memory_id=NEW.memory_id;
END;
INSERT INTO data_table_lifecycle VALUES ('memory_search_fts','derived','memory-search',9);
CREATE TABLE memory_migration_runs (
  migration_id TEXT PRIMARY KEY,
  imported_count INTEGER NOT NULL,
  remaining_count INTEGER NOT NULL,
  completed_at INTEGER NOT NULL
) STRICT;
INSERT INTO data_table_lifecycle VALUES ('memory_migration_runs','durable','memory-migration',9);
INSERT INTO schema_migrations VALUES (9, 'memory-search-projection', unixepoch() * 1000);
PRAGMA user_version = 9;
