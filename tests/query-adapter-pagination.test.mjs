import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { localDataFixture } from './fixtures/local-data-app.mjs';

async function fixture(t) {
  const f=await localDataFixture({timers:false});
  t.after(()=>f.close());
  const data=f.app.localData.get();
  data.initializeFreshRuntime('query-pagination-fixture');
  const db=new DatabaseSync(data.filename);
  try {db.prepare('INSERT INTO project_registrations(runtime_id,project_id,data) VALUES(?,?,?)')
    .run('query-pagination-fixture',f.project.id,JSON.stringify(f.project));}
  finally {db.close();}
  for(let index=0;index<3;index++) {
    await writeFile(path.join(f.project.directory,`page-${index}.md`),`# Page ${index}\n\npaginationneedle Café 日本語 ${index}\n`);
    data.indexChat(f.project.id,{id:`page-session-${index}`,title:`Page ${index}`,time:{updated:100}},[
      {info:{id:`page-message-${index}`,role:'assistant'},parts:[{type:'text',text:`paginationneedle Café 日本語 ${index}`}]}]);
    data.createMemory({id:`page-memory-${index}`,kind:'note',title:`Page ${index}`,body:`paginationneedle Café 日本語 ${index}`,
      source:{projectID:f.project.id}});
    data.addClaim({id:`page-claim-${index}`,predicate:`paginationneedle Café 日本語 ${index}`,origin:'user-stated',
      epistemicState:'supported',scope:{projectID:f.project.id},evidence:[{id:`source:page-${index}`}]});
  }
  const projectKey=process.platform==='win32'?f.project.directory.toLowerCase():f.project.directory;
  const indexed=spawnSync(process.execPath,['backend/tools/project-content-indexer.mjs','--db',data.filename,'--project-key',projectKey,
    'rebuild','--root',f.project.directory,'--facts','none'],{encoding:'utf8'});
  assert.equal(indexed.status,0,indexed.stderr);
  return {...f,data};
}
const identity=(domain,row)=>domain==='files'?`${row.projectID ?? row.project}:${row.sourceIdentity}:${row.locator}`
  :domain==='conversations'?`${row.projectID ?? row.project}:${row.session}:${row.message}`:row.id;
const routeFor={files:'index/search',conversations:'history/search',memories:'memory/search'};
const metadata=row=>Object.fromEntries(['resultID','type','originalSourceRef','sourceRevision','observedAt','capturedAt',
  'indexedAt','matchReasons','evidenceStatus','claimStatus','modelText'].map(key=>[key,row[key]]));

test('UI adapters, legacy knowledge operations and CLI execute the common continuation for all four domains',async t=>{
  const f=await fixture(t);
  for(const domain of ['files','conversations','memories','facts']) {
    const input={domain,query:'paginationneedle 日本語',projectID:f.project.id,limit:1};
    const first=await f.app.knowledgeQuery.query(input);
    assert.ok(first.nextCursor,`${domain} supplies executable continuation`);
    const second=await f.app.knowledgeQuery.query({...input,cursor:first.nextCursor});
    const read=async cursor=>domain==='facts'?f.api('knowledge',{operation:'query',...input,cursor})
      :f.api(`${routeFor[domain]}?${new URLSearchParams({q:input.query,project:f.project.id,limit:'1',...(cursor?{cursor}:{})})}`);
    for(const [expected,cursor] of [[first,undefined],[second,first.nextCursor]]) {
      const actual=await read(cursor);
      assert.deepEqual(actual.results.map(row=>identity(domain,row)),expected.results.map(row=>identity(domain,row)),domain);
      assert.equal(actual.nextCursor,expected.nextCursor,domain);
      assert.deepEqual(actual.page,expected.page,domain);
      assert.deepEqual(actual.results.map(metadata),expected.results.map(metadata),`${domain} keeps common per-hit metadata`);
    }
    assert.notEqual(identity(domain,first.results[0]),identity(domain,second.results[0]),`${domain} advances rather than repeating page one`);
    const cli=spawnSync(process.execPath,['scripts/knowledge.mjs','query',domain,input.query,'--data-home',path.dirname(f.data.filename),
      '--runtime-id','query-pagination-fixture','--project-id',f.project.id,'--limit','1','--cursor',first.nextCursor],{encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout),second);
    if(['memories','facts'].includes(domain)) {
      const legacy=await f.api('knowledge',{operation:domain==='memories'?'search':'claims',...input,cursor:first.nextCursor});
      assert.deepEqual(legacy.results.map(row=>identity(domain,row)),second.results.map(row=>identity(domain,row)));
      assert.equal(legacy.nextCursor,second.nextCursor);
      if(domain==='memories') assert.deepEqual(legacy.items,legacy.results);
    }
    let page=second;
    while(page.nextCursor) page=await f.app.knowledgeQuery.query({...input,cursor:page.nextCursor});
    assert.equal(page.truncated,false,domain);
    assert.notEqual(identity(domain,first.results[0]),identity(domain,page.results[0]),domain);
  }
});

test('UI memory search keeps the common bounded summary without reading retained transcripts',async t=>{
  const f=await fixture(t), body='boundedsummaryneedle '+ 'retained body '.repeat(25000);
  f.data.createMemory({id:'bounded-memory',kind:'note',title:'Bounded retained memory',body,source:{projectID:f.project.id},
    members:Array.from({length:80},(_,ordinal)=>({kind:'message',ref:`source:${ordinal}`,locator:{text:'PRIVATE FULL TRANSCRIPT '+body}}))});
  const original=f.data.getMemory;
  f.data.getMemory=()=>{throw Error('Search must not materialize a retained memory or its transcript.');};
  try {
    const input={domain:'memories',query:'boundedsummaryneedle',projectID:f.project.id,limit:25};
    const common=await f.app.knowledgeQuery.query(input),ui=await f.api('memory/search?'+new URLSearchParams({q:input.query,project:f.project.id,limit:'25'}));
    assert.equal(ui.results.length,1);
    const hit=ui.results[0];
    assert.deepEqual(metadata(hit),metadata(common.results[0]));
    assert.equal(hit.projectName,f.project.name);
    assert.ok(hit.body.length<=240);
    assert.equal(hit.bodyTruncated,true);
    assert.equal(hit.sourceRefCount,80);
    assert.equal(hit.sourceRefsTruncated,true);
    assert.equal(hit.sourceRefs.length,32);
    assert.equal(hit.members,undefined);
    assert.equal(hit.messages,undefined);
    assert.ok(!JSON.stringify(ui).includes('PRIVATE FULL TRANSCRIPT'));
  } finally {f.data.getMemory=original;}
  const retained=await f.app.history.readMemory('bounded-memory',1);
  assert.equal(retained.body,body,'exact retained reads remain complete');
  assert.equal(retained.members.length,80);
});

test('legacy query adapters reject changed criteria, unknown projects, invalid bounds and cursors on exact reads',async t=>{
  const f=await fixture(t);
  const headers={'X-Freelancer-Client':'webpage','Content-Type':'application/json'};
  for(const domain of ['files','conversations','memories']) {
    const first=await f.app.knowledgeQuery.query({domain,query:'paginationneedle',projectID:f.project.id,limit:1});
    const response=await fetch(`${f.url}/api/${routeFor[domain]}?${new URLSearchParams({q:'different query',project:f.project.id,limit:'1',cursor:first.nextCursor})}`,{headers});
    assert.equal(response.status,400,domain);
    const invalid=await fetch(`${f.url}/api/${routeFor[domain]}?${new URLSearchParams({q:'paginationneedle',project:f.project.id,limit:'201'})}`,{headers});
    assert.equal(invalid.status,400,`${domain} does not silently clamp an invalid bound`);
  }
  for(const operation of ['search','claims']) {
    const response=await fetch(`${f.url}/api/knowledge`,{method:'POST',headers,
      body:JSON.stringify({operation,query:'paginationneedle',projectID:'unregistered',limit:1})});
    assert.equal(response.status,400,operation);
  }
  const response=await fetch(`${f.url}/api/knowledge`,{method:'POST',headers,
    body:JSON.stringify({operation:'read',id:'page-memory-0',cursor:'supplied-but-unsupported'})});
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/continuation/);
});
