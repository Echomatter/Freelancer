import { createRequire } from 'node:module';
import { unifiedConfig, withUnifiedTransaction, markUnifiedCollection } from './unified-database.mjs';

const require=createRequire(import.meta.url);
export function observeStorageDriver(runtimeRoot) {
  const bun=!!process.versions.bun;
  const db=bun ? new (require('bun:sqlite').Database)(':memory:') : new (require('node:sqlite').DatabaseSync)(':memory:');
  let observation;
  try {
    db.exec('CREATE VIRTUAL TABLE probe USING fts5(text); CREATE TABLE strict_probe(value TEXT) STRICT;');
    db.prepare('INSERT INTO strict_probe VALUES($value)').run({$value:'日本語 café'});
    observation={driver:bun?'bun:sqlite':'node:sqlite',runtimeVersion:bun?process.versions.bun:process.versions.node,
      sqliteVersion:db.prepare('SELECT sqlite_version() AS version').get().version,fts5:true,strict:true,
      json:db.prepare("SELECT json_valid('{}') AS n").get().n===1,namedParameters:true,
      authorizer:typeof db.setAuthorizer==='function',observedAt:Date.now()};
  } finally { db.close(); }
  const config=unifiedConfig(runtimeRoot);
  if (config) withUnifiedTransaction(config,(database,runtimeID)=>{
    markUnifiedCollection(database,runtimeID,'storage-drivers');
    const json=JSON.stringify(observation);
    database.prepare(`INSERT INTO operational_records(runtime_id,collection,id,project_id,session_id,data,summary)
      VALUES(?,'storage-drivers',?,NULL,NULL,?,?) ON CONFLICT(runtime_id,collection,id)
      DO UPDATE SET data=excluded.data,summary=excluded.summary`).run(runtimeID,observation.driver,json,json);
  });
  return observation;
}
