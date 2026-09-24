// Publish staged Python extraction with the application's Node SQLite engine.
// Python never writes the live application database or its shared WAL.
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

export function publishProjectIndex(database, staged, projectKey) {
  const db = new DatabaseSync(database);
  try {
    db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');
    db.prepare('ATTACH DATABASE ? AS staged').run(staged);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM content_units_fts WHERE project_key=?').run(projectKey);
      db.prepare('DELETE FROM content_sources WHERE project_key=?').run(projectKey);
      db.prepare('DELETE FROM content_fact_stats WHERE project_key=?').run(projectKey);
      db.prepare('DELETE FROM content_meta WHERE project_key=?').run(projectKey);
      const columns = 'project_key,filename,virtual_path,container_path,member_path,extension,source_role,status,routing_rank,file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,notes';
      db.prepare(`INSERT INTO content_sources(${columns}) SELECT ${columns} FROM staged.content_sources WHERE project_key=?`).run(projectKey);
      db.prepare(`INSERT INTO content_units(source_id,unit_no,locator,heading,text,word_count,char_count,sha256)
        SELECT target.source_id,u.unit_no,u.locator,u.heading,u.text,u.word_count,u.char_count,u.sha256
        FROM staged.content_units u JOIN staged.content_sources source ON source.source_id=u.source_id
        JOIN content_sources target ON target.project_key=? AND target.virtual_path=source.virtual_path
        WHERE source.project_key=?`).run(projectKey, projectKey);
      db.prepare(`INSERT INTO content_units_fts(rowid,project_key,filename,virtual_path,source_role,status,heading,locator,text)
        SELECT u.unit_id,s.project_key,s.filename,s.virtual_path,s.source_role,s.status,u.heading,u.locator,u.text
        FROM content_units u JOIN content_sources s ON s.source_id=u.source_id WHERE s.project_key=?`).run(projectKey);
      db.prepare(`INSERT INTO content_facts(source_id,unit_no,locator,fact_kind,family,label,label_norm,value_text,value_num,value_unit,field_path,evidence,confidence)
        SELECT target.source_id,f.unit_no,f.locator,f.fact_kind,f.family,f.label,f.label_norm,f.value_text,f.value_num,f.value_unit,f.field_path,f.evidence,f.confidence
        FROM staged.content_facts f JOIN staged.content_sources source ON source.source_id=f.source_id
        JOIN content_sources target ON target.project_key=? AND target.virtual_path=source.virtual_path
        WHERE source.project_key=?`).run(projectKey, projectKey);
      db.prepare('INSERT INTO content_fact_stats SELECT * FROM staged.content_fact_stats WHERE project_key=?').run(projectKey);
      db.prepare('INSERT INTO content_meta SELECT * FROM staged.content_meta WHERE project_key=?').run(projectKey);
      db.exec("INSERT INTO content_units_fts(content_units_fts) VALUES('integrity-check')");
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 5) throw Error('Expected database, staged database, and project key.');
  publishProjectIndex(...process.argv.slice(2));
}
