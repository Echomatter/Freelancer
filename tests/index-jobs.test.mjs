import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createIndexJobs } from '../server/index-jobs.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';

const until = async condition => {
  for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Index job did not finish');
};
test('first-open indexing is scoped, sequential, and remembered only after both indexes succeed', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-index-jobs-'));
  const calls = [];
  let failChats = true;
  const app = { project: async id => { assert.equal(id, 'p'); return { id }; },
    rebuildContentIndex: async options => { calls.push(['files', options.projectID]); options.onProgress('Reading project files'); return { sources: 3, failures: [] }; },
    history: { rebuildChatSearch: async options => { calls.push(['chats', options.projectID]);
      return { conversations: 2, failures: failChats ? [{ project: 'p', error: 'Offline' }] : [] }; } } };
  let jobs = createIndexJobs({ app, backendRoot: root, dataRoot: root });
  t.after(async () => { await jobs.close(); await rm(root, { recursive: true, force: true }); });
  await jobs.start('prepare', 'p');
  await until(() => jobs.status().status !== 'running');
  assert.equal(jobs.status().status, 'partial');
  const db = createLocalDataStore(root);
  assert.equal(db.projectIndexesReady('p'), false);
  failChats = false;
  await jobs.start('prepare', 'p');
  await until(() => jobs.status().status === 'completed');
  assert.equal(db.projectIndexesReady('p'), true);
  assert.deepEqual(calls, [['files', 'p'], ['chats', 'p'], ['files', 'p'], ['chats', 'p']]);
  db.close();
  await jobs.close();
  jobs = createIndexJobs({ app, backendRoot: root, dataRoot: root });
  assert.equal(await jobs.start('prepare', 'p'), null, 'restart reuses completed setup');
  assert.equal(calls.length, 4);
});

test('index stop fences another operation and does not mark interrupted setup as ready', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-index-stop-'));
  let entered = false;
  const app = { project: async id => ({ id }), rebuildContentIndex: async ({ signal }) => {
    entered = true;
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    return { sources: 1, failures: [] };
  }, history: { rebuildChatSearch: async () => assert.fail('Cancelled preparation must not start another step') } };
  const jobs = createIndexJobs({ app, backendRoot: root, dataRoot: root });
  t.after(async () => { await jobs.close(); await rm(root, { recursive: true, force: true }); });
  const job = await jobs.start('prepare', 'p');
  await until(() => entered);
  await assert.rejects(jobs.start('optimize'), /Another index/);
  assert.throws(() => jobs.dismiss(job.id), /still running/);
  jobs.stop(job.id);
  await until(() => jobs.status().status === 'stopped');
  const db = createLocalDataStore(root);
  assert.equal(db.projectIndexesReady('p'), false);
  db.close();
  jobs.dismiss(job.id);
  assert.equal(jobs.status(), null);
});

test('published file indexes with extraction gaps stay reusable and complete with skipped files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-index-gaps-'));
  const jobs = createIndexJobs({ dataRoot: root, app: { project: async id => ({ id }),
    rebuildContentIndex: async () => ({ sources: 2, failures: [{ source: 'scan.pdf', error: 'PDF extractor unavailable' }] }),
    history: { rebuildChatSearch: async () => ({ conversations: 1, failures: [] }) } } });
  t.after(async () => { await jobs.close(); await rm(root, { recursive: true, force: true }); });
  await jobs.start('prepare', 'p');
  await until(() => jobs.status().status === 'completed');
  assert.match(jobs.status().label, /1 file skipped/);
  assert.equal(jobs.status().skipped, 1);
  assert.equal(await jobs.start('prepare', 'p'), null);
  assert.equal(jobs.status().failures[0].source, 'scan.pdf');
  const oldID = jobs.status().id;
  const retry = await jobs.start('prepare', 'p', oldID);
  assert.notEqual(retry.id, oldID, 'explicit Retry rebuilds even reusable partial coverage');
  await until(() => jobs.status().status === 'completed');
});

test('SQLite integrity findings are failures, and synchronous maintenance never offers a fake Stop', async () => {
  const jobs = createIndexJobs({ app: { history: { maintainIndex: async operation => ({ healthy: false, findings: [`${operation} failed`] }) } } });
  const job = await jobs.start('check');
  assert.equal(job.stoppable, false);
  assert.throws(() => jobs.stop(job.id), /cannot be stopped/);
  await until(() => jobs.status().status === 'failed');
  assert.match(jobs.status().label, /check failed/);
  await jobs.close();
});

test('clean index reset preserves drafts while replacing derived search tables transactionally', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-index-reset-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const store = createLocalDataStore(root);
  store.saveDraft('p', 'chat', 'keep this draft', 0);
  store.close();
  const db = new DatabaseSync(path.join(root, 'freelancer.sqlite'));
  db.exec("INSERT INTO content_meta VALUES('p','built_at_utc','now'); INSERT INTO content_sources(project_key,filename,virtual_path,container_path,extension,source_role,status,routing_rank,file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count) VALUES('p','a.md','a.md','a.md','.md','document','current',0,1,'now','x',0,'line','text','ok',0,0)");
  db.close();
  const reset = createLocalDataStore(root);
  assert.match(reset.maintainIndex('reset').message, /cleared/);
  reset.close();
  const reopened = createLocalDataStore(root);
  assert.equal(reopened.draft('p', 'chat').text, 'keep this draft');
  assert.equal(reopened.indexStats().fileProjects.length, 0);
  assert.equal(reopened.maintainIndex('check').healthy, true);
  reopened.close();
});
