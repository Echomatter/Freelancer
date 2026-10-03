-- Preserve legacy import markers through cutover.
CREATE TABLE IF NOT EXISTS runtime_collection_markers (
  runtime_id TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  PRIMARY KEY(runtime_id, collection_name)
) STRICT;
INSERT OR IGNORE INTO data_table_lifecycle VALUES
 ('runtime_collection_markers','durable','runtime-cutover-markers',11);
INSERT INTO schema_migrations VALUES (11, 'runtime-cutover-markers', unixepoch() * 1000);
PRAGMA user_version = 11;
