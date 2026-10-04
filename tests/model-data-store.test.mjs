import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertFreshRuntimeRoot, createLocalDataStore } from '../server/data/store.mjs';
import { createModelDataStore } from '../server/data/model-data.mjs';
import { LOCAL_DATA_SCHEMA_VERSION } from '../shared/data-contract.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-model-data-'));
  let store = createLocalDataStore(root);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, get store() { return store; }, reopen() { store.close(); store = createLocalDataStore(root); return store; } };
}

const snapshot = (retrievedAt, { name = 'Example Model', raw = { sourceText: 'source-owned' }, price = 0.25 } = {}) => ({
  schemaVersion: 1, source: 'modelsdev', retrievedAt,
  sourceReference: { url: 'https://models.dev/api.json', path: 'providers/example/models/example' },
  sourceMetadata: { version: 'fixture-v1', pages: 1 },
  quota: null,
  records: [{ id: 'modelsdev:example/example', kind: 'deployment', name, provider: 'example', modelID: 'example',
    aliases: ['documented-example'], identifiers: { providerID: 'example', modelID: 'example', canonicalModelID: 'example/canonical' },
    configuration: { contextWindow: 32000 }, sourceReference: { path: 'providers/example/models/example' },
    sourceDates: { publishedAt: '2026-09' }, raw,
    facts: [{ attribute: 'input-cost', value: price, units: 'USD / million tokens', scale: { denominator: 1_000_000 },
      configuration: { direction: 'input' }, sourceRef: { path: 'pricing.input' }, dates: { measuredAt: '2026-09' },
      identityMatch: { status: 'documented-alias', alias: 'example/canonical' } }],
  }],
});
const snapshotWithFacts = (retrievedAt, count, value = 0.5) => {
  const result = snapshot(retrievedAt, { price: value });
  result.records[0].facts = Array.from({ length: count }, (_, ordinal) => ({
    attribute: `fixture.measure.${ordinal}`, value, units: 'fixture-unit', scale: null,
    configuration: {}, sourceRef: { path: `/facts/${ordinal}` }, dates: { measuredAt: '2026-10' }, identityMatch: { status: 'unmatched' },
  }));
  return result;
};

test('schema 23 registers model-data durable tables in the existing SQLite lifecycle', async t => {
  const { store } = await fixture(t);
  const db = new DatabaseSync(store.info().filename, { readOnly: true });
  try {
    assert.equal(store.info().schemaVersion, LOCAL_DATA_SCHEMA_VERSION);
    const rows = db.prepare("SELECT table_name,lifecycle,owner,introduced_version FROM data_table_lifecycle WHERE owner='model-data' ORDER BY table_name").all();
    assert.deepEqual(rows.map(row => [row.table_name, row.lifecycle, row.introduced_version]), [
      ['model_data_facts','durable',23], ['model_data_records','durable',23], ['model_data_refresh_jobs','durable',23],
      ['model_data_secrets','durable',23], ['model_data_snapshots','durable',23], ['model_data_sources','durable',23],
    ]);
    const sources = store.modelDataStatus().sources;
    assert.deepEqual(sources.map(row => row.id).sort(), ['artificial-analysis','modelsdev']);
    assert.ok(sources.every(row => row.recordCount === 0 && row.current === null));
  } finally { db.close(); }
});

test('fresh-runtime guards allow only the exact unrefreshed source seed rows', async t => {
  const fresh = await fixture(t);
  assert.doesNotThrow(() => assertFreshRuntimeRoot(fresh.root, 'fresh-model-data'));
  assert.equal(fresh.store.initializeFreshRuntime('fresh-model-data').created, true);
  assert.doesNotThrow(() => assertFreshRuntimeRoot(fresh.root, 'fresh-model-data'));

  const changed = await fixture(t);
  changed.store.saveModelDataSourceStatus('modelsdev', { state: 'complete' });
  assert.throws(() => assertFreshRuntimeRoot(changed.root, 'fresh-model-data-dirty'), /unregistered data/);
  assert.throws(() => changed.store.initializeFreshRuntime('fresh-model-data-dirty'), /not empty/);
});

test('all retained active refresh jobs are enumerable and WAL checkpoint leases restore idempotently', async t => {
  const { store } = await fixture(t);
  const models = store.beginModelDataRefresh({ id: 'active-models', sources: ['modelsdev'] });
  const aa = store.beginModelDataRefresh({ id: 'active-aa', sources: ['artificial-analysis'] });
  assert.deepEqual(store.modelDataActiveJobs().jobs.map(job => job.id), [models.id, aa.id]);
  assert.equal(store.modelDataActiveJobs().truncated, false);

  const db = new DatabaseSync(':memory:');
  const modelStore = createModelDataStore(db, callback => callback());
  const original = db.prepare('PRAGMA wal_autocheckpoint').get().wal_autocheckpoint;
  const releaseFirst = modelStore.beginModelDataBackgroundWrite();
  const releaseSecond = modelStore.beginModelDataBackgroundWrite();
  assert.equal(db.prepare('PRAGMA wal_autocheckpoint').get().wal_autocheckpoint, 0);
  releaseFirst(); releaseFirst();
  assert.equal(db.prepare('PRAGMA wal_autocheckpoint').get().wal_autocheckpoint, 0);
  releaseSecond(); releaseSecond();
  assert.equal(db.prepare('PRAGMA wal_autocheckpoint').get().wal_autocheckpoint, original);
  db.close();
});

test('staged publication commits bounded batches while readers keep seeing the previous snapshot', async t => {
  const { store } = await fixture(t);
  const initial = store.beginModelDataRefresh({ id: 'staged-visible-initial', sources: ['modelsdev'] });
  const prior = store.publishModelDataSource(snapshot(100), { jobID: initial.id });
  store.finishModelDataRefresh(initial.id, { status: 'complete' });
  const next = store.beginModelDataRefresh({ id: 'staged-visible-next', sources: ['modelsdev'] });
  let firstBatch, release;
  const firstBatchReady = new Promise(resolve => { firstBatch = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const progress = [];
  const publication = store.modelDataPublishStaged(snapshotWithFacts(200, 1200), { jobID: next.id,
    async onProgress(event) {
      progress.push(event);
      if (progress.length === 1) { firstBatch(); await gate; }
    },
  });
  await firstBatchReady;
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, prior.snapshotID);
  assert.equal(store.modelDataList({}).records[0].snapshotID, prior.snapshotID,
    'committed staging rows remain invisible until the final pointer transaction');
  release();
  const published = await publication;
  assert.equal(published.snapshotID, `modelsdev:${published.contentSha256}`);
  assert.equal(store.modelDataList({}).records[0].snapshotID, published.snapshotID);
  assert.equal(store.modelDataDetail('modelsdev:example/example', { limit: 10 }).record.snapshotID, published.snapshotID);
  assert.deepEqual(progress.map(event => event.processedOperations), [1000, 1201]);
  assert.ok(progress.every(event => event.processedOperations <= event.totalOperations));
});

test('staged cancellation cleans only its own invisible rows and retains the prior publication', async t => {
  const { store } = await fixture(t);
  const initial = store.beginModelDataRefresh({ id: 'staged-cancel-initial', sources: ['modelsdev'] });
  const prior = store.publishModelDataSource(snapshot(100), { jobID: initial.id });
  store.finishModelDataRefresh(initial.id, { status: 'complete' });
  const next = store.beginModelDataRefresh({ id: 'staged-cancel-next', sources: ['modelsdev'] });
  const controller = new AbortController();
  await assert.rejects(store.modelDataPublishStaged(snapshotWithFacts(200, 1200), { jobID: next.id, signal: controller.signal,
    async onProgress() { controller.abort(new DOMException('cancel fixture', 'AbortError')); },
  }), { name: 'AbortError' });
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, prior.snapshotID);
  const db = new DatabaseSync(store.info().filename, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM model_data_snapshots WHERE publication_status='staging'").get().n, 0);
    assert.equal(store.modelDataList({}).records[0].snapshotID, prior.snapshotID);
  } finally { db.close(); }
});

test('generation changes fence and clean an older staged publisher', async t => {
  const { store } = await fixture(t);
  const initial = store.beginModelDataRefresh({ id: 'staged-fence-initial', sources: ['modelsdev'] });
  const prior = store.publishModelDataSource(snapshot(100), { jobID: initial.id });
  store.finishModelDataRefresh(initial.id, { status: 'complete' });
  const stale = store.beginModelDataRefresh({ id: 'staged-fence-stale', sources: ['modelsdev'] });
  let firstBatch, release;
  const firstBatchReady = new Promise(resolve => { firstBatch = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const publication = store.modelDataPublishStaged(snapshotWithFacts(200, 1200), { jobID: stale.id,
    async onProgress() { firstBatch(); await gate; },
  });
  await firstBatchReady;
  store.beginModelDataRefresh({ id: 'staged-fence-winner', sources: ['modelsdev'] });
  release();
  await assert.rejects(publication, { status: 409 });
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, prior.snapshotID);
  const db = new DatabaseSync(store.info().filename, { readOnly: true });
  try { assert.equal(db.prepare("SELECT count(*) AS n FROM model_data_snapshots WHERE publication_status='staging'").get().n, 0); }
  finally { db.close(); }
});

test('a superseding generation can publish identical content while the old stage is held', async t => {
  const { store } = await fixture(t);
  const initial = store.beginModelDataRefresh({ id: 'same-stage-initial', sources: ['modelsdev'] });
  store.publishModelDataSource(snapshot(100), { jobID: initial.id });
  store.finishModelDataRefresh(initial.id, { status: 'complete' });
  const stale = store.beginModelDataRefresh({ id: 'same-stage-stale', sources: ['modelsdev'] });
  let firstBatch, release;
  const firstBatchReady = new Promise(resolve => { firstBatch = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const identical = snapshotWithFacts(200, 1200);
  const stalePublish = store.modelDataPublishStaged(identical, { jobID: stale.id,
    async onProgress() { firstBatch(); await gate; },
  });
  await firstBatchReady;

  const winner = store.beginModelDataRefresh({ id: 'same-stage-winner', sources: ['modelsdev'] });
  const winnerPublish = await store.modelDataPublishStaged(identical, { jobID: winner.id });
  assert.equal(winnerPublish.deduplicated, false);
  assert.equal(store.modelDataDetail('modelsdev:example/example', { limit: 1 }).record.snapshotID, winnerPublish.snapshotID);
  assert.equal(store.modelDataList({}).records[0].snapshotID, winnerPublish.snapshotID);

  release();
  await assert.rejects(stalePublish, { status: 409 });
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, winnerPublish.snapshotID);
  assert.equal(store.modelDataDetail('modelsdev:example/example', { limit: 10 }).factsTruncated, true);
});

test('startup recovery can explicitly remove orphaned staging owned by an interrupted refresh', async t => {
  const { store } = await fixture(t);
  const job = store.beginModelDataRefresh({ id: 'staging-recovery', sources: ['modelsdev'] });
  const db = new DatabaseSync(store.info().filename);
  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare(`INSERT INTO model_data_snapshots(snapshot_id,source,content_sha256,schema_version,retrieved_at,
      source_reference_json,metadata_json,record_count,publication_status,job_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('modelsdev:staging:orphan', 'modelsdev', 'a'.repeat(64), 1, 100,
        '{}', '{}', 0, 'staging', job.id, 100);
    db.prepare(`INSERT INTO model_data_records(record_key,snapshot_id,source,record_id,kind,name,normalized_name,
      provider,model_id,aliases_json,identifiers_json,configuration_json,source_reference_json,source_dates_json,
      field_presence_json,raw_json,identity_status,search_text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('orphan-record-key', 'modelsdev:staging:orphan', 'modelsdev', 'modelsdev:orphan', 'model', 'Orphan', 'orphan',
        null, null, '[]', '{}', '{}', '{}', '{}', '{}', '{}', 'unmatched', '');
    const fact = db.prepare(`INSERT INTO model_data_facts(fact_id,record_key,ordinal,attribute,value_json,value_text,value_number,
      units,scale_json,configuration_json,source_ref_json,dates_json,identity_match_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (let ordinal = 0; ordinal < 2501; ordinal++) fact.run(`orphan-fact-${ordinal}`, 'orphan-record-key', ordinal,
      `fixture.${ordinal}`, '0', '0', 0, null, null, '{}', '{}', '{}', '{}');
    db.exec('COMMIT');
  } finally { db.close(); }
  assert.deepEqual(store.modelDataStagingJobs(), { jobs: [], truncated: false }, 'active jobs are not cleaned while their worker may still be alive');
  store.beginModelDataRefresh({ id: 'staging-recovery-newer', sources: ['modelsdev'] });
  assert.deepEqual(store.modelDataStagingJobs(), {
    jobs: [{ jobID: job.id, status: 'running', sources: ['modelsdev'] }], truncated: false,
  }, 'a running job superseded by a newer source owner is still recognized as an orphan candidate');
  store.finishModelDataRefresh(job.id, { status: 'interrupted' });
  assert.deepEqual(store.modelDataStagingJobs(), { jobs: [{ jobID: job.id, status: 'interrupted', sources: ['modelsdev'] }], truncated: false });
  let ticks = 0, heartbeatActive = true;
  const heartbeat = () => { ticks++; if (heartbeatActive) setImmediate(heartbeat); };
  setImmediate(heartbeat);
  assert.deepEqual(await store.modelDataCleanupStaging(job.id), { jobID: job.id, removedSnapshots: 1 });
  heartbeatActive = false;
  assert.ok(ticks >= 2, 'cleanup yields to other event-loop work between committed delete batches');
  assert.deepEqual(await store.modelDataCleanupStaging(job.id), { jobID: job.id, removedSnapshots: 0 });
  assert.deepEqual(store.modelDataStagingJobs(), { jobs: [], truncated: false });
});

test('obsolete snapshot cleanup yields in bounded batches and preserves current provenance and cursors', async t => {
  const { store } = await fixture(t);
  const oldModelsJob = store.beginModelDataRefresh({ id: 'obsolete-models', sources: ['modelsdev'] });
  const oldModels = snapshotWithFacts(100, 2501);
  oldModels.records.push(...Array.from({ length: 1001 }, (_, index) => ({
    ...oldModels.records[0], id: `modelsdev:example/obsolete-${index}`, modelID: `obsolete-${index}`, facts: [],
  })));
  const obsoleteModels = store.publishModelDataSource(oldModels, { jobID: oldModelsJob.id });
  store.finishModelDataRefresh(oldModelsJob.id, { status: 'complete' });
  const oldAAJob = store.beginModelDataRefresh({ id: 'obsolete-aa', sources: ['artificial-analysis'] });
  const oldAA = { ...snapshot(100), source: 'artificial-analysis', records: [
    { ...snapshot(100).records[0], id: 'artificial-analysis:configuration:obsolete-one' },
    { ...snapshot(100).records[0], id: 'artificial-analysis:configuration:obsolete-two' },
  ] };
  const obsoleteAA = store.publishModelDataSource(oldAA, { jobID: oldAAJob.id });
  store.finishModelDataRefresh(oldAAJob.id, { status: 'complete' });

  const currentModelsJob = store.beginModelDataRefresh({ id: 'kept-models', sources: ['modelsdev'] });
  const currentModels = snapshotWithFacts(200, 3, 0.75);
  currentModels.records.push({ ...currentModels.records[0], id: 'modelsdev:example/second', modelID: 'second' });
  store.publishModelDataSource(currentModels, { jobID: currentModelsJob.id });
  store.finishModelDataRefresh(currentModelsJob.id, { status: 'complete' });
  const currentAAJob = store.beginModelDataRefresh({ id: 'kept-aa', sources: ['artificial-analysis'] });
  store.publishModelDataSource({ ...oldAA, retrievedAt: 200, records: [
    { ...oldAA.records[0], id: 'artificial-analysis:configuration:kept-one', name: 'Kept AA' },
  ] }, { jobID: currentAAJob.id });
  store.finishModelDataRefresh(currentAAJob.id, { status: 'complete' });
  store.saveModelDataSourceStatus('modelsdev', { quota: { requestTimes: [200], remaining: 7 }, metadata: { configured: true } });
  store.saveModelDataSecret('artificial-analysis', 'dpapi-current-user:v1:dGVzdC1jaXBoZXJ0ZXh0');
  store.saveDraft('kept-project', 'kept-draft', 'Keep the unrelated draft.', 0);

  const statusBefore = store.modelDataStatus();
  const firstPage = store.modelDataList({ limit: 1 });
  const nextPage = store.modelDataList({ limit: 1, cursor: firstPage.nextCursor });
  const firstDetail = store.modelDataDetail('modelsdev:example/example', { limit: 1 });
  const nextDetail = store.modelDataDetail('modelsdev:example/example', { limit: 1, cursor: firstDetail.nextCursor });
  assert.ok(firstPage.nextCursor);
  assert.ok(firstDetail.nextCursor);
  const db = new DatabaseSync(store.info().filename, { readOnly: true });
  const obsoleteIDs = [obsoleteModels.snapshotID, obsoleteAA.snapshotID];
  const remaining = () => ({
    facts: db.prepare(`SELECT count(*) AS n FROM model_data_facts f JOIN model_data_records r USING(record_key)
      WHERE r.snapshot_id IN (?,?)`).get(...obsoleteIDs).n,
    records: db.prepare('SELECT count(*) AS n FROM model_data_records WHERE snapshot_id IN (?,?)').get(...obsoleteIDs).n,
  });
  const jobsBefore = db.prepare('SELECT * FROM model_data_refresh_jobs ORDER BY job_id').all();
  const currentSnapshotsBefore = db.prepare(`SELECT p.* FROM model_data_snapshots p JOIN model_data_sources s
    ON s.current_snapshot_id=p.snapshot_id ORDER BY p.source`).all();
  const observations = [remaining()];
  let heartbeatActive = true, concurrentCleanupCheck;
  const heartbeat = () => {
    observations.push(remaining());
    if (!concurrentCleanupCheck) {
      assert.throws(() => store.beginModelDataRefresh({ id: 'cleanup-concurrent-refresh', sources: ['modelsdev'] }), { status: 409 });
      concurrentCleanupCheck = assert.rejects(store.modelDataCleanupObsoleteSnapshots(), { status: 409 });
    }
    if (heartbeatActive) setImmediate(heartbeat);
  };
  try {
    setImmediate(heartbeat);
    assert.deepEqual(await store.modelDataCleanupObsoleteSnapshots(), {
      removedSnapshots: 2, removedRecords: 1004, removedFacts: 2503,
    });
    heartbeatActive = false;
    await new Promise(resolve => setImmediate(resolve));
    await concurrentCleanupCheck;
    assert.ok(observations.length >= 5, 'cleanup yields to readers between committed deletion batches');
    for (let index = 1; index < observations.length; index++) {
      assert.ok(observations[index - 1].facts - observations[index].facts <= 1000, 'a fact deletion batch stays bounded');
      assert.ok(observations[index - 1].records - observations[index].records <= 1000, 'a record deletion batch stays bounded');
    }
    assert.deepEqual(remaining(), { facts: 0, records: 0 });
    assert.deepEqual(store.modelDataStatus(), statusBefore);
    assert.deepEqual(store.modelDataList({ limit: 1 }), firstPage);
    assert.deepEqual(store.modelDataList({ limit: 1, cursor: firstPage.nextCursor }), nextPage);
    assert.deepEqual(store.modelDataDetail('modelsdev:example/example', { limit: 1 }), firstDetail);
    assert.deepEqual(store.modelDataDetail('modelsdev:example/example', { limit: 1, cursor: firstDetail.nextCursor }), nextDetail);
    assert.deepEqual(db.prepare('SELECT * FROM model_data_refresh_jobs ORDER BY job_id').all(), jobsBefore);
    assert.deepEqual(db.prepare(`SELECT p.* FROM model_data_snapshots p JOIN model_data_sources s
      ON s.current_snapshot_id=p.snapshot_id ORDER BY p.source`).all(), currentSnapshotsBefore);
    assert.equal(store.modelDataSecret('artificial-analysis'), 'dpapi-current-user:v1:dGVzdC1jaXBoZXJ0ZXh0');
    assert.equal(store.draft('kept-project', 'kept-draft').text, 'Keep the unrelated draft.');
    assert.deepEqual(await store.modelDataCleanupObsoleteSnapshots(), { removedSnapshots: 0, removedRecords: 0, removedFacts: 0 });
    assert.equal(db.prepare('PRAGMA foreign_key_check').get(), undefined);
  } finally { heartbeatActive = false; db.close(); }
});

test('obsolete snapshot cleanup refuses active refreshes and existing staging without changing publications', async t => {
  const { store } = await fixture(t);
  const initial = store.beginModelDataRefresh({ id: 'obsolete-refusal-initial', sources: ['modelsdev'] });
  const previous = store.publishModelDataSource(snapshot(100), { jobID: initial.id });
  store.finishModelDataRefresh(initial.id, { status: 'complete' });
  const next = store.beginModelDataRefresh({ id: 'obsolete-refusal-next', sources: ['modelsdev'] });
  await assert.rejects(store.modelDataCleanupObsoleteSnapshots(), /active model data refresh/);
  store.finishModelDataRefresh(next.id, { status: 'cancelling' });
  await assert.rejects(store.modelDataCleanupObsoleteSnapshots(), /active model data refresh/);
  store.finishModelDataRefresh(next.id, { status: 'cancelled' });
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, previous.snapshotID);

  const db = new DatabaseSync(store.info().filename);
  try {
    db.prepare(`INSERT INTO model_data_snapshots(snapshot_id,source,content_sha256,schema_version,retrieved_at,
      source_reference_json,metadata_json,record_count,publication_status,job_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run('modelsdev:staging:refusal', 'modelsdev', 'b'.repeat(64), 1, 100,
        '{}', '{}', 0, 'staging', next.id, 100);
    await assert.rejects(store.modelDataCleanupObsoleteSnapshots(), /Clean up model data staging/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM model_data_snapshots').get().n, 2);
    assert.equal(store.modelDataDetail('modelsdev:example/example').facts[0].value, 0.25);
    assert.deepEqual(await store.modelDataCleanupStaging(next.id), { jobID: next.id, removedSnapshots: 1 });
    assert.deepEqual(await store.modelDataCleanupObsoleteSnapshots(), { removedSnapshots: 0, removedRecords: 0, removedFacts: 0 });
    const unownedID = 'modelsdev:unowned-obsolete';
    db.prepare(`INSERT INTO model_data_snapshots(snapshot_id,source,content_sha256,schema_version,retrieved_at,
      source_reference_json,metadata_json,record_count,publication_status,job_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(unownedID, 'modelsdev', 'c'.repeat(64), 1, 100,
        '{}', '{}', 0, 'complete', null, 100);
    await assert.rejects(store.modelDataCleanupObsoleteSnapshots(), error => {
      assert.equal(error.status, 409);
      assert.deepEqual(error.cleanup, { removedSnapshots: 0, removedRecords: 0, removedFacts: 0 });
      return /no retained refresh job/.test(error.message);
    });
    assert.equal(db.prepare('SELECT publication_status FROM model_data_snapshots WHERE snapshot_id=?').get(unownedID).publication_status, 'complete',
      'a nullable owner cannot become staging that the existing recovery API cannot address');
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare('UPDATE model_data_snapshots SET job_id=? WHERE snapshot_id=?').run('missing-refresh-job', unownedID);
    await assert.rejects(store.modelDataCleanupObsoleteSnapshots(), /no retained refresh job/);
    assert.equal(db.prepare('SELECT publication_status FROM model_data_snapshots WHERE snapshot_id=?').get(unownedID).publication_status, 'complete',
      'a missing owner is rejected before any child deletion or staging transition');
    assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, previous.snapshotID);
    assert.equal(store.modelDataDetail('modelsdev:example/example').facts[0].value, 0.25);
    db.prepare('DELETE FROM model_data_snapshots WHERE snapshot_id=?').run(unownedID);
    db.exec('PRAGMA foreign_keys=ON');
    assert.equal(db.prepare('PRAGMA foreign_key_check').get(), undefined);
  } finally { db.close(); }
});

test('interrupted obsolete deletion remains invisible and recoverable when another store begins a refresh', async t => {
  const { root, store } = await fixture(t);
  const previousJob = store.beginModelDataRefresh({ id: 'obsolete-interrupted-previous', sources: ['modelsdev'] });
  const previous = store.publishModelDataSource(snapshotWithFacts(100, 2501), { jobID: previousJob.id });
  store.finishModelDataRefresh(previousJob.id, { status: 'complete' });
  const currentJob = store.beginModelDataRefresh({ id: 'obsolete-interrupted-current', sources: ['modelsdev'] });
  const current = store.publishModelDataSource(snapshot(200), { jobID: currentJob.id });
  store.finishModelDataRefresh(currentJob.id, { status: 'complete' });
  const otherStore = createLocalDataStore(root);
  const db = new DatabaseSync(store.info().filename, { readOnly: true });
  let newerJob;
  try {
    setImmediate(() => { newerJob = otherStore.beginModelDataRefresh({ id: 'obsolete-interrupted-newer', sources: ['modelsdev'] }); });
    await assert.rejects(store.modelDataCleanupObsoleteSnapshots(), error => {
      assert.equal(error.status, 409);
      assert.deepEqual(error.cleanup, { removedSnapshots: 0, removedRecords: 0, removedFacts: 1000 });
      return /active model data refresh/.test(error.message);
    });
    assert.ok(newerJob);
    assert.equal(db.prepare('SELECT publication_status FROM model_data_snapshots WHERE snapshot_id=?').get(previous.snapshotID).publication_status, 'staging');
    assert.equal(db.prepare(`SELECT count(*) AS n FROM model_data_facts f JOIN model_data_records r USING(record_key)
      WHERE r.snapshot_id=?`).get(previous.snapshotID).n, 1501);
    assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').currentSnapshotID, current.snapshotID);
    assert.equal(store.modelDataDetail('modelsdev:example/example').facts[0].value, 0.25);
    store.finishModelDataRefresh(newerJob.id, { status: 'cancelled' });
    assert.deepEqual(store.modelDataStagingJobs().jobs.map(row => row.jobID), [previousJob.id]);
    assert.deepEqual(await store.modelDataCleanupStaging(previousJob.id), { jobID: previousJob.id, removedSnapshots: 1 });
    assert.deepEqual(await store.modelDataCleanupObsoleteSnapshots(), { removedSnapshots: 0, removedRecords: 0, removedFacts: 0 });
    assert.equal(db.prepare('PRAGMA foreign_key_check').get(), undefined);
  } finally { db.close(); otherStore.close(); }
});

test('source snapshots publish atomically, deduplicate by content, and retain immutable typed provenance', async t => {
  const { store } = await fixture(t);
  const firstJob = store.beginModelDataRefresh({ id: 'refresh-one', sources: ['modelsdev'], createdAt: 100 });
  const firstPayload = snapshot(200); firstPayload.sourceMetadata.requests = 1;
  const first = store.publishModelDataSource(firstPayload, { jobID: firstJob.id });
  assert.equal(first.recordCount, 1);
  store.finishModelDataRefresh(firstJob.id, { status: 'complete', updatedAt: 210, result: { summary: 'loaded' } });

  const duplicateJob = store.beginModelDataRefresh({ id: 'refresh-duplicate', sources: ['modelsdev'], createdAt: 300 });
  const duplicatePayload = snapshot(400); duplicatePayload.sourceMetadata.requests = 2;
  const duplicate = store.publishModelDataSource(duplicatePayload, { jobID: duplicateJob.id });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.snapshotID, first.snapshotID);
  store.finishModelDataRefresh(duplicateJob.id, { status: 'complete', updatedAt: 410 });
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').lastSuccessAt, 400,
    'unchanged content still records a successful retrieval time');

  const changedJob = store.beginModelDataRefresh({ id: 'refresh-changed', sources: ['modelsdev'], createdAt: 500 });
  const changed = store.publishModelDataSource(snapshot(600, { price: 0.5 }), { jobID: changedJob.id });
  assert.notEqual(changed.snapshotID, first.snapshotID);
  store.finishModelDataRefresh(changedJob.id, { status: 'complete', updatedAt: 610 });

  const page = store.modelDataList({ query: 'EXAMPLE/CANONICAL', kind: 'deployment', limit: 25 });
  assert.equal(page.records.length, 1);
  assert.equal(page.records[0].snapshotID, changed.snapshotID);
  assert.equal(page.records[0].identityStatus, 'unmatched', 'record identity is not inferred from a fact annotation');
  const detail = store.modelDataDetail(page.records[0].id);
  assert.equal(detail.facts[0].value, 0.5);
  assert.equal(detail.facts[0].subject, 'modelsdev:example/example');
  assert.equal(detail.facts[0].units, 'USD / million tokens');
  assert.equal(detail.facts[0].sourceRef.path, 'pricing.input');
  assert.equal(detail.facts[0].identityMatch.status, 'documented-alias');
  assert.equal(detail.record.fieldPresence.attributes['cost.output'].state, 'missing');
  assert.equal(detail.record.fieldPresence.categories.capabilities.state, 'missing');
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').current.contentSha256, changed.contentSha256);
});

test('a newer refresh generation fences stale publishers and failed refresh preserves the current snapshot', async t => {
  const { store } = await fixture(t);
  const initial = store.beginModelDataRefresh({ id: 'initial', sources: ['modelsdev'] });
  const published = store.publishModelDataSource(snapshot(200), { jobID: initial.id });
  store.finishModelDataRefresh(initial.id, { status: 'complete' });
  const stale = store.beginModelDataRefresh({ id: 'stale-writer', sources: ['modelsdev'] });
  const winner = store.beginModelDataRefresh({ id: 'winner', sources: ['modelsdev'] });
  assert.throws(() => store.publishModelDataSource(snapshot(300, { name: 'stale' }), { jobID: stale.id }), { status: 409 });
  store.saveModelDataSourceStatus('modelsdev', { state: 'failed', error: 'source unavailable', retryAt: 1234 }, winner.id);
  store.finishModelDataRefresh(winner.id, { status: 'failed', error: 'source unavailable' });
  const status = store.modelDataStatus().sources.find(row => row.id === 'modelsdev');
  assert.equal(status.currentSnapshotID, published.snapshotID);
  assert.equal(status.state, 'failed');
  assert.equal(store.modelDataList({}).records[0].name, 'Example Model');
});

test('the current refresh can coalesce an additional source without restarting existing source progress', async t => {
  const { store } = await fixture(t);
  const started = store.beginModelDataRefresh({ id: 'coalesced', sources: ['modelsdev'], createdAt: 100 });
  const originalGeneration = store.modelDataStatus().sources.find(row => row.id === 'modelsdev').generation;
  const expanded = store.beginModelDataRefresh({ id: 'coalesced', sources: ['modelsdev','artificial-analysis'], createdAt: 200 });
  assert.equal(expanded.id, started.id);
  assert.deepEqual(expanded.sources, ['modelsdev','artificial-analysis']);
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').generation, originalGeneration);
  assert.equal(expanded.status, 'running');
  store.publishModelDataSource({ ...snapshot(300), source: 'artificial-analysis', records: [
    { ...snapshot(300).records[0], id: 'artificial-analysis:configuration:uuid' },
  ] }, { jobID: expanded.id });
  store.finishModelDataRefresh(expanded.id, { status: 'partial', summary: 'one source failed' });
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'artificial-analysis').state, 'complete');
  assert.equal(store.modelDataStatus().sources.find(row => row.id === 'modelsdev').state, 'partial');
});

test('details disclose raw truncation while retaining the full raw record, and exact native identity matching stays bounded', async t => {
  const { store } = await fixture(t);
  const job = store.beginModelDataRefresh({ id: 'raw-detail', sources: ['modelsdev'] });
  const raw = { payload: 'x'.repeat(20_000) };
  const output = store.publishModelDataSource(snapshot(200, { raw }), { jobID: job.id });
  store.finishModelDataRefresh(job.id, { status: 'complete' });
  const detail = store.modelDataDetail('modelsdev:example/example');
  assert.equal(detail.record.raw, null);
  assert.equal(detail.record.rawTruncated, true);
  assert.ok(detail.record.rawBytes > 16 * 1024);
  const matches = store.modelDataNativeMatches({ providerID: 'example', modelID: 'example' });
  assert.equal(matches.records[0].id, 'modelsdev:example/example');
  assert.equal(matches.matching, 'exact-declared-identifier-or-documented-alias');
  const incompleteNativeIdentity = store.modelDataNativeMatches({ providerID: 'other', modelID: 'unrelated', nativeModel: {
    sourceIdentities: { modelsdev: { providerID: undefined, modelID: undefined, canonicalModelID: undefined } },
  } });
  assert.deepEqual(incompleteNativeIdentity.records, [], 'missing identity fields do not match arbitrary source rows');
  assert.ok(output.snapshotID);
});

test('native matches include only source-declared canonical facts linked from the matched deployment', async t => {
  const { store } = await fixture(t);
  const job = store.beginModelDataRefresh({ id: 'canonical-link', sources: ['modelsdev'] });
  const payload = snapshot(200);
  payload.records[0].modelID = 'native-deployment';
  payload.records[0].identifiers = { providerID: 'example', modelID: 'native-deployment', canonicalModelID: 'canonical/source-id' };
  payload.records[0].aliases = [];
  const canonical = {
    ...payload.records[0], id: 'modelsdev:model:canonical-source-id', kind: 'model', name: 'Source canonical model',
    provider: null, modelID: 'canonical/source-id', identifiers: { canonicalModelID: 'canonical/source-id' },
    facts: [{ attribute: 'benchmarks.0.score', value: 0.87, configuration: { harness: 'source-owned' } }],
  };
  payload.records.push(canonical, {
    ...canonical, id: 'modelsdev:model:unrelated-source-id', identifiers: { canonicalModelID: 'unrelated/source-id' }, modelID: 'unrelated/source-id',
  }, {
    ...payload.records[0], id: 'modelsdev:deployment:other:native-deployment', provider: 'other',
    identifiers: { providerID: 'other', modelID: 'native-deployment', canonicalModelID: 'canonical/source-id' },
  });
  store.publishModelDataSource(payload, { jobID: job.id });
  store.finishModelDataRefresh(job.id, { status: 'complete' });

  const native = { providerID: 'example', modelID: 'native-deployment' };
  const matches = store.modelDataNativeMatches(native);
  assert.deepEqual(matches.records.map(row => row.id), [payload.records[0].id, canonical.id]);
  assert.equal(matches.records[1].kind, 'model');
  assert.equal(store.modelDataDetail(matches.records[1].id).facts[0].value, 0.87);
  assert.deepEqual(store.modelDataNativeMatches(native, { limit: 1 }).records.map(row => row.id), [payload.records[0].id]);
  assert.equal(store.modelDataNativeMatches(native, { limit: 1 }).truncated, true);
  assert.deepEqual(store.modelDataNativeMatches({ providerID: 'missing', modelID: 'native-deployment' }).records, []);
  assert.deepEqual(store.modelDataNativeMatches({ providerID: 'missing', modelID: 'unrelated', nativeModel: {
    sourceAliases: { modelsdev: [payload.records[0].id] },
  } }).records.map(row => row.id), [payload.records[0].id, canonical.id], 'explicit deployment aliases retain their source-declared canonical dependency');
});

test('list cursors are invalidated when a published source snapshot changes', async t => {
  const { store } = await fixture(t);
  const initial = store.beginModelDataRefresh({ id: 'cursor-initial', sources: ['modelsdev'] });
  const value = snapshot(100);
  value.records.push({ ...value.records[0], id: 'modelsdev:example/second', name: 'Second Example', modelID: 'second' });
  store.publishModelDataSource(value, { jobID: initial.id });
  store.finishModelDataRefresh(initial.id, { status: 'complete' });

  const firstPage = store.modelDataList({ limit: 1 });
  assert.equal(firstPage.records.length, 1);
  assert.ok(firstPage.nextCursor);

  const next = store.beginModelDataRefresh({ id: 'cursor-next', sources: ['modelsdev'] });
  const changed = snapshot(200, { price: 0.5 });
  changed.records.push({ ...changed.records[0], id: 'modelsdev:example/second', name: 'Second Example', modelID: 'second' });
  store.publishModelDataSource(changed, { jobID: next.id });
  store.finishModelDataRefresh(next.id, { status: 'complete' });
  assert.throws(() => store.modelDataList({ limit: 1, cursor: firstPage.nextCursor }), /different criteria/);
});

test('Artificial Analysis matches only an explicitly declared source ID, not a bare slug', async t => {
  const { store } = await fixture(t);
  const job = store.beginModelDataRefresh({ id: 'aa-identity', sources: ['artificial-analysis'] });
  const aa = snapshot(200);
  const record = aa.records[0];
  store.publishModelDataSource({ ...aa, source: 'artificial-analysis', records: [{
    ...record, id: 'artificial-analysis:configuration:uuid-1', kind: 'configuration', provider: undefined,
    modelID: undefined, aliases: ['well-known-slug'], identifiers: { source: 'artificial-analysis', sourceID: 'uuid-1', slug: 'well-known-slug' },
  }] }, { jobID: job.id });
  store.finishModelDataRefresh(job.id, { status: 'complete' });
  assert.deepEqual(store.modelDataNativeMatches({ providerID: 'creator', modelID: 'well-known-slug' }).records, [],
    'creator and slug resemblance is not an identity assertion');
  const explicit = store.modelDataNativeMatches({ providerID: 'creator', modelID: 'well-known-slug', nativeModel: {
    sourceIdentities: { 'artificial-analysis': { id: 'uuid-1' } },
  } });
  assert.deepEqual(explicit.records.map(row => row.id), ['artificial-analysis:configuration:uuid-1']);
});

test('in-flight refresh receipt survives SQLite reopen for the service-level recovery guard', async t => {
  const fixtureValue = await fixture(t);
  const active = fixtureValue.store.beginModelDataRefresh({ id: 'interrupted-job', sources: ['modelsdev'] });
  assert.equal(active.status, 'running');
  const reopened = fixtureValue.reopen();
  const state = reopened.modelDataStatus();
  assert.equal(state.job.status, 'running');
  assert.equal(state.sources.find(row => row.id === 'modelsdev').state, 'running');
  assert.equal(state.sources.find(row => row.id === 'modelsdev').currentSnapshotID, null);
});

test('model data secrets store only opaque DPAPI ciphertext', async t => {
  const { store } = await fixture(t);
  const secret = 'dpapi-current-user:v1:dGVzdC1jaXBoZXJ0ZXh0';
  assert.equal(store.saveModelDataSecret('artificial-analysis', secret).saved, true);
  assert.equal(store.modelDataSecret('artificial-analysis'), secret);
  assert.throws(() => store.saveModelDataSecret('artificial-analysis', 'plaintext'), /DPAPI ciphertext/);
});
