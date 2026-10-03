import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const conflict = () => Object.assign(Error('Index job state changed in another runtime. Refresh before retrying.'), { status:409 });

// Operational jobs use the same durable table as execution receipts. Keep each
// completed job and a dismissible current pointer; no new state file is created.
export function createIndexJobState(filename, runtimeID) {
  if (!path.isAbsolute(filename) || typeof runtimeID !== 'string' || !runtimeID)
    throw Error('Index job state requires a database path and runtime identity.');
  const open = (write, action) => {
    const db = new DatabaseSync(filename, { readOnly:!write });
    try {
      db.exec('PRAGMA busy_timeout=10000');
      if (db.prepare('PRAGMA application_id').get().application_id !== 1414482766)
        throw Error('Index jobs require the Freelancer database.');
      if (write) db.exec('PRAGMA synchronous=FULL');
      return action(db);
    } finally { db.close(); }
  };
  const read = db => {
    const pointer = db.prepare("SELECT data FROM operational_records WHERE runtime_id=? AND collection='index-job-state' AND id='current'").get(runtimeID);
    const id = pointer ? JSON.parse(pointer.data).id : null;
    if (!id) return null;
    const row = db.prepare("SELECT data FROM operational_records WHERE runtime_id=? AND collection='index-jobs' AND id=?").get(runtimeID,id);
    if (!row) throw Error('The current index job record is missing. Existing indexes were preserved.');
    return JSON.parse(row.data);
  };
  return {
    read: () => open(false, read),
    save(next, previous) {
      return open(true, db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const current = read(db);
          if (current?.id !== previous?.id || current?.stateRevision !== previous?.stateRevision) throw conflict();
          const saved = next ? { ...next, stateRevision:(next.id === previous?.id ? previous.stateRevision : 0) + 1 } : null;
          const put = db.prepare(`INSERT INTO operational_records(runtime_id,collection,id,project_id,session_id,data,summary)
            VALUES(?,?,?,?,NULL,?,?) ON CONFLICT(runtime_id,collection,id) DO UPDATE SET
            project_id=excluded.project_id,data=excluded.data,summary=excluded.summary`);
          if (saved) put.run(runtimeID,'index-jobs',saved.id,saved.project || null,JSON.stringify(saved),JSON.stringify({kind:saved.kind,status:saved.status,updatedAt:saved.updatedAt}));
          else if (previous) {
            const dismissed = { ...previous, dismissedAt:Date.now(), stateRevision:previous.stateRevision + 1 };
            put.run(runtimeID,'index-jobs',previous.id,previous.project || null,JSON.stringify(dismissed),JSON.stringify({kind:previous.kind,status:previous.status,dismissedAt:dismissed.dismissedAt}));
          }
          put.run(runtimeID,'index-job-state','current',null,JSON.stringify({id:saved?.id ?? null}), '{}');
          db.exec('COMMIT');
          return saved;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      });
    },
  };
}
