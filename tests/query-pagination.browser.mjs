import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

const needle='paginationneedle';
const domains=[
  ['Files','File results','.knowledge-file-result'],
  ['Conversations','Conversation results','.content-search-conversation'],
  ['Memories','Memory results','.indexed-search-result'],
  ['Facts','Fact results','.knowledge-claim'],
];

async function paginationFixture(own,{count=131,memoryOnly=false}={}) {
  const f=await own(localDataFixture({timers:false})), data=f.app.localData.get();
  f.app.history.indexCurrent=async()=>false;
  if (!memoryOnly) {
    const db=new DatabaseSync(data.filename), key=process.platform==='win32'?f.directory.toLowerCase():f.directory;
    try {
      db.exec('BEGIN');
      db.prepare(`INSERT INTO content_sources(source_id,project_key,filename,virtual_path,container_path,extension,source_role,status,
        routing_rank,file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,source_identity,revision_identity)
        VALUES(1,?,'paging.txt','paging.txt',?,'.txt','current_project_source','current',80,100,'2026-10-03','source-hash',?,'line','fixture','ok',100,10,'source:paging','revision:paging')`)
        .run(key,path.join(f.directory,'paging.txt'),count);
      const unit=db.prepare(`INSERT INTO content_units(unit_id,source_id,unit_no,locator,heading,text,word_count,char_count,sha256)
        VALUES(?,1,?,?,?,?,2,100,'unit-hash')`);
      const fts=db.prepare(`INSERT INTO content_units_fts(rowid,project_key,filename,virtual_path,source_role,status,heading,locator,text)
        VALUES(?,?,'paging.txt','paging.txt','current_project_source','current',?,?,?)`);
      for(let index=1;index<=count;index++) {
        const title=`Paged file ${String(index).padStart(3,'0')}`, locator=`L${index}`, text=`${needle} source record ${index}`;
        unit.run(index,index,locator,title,text); fts.run(index,key,title,locator,text);
      }
      db.exec('COMMIT');
    } finally {db.close();}
  }
  for(let index=1;index<=count;index++) {
    const suffix=String(index).padStart(3,'0');
    data.createMemory({id:`paging-memory-${suffix}`,kind:'note',title:`Paged memory ${suffix}`,body:`${needle} retained record ${index}`,
      source:{projectID:f.project.id},members:[{kind:'message',ref:`fixture:${suffix}`,locator:{providerID:'fixture',modelID:'model-a'}}]});
    if (!memoryOnly) {
      const session={id:`ses_paging_${suffix}`,title:`Paged conversation ${suffix}`,directory:f.directory,time:{created:500,updated:600}};
      f.state.sessions.push(session);
      data.indexChat(f.project.id,session,[{info:{id:`msg_paging_${suffix}`,role:'assistant',time:{created:500}},
        parts:[{type:'text',text:`${needle} conversation record ${index}`}]}]);
      data.addClaim({id:`paging-claim-${suffix}`,predicate:`Paged fact ${suffix}`,value:`${needle} fact record ${index}`,
        origin:'user-stated',epistemicState:'supported',method:'pagination fixture',scope:{projectID:f.project.id},
        evidence:[{id:`memory:paging-memory-${suffix}@1`,kind:'memory',memoryID:`paging-memory-${suffix}`,memoryRevision:1,relation:'supports'}]});
    }
  }
  data.markProjectIndexesReady(f.project.id);
  return {...f,data};
}

async function search(page,url,{tab='All content',query=needle}={}) {
  await page.goto(url);
  await page.getByRole('button',{name:'Application settings',exact:true}).click();
  await page.getByRole('button',{name:'Search all content',exact:true}).click();
  await page.getByRole('tab',{name:tab,exact:true}).click();
  await page.getByRole('searchbox',{name:'Search all content',exact:true}).fill(query);
}

test('bounded fact summaries label omitted value and references and load the retained value before correction',{tag:['@app']},async({appBrowser:browser,own})=>{
  const f=await paginationFixture(own,{count:1,memoryOnly:true}),page=await browser.newPage({viewport:{width:390,height:844}});
  const value='日'.repeat(40000),predicate='Oversized retained fact';
  f.data.addClaim({id:'oversized-query-fact',predicate,value,origin:'user-stated',epistemicState:'supported',
    method:'bounded metadata fixture',scope:{projectID:f.project.id},evidence:Array.from({length:40},(_,index)=>({
      id:`retained:${index}`,kind:'memory',memoryID:'paging-memory-001',memoryRevision:1,relation:'supports'}))});
  await search(page,f.url,{tab:'Facts',query:predicate});
  const fact=page.getByLabel('Fact results',{exact:true}).locator('.knowledge-claim');
  await expect(fact).toHaveCount(1);
  await expect(fact).toContainText('The value exceeds the search summary limit.');
  await fact.getByText('Evidence and validity',{exact:true}).click();
  await expect(fact).toContainText('Showing 32 of 40 retained evidence references.');
  await fact.getByRole('button',{name:`Correct fact ${predicate}`,exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Correct fact',exact:true});
  await expect(editor.getByRole('textbox',{name:'Fact value',exact:true})).toHaveValue(value);
  await expect(editor.locator('.knowledge-selected-evidence')).toHaveCount(0);
  await expect(editor).toContainText('The previous claim and its evidence remain in history.');
  await editor.getByRole('button',{name:'Cancel',exact:true}).click();
  const original=await f.api('knowledge',{operation:'read-claim',id:'oversized-query-fact'});
  assert.equal(original.value,value);
  assert.equal(original.evidence.length,40,'opening a correction preserves every original reference');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
});

test('a fact correction preserves typed values and applicability when its project scope changes',{tag:['@app']},async({appBrowser:browser,own})=>{
  const f=await paginationFixture(own,{count:1,memoryOnly:true}),page=await browser.newPage({viewport:{width:390,height:844}});
  const scenarios=[
    ['number',17,{projectID:f.project.id,version:'1.2',units:'milliseconds'},true],
    ['object',{count:17,confirmed:true},{platform:'Windows',version:'2.0'},false],
    ['boolean',false,{project:f.project.id,model:'model-a',platform:'Windows'},false],
  ];
  for(const [suffix,value,scope,changeProject] of scenarios) {
    const predicate=`Retained typed value ${suffix}`,id=`typed-value-${suffix}`;
    f.data.addClaim({id,predicate,value,origin:'source-reported',epistemicState:'supported',method:'Original source method',
      scope,evidence:[{id:'memory:source',kind:'memory',memoryID:'paging-memory-001',memoryRevision:1}]});
    await search(page,f.url,{tab:'Facts',query:predicate});
    const fact=page.getByLabel('Fact results',{exact:true}).locator('.knowledge-claim');
    await expect(fact).toHaveCount(1);
    await fact.getByRole('button',{name:`Correct fact ${predicate}`,exact:true}).click();
    const editor=page.getByRole('dialog',{name:'Correct fact',exact:true});
    await expect(editor.getByLabel('Fact value',{exact:true})).toHaveValue(JSON.stringify(value));
    await expect(editor.getByLabel('Claim origin',{exact:true})).toHaveValue('user-stated');
    await expect(editor.getByLabel('Epistemic status',{exact:true})).toHaveValue('unverified');
    await expect(editor.getByLabel('Fact scope',{exact:true})).toHaveValue(scope.projectID??scope.project??'');
    if(changeProject) await editor.getByLabel('Fact scope',{exact:true}).selectOption('');
    await editor.getByLabel('How this claim was established',{exact:true}).fill('User reviewed the retained source.');
    await editor.getByLabel('Reason for correction',{exact:true}).fill('Clarify provenance without changing the value.');
    const source=editor.getByLabel('Retained source revision',{exact:true});
    const label='Paged memory 001 · retained revision 1';
    await expect(source.locator('option')).toContainText([label]);
    await source.selectOption({label});
    await editor.getByRole('button',{name:'Add evidence',exact:true}).click();
    await editor.getByRole('button',{name:'Save correction',exact:true}).click();
    await expect(editor).toHaveCount(0);
    const history=await f.api('knowledge',{operation:'claims',query:predicate,includeHistorical:true});
    assert.equal(history.results.length,2);
    const replacement=history.results.find(row=>row.id!==id);
    assert.deepEqual(replacement.value,value);
    const expectedScope={...scope};
    if(changeProject) {delete expectedScope.projectID;delete expectedScope.project;}
    assert.deepEqual(replacement.scope,expectedScope,'correction keeps non-project applicability and changes the project only when explicitly selected');
    assert.equal(replacement.origin,'user-stated');
    assert.equal(replacement.epistemicState,'unverified');
    const original=await f.api('knowledge',{operation:'read-claim',id});
    assert.equal(original.epistemicState,'superseded');
    assert.deepEqual(original.scope,scope,'the superseded claim preserves its original scope');
  }
});

test('search pages reach later matches without growing the visible groups and fit phone width',{tag:['@app']},async({appBrowser:browser,own},info)=>{
  const f=await paginationFixture(own),page=await browser.newPage({viewport:{width:1280,height:900}});
  await search(page,f.url);
  for(const [,label,item] of domains) await expect(page.getByLabel(label,{exact:true}).locator(item)).toHaveCount(25);
  for(const count of [50,75,100]) {
    await page.getByRole('button',{name:'Show more results',exact:true}).click();
    for(const [,label,item] of domains) await expect(page.getByLabel(label,{exact:true}).locator(item)).toHaveCount(count);
  }
  await expect(page.getByRole('button',{name:'Show more results',exact:true})).toHaveCount(0);
  const firstFiles=await page.getByLabel('File results',{exact:true}).locator('.indexed-result-heading strong').allTextContents();
  for(const [name,label,item] of domains) {
    const group=page.getByLabel(label,{exact:true});
    await group.getByRole('button',{name:`Next ${name} page`,exact:true}).click();
    await expect(group.locator(item)).toHaveCount(31);
    await expect(group.getByRole('group',{name:`${name} pages`,exact:true})).toContainText('Matches 101–131');
    await expect(group.getByRole('button',{name:`Next ${name} page`,exact:true})).toBeDisabled();
    await expect(group).toContainText('Results may move as the index updates.');
  }
  const secondFiles=await page.getByLabel('File results',{exact:true}).locator('.indexed-result-heading strong').allTextContents();
  assert.ok(secondFiles.every(title=>!firstFiles.includes(title)),'later file matches are reached rather than appended or repeated');
  await page.getByRole('button',{name:'Previous Files page',exact:true}).click();
  await expect(page.getByLabel('File results',{exact:true}).locator('.knowledge-file-result')).toHaveCount(100);
  assert.deepEqual(await page.getByLabel('File results',{exact:true}).locator('.indexed-result-heading strong').allTextContents(),firstFiles);
  await expect(page.getByLabel('Memory results',{exact:true}).locator('.indexed-search-result')).toHaveCount(31);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Start over Memories',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'Previous Memories page',exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'page controls and moving-index captions fit390px');
  await info.attach('query-pagination-phone',{body:await page.screenshot(),contentType:'image/png'});
  for(let index=1;index<=5;index++) {
    const session={id:`ses_duplicate_${index}`,title:`Multiple matching messages ${index}`,directory:f.directory,time:{created:700,updated:800}};
    f.state.sessions.push(session);
    f.data.indexChat(f.project.id,session,Array.from({length:10},(_,message)=>({info:{id:`duplicate_${index}_${message}`,role:'assistant',time:{created:700}},
      parts:[{type:'text',text:'duplicatemessageneedle'}]})));
  }
  await page.getByRole('tab',{name:'Conversations',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search all content',exact:true}).fill('duplicatemessageneedle');
  const conversationGroup=page.getByLabel('Conversation results',{exact:true});
  await expect(conversationGroup.locator('.content-search-conversation')).toHaveCount(3);
  await conversationGroup.getByRole('button',{name:'Next Conversations page',exact:true}).click();
  await expect(conversationGroup.getByRole('group',{name:'Conversations pages',exact:true})).toContainText('Matches 26–50');
  await expect(conversationGroup.locator('.content-search-conversation')).toHaveCount(3);
});

test('a failed continuation preserves the page, retries its cursor, and can start over after invalidation',{tag:['@app']},async({appBrowser:browser,own})=>{
  const f=await paginationFixture(own,{count:65,memoryOnly:true}),page=await browser.newPage({viewport:{width:1280,height:900}});
  const requests=[]; let failure='Page fixture unavailable';
  await page.route('**/api/memory/search?**',route=>{
    const cursor=new URL(route.request().url()).searchParams.get('cursor');
    if (!cursor) return route.continue();
    requests.push(cursor);
    if (!failure) return route.continue();
    const error=failure; failure='';
    return route.fulfill({status:error.startsWith('Cursor')?400:503,contentType:'application/json',body:JSON.stringify({error})});
  });
  await search(page,f.url,{tab:'Memories'});
  const group=page.getByLabel('Memory results',{exact:true}),titles=group.locator('.indexed-result-heading strong');
  await expect(titles).toHaveCount(25);
  const first=await titles.allTextContents();
  await group.getByRole('button',{name:'Next Memories page',exact:true}).click();
  const error=page.getByRole('alert').filter({hasText:'Page fixture unavailable'});
  await expect(error).toBeVisible(); assert.deepEqual(await titles.allTextContents(),first);
  await error.getByRole('button',{name:'Retry search',exact:true}).click();
  await expect(group.getByRole('group',{name:'Memories pages',exact:true})).toContainText('Matches 26–50');
  assert.equal(requests[0],requests[1],'retry retains the same failed cursor');
  const second=await titles.allTextContents(); failure='Cursor scope changed; start over.';
  await group.getByRole('button',{name:'Next Memories page',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Cursor scope changed'})).toBeVisible();
  assert.deepEqual(await titles.allTextContents(),second,'invalid continuation does not discard the last visible page');
  await group.getByRole('button',{name:'Start over Memories',exact:true}).click();
  await expect(group.getByRole('group',{name:'Memories pages',exact:true})).toContainText('Matches 1–25');
  await expect(page.getByRole('alert')).toHaveCount(0);
  assert.deepEqual(await titles.allTextContents(),first);
  await expect(group.getByRole('button',{name:'Previous Memories page',exact:true})).toBeDisabled();
  const params=new URLSearchParams({q:needle,limit:'25',pinnedOnly:'false',includeArchived:'false'});
  const kept=new Set((await f.api('memory/search?'+params)).results.map(row=>row.id));
  for(let index=1;index<=65;index++) {
    const id=`paging-memory-${String(index).padStart(3,'0')}`;
    if(!kept.has(id)) assert.equal(f.data.forgetMemory({id,reason:'owned moving-index fixture'}).forgotten,true);
  }
  await group.getByRole('button',{name:'Next Memories page',exact:true}).click();
  await expect(titles).toHaveCount(0);
  await expect(group.getByRole('group',{name:'Memories pages',exact:true})).toContainText('No matches on this page');
  await expect(group.getByRole('button',{name:'Previous Memories page',exact:true})).toBeEnabled();
  await expect(group.getByRole('button',{name:'Start over Memories',exact:true})).toBeEnabled();
  await group.getByRole('button',{name:'Previous Memories page',exact:true}).click();
  await expect(titles).toHaveCount(25); assert.deepEqual(await titles.allTextContents(),first);
  await expect(group.getByRole('group',{name:'Memories pages',exact:true})).toHaveCount(0);
  // Re-establish one overflow row, then remove it after the fresh first page.
  f.data.createMemory({id:'moving-overflow',kind:'note',title:'Moving overflow',body:needle,source:{projectID:f.project.id}});
  await page.getByRole('searchbox',{name:'Search all content',exact:true}).fill('');
  await page.getByRole('searchbox',{name:'Search all content',exact:true}).fill(needle);
  await expect(group.getByRole('button',{name:'Next Memories page',exact:true})).toBeEnabled();
  f.data.forgetMemory({id:'moving-overflow',reason:'owned moving-index fixture'});
  await group.getByRole('button',{name:'Next Memories page',exact:true}).click();
  await expect(titles).toHaveCount(0);
  await group.getByRole('button',{name:'Start over Memories',exact:true}).click();
  await expect(titles).toHaveCount(25);assert.deepEqual(await titles.allTextContents(),first);
});

test('query, filter and project scope changes cancel continuation and reject its late response',{tag:['@app']},async({appBrowser:browser,own})=>{
  const f=await paginationFixture(own,{count:65,memoryOnly:true}),page=await browser.newPage({viewport:{width:1280,height:900}});
  f.data.createMemory({id:'changed-query-memory',kind:'note',title:'Changed query result',body:'changedquerymarker',source:{projectID:f.project.id}});
  const first=await f.api('memory/search?'+new URLSearchParams({q:needle,limit:'25',pinnedOnly:'false',includeArchived:'false'}));
  const stale=await f.api('memory/search?'+new URLSearchParams({q:needle,limit:'25',pinnedOnly:'false',includeArchived:'false',cursor:first.nextCursor}));
  const gates=[],requests=[],cancelled=[]; let held=null;
  const holdNext=()=>{
    let enter,release,finish;
    const state={entered:new Promise(resolve=>enter=resolve),gate:new Promise(resolve=>release=resolve),finished:new Promise(resolve=>finish=resolve),
      enter:()=>enter(),release:()=>release(),finish:()=>finish()};
    gates.push(state); held=state; return state;
  };
  await own(Promise.resolve({close:async()=>{for(const gate of gates) gate.release();await page.unrouteAll({behavior:'wait'});}}));
  page.on('requestfailed',request=>{
    const url=new URL(request.url());
    if(url.pathname==='/api/memory/search'&&url.searchParams.has('cursor')) cancelled.push(request.failure()?.errorText);
  });
  await page.route('**/api/memory/search?**',async route=>{
    const url=new URL(route.request().url()); requests.push(Object.fromEntries(url.searchParams));
    const state=held;
    if(!state||!url.searchParams.has('cursor')) return route.continue();
    held=null;state.enter();await state.gate;
    try {await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stale)});} finally {state.finish();}
  });
  await search(page,f.url,{tab:'Memories'});
  const group=()=>page.getByLabel('Memory results',{exact:true});
  await expect(group().locator('.indexed-search-result')).toHaveCount(25);
  let state=holdNext(); await group().getByRole('button',{name:'Next Memories page',exact:true}).click();await state.entered;
  await page.getByRole('searchbox',{name:'Search all content',exact:true}).fill('changedquerymarker');
  await expect(group().locator('.indexed-search-result')).toHaveCount(1);await expect(group()).toContainText('Changed query result');
  state.release();await state.finished;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(group().locator('.indexed-search-result')).toHaveCount(1);
  await page.getByRole('searchbox',{name:'Search all content',exact:true}).fill(needle);
  await expect(group().locator('.indexed-search-result')).toHaveCount(25);
  state=holdNext();await group().getByRole('button',{name:'Next Memories page',exact:true}).click();await state.entered;
  await page.getByLabel('Model ID',{exact:true}).fill('fixture/model-a');
  await expect(group().getByRole('group',{name:'Memories pages',exact:true})).toContainText('Matches 1–25');
  await expect(group().getByRole('button',{name:'Previous Memories page',exact:true})).toBeDisabled();
  state.release();await state.finished;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(group().getByRole('group',{name:'Memories pages',exact:true})).toContainText('Matches 1–25');
  await expect(group().getByRole('button',{name:'Previous Memories page',exact:true})).toBeDisabled();
  await page.getByLabel('Model ID',{exact:true}).fill('');
  await expect.poll(()=>requests.some(row=>row.q===needle&&!row.model&&!row.cursor&&requests.indexOf(row)>requests.findLastIndex(item=>item.model==='fixture/model-a'))).toBe(true);
  await expect(group().getByRole('button',{name:'Next Memories page',exact:true})).toBeEnabled();
  state=holdNext();await group().getByRole('button',{name:'Next Memories page',exact:true}).click();await state.entered;
  await page.getByRole('button',{name:'Project settings',exact:true}).click();
  await page.locator('#project-settings-links').getByRole('button',{name:'Search project content',exact:true}).click();
  await page.getByRole('tab',{name:'Memories',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search project content',exact:true}).fill(needle);
  await expect(group().locator('.indexed-search-result')).toHaveCount(25);
  state.release();await state.finished;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(group().getByRole('group',{name:'Memories pages',exact:true})).toContainText('Matches 1–25');
  await expect(group().getByRole('button',{name:'Previous Memories page',exact:true})).toBeDisabled();
  assert.ok(requests.some(row=>row.project===f.project.id&&row.q===needle&&!row.cursor),'new project scope starts without a previous cursor');
  await expect.poll(()=>cancelled.length,{message:'all three stale continuation reads were actually aborted'}).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
