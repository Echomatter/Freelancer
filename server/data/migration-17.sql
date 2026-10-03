CREATE TABLE content_source_revisions (
  source_identity TEXT NOT NULL, revision_identity TEXT NOT NULL, project_key TEXT NOT NULL,
  virtual_path TEXT NOT NULL, metadata_json TEXT NOT NULL, captured_at INTEGER NOT NULL,
  PRIMARY KEY(source_identity,revision_identity)
) STRICT;
CREATE INDEX content_source_revisions_project ON content_source_revisions(project_key,virtual_path,captured_at DESC);
CREATE TABLE content_unit_revisions (
  source_identity TEXT NOT NULL, revision_identity TEXT NOT NULL, unit_no INTEGER NOT NULL,
  locator TEXT NOT NULL, heading TEXT NOT NULL, text TEXT NOT NULL, word_count INTEGER NOT NULL,
  char_count INTEGER NOT NULL, sha256 TEXT NOT NULL,
  PRIMARY KEY(source_identity,revision_identity,unit_no),
  FOREIGN KEY(source_identity,revision_identity) REFERENCES content_source_revisions(source_identity,revision_identity)
) STRICT;
CREATE INDEX content_unit_revisions_ref ON content_unit_revisions(source_identity,revision_identity,locator,sha256);
INSERT INTO content_source_revisions(source_identity,revision_identity,project_key,virtual_path,metadata_json,captured_at)
SELECT s.source_identity,s.revision_identity,s.project_key,s.virtual_path,
  json_object('filename',s.filename,'containerPath',s.container_path,'memberPath',s.member_path,'extension',s.extension,
    'sourceRole',s.source_role,'status',s.status,'routingRank',s.routing_rank,'fileSizeBytes',s.file_size_bytes,
    'modifiedUTC',s.modified_utc,'sourceSha256',s.sha256,'unitCount',s.unit_count,'locatorKind',s.locator_kind,
    'extractionMethod',s.extraction_method,'extractionStatus',s.extraction_status,'textChars',s.text_chars,
    'wordCount',s.word_count,'notes',s.notes),unixepoch()*1000
FROM content_sources s;
INSERT INTO content_unit_revisions(source_identity,revision_identity,unit_no,locator,heading,text,word_count,char_count,sha256)
SELECT s.source_identity,s.revision_identity,u.unit_no,u.locator,u.heading,u.text,u.word_count,u.char_count,u.sha256
FROM content_units u JOIN content_sources s USING(source_id);
INSERT INTO data_table_lifecycle VALUES
 ('content_source_revisions','durable','content-evidence-history',17),
 ('content_unit_revisions','durable','content-evidence-history',17);
INSERT INTO schema_migrations VALUES (17, 'durable-content-source-revisions', unixepoch() * 1000);
PRAGMA user_version = 17;
