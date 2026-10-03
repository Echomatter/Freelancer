import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createIndexJobs } from '../server/index-jobs.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createIndexJobState } from '../server/data/index-job-state.mjs';

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

test('putting a project away refreshes files and chats first and blocks later targeted index jobs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-archive-index-'));
  const calls = [];
  let archived = false;
  const app = {
    project: async id => ({ id, name: id }),
    rebuildContentIndex: async options => {
      calls.push(['files', options.projectID, options.includeArchivedProject]);
      return { sources: 4, failures: [] };
    },
    history: {
      isProjectArchived: async id => id === 'p' && archived,
      projectArchiveRevision: async () => 0,
      rebuildChatSearch: async options => {
        calls.push(['chats', options.projectID, options.includeArchivedProject]);
        return { conversations: 3, failures: [] };
      },
    },
  };
  const jobs = createIndexJobs({ app, dataRoot: root });
  t.after(async () => { await jobs.close(); await rm(root, { recursive: true, force: true }); });

  assert.deepEqual(await jobs.archiveProject('p', 0, async () => {
    calls.push(['archive', 'p']); archived = true; return { archived };
  }), { archived: true });
  assert.deepEqual(calls, [['files', 'p', true], ['chats', 'p', true], ['archive', 'p']]);
  assert.equal(jobs.status().kind, 'archive');
  assert.equal(jobs.status().status, 'completed');
  await assert.rejects(jobs.start('files', 'p'), /Restore this project/);
  await assert.rejects(jobs.start('chats', 'p'), /Restore this project/);
});

test('a failed final index leaves the project active and does not archive it', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-archive-index-failure-'));
  let archived = false;
  const app = {
    project: async id => ({ id }),
    rebuildContentIndex: async () => ({ sources: 1, failures: [] }),
    history: {
      isProjectArchived: async () => archived,
      projectArchiveRevision: async () => 0,
      rebuildChatSearch: async () => ({ conversations: 0, failures: [{ project: 'p', error: 'Native chat unavailable' }] }),
    },
  };
  const jobs = createIndexJobs({ app, dataRoot: root });
  t.after(async () => { await jobs.close(); await rm(root, { recursive: true, force: true }); });

  await assert.rejects(jobs.archiveProject('p', 0, async () => { archived = true; }), /0 conversations indexed/);
  assert.equal(archived, false);
  assert.equal(jobs.status().status, 'partial');
});

test('stopping the final archive index keeps the project active and never calls its commit', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-archive-index-stop-'));
  let entered = false, archived = false;
  const app = {
    project: async id => ({ id }),
    rebuildContentIndex: async ({ signal }) => {
      entered = true;
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      signal.throwIfAborted();
    },
    history: {
      isProjectArchived: async () => archived,
      projectArchiveRevision: async () => 0,
      rebuildChatSearch: async () => assert.fail('stop must fence chat indexing'),
    },
  };
  const jobs = createIndexJobs({ app, dataRoot: root });
  t.after(async () => { await jobs.close(); await rm(root, { recursive: true, force: true }); });
  const archive = jobs.archiveProject('p', 0, async () => { archived = true; });
  await until(() => entered);
  jobs.stop(jobs.status().id);
  await assert.rejects(archive, /stopped/);
  assert.equal(archived, false);
  assert.equal(jobs.status().status, 'stopped');
});

test('a commit conflict after successful final indexing leaves the project active', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-archive-index-commit-'));
  const calls = [];
  let archived = false;
  const app = {
    project: async id => ({ id }),
    rebuildContentIndex: async () => { calls.push('files'); return { sources: 1, failures: [] }; },
    history: {
      isProjectArchived: async () => archived,
      projectArchiveRevision: async () => 0,
      rebuildChatSearch: async () => { calls.push('chats'); return { conversations: 1, failures: [] }; },
    },
  };
  const jobs = createIndexJobs({ app, dataRoot: root });
  t.after(async () => { await jobs.close(); await rm(root, { recursive: true, force: true }); });
  await assert.rejects(jobs.archiveProject('p', 0, async () => { throw Error('archive revision changed'); }), /archive revision changed/);
  assert.deepEqual(calls, ['files', 'chats']);
  assert.equal(jobs.status().status, 'completed');
  assert.equal(archived, false);
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

test('index terminal results and dismissal survive restart without starting new work', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-index-durable-'));
  let calls = 0;
  const app = { project:async id=>({id}), rebuildContentIndex:async()=>{
    calls++; return {sources:2,failures:[{source:'scan.pdf',error:'Text unavailable'}]};
  } };
  let jobs = createIndexJobs({dataRoot:root,app});
  t.after(async()=>{await jobs.close();await rm(root,{recursive:true,force:true});});
  const started = await jobs.start('files','p');
  await until(()=>jobs.status().status==='completed');
  await jobs.close();
  jobs = createIndexJobs({dataRoot:root,app});
  assert.equal(jobs.status().id,started.id);
  assert.equal(jobs.status().status,'completed');
  assert.equal(jobs.status().failures[0].source,'scan.pdf');
  assert.equal(calls,1,'restart only reads the saved outcome');
  jobs.dismiss(started.id); await jobs.close();
  jobs = createIndexJobs({dataRoot:root,app});
  assert.equal(jobs.status(),null,'dismissal is durable');
  const db = new DatabaseSync(path.join(root,'freelancer.sqlite'),{readOnly:true});
  const saved=JSON.parse(db.prepare("SELECT data FROM operational_records WHERE collection='index-jobs' AND id=?").get(started.id).data);
  assert.ok(saved.dismissedAt,'dismissal keeps the historical outcome');
  db.close();
});

test('interrupted preparation retains checkpoints and resumes only after explicit retry',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-index-resume-'));
  const initial=createLocalDataStore(root); initial.close();
  const state=createIndexJobState(path.join(root,'freelancer.sqlite'),'standalone-index-jobs');
  const prior=state.save({id:'interrupted-job',kind:'prepare',project:'p',status:'running',step:'chats',
    ownerRunID:'previous-server',stoppable:true,createdAt:1,label:'Loading conversations',
    checkpoints:[{step:'files',complete:true,result:{sources:4,conversations:0,failures:[]}}]},null);
  const calls=[];
  const app={project:async id=>({id}),rebuildContentIndex:async()=>assert.fail('the completed files checkpoint is retained'),
    history:{rebuildChatSearch:async()=>{calls.push('chats');return {conversations:3,failures:[]};}}};
  const jobs=createIndexJobs({dataRoot:root,app});
  t.after(async()=>{await jobs.close();await rm(root,{recursive:true,force:true});});
  const recovered=jobs.status();
  assert.equal(recovered.status,'partial');assert.equal(recovered.interrupted,true);
  assert.equal(recovered.step,'chats');assert.equal(recovered.stoppable,false);
  assert.equal(calls.length,0,'loading an interrupted job does not resume it');
  const before=createLocalDataStore(root);assert.equal(before.projectIndexesReady('p'),false);before.close();
  const retried=await jobs.start('prepare','p',prior.id);
  assert.notEqual(retried.id,prior.id);assert.equal(retried.retryOf,prior.id);
  await until(()=>jobs.status().status==='completed');
  assert.deepEqual(calls,['chats']);assert.match(jobs.status().label,/4 files and 3 conversations/);
  const after=createLocalDataStore(root);assert.equal(after.projectIndexesReady('p'),true);after.close();
});

test('interrupted archive and SQLite jobs never replay an archive commit or maintenance',async t=>{
  for(const kind of ['archive','reset','compact']){
    const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-index-no-replay-'));
    const initial=createLocalDataStore(root);initial.close();
    const state=createIndexJobState(path.join(root,'freelancer.sqlite'),'standalone-index-jobs');
    state.save({id:kind,kind,project:kind==='archive'?'p':'',status:'running',ownerRunID:'previous-server',createdAt:1,
      label:'Running',stoppable:false,checkpoints:[]},null);
    const app={project:async()=>assert.fail('recovery must not alter projects'),
      rebuildContentIndex:async()=>assert.fail('recovery must not rebuild files'),
      history:{maintainIndex:async()=>assert.fail('recovery must not replay maintenance')}};
    const jobs=createIndexJobs({dataRoot:root,app});
    t.after(async()=>{await jobs.close();await rm(root,{recursive:true,force:true});});
    assert.equal(jobs.status().status,'partial');assert.equal(jobs.status().interrupted,true);
    assert.equal(jobs.isArchiving('p'),false,'an interrupted archive has no live commit reservation');
    if(kind==='archive')await assert.rejects(jobs.start('archive','p',kind),/Put project away/);
  }
});

test('running progress and stop failures persist and concurrent updates cannot overwrite newer state',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-index-progress-'));
  let entered=false;
  const app={project:async id=>({id}),rebuildContentIndex:async({onProgress,signal})=>{
    onProgress('Retained 20 sources');entered=true;
    await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();
  }};
  const jobs=createIndexJobs({dataRoot:root,app});
  t.after(async()=>{await jobs.close();await rm(root,{recursive:true,force:true});});
  const started=await jobs.start('files','p');await until(()=>entered);
  const state=createIndexJobState(path.join(root,'freelancer.sqlite'),'standalone-index-jobs');
  const progress=state.read();assert.equal(progress.label,'Retained 20 sources');assert.equal(progress.step,'files');
  assert.equal((await jobs.start('files','p')).id,started.id,'duplicate start shares the same live job');
  jobs.stop(started.id);await until(()=>jobs.status().status==='stopped');
  assert.equal(state.read().status,'stopped');assert.ok(state.read().failure);
  assert.throws(()=>state.save({...progress,label:'obsolete'},progress),/changed in another runtime/);
  assert.equal(state.read().status,'stopped');
});
