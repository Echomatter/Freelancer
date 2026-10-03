import { randomUUID, createHash } from 'node:crypto';

const decodeJob = row => row && ({ ...row });
const jobSelect = `SELECT job_id AS id,memory_id AS memoryID,project_id AS projectID,
  session_id AS sessionID,status,expected_revision AS expectedRevision,attempts,
  created_at AS createdAt,updated_at AS updatedAt,error FROM memory_capture_jobs`;

/** Capture is a durable read job. Restart may resume capture, never execution. */
export function createMemoryCaptureService(db, tx) {
  return {
    queueMemoryCapture({ memoryID, projectID, sessionID }) {
      return tx(() => {
        const item = db.prepare('SELECT deleted_at FROM memory_items WHERE memory_id=?').get(memoryID);
        const revision = db.prepare('SELECT max(revision) AS n FROM memory_item_revisions WHERE memory_id=?').get(memoryID)?.n;
        if (!item || item.deleted_at !== null || !revision) throw Error('Choose an available memory.');
        const existing = db.prepare(`${jobSelect} WHERE memory_id=? AND status IN ('queued','running')`).get(memoryID);
        if (existing) return decodeJob(existing);
        const id = randomUUID(), now = Date.now();
        db.prepare(`INSERT INTO memory_capture_jobs VALUES(?,?,?,?,'queued',?,0,?,?,NULL)`)
          .run(id,memoryID,projectID,sessionID,revision,now,now);
        return decodeJob(db.prepare(`${jobSelect} WHERE job_id=?`).get(id));
      });
    },
    memoryCaptureJob(memoryID) {
      return decodeJob(db.prepare(`${jobSelect} WHERE memory_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(memoryID));
    },
    resumeMemoryCaptures() {
      db.prepare("UPDATE memory_capture_jobs SET status='queued',updated_at=? WHERE status='running'").run(Date.now());
      return db.prepare(`${jobSelect} WHERE status='queued' ORDER BY created_at,rowid`).all().map(decodeJob);
    },
    claimMemoryCapture(id) {
      return tx(() => {
        const changed = db.prepare("UPDATE memory_capture_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE job_id=? AND status='queued'").run(Date.now(),id).changes;
        return changed ? decodeJob(db.prepare(`${jobSelect} WHERE job_id=?`).get(id)) : null;
      });
    },
    failMemoryCapture(id, error, interrupted = false) {
      db.prepare("UPDATE memory_capture_jobs SET status=?,error=?,updated_at=? WHERE job_id=? AND status IN ('queued','running')")
        .run(interrupted ? 'queued' : 'failed',String(error?.message ?? error).slice(0,2000),Date.now(),id);
    },
    completeMemoryCapture({ jobID, messages, members, boundary, provenance }) {
      if (!Array.isArray(messages) || !Array.isArray(members)) throw Error('Capture needs bounded messages and members.');
      const body = messages.map(message => `${message.role}: ${message.text}`).join('\n\n');
      if (Buffer.byteLength(body) > 1_000_000 || members.length > 5000) throw Error('Capture exceeds its storage bounds.');
      return tx(() => {
        const job = db.prepare(`${jobSelect} WHERE job_id=? AND status='running'`).get(jobID);
        if (!job) throw Error('Capture job is no longer running.');
        const item = db.prepare('SELECT deleted_at FROM memory_items WHERE memory_id=?').get(job.memoryID);
        const current = db.prepare('SELECT revision,revision_id AS id FROM memory_item_revisions WHERE memory_id=? ORDER BY revision DESC LIMIT 1').get(job.memoryID);
        if (!item || item.deleted_at !== null || current.revision !== job.expectedRevision)
          throw Error('Memory changed during capture. Refresh to capture its current source.');
        const revisionID = randomUUID(), revision = current.revision + 1, now = Date.now();
        const snapshotHash = createHash('sha256').update(JSON.stringify({messages,members,boundary})).digest('hex');
        db.prepare('INSERT INTO memory_item_revisions VALUES(?,?,?,?,?,?,?)')
          .run(revisionID,job.memoryID,revision,body,JSON.stringify({...provenance,snapshotHash}),JSON.stringify({...boundary,capturedAt:now}),now);
        const insert = db.prepare('INSERT INTO memory_members VALUES(?,?,?,?,?,?,?,?)');
        members.forEach((member,ordinal) => insert.run(revisionID,ordinal,member.kind,member.ref,member.revision ?? null,
          JSON.stringify(member.locator ?? {}),member.hash ?? null,member.availability ?? 'available'));
        db.prepare('UPDATE memory_items SET updated_at=? WHERE memory_id=?').run(now,job.memoryID);
        db.prepare('INSERT INTO memory_changes VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(),job.memoryID,null,'captured',current.id,revisionID,'capture',job.sessionID,'',now);
        db.prepare("UPDATE memory_capture_jobs SET status='completed',error=NULL,updated_at=? WHERE job_id=?").run(now,jobID);
        return { id:job.memoryID,revision,revisionID,snapshotHash };
      });
    },
  };
}
