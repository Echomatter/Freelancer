import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { localDataFixture } from './fixtures/local-data-app.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const seed = f => f.app.localData.get().createMemory({
  id: 'memory:backfill-contention-note', kind: 'note', title: 'Backfill contention fixture',
  body: 'HTTP search remains available while native history messages are committed.', source: { projectID: f.project.id },
});

test('sustained native backfill keeps HTTP query, draft, status and fixture send responsive', { timeout: 20000 }, async t => {
  const priorBridge = process.env.FREELANCER_GIT_BRIDGE, bridgeToken = 'sustained-backfill-fixture-bridge';
  process.env.FREELANCER_GIT_BRIDGE = bridgeToken;
  t.after(() => { if (priorBridge === undefined) delete process.env.FREELANCER_GIT_BRIDGE; else process.env.FREELANCER_GIT_BRIDGE = priorBridge; });

  const f = await localDataFixture({ timers: false });
  const gates = [12, 30].map(after => ({ after, entered: deferred(), release: deferred(), released: false }));
  let pending;
  t.after(async () => {
    for (const gate of gates) { gate.released = true; gate.release.resolve(); }
    await pending?.catch(() => {});
    await f.close();
  });
  seed(f);
  const data = f.app.localData.get();
  for (let index = 0; index < 4; index++) f.state.sessions.push({
    id: `ses_send_stress_${index}`, directory: f.directory, title: `Independent fixture send ${index}`,
    time: { created: 5000 + index, updated: 5000 + index },
  });
  const sessions = Array.from({ length: 40 }, (_, index) => ({
    id: `ses_stress_${String(index).padStart(2, '0')}`,
    directory: f.directory,
    title: `Persisted stress session ${index}`,
    time: { created: 1000 + index, updated: 2000 - index * 10 },
  }));
  const nativeRequest = f.host.request.bind(f.host);
  let messageReads = 0, nativePageReads = 0;
  f.host.request = async (route, options = {}) => {
    if (route.startsWith('/experimental/session?')) {
      nativePageReads++;
      const params = new URL(route, 'http://fixture').searchParams;
      assert.equal(params.get('directory'), f.directory);
      assert.equal(params.get('archived'), 'true');
      assert.equal(options.responseMetadata, true);
      const start = params.has('start') ? Number(params.get('start')) : null;
      const before = params.has('cursor') ? Number(params.get('cursor')) : null;
      const limit = Number(params.get('limit'));
      const matches = sessions.filter(session => (start === null || session.time.updated >= start)
        && (before === null || session.time.updated < before))
        .sort((a, b) => b.time.updated - a.time.updated || b.id.localeCompare(a.id));
      const body = structuredClone(matches.slice(0, limit));
      return { body, metadata: { 'x-next-cursor': matches.length > limit ? String(body.at(-1).time.updated) : null } };
    }
    const match = route.match(/^\/session\/(ses_stress_\d+)\/message$/);
    if (match) {
      messageReads++;
      const index = Number(match[1].slice('ses_stress_'.length));
      const gate = gates.find(item => item.after === index);
      if (gate) { gate.entered.resolve(); await gate.release.promise; }
      return [{ info: { id: `msg_stress_${String(index).padStart(2, '0')}`, role: 'user', time: { created: 3000 + index } },
        parts: [{ id: `part_stress_${String(index).padStart(2, '0')}`, type: 'text', text: `Durably captured fixture evidence ${index}.` }] }];
    }
    return nativeRequest(route, options);
  };

  let cursorCheckpoints = 0;
  const checkpoint = data.checkpointOpenCodeIngest.bind(data);
  data.checkpointOpenCodeIngest = input => { const result = checkpoint(input); cursorCheckpoints++; return result; };

  const bridge = async body => {
    const response = await fetch(`${f.url}/api/knowledge/agent`, { method: 'POST', headers: {
      'X-Freelancer-Client': 'webpage', 'X-Freelancer-Git-Bridge': bridgeToken, 'Content-Type': 'application/json',
    }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result.error), { status: response.status });
    return result;
  };
  const sendFixture = async round => {
    const response = await fetch(`${f.url}/api/send`, { method: 'POST', headers: {
      'X-Freelancer-Client': 'webpage', 'Content-Type': 'application/json',
    }, body: JSON.stringify({ project: f.project.id, session: `ses_send_stress_${round}`,
      text: `Fixture acknowledgement during sustained native capture ${round}.`, model: 'opencode/free', agentID: 'engineer' }) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(result?.error ?? 'Fixture send was rejected.'), { status: response.status });
    return { status: response.status, result };
  };
  const durable = () => {
    const db = new DatabaseSync(data.filename, { readOnly: true });
    try {
      return db.prepare(`SELECT status,captured_sessions AS sessions,captured_messages AS messages,
        cursor_json AS cursor FROM opencode_ingest_runs ORDER BY started_at DESC LIMIT 1`).get();
    } finally { db.close(); }
  };

  pending = f.app.history.backfillOpenCode({ projectID: f.project.id, pageSize: 8 });
  let finished = false;
  pending = pending.then(result => { finished = true; return result; });
  pending.catch(() => {});
  let draftRevision = 0;
  const samples = [];
  for (const [gateIndex, gate] of gates.entries()) {
    await gate.entered.promise;
    const before = durable();
    assert.equal(before.status, 'running');
    assert.equal(before.sessions, gate.after, `native read gate occurs after ${gate.after} durable session captures`);
    assert.equal(before.messages, gate.after);
    for (let withinGate = 0; withinGate < 2; withinGate++) {
      const round = gateIndex * 2 + withinGate;
      const started = performance.now();
      const [query, draft, status, sent] = await Promise.all([
        f.api('knowledge', { operation: 'query', domain: 'memories', query: 'memory:backfill-contention-note' }),
        f.api(`drafts?project=${f.project.id}&session=new`, { text: `Draft update during capture ${round}.`, revision: draftRevision }, 'PUT'),
        bridge({ operation: 'warehouse-status', projectID: f.project.id }),
        sendFixture(round),
      ]);
      const elapsedMs = performance.now() - started;
      draftRevision = draft.revision;
      assert.equal(query.results[0].id, 'memory:backfill-contention-note');
      assert.equal(draft.text, `Draft update during capture ${round}.`);
      assert.equal(status.ingestRuns[0].status, 'running', 'HTTP status observes the in-flight durable import');
      assert.equal(sent.status, 200, 'fixture send receives its normal HTTP acknowledgment without provider inference');
      assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, round + 1);
      assert.equal(finished, false, 'the sustained import remains held in the native fixture request');
      assert.equal(gate.released, false);
      assert.deepEqual(durable(), before, 'interactive operations finish before releasing the native read; prior SQLite captures and cursor state stay stable');
      assert.equal(messageReads, gate.after + 1, 'the importer is paused on exactly the next source message');
      samples.push({ round: round + 1, afterCaptures: gate.after, elapsedMs: Math.round(elapsedMs) });
    }
    gate.released = true;
    gate.release.resolve();
  }

  const result = await pending;
  assert.equal(result.results[0].status, 'complete');
  assert.equal(result.results[0].capturedSessions, 40);
  assert.equal(result.results[0].capturedMessages, 40);
  assert.ok(cursorCheckpoints >= 40, `expected durable run/cursor checkpoints for the capture stream; observed ${cursorCheckpoints}`);
  assert.ok(nativePageReads >= 10, `expected multiple actual native-fixture pages and tie-bucket reads; observed ${nativePageReads}`);
  assert.equal(messageReads, 40);

  const db = new DatabaseSync(data.filename, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_sessions WHERE project_id=?').get(f.project.id).n, 40);
    assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_messages WHERE project_id=?').get(f.project.id).n, 40);
    assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_message_revisions WHERE project_id=?').get(f.project.id).n, 40);
    const runRow = db.prepare('SELECT status,captured_sessions AS sessions,captured_messages AS messages,cursor_json AS cursor FROM opencode_ingest_runs WHERE run_id=?').get(result.results[0].runID);
    assert.equal(runRow.status, 'complete'); assert.equal(runRow.sessions, 40); assert.equal(runRow.messages, 40); assert.equal(runRow.cursor, null);
  } finally { db.close(); }
  assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, 4, 'capture never duplicates the four explicit fixture sends');
  assert.ok((await f.api(`drafts?project=${f.project.id}&session=new`)).text.endsWith('3.'), 'the last concurrent draft revision remains durable');
  t.diagnostic(`40 SQLite-backed message captures, ${cursorCheckpoints} durable run/cursor checkpoints, ${nativePageReads} native-fixture page reads; 4 query/draft/status/send batches completed while import was held after 12 and 30 captures. Observed batch durations: ${samples.map(row => `${row.elapsedMs}ms at ${row.afterCaptures} captures`).join(', ')}. Synthetic fixture only; no machine-specific latency cutoff or production-load claim.`);
});
