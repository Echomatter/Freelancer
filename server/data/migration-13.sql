ALTER TABLE content_sources ADD COLUMN source_identity TEXT NOT NULL DEFAULT '';
ALTER TABLE content_sources ADD COLUMN revision_identity TEXT NOT NULL DEFAULT '';
UPDATE content_sources SET
  source_identity='content-source:'||lower(hex(project_key||char(0)||virtual_path)),
  revision_identity='content-revision:'||lower(hex(project_key||char(0)||virtual_path||char(0)||sha256));
CREATE UNIQUE INDEX content_sources_identity ON content_sources(source_identity);
INSERT INTO schema_migrations VALUES (13, 'stable-content-source-identities', unixepoch() * 1000);
PRAGMA user_version = 13;
