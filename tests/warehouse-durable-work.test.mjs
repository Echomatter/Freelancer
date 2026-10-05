import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { createLocalDataStore } from '../server/data/store.mjs';
import { openCodeSnapshotProof, openCodeSourceIdentity } from '../server/data/opencode-warehouse.mjs';
import { createHistoryService } from '../server/history.mjs';
import { createOpenCodeEventCoordinator } from '../server/opencode-event-coordinator.mjs';
import { backupLocalData, restoreLocalData } from '../server/data/backup.mjs';
import { FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';
import { LOCAL_DATA_SCHEMA_VERSION } from '../shared/data-contract.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-durable-warehouse-'));
  const directory = path.join(root, 'project'), dataHome = path.join(root, 'data');
  await mkdir(directory);
  let store = createLocalDataStore(dataHome), nativeReads = 0;
  store.initializeFreshRuntime(FRESH_RUNTIME_ID);
  const project = { id: 'durable-project', name: 'Durable project', directory };
  const registration = new DatabaseSync(store.filename);
  try { registration.prepare('INSERT INTO project_registrations(runtime_id,project_id,data) VALUES(?,?,?)').run(FRESH_RUNTIME_ID, project.id, JSON.stringify(project)); }
  finally { registration.close(); }
  const nativeDatabasePath = path.join(root, 'native-opencode.sqlite');
  const source = openCodeSourceIdentity(nativeDatabasePath);
  const session = { id: 'ses_durable', title: 'Durable warehouse conversation', directory, time: { created: 100, updated: 500, archived: 500 } };
  const histories = [];
  const createHistory = ({ resolveProject, nativeRequest } = {}) => {
    const history = createHistoryService({ backendRoot: path.join(root, 'backend'), dataRoot: dataHome,
      localData: { get: () => store },
      app: { store: { read: async () => ({ projects: [project] }) }, indexJobs: { isArchiving: () => false },
        project: async id => { if (id !== project.id) throw Error('Choose a registered project.'); return resolveProject ? resolveProject(project) : project; } },
      host: { databasePath: async () => nativeDatabasePath,
        request: async (route, options) => {
          nativeReads++;
          if (nativeRequest) return nativeRequest(route, options);
          throw Error('Durable derivation must not read the native host.');
        } } });
    histories.push(history); return history;
  };
  const captureInput = (text, overrides = {}) => {
    const messages = [{ info: { id: 'msg_durable', sessionID: session.id, role: 'assistant', time: { created: 200 },
      model: { providerID: 'fixture', modelID: 'retained' } }, parts: [{ id: 'part_durable', type: 'text', text }] }];
    const input = { ...source, projectID: project.id, session, messages, projectionSafe: true,
      snapshotCompleteness: 'complete', snapshotProof: openCodeSnapshotProof(session, messages), ...overrides };
    return input;
  };
  const capture = (text, overrides = {}) => store.recordOpenCodeSnapshot(captureInput(text, overrides));
  const raw = action => {
    const db = new DatabaseSync(store.filename);
    try { return action(db); } finally { db.close(); }
  };
  const jobs = (options = {}) => store.listWarehouseDerivationJobs({ sourceID: source.sourceSystemID, projectID: project.id, limit: 100, ...options });
  t.after(async () => {
    for (const history of histories) await history.close();
    store.close(); await rm(root, { recursive: true, force: true });
  });
  return { root, dataHome, project, source, session, captureInput, capture, raw, jobs, createHistory,
    get store() { return store; }, get nativeReads() { return nativeReads; },
    reopen() { store.close(); store = createLocalDataStore(dataHome); return store; } };
}

function nativeInventory(f) {
  const rows = Array.from({ length: 7 }, (_, index) => {
    const updated = 900 - index * 100;
    return { id: `ses_native_${updated}`, title: `Retained ${updated}`, directory: f.project.directory,
      time: { created: 100, updated, archived: updated } };
  });
  const bodies = new Map(rows.map(row => [row.id, `hematite transcript ${row.id}`]));
  const messageReads = new Map(), routes = [];
  const history = f.createHistory({ nativeRequest: async (route, options) => {
    options.signal?.throwIfAborted();
    routes.push(route);
    const url = new URL(route, 'http://native-fixture');
    if (url.pathname === '/experimental/session') {
      assert.equal(options.responseMetadata, true);
      assert.equal(url.searchParams.get('archived'), 'true');
      assert.equal(url.searchParams.get('directory'), f.project.directory);
      const before = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')) : Infinity;
      const start = url.searchParams.has('start') ? Number(url.searchParams.get('start')) : -Infinity;
      const limit = Number(url.searchParams.get('limit'));
      const candidates = rows.filter(row => row.time.updated < before && row.time.updated >= start)
        .sort((a, b) => b.time.updated - a.time.updated || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const body = candidates.slice(0, limit);
      return { body, metadata: { 'x-next-cursor': candidates.length > body.length ? String(body.at(-1).time.updated) : null } };
    }
    const match = /^\/session\/([^/]+)\/message$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]);
      assert.ok(rows.some(row => row.id === id));
      messageReads.set(id, (messageReads.get(id) ?? 0) + 1);
      return [{ info: { id: `msg_${id}`, sessionID: id, role: 'assistant', time: { created: 200 } },
        parts: [{ id: `part_${id}`, type: 'text', text: bodies.get(id) }] }];
    }
    throw Error(`Unexpected native fixture route: ${url.pathname}`);
  } });
  return { history, rows, bodies, messageReads, routes };
}

async function drainBoundedBackfill(history, projectID, options = {}) {
  const slices = [];
  for (let index = 0; index < 10; index++) {
    const summary = await history.backfillOpenCode({ projectID, resume: true, pageSize: 5, maxSessions: 2, maxPages: 8, ...options });
    const run = summary.results[0];
    assert.ok(run.capturedSessions <= 2, 'each reconciliation slice stays within its session budget');
    slices.push(run);
    if (run.status === 'complete') return slices;
  }
  assert.fail('bounded reconciliation did not reach the oldest native session within ten slices');
}

async function within(promise, milliseconds, message) {
  const timer = new AbortController();
  try {
    return await Promise.race([promise, delay(milliseconds, undefined, { signal: timer.signal }).then(() => assert.fail(message))]);
  } finally { timer.abort(); }
}

test('capturing a snapshot and its pending derivation is one atomic durable commit', async t => {
  const f = await fixture(t);
  f.raw(db => db.exec(`CREATE TRIGGER fixture_reject_derivation BEFORE INSERT ON opencode_derivation_jobs
    BEGIN SELECT RAISE(ABORT, 'fixture derivation enqueue rejected'); END`));
  assert.throws(() => f.capture('atomic violet evidence'), /fixture derivation enqueue rejected/);
  f.raw(db => {
    for (const table of ['opencode_sources', 'opencode_sessions', 'opencode_session_revisions', 'opencode_messages', 'opencode_message_revisions', 'opencode_derivation_jobs'])
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, `${table} rolls back with derivation enqueue`);
    db.exec('DROP TRIGGER fixture_reject_derivation');
  });
  f.capture('atomic violet evidence');
  const pending = f.jobs();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].sourceID, f.source.sourceSystemID);
  assert.equal(pending[0].projectID, f.project.id);
  assert.equal(pending[0].sessionID, f.session.id);
  const exact = f.store.readWarehouseDerivationSnapshot({ id: pending[0].id, revisionToken: pending[0].revisionToken });
  assert.equal(exact.isCurrent, true);
  assert.equal(exact.messages[0].parts[0].text, 'atomic violet evidence');
  f.reopen();
  assert.deepEqual(f.jobs().map(row => [row.id, row.revisionToken]), pending.map(row => [row.id, row.revisionToken]));
});

test('abrupt capture-worker termination leaves pending work recoverable without native rereads and repeated snapshots coalesce', async t => {
  const f = await fixture(t);
  f.store.close();
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { createLocalDataStore } = await import(workerData.storeModule);
      const store = createLocalDataStore(workerData.dataHome);
      store.recordOpenCodeSnapshot(workerData.input);
      parentPort.postMessage(store.listWarehouseDerivationJobs()[0]);
      // The owner terminates this thread while its SQLite connection is open.
      setInterval(() => {}, 1000);
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { dataHome: f.dataHome, input: f.captureInput('recoverable turquoise transcript'),
    storeModule: new URL('../server/data/store.mjs', import.meta.url).href } });
  let committed;
  try { committed = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }); }
  finally { await worker.terminate(); }
  f.reopen();
  const first = f.jobs()[0];
  assert.deepEqual([first.id, first.revisionToken], [committed.id, committed.revisionToken]);
  f.capture('recoverable turquoise transcript');
  assert.deepEqual(f.jobs().map(row => [row.id, row.revisionToken]), [[first.id, first.revisionToken]]);
  f.raw(db => assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_message_revisions').get().n, 1));
  f.reopen();
  const result = await f.createHistory().processWarehouseDerivationJobs({ limit: 10 });
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal(f.nativeReads, 0, 'recovery derives captured SQLite records instead of replaying native work');
  assert.equal(f.jobs().length, 0);
  assert.equal(f.store.searchChats('turquoise')[0].session, f.session.id);
  f.capture('recoverable turquoise transcript');
  assert.equal(f.jobs().length, 0, 'a repeated published snapshot does not enqueue duplicate work');
  f.raw(db => {
    assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_derivation_jobs').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_message_revisions').get().n, 1);
  });
});

test('refresh revision acknowledgements and old derivation tokens cannot clear or overwrite newer work', async t => {
  const f = await fixture(t);
  const input = { sourceID: f.source.sourceSystemID, projectID: f.project.id, sessionID: f.session.id, reason: 'event-hint' };
  const first = f.store.markWarehouseRefreshNeeded(input), newer = f.store.markWarehouseRefreshNeeded(input);
  assert.equal(first.id, newer.id);
  assert.ok(newer.revision > first.revision);
  assert.equal(f.store.clearWarehouseRefreshNeeded(first).cleared, false);
  assert.deepEqual(f.store.listWarehouseRefreshNeeded({ sourceID: input.sourceID, projectID: input.projectID }).map(row => [row.id, row.revision]), [[newer.id, newer.revision]]);
  assert.equal(f.store.clearWarehouseRefreshNeeded(newer).cleared, true);
  const afterClear = f.store.markWarehouseRefreshNeeded(input);
  assert.ok(afterClear.revision > newer.revision, 'cleared durable rows prevent ABA acknowledgement reuse');
  assert.equal(f.store.clearWarehouseRefreshNeeded(newer).cleared, false);

  f.capture('older amber projection');
  const olderJob = f.jobs()[0];
  f.capture('newer indigo projection');
  const newJob = f.jobs().find(row => row.id !== olderJob.id || row.revisionToken !== olderJob.revisionToken);
  assert.ok(newJob, 'changed native parts under the same session header enqueue a new exact snapshot');
  assert.equal(f.store.publishWarehouseDerivationJob(newJob).status, 'complete');
  assert.equal(f.store.searchChats('indigo')[0].session, f.session.id);
  const oldResult = f.store.publishWarehouseDerivationJob(olderJob);
  assert.ok(['stale', 'superseded'].includes(oldResult.status));
  assert.equal(oldResult.published, false);
  assert.equal(f.store.searchChats('amber').length, 0, 'old work cannot replace the current exact search projection');
  assert.equal(f.store.searchChats('indigo')[0].session, f.session.id);
  assert.equal(f.store.clearWarehouseRefreshNeeded(first).cleared, false, 'derivation publication does not clear a newer native refresh hint');
});

test('derivation queue orders due retries and fresh work by eligibility time without starving either', async t => {
  const f = await fixture(t), base = Date.now() - 4000;
  f.capture('fair retry projection');
  const retry = f.jobs()[0];
  f.store.failWarehouseDerivationJob({ ...retry, error: Error('Fixture transient failure.') });
  const freshSession = { ...f.session, id: 'ses_fair_fresh' };
  f.store.recordOpenCodeSnapshot({ ...f.source, projectID: f.project.id, session: freshSession, messages: [], projectionSafe: true,
    snapshotCompleteness: 'complete', snapshotProof: openCodeSnapshotProof(freshSession, []) });
  const fresh = f.jobs({ includeDeferred: true }).find(row => row.id !== retry.id);
  f.raw(db => {
    db.prepare('UPDATE opencode_derivation_jobs SET created_at=?,updated_at=?,next_attempt_at=? WHERE job_id=?')
      .run(base, base, base + 1000, retry.id);
    db.prepare('UPDATE opencode_derivation_jobs SET created_at=?,updated_at=? WHERE job_id=?')
      .run(base + 1200, base + 1200, fresh.id);
  });
  assert.equal(f.jobs({ limit: 1 })[0].id, retry.id, 'retry eligible at t=1000 precedes fresh work authored at t=1200');
  f.store.failWarehouseDerivationJob({ ...retry, error: Error('Fixture second transient failure.') });
  f.raw(db => db.prepare('UPDATE opencode_derivation_jobs SET updated_at=?,next_attempt_at=? WHERE job_id=?')
    .run(base + 1200, base + 3200, retry.id));
  assert.equal(f.jobs({ limit: 1 })[0].id, fresh.id, 'fresh eligible work precedes a later retry despite the retry original creation time');
});

test('refresh queue orders due retries and fresh hints by eligibility time without starving either', async t => {
  const f = await fixture(t), base = Date.now() - 4000;
  const retry = f.store.markWarehouseRefreshNeeded({ sourceID: f.source.sourceSystemID, projectID: f.project.id,
    sessionID: 'ses_fair_retry', reason: 'manual' });
  f.store.failWarehouseRefreshNeeded({ ...retry, error: Error('Fixture transient hint failure.') });
  const fresh = f.store.markWarehouseRefreshNeeded({ sourceID: f.source.sourceSystemID, projectID: f.project.id,
    sessionID: 'ses_fair_fresh', reason: 'manual' });
  f.raw(db => {
    db.prepare('UPDATE opencode_refresh_needed SET created_at=?,updated_at=?,next_attempt_at=? WHERE refresh_id=?')
      .run(base, base, base + 1000, retry.id);
    db.prepare('UPDATE opencode_refresh_needed SET created_at=?,updated_at=? WHERE refresh_id=?')
      .run(base + 1200, base + 1200, fresh.id);
  });
  const first = () => f.store.listWarehouseRefreshNeeded({ sourceID: f.source.sourceSystemID, limit: 1 })[0];
  assert.equal(first().id, retry.id, 'eligible retry outranks a newer fresh hint');
  f.store.failWarehouseRefreshNeeded({ ...retry, error: Error('Fixture second transient hint failure.') });
  f.raw(db => db.prepare('UPDATE opencode_refresh_needed SET updated_at=?,next_attempt_at=? WHERE refresh_id=?')
    .run(base + 1200, base + 3200, retry.id));
  assert.equal(first().id, fresh.id, 'older eligible fresh hint outranks the newly deferred retry');
});

test('safe active windows derive without claiming completeness while unsafe windows preserve prior search', async t => {
  const f = await fixture(t), active = { ...f.session, time: { created: 100, updated: 500 } };
  f.capture('active emerald projection', { session: active, snapshotCompleteness: 'partial', snapshotProof: null, projectionSafe: true });
  const safe = f.jobs()[0];
  assert.equal(f.store.publishWarehouseDerivationJob(safe).status, 'complete');
  assert.equal(f.store.searchChats('emerald')[0].session, active.id);
  f.capture('unsafe truncated scarlet window', { session: active, snapshotCompleteness: 'partial', snapshotProof: null, projectionSafe: false });
  const unsafe = f.jobs({ includeBlocked: true }).find(row => row.id !== safe.id || row.revisionToken !== safe.revisionToken);
  assert.ok(unsafe);
  const blocked = f.store.publishWarehouseDerivationJob(unsafe);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.published, false);
  assert.equal(f.store.searchChats('scarlet').length, 0);
  assert.equal(f.store.searchChats('emerald')[0].session, active.id, 'unsafe derivation retains the last safe FTS projection');
  f.raw(db => {
    const row = db.prepare('SELECT * FROM opencode_derivation_jobs WHERE job_id=?').get(unsafe.id);
    assert.ok(row, 'blocked work retains a durable receipt');
    assert.match(JSON.stringify(row), /blocked|unsafe|projection/i);
  });
});

test('an older derivation version remains inspectable but cannot publish or requeue the current snapshot', async t => {
  const f = await fixture(t);
  f.capture('current sapphire projection');
  const current = f.jobs()[0];
  assert.equal(f.store.publishWarehouseDerivationJob(current).status, 'complete');
  const legacyID = 'fixture-older-derivation-version';
  f.raw(db => db.prepare(`INSERT INTO opencode_derivation_jobs(job_id,source_system_id,project_id,session_id,
    snapshot_revision_sha256,derivation_version,manifest_json,publication_revision,revision_token,status,
    blocked_reason,attempts,next_attempt_at,error,created_at,updated_at,completed_at)
    SELECT ?,source_system_id,project_id,session_id,snapshot_revision_sha256,?,manifest_json,
      publication_revision,revision_token,'pending',NULL,0,NULL,NULL,created_at,updated_at,NULL
    FROM opencode_derivation_jobs WHERE job_id=?`).run(legacyID, 'chat-search-retired-fixture', current.id));
  const legacy = { id: legacyID, revisionToken: current.revisionToken };
  const exact = f.store.readWarehouseDerivationSnapshot(legacy);
  assert.equal(exact.job.derivationVersion, 'chat-search-retired-fixture');
  assert.equal(exact.isCurrent, false, 'publication ownership includes the derivation version');
  assert.equal(exact.messages[0].parts[0].text, 'current sapphire projection', 'retained historical inputs remain inspectable');
  const outcome = f.store.publishWarehouseDerivationJob(legacy);
  assert.equal(outcome.published, false);
  assert.equal(outcome.status, 'superseded');
  f.store.requeueWarehouseDerivations({ sourceID: f.source.sourceSystemID, projectID: f.project.id, includeComplete: false, wakeBlocked: true });
  f.raw(db => {
    const row = db.prepare('SELECT status,revision_token FROM opencode_derivation_jobs WHERE job_id=?').get(legacyID);
    assert.equal(row.status, 'superseded');
    assert.equal(row.revision_token, legacy.revisionToken, 'repair cannot wake a retired derivation version');
  });
  assert.equal(f.store.searchChats('sapphire')[0].session, f.session.id);
  f.raw(db => {
    db.prepare('UPDATE chat_search_state SET derivation_job_id=NULL WHERE derivation_job_id=?').run(current.id);
    db.prepare('DELETE FROM opencode_derivation_jobs WHERE job_id=?').run(current.id);
    db.prepare("UPDATE opencode_derivation_jobs SET status='pending',completed_at=NULL WHERE job_id=?").run(legacyID);
  });
  f.reopen();
  const upgraded = f.jobs()[0];
  assert.equal(upgraded.derivationVersion, current.derivationVersion, 'reopen initializes the supported extractor version from qualified retained metadata');
  assert.equal(f.store.readWarehouseDerivationSnapshot(upgraded).isCurrent, true);
  assert.equal(f.store.readWarehouseDerivationSnapshot(legacy).job.status, 'superseded');
  assert.equal(f.store.publishWarehouseDerivationJob(upgraded).status, 'complete');
  assert.equal(f.store.searchChats('sapphire')[0].session, f.session.id);
});

test('retained captures survive store reopen while their search and immutable inputs remain intact', async t => {
  const f = await fixture(t);
  f.capture('preexisting pearl transcript');
  assert.equal(f.store.publishWarehouseDerivationJob(f.jobs()[0]).status, 'complete');
  const sourceRevision = f.raw(db => db.prepare('SELECT current_revision_sha256 FROM opencode_messages').get().current_revision_sha256);
  f.store.close();
  f.reopen();
  assert.equal(f.jobs({ includeBlocked: true }).length, 0, 'completed work is not recreated on reopen');
  assert.equal(f.store.searchChats('pearl')[0].session, f.session.id);
  f.raw(db => {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, LOCAL_DATA_SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT current_revision_sha256 FROM opencode_messages').get().current_revision_sha256, sourceRevision);
    assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_message_revisions').get().n, 1);
  });
});

test('closing derivation work aborts a held project lookup without late publication or native rereads', async t => {
  const f = await fixture(t);
  f.capture('cancelled copper projection');
  let entered, release;
  const enteredProject = new Promise(resolve => { entered = resolve; });
  const heldProject = new Promise(resolve => { release = resolve; });
  const history = f.createHistory({ resolveProject: project => { entered(); return heldProject.then(() => project); } });
  const work = history.processWarehouseDerivationJobs({ limit: 10 });
  const outcome = work.then(result => ({ result }), error => ({ error }));
  await enteredProject;
  const closed = history.close();
  try {
    assert.equal(await Promise.race([closed.then(() => true), delay(1000, false, { ref: false })]), true,
      'close settles promptly despite an uncancellable application store read');
    assert.equal((await outcome).error?.name, 'AbortError');
  } finally { release(); }
  await delay(0);
  assert.equal(f.store.searchChats('copper').length, 0, 'a late lookup cannot publish after shutdown');
  assert.equal(f.jobs().length, 1, 'cancelled publication remains durable pending work');
  assert.equal(f.nativeReads, 0);
});

test('bounded backfill resumes within a native page and eventually reaches the oldest session without starvation', async t => {
  const f = await fixture(t), native = nativeInventory(f);
  const slices = await drainBoundedBackfill(native.history, f.project.id);
  assert.ok(slices.length > 1);
  assert.equal(slices.at(-1).status, 'complete');
  assert.deepEqual([...native.messageReads].sort(), native.rows.map(row => [row.id, 1]).sort(),
    'stable page checkpoints skip already committed messages across bounded invocations');
  assert.equal(f.store.openCodeCoverage()[0].sessions, 7);
  assert.equal(f.store.searchChats('ses_native_300')[0].session, 'ses_native_300');
  assert.equal(native.routes.some(route => route.includes('prompt')), false, 'background reconciliation never sends or replays prompts');
});

test('a changed head boundary bucket invalidates successful page IDs beyond the native visible prefix', async t => {
  const f = await fixture(t), native = nativeInventory(f);
  for (const row of native.rows.slice(0, 6)) row.time.updated = row.time.archived = 900;
  const partial = await native.history.backfillOpenCode({ projectID: f.project.id, resume: false, pageSize: 5, maxSessions: 2 });
  assert.equal(partial.results[0].status, 'partial');
  const capturedID = [...native.messageReads.keys()][0];
  native.bodies.set(capturedID, 'reconciled zircon transcript after boundary insertion');
  native.rows.push({ id: 'ses_a_boundary_insert', title: 'Boundary insertion', directory: f.project.directory,
    time: { created: 100, updated: 900, archived: 900 } });
  native.bodies.set('ses_a_boundary_insert', 'inserted topaz transcript');
  const slices = await drainBoundedBackfill(native.history, f.project.id);
  assert.equal(slices.at(-1).status, 'complete');
  assert.ok(native.messageReads.get(capturedID) >= 2, 'expanded head signature clears the previous successful-ID cache');
  assert.equal(f.store.searchChats('zircon')[0].session, capturedID);
  assert.equal(f.store.searchChats('topaz')[0].session, 'ses_a_boundary_insert');
  assert.equal(f.store.openCodeCoverage()[0].sessions, 8);
});

test('periodic reconciliation aborts a held native page at its deadline and preserves a durable partial checkpoint', async t => {
  const f = await fixture(t);
  const scheduleTimer = globalThis.setTimeout;
  let scheduledReconciliations = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => {
    // Advance the minute-long polling cadence; keep its 100ms read deadline real.
    if (milliseconds === 60_000) {
      scheduledReconciliations++;
      return scheduleTimer(callback, 10, ...args);
    }
    return scheduleTimer(callback, milliseconds, ...args);
  });
  let holding = false, entered, aborted;
  const enteredPage = new Promise(resolve => { entered = resolve; });
  const abortedPage = new Promise(resolve => { aborted = resolve; });
  const history = f.createHistory({ nativeRequest: async (route, options) => {
    assert.equal(new URL(route, 'http://native-fixture').pathname, '/experimental/session');
    assert.equal(options.responseMetadata, true);
    if (!holding) return { body: [], metadata: { 'x-next-cursor': null } };
    entered();
    return new Promise((_resolve, reject) => {
      const abort = () => { aborted(options.signal); reject(options.signal.reason); };
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    });
  } });
  const coordinator = createOpenCodeEventCoordinator({ history,
    store: { read: async () => ({ projects: [f.project] }) },
    host: { events: async (_directory, signal) => new ReadableStream({ start(controller) {
      if (signal.aborted) controller.close();
      else signal.addEventListener('abort', () => controller.close(), { once: true });
    } }) },
    reconciliationIntervalMs: 60_000, reconciliationMaxDurationMs: 100,
    reconciliationPageSize: 5, reconciliationMaxPages: 8, reconciliationMaxSessions: 2,
    projectRefreshMs: 60_000 });
  coordinator.start();
  try {
    await within(coordinator.flush(), 2000, 'startup reconciliation did not finish its empty native fixture');
    holding = true;
    await within(enteredPage, 2000, 'periodic reconciliation did not start its bounded native page');
    const signal = await within(abortedPage, 2000, 'the reconciliation deadline did not abort its held native read');
    assert.equal(signal.aborted, true);
    assert.ok(scheduledReconciliations > 0);
  } finally { await coordinator.stop(); }
  f.raw(db => {
    const checkpoint = db.prepare(`SELECT r.status,c.state,c.cursor_json FROM opencode_ingest_cursors c
      JOIN opencode_ingest_runs r ON r.run_id=c.latest_run_id WHERE c.project_id=?`).get(f.project.id);
    assert.equal(checkpoint.status, 'partial');
    assert.equal(checkpoint.state, 'incomplete');
    assert.equal(JSON.parse(checkpoint.cursor_json).contract, 'opencode-updated-v1');
  });
  assert.equal(f.store.searchChats('deadline').length, 0);
  assert.equal(f.jobs().length, 0, 'an unread page never produces invented derivation work');
});

test('failed derivation stays pending across service recreation and retries captured inputs with bounded delay', async t => {
  const f = await fixture(t);
  f.capture('retryable lavender evidence');
  const history = f.createHistory();
  f.raw(db => db.exec(`CREATE TRIGGER fixture_reject_chat_projection BEFORE INSERT ON chat_search_state
    BEGIN SELECT RAISE(ABORT, 'fixture publication unavailable'); END`));
  const failure = await history.processWarehouseDerivationJobs({ limit: 10 });
  assert.equal(failure.failed, 1);
  assert.equal(failure.completed, 0);
  const failedRow = f.raw(db => db.prepare('SELECT * FROM opencode_derivation_jobs').get());
  assert.ok(failedRow);
  assert.ok(failedRow.attempts >= 1);
  assert.equal(failedRow.status, 'pending');
  assert.ok(failedRow.next_attempt_at > failedRow.updated_at, 'failed work receives positive retry backoff');
  assert.ok(failedRow.next_attempt_at - failedRow.updated_at <= 60_000, 'retry backoff stays bounded');
  assert.doesNotMatch(failedRow.error, /fixture publication unavailable/, 'durable failures retain safe error metadata');
  assert.ok(f.jobs({ includeDeferred: true }).some(row => row.id === failedRow.job_id && row.attempts === failedRow.attempts));
  assert.equal(f.store.searchChats('lavender').length, 0);
  f.raw(db => {
    assert.equal(db.prepare('SELECT count(*) AS n FROM session_headers').get().n, 0, 'failed atomic publication rolls back remembered headers too');
    db.exec('DROP TRIGGER fixture_reject_chat_projection');
  });
  f.store.maintainIndex('reset');
  const afterRepair = f.jobs({ includeDeferred: true })[0];
  assert.equal(afterRepair.attempts, failedRow.attempts, 'index repair preserves failed-attempt history');
  assert.equal(afterRepair.nextAttemptAt, failedRow.next_attempt_at, 'index repair preserves retry backoff');
  assert.equal(afterRepair.error, failedRow.error);
  await history.close(); f.reopen();
  const recoveredHistory = f.createHistory();
  let completed = 0;
  const deadline = Date.now() + 10_000;
  while (!completed && Date.now() < deadline) {
    const result = await recoveredHistory.processWarehouseDerivationJobs({ limit: 10 });
    completed += result.completed;
    if (!completed) await delay(50);
  }
  assert.equal(completed, 1, 'failed derivation becomes retryable after bounded backoff');
  assert.equal(f.store.searchChats('lavender')[0].session, f.session.id);
  assert.equal(f.jobs().length, 0);
  assert.equal(f.nativeReads, 0);
});

test('cumulative retained windows exceeding the byte budget block metadata-only and preserve the last safe search projection', async t => {
  const f = await fixture(t), active = { ...f.session, time: { created: 100, updated: 500 } };
  f.capture('last safe ivory transcript', { session: active, snapshotCompleteness: 'partial', snapshotProof: null });
  assert.equal(f.store.publishWarehouseDerivationJob(f.jobs()[0]).status, 'complete');
  const window = (prefix, marker) => Array.from({ length: 10 }, (_, index) => ({
    info: { id: `msg_${prefix}_${index}`, sessionID: active.id, role: 'assistant', time: { created: 200 + index } },
    parts: [{ id: `part_${prefix}_${index}`, type: 'text', text: `${marker} ${'x'.repeat(450_000)}` }],
  }));
  const first = window('first', 'apricot'), second = window('second', 'orchid');
  const byteLimit = 8 * 1024 * 1024;
  for (const messages of [first, second]) {
    assert.ok(Buffer.byteLength(JSON.stringify({ session: active, messages })) < byteLimit, 'each independent input window fits the byte budget');
    f.capture('', { session: active, messages, snapshotCompleteness: 'partial', snapshotProof: null, projectionSafe: true });
    if (messages === first) {
      assert.equal(f.store.publishWarehouseDerivationJob(f.jobs()[0]).status, 'complete');
      assert.equal(f.store.searchChats('apricot').length, 10);
    }
  }
  const blockedJob = f.jobs({ includeBlocked: true })[0];
  assert.equal(blockedJob.status, 'blocked');
  assert.equal(blockedJob.blockedReason, 'byte-limit');
  const snapshot = f.store.readWarehouseDerivationSnapshot(blockedJob);
  assert.equal(snapshot.status, 'blocked');
  assert.equal(snapshot.reason, 'byte-limit');
  assert.equal(snapshot.messageCount, 21);
  assert.ok(snapshot.retainedPayloadBytes > byteLimit);
  assert.equal(snapshot.messages, undefined, 'oversized exact payloads are not reconstructed into a giant snapshot');
  assert.equal(snapshot.session, undefined);
  assert.equal(f.store.publishWarehouseDerivationJob(blockedJob).status, 'blocked');
  assert.equal(f.store.searchChats('orchid').length, 0);
  assert.equal(f.store.searchChats('apricot').length, 10, 'blocked work retains the previously published exact search copy');
  assert.equal(f.store.searchChats('ivory')[0].session, active.id);
  f.raw(db => {
    assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_messages').get().n, 21, 'source pointers remain durable without truncation');
    const manifest = JSON.parse(db.prepare('SELECT manifest_json FROM opencode_derivation_jobs WHERE job_id=?').get(blockedJob.id).manifest_json);
    assert.equal(manifest.messageCount, 21);
    assert.ok(manifest.retainedPayloadBytes > byteLimit);
  });
});

test('cumulative membership above 5000 stays durable and blocked until a qualified bounded snapshot replaces it', async t => {
  const f = await fixture(t), active = { ...f.session, time: { created: 100, updated: 500 } };
  f.capture('bounded platinum projection', { session: active, snapshotCompleteness: 'partial', snapshotProof: null });
  assert.equal(f.store.publishWarehouseDerivationJob(f.jobs()[0]).status, 'complete');
  const messages = Array.from({ length: 5000 }, (_, index) => ({
    info: { id: `msg_union_${index}`, sessionID: active.id, role: 'assistant', time: { created: 200 + index } },
    parts: [{ id: `part_union_${index}`, type: 'text', text: 'oversized pewter window' }],
  }));
  f.capture('', { session: active, messages, snapshotCompleteness: 'partial', snapshotProof: null, projectionSafe: true });
  const blocked = f.jobs({ includeBlocked: true })[0];
  assert.equal(blocked.blockedReason, 'message-limit');
  const snapshot = f.store.readWarehouseDerivationSnapshot(blocked);
  assert.equal(snapshot.status, 'blocked');
  assert.equal(snapshot.messageCount, 5001);
  assert.equal(snapshot.messages, undefined);
  assert.equal(f.store.publishWarehouseDerivationJob(blocked).status, 'blocked');
  assert.equal(f.store.searchChats('pewter').length, 0);
  assert.equal(f.store.searchChats('platinum')[0].session, active.id);
  f.raw(db => {
    assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_messages').get().n, 5001);
    const manifest = JSON.parse(db.prepare('SELECT manifest_json FROM opencode_derivation_jobs WHERE job_id=?').get(blocked.id).manifest_json);
    assert.equal(manifest.messageCount, 5001);
    assert.equal(manifest.messageRefs, null, 'bounded jobs do not invent a truncated exact snapshot');
  });
  f.capture('qualified silver replacement');
  const replacement = f.jobs()[0];
  assert.equal(f.store.publishWarehouseDerivationJob(replacement).status, 'complete');
  assert.equal(f.store.searchChats('silver')[0].session, f.session.id);
  assert.equal(f.store.searchChats('platinum').length, 0);
  assert.equal(f.store.readWarehouseDerivationSnapshot(blocked).job.status, 'superseded');
  f.raw(db => assert.equal(db.prepare('SELECT count(*) AS n FROM opencode_messages').get().n, 1));
});

test('backup, restore and index repair preserve durable derivation and refresh work', async t => {
  const f = await fixture(t);
  f.capture('backup cobalt pending evidence');
  const job = f.jobs()[0], refresh = f.store.markWarehouseRefreshNeeded({ sourceID: f.source.sourceSystemID,
    projectID: f.project.id, sessionID: f.session.id, reason: 'manual' });
  f.store.maintainIndex('reset');
  assert.ok(f.jobs().some(row => row.id === job.id), 'index repair preserves durable captured work');
  assert.ok(f.store.listWarehouseRefreshNeeded({ sourceID: f.source.sourceSystemID }).some(row => row.id === refresh.id));
  const afterRepair = f.jobs()[0];
  f.store.close();
  const bundle = path.join(f.root, 'backup'), restored = path.join(f.root, 'restored');
  const backup = await backupLocalData(f.dataHome, bundle, { quiesced: true });
  assert.equal(backup.manifest.database.counts.opencode_derivation_jobs, 1);
  assert.equal(backup.manifest.database.counts.opencode_refresh_needed, 1);
  await restoreLocalData(bundle, restored, { quiesced: true });
  const recovered = createLocalDataStore(restored);
  try {
    const jobs = recovered.listWarehouseDerivationJobs({ sourceID: f.source.sourceSystemID, projectID: f.project.id, limit: 100 });
    assert.deepEqual(jobs.map(row => [row.id, row.revisionToken]), [[afterRepair.id, afterRepair.revisionToken]]);
    assert.deepEqual(recovered.listWarehouseRefreshNeeded({ sourceID: f.source.sourceSystemID }).map(row => [row.id, row.revision]), [[refresh.id, refresh.revision]]);
    assert.equal(recovered.publishWarehouseDerivationJob(jobs[0]).status, 'complete');
    assert.equal(recovered.searchChats('cobalt')[0].session, f.session.id);
    assert.equal(recovered.clearWarehouseRefreshNeeded(refresh).cleared, true);
  } finally { recovered.close(); }
});
