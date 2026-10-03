import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createKnowledgeQuery } from '../server/data/knowledge-query.mjs';
import { FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';

const directoryKey = directory => process.platform === 'win32' ? directory.toLowerCase() : directory;
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-query-'));
  const dataHome = path.join(root, 'data'), store = createLocalDataStore(dataHome);
  store.initializeFreshRuntime(FRESH_RUNTIME_ID);
  const projects = ['alpha', 'beta'].map(id => ({ id, directory: path.join(root, id) }));
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const db = new DatabaseSync(store.filename);
  try {
    const register = db.prepare('INSERT INTO project_registrations(runtime_id,project_id,data) VALUES(?,?,?)');
    for (const project of projects) register.run(FRESH_RUNTIME_ID, project.id, JSON.stringify(project));
    register.run('other-runtime', 'other', JSON.stringify({ id: 'other', directory: path.join(root, 'other') }));
    for (const [index, project] of [...projects, { id: 'other', directory: path.join(root, 'other') }].entries()) {
      const source = index + 1, name = index === 0 ? 'literal%_.md' : 'literalXY.md', key = directoryKey(project.directory);
      db.prepare(`INSERT INTO content_sources(source_id,project_key,filename,virtual_path,container_path,extension,source_role,status,
        routing_rank,file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,source_identity,revision_identity)
        VALUES(?,?,?,?,?,'.md','current_project_source','current',80,30,'2026-10-02','source-hash',1,'line','fixture','ok',30,4,?,?)`)
        .run(source, key, name, name, path.join(project.directory, name), `source:${project.id}`, `revision:${project.id}`);
      db.prepare('INSERT INTO content_units(unit_id,source_id,unit_no,locator,text,word_count,char_count,sha256) VALUES(?,?,0,\'L1\',?,4,30,\'unit-hash\')')
        .run(source, source, 'Café 日本語 amber observatory');
      db.prepare('INSERT INTO content_units_fts(rowid,project_key,filename,virtual_path,source_role,status,heading,locator,text) VALUES(?,?,?,?,?,?,\'\',\'L1\',?)')
        .run(source, key, name, name, 'current_project_source', 'current', 'Café 日本語 amber observatory');
    }
  } finally { db.close(); }
  for (const project of [...projects, { id: 'other' }]) {
    store.indexChat(project.id, { id: `session-${project.id}`, title: 'Observatory', time: { updated: 50 } }, [
      { info: { id: `message-${project.id}`, role: 'assistant', model: { providerID: 'fixture', modelID: 'model-a' } },
        parts: [{ type: 'text', text: 'Café 日本語 amber observatory' }] },
    ]);
    store.createMemory({ id: `memory-${project.id}`, kind: 'note', title: 'Observatory', body: 'Café 日本語 amber observatory',
      source: { projectID: project.id }, members: [{ kind: 'message', ref: 'message:one', locator: { providerID: 'fixture', modelID: 'model-a' } }] });
    store.addClaim({ id: `claim-${project.id}`, predicate: 'Café 日本語 amber observatory', origin: 'source-reported', epistemicState: 'supported',
      scope: { projectID: project.id }, modelProvider: 'fixture', modelID: 'model-a', evidence: [{ id: `memory:memory-${project.id}@1` }] });
  }
  let registry = projects;
  const service = createKnowledgeQuery({ data: store, getProjects: () => registry });
  return { root, dataHome, store, projects, service, setRegistry: value => { registry = value; } };
}

test('shared file and conversation queries resolve canonical current-runtime projects before limiting', async t => {
  const { service, projects, setRegistry } = await fixture(t);
  for (const domain of ['files', 'conversations']) {
    const global = await service.query({ domain, query: '日本語 observatory' });
    assert.deepEqual(global.results.map(row => row.projectID), ['alpha', 'beta']);
    assert.equal(global.filters.global, true);
    const scoped = await service.query({ domain, query: 'amber observatory', phrase: true, projectDirectory: projects[1].directory, limit: 1 });
    assert.equal(scoped.results[0].projectID, 'beta');
    assert.equal(scoped.truncated, false, 'project scope must precede LIMIT');
    const bounded = await service.query({ domain, query: 'observatory', limit: 1 });
    assert.equal(bounded.results[0].projectID, 'alpha');
    assert.equal(bounded.truncated, true);
  }
  setRegistry([projects[1]]);
  assert.deepEqual((await service.query({ domain: 'conversations', query: '日本語' })).results.map(row => row.projectID), ['beta'],
    'each query uses the current project registry');
});

test('shared filters retain literal source wildcards and Unicode phrase, model and pinned scope', async t => {
  const { service, store } = await fixture(t);
  const file = await service.query({ domain: 'files', query: '日本語 amber', phrase: true, source: '%_', role: 'current_project_source', status: 'current' });
  assert.deepEqual(file.results.map(row => row.projectID), ['alpha']);
  assert.equal((await service.query({ domain: 'files', query: 'amber 日本語', phrase: true })).results.length, 0);
  assert.equal((await service.query({ domain: 'conversations', query: '日本語', model: 'fixture/missing' })).results.length, 0);
  assert.equal((await service.query({ domain: 'memories', query: '日本語', model: 'fixture/missing' })).results.length, 0);
  store.setMemoryPin({ id: 'memory-beta', pinned: true, expectedRevision: 0 });
  const memory = await service.query({ domain: 'memories', query: '日本語 amber', phrase: true, model: 'fixture/model-a', pinnedOnly: true });
  assert.deepEqual(memory.results.map(row => row.id), ['memory-beta']);
  const exact = await service.query({ domain: 'memories', query: 'memory-beta', projectID: 'beta' });
  assert.equal(exact.results[0].projectID, 'beta');
  assert.equal((await service.query({ domain: 'memories', query: 'memory-beta', projectID: 'alpha' })).results.length, 0);
});

test('facts use common phrase matching, provider/model and epistemic filters with exact IDs', async t => {
  const { service, store } = await fixture(t);
  const facts = await service.query({ domain: 'facts', query: '日本語 amber', phrase: true, projectID: 'alpha',
    model: 'fixture/model-a', epistemicState: 'supported', origin: 'source-reported' });
  assert.deepEqual(facts.results.map(row => row.id), ['claim-alpha']);
  assert.equal((await service.query({ domain: 'facts', query: 'amber 日本語', phrase: true })).results.length, 0);
  assert.equal((await service.query({ domain: 'facts', query: '日本語', model: 'wrong/model-a' })).results.length, 0);
  assert.equal((await service.query({ domain: 'facts', query: 'claim-beta' })).results[0].id, 'claim-beta');
  assert.equal((await service.query({ domain: 'facts', query: '日本語', limit: 1 })).truncated, true);
  store.correctClaim({ id: 'claim-alpha', epistemicState: 'disputed', evidence: [{ id: 'source:updated' }] });
  assert.equal((await service.query({ domain: 'facts', query: 'claim-alpha' })).results.length, 0);
  assert.equal((await service.query({ domain: 'facts', query: 'claim-alpha', includeHistorical: true })).results[0].epistemicState, 'superseded');
});

test('unknown, mismatched and unsupported scopes fail before searching', async t => {
  const { service, projects } = await fixture(t);
  for (const input of [
    { domain: 'files', projectID: 'other' },
    { domain: 'files', projectID: 'alpha', projectDirectory: projects[1].directory },
    { domain: 'files', projectID: 'alpha', global: true },
    { domain: 'conversations', global: false },
    { domain: 'files', projectDirectory: 'relative' },
    { domain: 'files', model: 'fixture/model-a' },
    { domain: 'memories', source: 'notes.md' },
    { domain: 'facts', limit: 201 },
    { domain: 'facts', phrase: 'yes' },
    { domain: 'facts', query: 'x'.repeat(201) },
  ]) await assert.rejects(service.query(input), { status: 400 });
});

test('all four domains retain a 200-result boundary and report the overflow row', async t => {
  const { service, store, projects } = await fixture(t);
  const db = new DatabaseSync(store.filename);
  try {
    db.exec('BEGIN');
    const saveUnit=db.prepare('INSERT INTO content_units(unit_id,source_id,unit_no,locator,text,word_count,char_count,sha256) VALUES(?,1,?,?,?,2,12,\'unit-hash\')');
    const saveFTS=db.prepare('INSERT INTO content_units_fts(rowid,project_key,filename,virtual_path,source_role,status,heading,locator,text) VALUES(?,?,\'literal%_.md\',\'literal%_.md\',\'current_project_source\',\'current\',\'\',?,?)');
    for(let index=1;index<=200;index++) {
      saveUnit.run(index+10,index,`L${index+1}`,'日本語 amber');
      saveFTS.run(index+10,directoryKey(projects[0].directory),`L${index+1}`,'日本語 amber');
    }
    db.exec('COMMIT');
  } finally {db.close();}
  store.indexChat('alpha',{id:'many-messages',title:'Many',time:{updated:2}},Array.from({length:200},(_,index)=>({
    info:{id:`many-${index}`,role:'assistant',providerID:'fixture',modelID:'model-a'},parts:[{type:'text',text:'日本語 amber'}],
  })));
  for(let index=1;index<=200;index++) {
    store.createMemory({id:`many-memory-${index}`,kind:'note',title:'Many',body:'日本語 amber',source:{projectID:'alpha'}});
    store.addClaim({id:`many-claim-${index}`,predicate:'日本語 amber',value:index,origin:'source-reported',epistemicState:'supported',
      scope:{projectID:'alpha'},evidence:[{id:'source:many'}]});
  }
  for(const domain of ['files','conversations','memories','facts']) {
    const input={domain,query:'日本語 amber',projectID:'alpha',limit:200};
    const found=await service.query(input);
    assert.equal(found.results.length,200,`${domain} must not silently cap results at 100`);
    assert.equal(found.truncated,true,`${domain} preserves the overflow sentinel`);
    assert.equal(found.page.continuation,'available');
    assert.equal(found.page.consistency,'moving-index');
    assert.equal(found.page.returned,200);
    assert.equal(found.page.offset,0);
    assert.ok(found.nextCursor);
    const next=await service.query({...input,cursor:found.nextCursor});
    assert.equal(next.results.length,1,`${domain} continuation executes beyond the first 200 rows`);
    assert.equal(next.page.offset,200);
    assert.equal(next.truncated,false);
    assert.equal(next.nextCursor,null);
    assert.equal(next.page.continuation,'complete');
    const identity=row=>domain==='files'?`${row.sourceIdentity}:${row.unit}:${row.locator}`:
      domain==='conversations'?`${row.project}:${row.session}:${row.message}`:row.id;
    assert.equal(new Set([...found.results,...next.results].map(identity)).size,201,`${domain} ordered pages do not repeat a tied row`);
    assert.deepEqual(await service.query({...input,cursor:found.nextCursor}),next,'repeated reads have deterministic ties in an unchanged index');
  }
});

test('continuation criteria reject changed queries, Unicode filters, scopes, registries and malformed offsets before SQL', async t => {
  const { service, store, projects, setRegistry }=await fixture(t);
  const input={domain:'files',query:'日本語 amber',phrase:true,limit:1};
  const first=await service.query(input);
  const cursor=first.nextCursor;
  assert.ok(cursor);
  const next=await service.query({...input,cursor});
  assert.deepEqual(next.results.map(row=>row.projectID),['beta']);
  const original=store.searchFiles;
  let calls=0;
  store.searchFiles=(...args)=>{calls++;return original.apply(store,args);};
  for(const changes of [
    {query:'Café 日本語'}, {domain:'conversations'}, {phrase:false}, {limit:2},
    {source:'日本語'}, {role:'current_project_source'}, {status:'historical'},
    {projectID:'alpha'}, {projectDirectory:projects[0].directory},
  ]) await assert.rejects(service.query({...input,...changes,cursor}),{status:400});
  const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
  const token=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  for(const invalid of ['', 'not-a-valid-cursor', cursor+'=', 'x'.repeat(1025),
    token({...decoded,v:2}),token({...decoded,o:-1}),token({...decoded,o:0}),token({...decoded,o:0.5}),
    token({...decoded,o:100001}),token({...decoded,o:'1'}),token({...decoded,extra:true}),token({...decoded,c:'0'.repeat(64)})])
    await assert.rejects(service.query({...input,cursor:invalid}),{status:400});
  setRegistry([projects[1]]);
  await assert.rejects(service.query({...input,cursor}),{status:400});
  setRegistry(projects.map(project=>project.id==='beta'?{...project,directory:path.join(project.directory,'moved')}:project));
  await assert.rejects(service.query({...input,cursor}),{status:400});
  assert.equal(calls,0,'invalid cursors fail before invoking SQL search');
  setRegistry([...projects].reverse());
  assert.deepEqual(await service.query({...input,cursor}),next,'registry presentation order does not change the canonical scope');
  const other=createKnowledgeQuery({data:{...store,filename:path.join(path.dirname(store.filename),'different.sqlite')},getProjects:()=>projects});
  await assert.rejects(other.query({...input,cursor}),{status:400});
});

test('memory and fact continuation preserve global authored records, exact IDs, blank pins and provider-only filters', async t => {
  const { service,store }=await fixture(t);
  store.createMemory({id:'projectless-note',kind:'note',title:'Café 日本語',body:'Café 日本語 amber observatory'});
  store.addClaim({id:'projectless-claim',predicate:'Café 日本語 amber observatory',origin:'user-stated',epistemicState:'unverified',
    modelProvider:'fixture',evidence:[{id:'memory:projectless-note@1'}]});
  for(const domain of ['memories','facts']) {
    const input={domain,query:'日本語',limit:1};
    const rows=[];
    let cursor;
    do {
      const found=await service.query({...input,cursor});
      assert.ok(found.results.length<=1);
      rows.push(...found.results);
      cursor=found.nextCursor??undefined;
    }while(cursor);
    assert.equal(rows.length,4);
    assert.ok(rows.some(row=>row.projectID==='other'),'global retained authored data is not excluded by the current project registry');
    assert.ok(rows.some(row=>row.projectID===null),'projectless authored data remains searchable');
  }
  for(const id of ['memory-alpha','memory-beta']) store.setMemoryPin({id,pinned:true,expectedRevision:0});
  const pins={domain:'memories',query:'',pinnedOnly:true,limit:1};
  const first=await service.query(pins),next=await service.query({...pins,cursor:first.nextCursor});
  assert.equal(first.results.length,1);assert.equal(next.results.length,1);
  assert.notEqual(first.results[0].id,next.results[0].id);assert.equal(next.nextCursor,null);
  for(const [domain,id] of [['memories','memory-alpha'],['facts','claim-alpha']]) {
    const exact=await service.query({domain,query:id,limit:1});
    assert.equal(exact.results[0].id,id);assert.equal(exact.nextCursor,null);assert.equal(exact.page.continuation,'complete');
  }
  const providers=await service.query({domain:'facts',query:'日本語',modelProvider:'fixture',limit:1});
  assert.equal(providers.truncated,true);
  assert.equal((await service.query({domain:'facts',query:'日本語',modelProvider:'absent'})).results.length,0);
  await assert.rejects(service.query({domain:'facts',model:'fixture/model-a',modelProvider:'different'}),{status:400});
  await assert.rejects(service.query({domain:'files',modelProvider:'fixture'}),{status:400});
  await assert.rejects(service.query({domain:'facts',query:'日本語',modelProvider:'different',limit:1,cursor:providers.nextCursor}),{status:400});
});

test('finite continuation bounds never advertise an unusable next cursor', async () => {
  const directory=path.resolve('paging-bound-project');
  const calls=[];
  const service=createKnowledgeQuery({getProjects:()=>[{id:'bound',directory}],data:{
    searchFiles:(match,projects,filters,limit,offset)=>{
      calls.push({limit,offset});return Array.from({length:limit},(_,index)=>({projectKey:directory,path:'bounded.md',unit:offset+index}));
    },
  }});
  const input={domain:'files',query:'bounded',limit:1};
  const first=await service.query(input);
  const token=JSON.parse(Buffer.from(first.nextCursor,'base64url').toString('utf8'));token.o=100000;
  const last=await service.query({...input,cursor:Buffer.from(JSON.stringify(token)).toString('base64url')});
  assert.equal(last.results.length,1);assert.equal(last.truncated,true);
  assert.equal(last.page.continuation,'offset-limit');assert.equal(last.page.hasMore,true);assert.equal(last.nextCursor,null);
  assert.deepEqual(calls,[{limit:2,offset:0},{limit:2,offset:100000}]);
});

test('read-only CLI has query parity and refuses absent or unregistered databases without initialization', async t => {
  const { root, dataHome, service, store } = await fixture(t);
  const invoke = args => spawnSync(process.execPath, [path.resolve('scripts/knowledge.mjs'), ...args], {
    cwd: path.resolve('.'), encoding: 'utf8', env: { ...process.env, FREELANCER_DATA_HOME: dataHome },
  });
  for (const domain of ['files', 'conversations', 'memories', 'facts']) {
    const expected = await service.query({ domain, query: '日本語 amber', phrase: true, projectID: 'beta', limit: 1 });
    const result = invoke(['query', domain, '日本語 amber', '--phrase', '--project-id', 'beta', '--limit', '1']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
    const input={domain,query:'日本語 amber',phrase:true,limit:1};
    const first=await service.query(input);
    const expectedNext=await service.query({...input,cursor:first.nextCursor});
    const continued=invoke(['query',domain,'日本語 amber','--phrase','--limit','1','--cursor',first.nextCursor]);
    assert.equal(continued.status,0,continued.stderr);
    assert.deepEqual(JSON.parse(continued.stdout),expectedNext,'CLI executes the same continuation as the shared service');
    const mismatch=invoke(['query',domain,'different query','--phrase','--limit','1','--cursor',first.nextCursor]);
    assert.equal(mismatch.status,1);assert.match(mismatch.stderr,/Cursor is invalid/);
  }
  const providerOnly=invoke(['query','facts','日本語','--model-provider','fixture','--limit','1']);
  assert.equal(providerOnly.status,0,providerOnly.stderr);
  assert.deepEqual(JSON.parse(providerOnly.stdout),await service.query({domain:'facts',query:'日本語',modelProvider:'fixture',limit:1}));
  const before = await readFile(store.filename);
  const badScope = invoke(['query', 'conversations', 'observatory', '--project-id', 'other']);
  assert.equal(badScope.status, 1);
  assert.deepEqual(await readFile(store.filename), before);
  const missing = path.join(root, 'missing');
  assert.equal(invoke(['query', 'files', 'observatory', '--data-home', missing]).status, 1);
  assert.equal(existsSync(missing), false, 'read-only CLI must not create directories or a database');
  assert.equal(invoke(['query', 'files', 'observatory', '--runtime-id', 'unregistered']).status, 1);
  assert.deepEqual(await readFile(store.filename), before);
});

test('native knowledge and content tools send canonical bridge queries and ask permission for mutations', async t => {
  const paging=await fixture(t);
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-native-query-'));
  const requests = [], permissions = [];
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    const input=JSON.parse(body);
    requests.push({ path: request.url, token: request.headers['x-freelancer-git-bridge'], body: input });
    response.setHeader('Content-Type', 'application/json');
    try {
      const result=input.operation==='query'&&input.query==='日本語 amber'?await paging.service.query(input):{status:'ok',results:[]};
      response.end(JSON.stringify(result));
    }catch(error){response.statusCode=error.status??500;response.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const oldRoot = process.env.FREELANCER_RUNTIME_ROOT, oldToken = process.env.FREELANCER_GIT_BRIDGE;
  process.env.FREELANCER_RUNTIME_ROOT = root; process.env.FREELANCER_GIT_BRIDGE = 'fixture-bridge';
  t.after(async () => {
    if (oldRoot === undefined) delete process.env.FREELANCER_RUNTIME_ROOT; else process.env.FREELANCER_RUNTIME_ROOT = oldRoot;
    if (oldToken === undefined) delete process.env.FREELANCER_GIT_BRIDGE; else process.env.FREELANCER_GIT_BRIDGE = oldToken;
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'tools/runtime'), { recursive: true }); await mkdir(path.join(root, '.state/webpage'), { recursive: true });
  await writeFile(path.join(root, 'tools/runtime/state-database.mjs'), "import { readFileSync } from 'node:fs'; export const readState = file => JSON.parse(readFileSync(file, 'utf8'));\n");
  await writeFile(path.join(root, 'tools/runtime/storage-diagnostics.mjs'), "import { writeFileSync } from 'node:fs'; import path from 'node:path'; export const observeStorageDriver = root => writeFileSync(path.join(root,'observed.txt'),'observed');\n");
  await writeFile(path.join(root, '.state/webpage/launch.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` }));
  const { default: plugin } = await import('../backend/opencode/plugins/knowledge.ts');
  const { default: content } = await import('../backend/opencode/tools/content_index.ts');
  const knowledge = (await plugin({ directory: root })).tool.knowledge;
  assert.equal(existsSync(path.join(root, 'observed.txt')), true, 'initializer observes actual runtime storage capabilities');
  assert.equal(knowledge.args.expectedRevision.parse(0), 0);
  assert.equal(knowledge.args.cursor.parse('next-page'),'next-page');
  assert.throws(()=>knowledge.args.cursor.parse('x'.repeat(1025)));
  for (const operation of ['query', 'claims', 'read-claim', 'pin', 'refresh', 'archive', 'restore', 'evidence', 'judgment-evidence', 'query-evidence', 'revise-relation', 'relation-history'])
    assert.equal(knowledge.args.operation.parse(operation), operation);
  const context = { directory: root, sessionID: 'session', messageID: 'message', abort: new AbortController().signal,
    ask: async input => { permissions.push(input); } };
  for(const operation of ['sources','unit','status','meta','facts','rebuild']) {
    const requested=requests.length,asked=permissions.length;
    await assert.rejects(content.execute({operation,cursor:'unsupported-cursor'},context),/Cursor is supported only/);
    assert.equal(requests.length,requested,'unsupported continuation must not contact the bridge');
    assert.equal(permissions.length,asked,'unsupported continuation must fail before mutation permissions');
  }
  await knowledge.execute({ operation: 'query', domain: 'facts', query: '日本語', phrase: true, model: 'fixture/model-a' }, context);
  assert.equal(requests[0].body.projectID, undefined, 'native knowledge defaults globally');
  assert.equal(requests[0].body.phrase, true);
  await knowledge.execute({operation:'relations',asOf:1234},context);
  assert.equal(requests.at(-1).body.asOf,1234);
  await knowledge.execute({operation:'judgment-evidence',domain:'memories',id:'existing-memory',revision:1},context);
  assert.equal(requests.at(-1).body.operation,'judgment-evidence');
  for (const operation of ['pin', 'refresh', 'archive', 'restore', 'revise-relation']) await knowledge.execute({ operation, id: 'memory', pinned: true, expectedRevision: 0 }, context);
  assert.deepEqual(permissions.map(item => item.metadata.operation), ['pin', 'refresh', 'archive', 'restore', 'revise-relation']);
  const snapshotRevisionSha256 = 'a'.repeat(64);
  assert.equal(knowledge.args.snapshotRevisionSha256.parse(snapshotRevisionSha256), snapshotRevisionSha256);
  await knowledge.execute({ operation: 'opencode-read', projectID: 'project', sessionID: 'retained-target',
    snapshotRevisionSha256, actorSessionID: 'forged-actor', messageID: 'forged-message' }, context);
  assert.equal(requests.at(-1).body.sessionID, 'retained-target', 'source reads preserve the selected conversation');
  assert.equal(requests.at(-1).body.snapshotRevisionSha256, snapshotRevisionSha256);
  assert.equal(requests.at(-1).body.actorSessionID, context.sessionID, 'caller input cannot replace native actor identity');
  assert.equal(requests.at(-1).body.messageID, context.messageID);
  await knowledge.execute({ operation: 'remember', title: 'Source note', body: 'Retained source evidence',
    sessionID: 'retained-target', actorSessionID: 'forged-actor', messageID: 'forged-message' }, context);
  assert.equal(requests.at(-1).body.sessionID, 'retained-target');
  assert.equal(requests.at(-1).body.actorSessionID, context.sessionID, 'mutations record their native caller, independently of a source target');
  assert.equal(requests.at(-1).body.messageID, context.messageID);
  for(const operation of ['judgment-evaluate','judgment-evaluate-batch']) {
    const before=requests.length;
    let asked=false;
    await knowledge.execute({operation,stateJson:'{"evidence":[]}'},{...context,ask:async input=>{
      assert.equal(requests.length,before,'permission is requested before any evaluation HTTP call');
      assert.equal(input.permission,'edit');assert.equal(input.metadata.provider,'TypeSafe');asked=true;
    }});
    assert.equal(asked,true);assert.equal(requests.length,before+1);assert.equal(requests.at(-1).body.operation,operation);
    const deniedBefore=requests.length;
    await assert.rejects(knowledge.execute({operation,stateJson:'{"evidence":[]}'},{...context,ask:async()=>{throw Error('Native permission explicitly denied');}}),/explicitly denied/);
    assert.equal(requests.length,deniedBefore,'native denial prevents the evaluation HTTP request');
  }
  await content.execute({ operation: 'chats', query: '日本語', model: 'fixture/model-a', phrase: true, cursor: 'fixture-cursor' }, context);
  const chats = requests.at(-1);
  assert.equal(chats.path, '/api/knowledge/agent'); assert.equal(chats.token, 'fixture-bridge');
  assert.equal(chats.body.operation, 'query'); assert.equal(chats.body.domain, 'conversations');
  assert.equal(chats.body.projectDirectory, root); assert.equal(chats.body.global, false);
  assert.equal(chats.body.cursor,'fixture-cursor');
  await content.execute({ operation: 'search', query: '日本語', global: true, source: '%_' }, context);
  assert.equal(requests.at(-1).body.global, true); assert.equal(requests.at(-1).body.projectDirectory, undefined);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(content.execute({ operation: 'search', query: '日本語' }, { ...context, abort: cancelled.signal }), { name: 'AbortError' });
  for(const domain of ['files','conversations','memories','facts']) {
    const input={operation:'query',domain,query:'日本語 amber',phrase:true,limit:1};
    const first=JSON.parse((await knowledge.execute(input,context)).output);
    assert.ok(first.nextCursor);
    const next=JSON.parse((await knowledge.execute({...input,cursor:first.nextCursor},context)).output);
    assert.deepEqual(next,await paging.service.query({...input,cursor:first.nextCursor}));
    assert.equal(next.page.offset,1);
    await assert.rejects(knowledge.execute({...input,limit:2,cursor:first.nextCursor},context),/Cursor is invalid/);
  }
  const contentInput={operation:'search',query:'日本語 amber',phrase:true,global:true,limit:1};
  const contentFirst=JSON.parse(await content.execute(contentInput,context));
  const contentNext=JSON.parse(await content.execute({...contentInput,cursor:contentFirst.nextCursor},context));
  assert.deepEqual(contentNext,await paging.service.query({domain:'files',query:'日本語 amber',phrase:true,global:true,limit:1,cursor:contentFirst.nextCursor}));
});
