import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const busySQL = 'WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) AS total FROM n';
async function until(condition) {
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) { if (await condition()) return; await delay(10); }
  assert.fail('Expected durable job state was not published.');
}
const seed = f => f.app.localData.get().createMemory({ id: 'memory:responsive-note', kind: 'note', title: 'Responsive draft note', body: 'Draft writes and knowledge reads remain usable while background work is pending.', source: { projectID: f.project.id } });

test('busy analytics worker times out while simultaneous HTTP query and draft writes remain responsive', { timeout: 10000 }, async t => {
  const priorBridge = process.env.FREELANCER_GIT_BRIDGE, bridgeToken = 'responsiveness-fixture-bridge';
  process.env.FREELANCER_GIT_BRIDGE = bridgeToken;
  t.after(() => { if (priorBridge === undefined) delete process.env.FREELANCER_GIT_BRIDGE; else process.env.FREELANCER_GIT_BRIDGE = priorBridge; });
  const f = await localDataFixture({ timers: false }); t.after(() => f.close()); seed(f);
  const nativeRequest = async body => {
    const response = await fetch(`${f.url}/api/knowledge/agent`, { method: 'POST', headers: { 'X-Freelancer-Client': 'webpage', 'X-Freelancer-Git-Bridge': bridgeToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw Object.assign(Error(result.error), { status: response.status }); return result;
  };
  const data = f.app.localData.get(), analyze = data.analyze.bind(data);
  let enteredResolve, finished = false;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  data.analyze = (...args) => { enteredResolve(); return analyze(...args); };
  const workerRequest = nativeRequest({ operation: 'analyze', sql: busySQL, paramsJson: '{}' })
    .then(value => { finished = true; return { value }; }, error => { finished = true; return { error }; });
  await Promise.race([entered, workerRequest.then(outcome => { throw outcome.error ?? Error('Analytical request finished before starting a worker.'); })]);
  const start = performance.now();
  const [query, draft] = await Promise.all([
    f.api('knowledge', { operation: 'query', domain: 'memories', query: 'memory:responsive-note' }),
    f.api(`drafts?project=${f.project.id}&session=new`, { text: 'Written while analytics runs.', revision: 0 }, 'PUT'),
  ]);
  const elapsedMs = performance.now() - start;
  assert.equal(query.results[0].id, 'memory:responsive-note');
  assert.equal(draft.text, 'Written while analytics runs.');
  assert.ok(elapsedMs < 1200, `simultaneous HTTP reads/write took ${Math.round(elapsedMs)}ms`);
  assert.equal(finished, false, 'HTTP work completes while the analytical worker remains busy');
  const outcome = await workerRequest;
  assert.match(outcome.error?.message ?? '', /execution time limit/);
  assert.equal((await f.api(`drafts?project=${f.project.id}&session=new`)).text, draft.text);
  const recovered = await nativeRequest({ operation: 'analyze', sql: 'SELECT count(*) AS n FROM memory_items', paramsJson: '{}' });
  assert.equal(recovered.rows[0].n, 1, 'a timeout releases worker capacity for subsequent real SQLite queries');
  t.diagnostic(`Concurrent HTTP query and draft write: ${Math.round(elapsedMs)}ms; busy analytics terminated at its 1500ms bound.`);
});

test('a pending extraction job permits HTTP query, durable draft write, status and cancellation', { timeout: 10000 }, async t => {
  const f = await localDataFixture({ timers: false }); t.after(() => f.close()); seed(f);
  let enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  f.app.rebuildContentIndex = async ({ signal, onProgress }) => {
    enteredResolve(); onProgress('Waiting for slow fixture extraction');
    await new Promise(resolve => {
      if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true });
    });
    signal.throwIfAborted();
    assert.fail('Cancelled extraction must not publish an index.');
  };
  const { job } = await f.api('index/jobs', { kind: 'files', project: f.project.id });
  await entered;
  const start = performance.now();
  const [query, draft, status] = await Promise.all([
    f.api('knowledge', { operation: 'query', domain: 'memories', query: 'memory:responsive-note' }),
    f.api(`drafts?project=${f.project.id}&session=new`, { text: 'Written while extraction waits.', revision: 0 }, 'PUT'),
    f.api('index/jobs'),
  ]);
  assert.equal(query.results[0].id, 'memory:responsive-note');
  assert.equal(draft.text, 'Written while extraction waits.');
  assert.equal(status.job.status, 'running');
  const stopped = await f.api('index/jobs/stop', { id: job.id });
  const elapsedMs = performance.now() - start;
  assert.equal(stopped.job.id, job.id);
  assert.ok(elapsedMs < 1000, `query/draft/status/cancel took ${Math.round(elapsedMs)}ms`);
  await until(async () => (await f.api('index/jobs')).job.status === 'stopped');
  assert.equal((await f.api(`drafts?project=${f.project.id}&session=new`)).text, draft.text);
  assert.equal(f.app.localData.get().projectIndexesReady(f.project.id), false, 'cancelled extraction never marks setup as complete');
  t.diagnostic(`HTTP query, draft write, running status and cancellation during pending extraction: ${Math.round(elapsedMs)}ms.`);
});

test('native history backfill checkpoints completed captures while HTTP query, draft and send stay responsive and abortable', { timeout: 15000 }, async t => {
  const controller = new AbortController();
  let pending;
  const f = await localDataFixture({ timers: false });
  t.after(async () => { controller.abort(); await pending?.catch(() => {}); await f.close(); });
  seed(f);
  const data = f.app.localData.get();
  for (const [index, session] of f.state.sessions.entries()) session.time.updated = 900 - index * 100;
  for (const sessionID of ['ses_history', 'ses_worker']) f.state.messages[sessionID] = [
    { info: { id: `msg_backfill_${sessionID}`, role: 'user', time: { created: 301 } },
      parts: [{ id: `part_backfill_${sessionID}`, type: 'text', text: `Committed capture for ${sessionID}.` }] },
  ];
  const nativeRequest = f.host.request.bind(f.host);
  let mode = 'slow', enteredResolve, slowReadAborted = false, backfillFinished = false;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  f.host.request = async (route, options = {}) => {
    if (route.startsWith('/experimental/session?')) {
      const params = new URL(route, 'http://fixture').searchParams;
      assert.equal(params.get('archived'), 'true', 'the native inventory must explicitly include archived sessions');
      assert.equal(params.get('directory'), f.directory);
      assert.equal(options.responseMetadata, true, 'native cursor headers are part of the paging contract');
      const start = params.has('start') ? Number(params.get('start')) : null;
      const before = params.has('cursor') ? Number(params.get('cursor')) : null;
      const limit = Number(params.get('limit'));
      // Native start is an inclusive updated-time lower bound, never an offset.
      // Tie-bucket reads (start=800,cursor=801) remain available; only the next
      // descending inventory page (cursor=800) is deliberately held/failing.
      if (before === 800 && start === null) {
        if (mode === 'slow') {
          enteredResolve();
          assert.equal(options.signal, controller.signal, 'the real backfill must forward cancellation to its pending native page read');
          await new Promise((_, reject) => {
            const abort = () => { slowReadAborted = true; reject(options.signal.reason); };
            if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
          });
        }
        if (mode === 'failing') throw Object.assign(Error('Transient native inventory page failure.'), { status: 503 });
      }
      const matches = f.state.sessions.filter(session => (start === null || session.time.updated >= start)
        && (before === null || session.time.updated < before))
        .sort((a, b) => b.time.updated - a.time.updated || b.id.localeCompare(a.id));
      const body = structuredClone(matches.slice(0, limit));
      return { body, metadata: { 'x-next-cursor': matches.length > limit ? String(body.at(-1).time.updated) : null } };
    }
    return nativeRequest(route, options);
  };
  pending = f.app.history.backfillOpenCode({ projectID: f.project.id, pageSize: 2, signal: controller.signal })
    .then(result => { backfillFinished = true; return result; });
  pending.catch(() => {}); // Teardown drains this promise if an earlier assertion fails.
  await Promise.race([entered, pending.then(result => {
    throw Error(`Backfill finished before reaching the held native timestamp page: ${result.results[0]?.error ?? result.results[0]?.status}`);
  })]);
  const durable = () => {
    const db = new DatabaseSync(data.filename, { readOnly: true });
    try {
      return {
        run: db.prepare('SELECT status,cursor_json AS cursorJSON,captured_sessions AS sessions,captured_messages AS messages,failed_sessions AS failures FROM opencode_ingest_runs ORDER BY started_at DESC LIMIT 1').get(),
        revisions: db.prepare('SELECT count(*) AS n FROM opencode_message_revisions').get().n,
        coverage: db.prepare('SELECT state FROM opencode_ingest_cursors WHERE project_id=?').get(f.project.id).state,
      };
    } finally { db.close(); }
  };
  const before = durable();
  assert.equal(before.run.status, 'running');
  assert.equal(before.run.sessions, 2); assert.equal(before.run.messages, 2);
  assert.equal(before.revisions, 2, 'both earlier capture commits are visible through an independent SQLite connection before the slow native page settles');
  const initialCursor = JSON.parse(before.run.cursorJSON);
  assert.equal(initialCursor.contract, 'opencode-updated-v1'); assert.equal(initialCursor.before, 800);
  assert.deepEqual(initialCursor.retryIDs, []);
  assert.equal(Object.hasOwn(initialCursor, 'start'), false, 'durable progress cannot treat native timestamps as row offsets');
  assert.equal(before.coverage, 'incomplete');

  const start = performance.now();
  const [query, draft] = await Promise.all([
    f.api('knowledge', { operation: 'query', domain: 'memories', query: 'memory:responsive-note' }),
    f.api(`drafts?project=${f.project.id}&session=new`, { text: 'Written during a pending native history page.', revision: 0 }, 'PUT'),
    f.api('send', { project: f.project.id, session: 'ses_other', text: 'One explicit send while native history capture waits.', model: 'opencode/free', agentID: 'engineer' }),
  ]);
  const elapsedMs = performance.now() - start;
  assert.equal(query.results[0].id, 'memory:responsive-note');
  assert.equal(draft.text, 'Written during a pending native history page.');
  assert.ok(elapsedMs < 2000, `HTTP query/draft/native-fixture send during backfill took ${Math.round(elapsedMs)}ms`);
  assert.equal(backfillFinished, false, 'interactive HTTP operations complete while the native backfill read is still pending');
  const prompts = () => f.calls.filter(call => call.route.endsWith('/prompt_async'));
  assert.equal(prompts().length, 1);
  assert.equal(prompts()[0].route, '/session/ses_other/prompt_async');

  const cancelStart = performance.now();
  controller.abort();
  const cancelled = await pending;
  const cancelMs = performance.now() - cancelStart;
  assert.ok(cancelMs < 1000, `aborting the pending native page took ${Math.round(cancelMs)}ms`);
  assert.equal(slowReadAborted, true);
  assert.equal(cancelled.results[0].status, 'partial');
  const after = durable();
  assert.equal(after.run.status, 'partial'); assert.equal(after.coverage, 'incomplete');
  assert.equal(after.run.sessions, 2); assert.equal(after.run.messages, 2); assert.equal(after.run.failures, 0);
  assert.equal(after.revisions, 2);
  assert.deepEqual(JSON.parse(after.run.cursorJSON), initialCursor, 'cancellation retains the committed timestamp boundary and initial native head signature');
  assert.deepEqual(data.openCodeIngestFailures({ runID: cancelled.results[0].runID }), [], 'cancellation is not recorded as a failed source or advanced beyond the unread page');
  assert.equal((await f.api(`drafts?project=${f.project.id}&session=new`)).text, draft.text);

  // Timestamp failure/resumption and tie-bucket behavior have dedicated cases in
  // local-data.test.mjs. Here resume proves capture never repeats an accepted send.
  mode = 'failing';
  const unavailable = await f.app.history.backfillOpenCode({ projectID: f.project.id, pageSize: 2, resume: true });
  assert.equal(unavailable.results[0].status, 'partial');
  assert.match(unavailable.results[0].error, /Transient native inventory page failure/);
  assert.equal(durable().revisions, 2);
  mode = 'ready';
  const resumed = await f.app.history.backfillOpenCode({ projectID: f.project.id, pageSize: 2, resume: true });
  assert.equal(resumed.results[0].status, 'complete');
  assert.equal(data.openCodeCoverage()[0].sessions, 3);
  assert.equal(prompts().length, 1, 'backfill cancellation, failure and resumption never replay the explicit accepted prompt');
  t.diagnostic(`Pending native history page: concurrent HTTP query/draft/send ${Math.round(elapsedMs)}ms; abort checkpoint ${Math.round(cancelMs)}ms; two capture commits retained. Native transport is a fixture, not live inference.`);
});
