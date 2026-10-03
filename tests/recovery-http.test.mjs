import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backupLocalData, restoreLocalData } from '../server/data/backup.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { createApplication } from '../server/application.mjs';
import { createStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { checkedCatalog } from '../backend/tools/runtime/agent-catalog.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('actual restored rating job stays readable without native calls and resumes only after its matching recovery review',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-restored-ratings-http-'));
  let runtime,app,store,sourceStore;
  t.after(async()=>{
    await runtime?.close();
    if(!runtime){app?.modelRatings?.close();await app?.history?.close();app?.localData?.close();}
    sourceStore?.close();await store?.flush();await rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  });
  const backendRoot=path.join(root,'backend'),directory=path.join(root,'project'),source=path.join(root,'source'),bundle=path.join(root,'backup'),restored=path.join(root,'restored');
  await mkdir(backendRoot);await mkdir(directory);
  store=createStore(backendRoot);const project={id:'restored-ratings-project',name:'Restored ratings',directory};
  await store.update('settings',settings=>({...settings,projects:[project]}));
  const workspace=checkedCatalog(await store.read('settings')),rows=[{id:'opencode/target',name:'Target',provider:'opencode'}];
  sourceStore=createLocalDataStore(source);sourceStore.initializeFreshRuntime(FRESH_RUNTIME_ID);sourceStore.modelCatalog(rows);
  sourceStore.saveRatingJob({id:'restored-rating-job',project:project.id,session:'ses_restored_rating',model:'opencode/fixture',targets:rows.map(row=>row.id),status:'running',summary:'Restored fixture research',createdAt:Date.now(),
    progress:{rows,queue:rows,workers:[{session:'ses_restored_rating',model:'opencode/fixture',status:'ready',batch:[]}],updated:[],missing:[],
      workspace,agent:workspace.agents.find(agent=>agent.id==='researcher'),models:rows,connected:['opencode']}});
  sourceStore.close();await backupLocalData(source,bundle,{quiesced:true});
  const result=await restoreLocalData(bundle,restored,{quiesced:true}),calls=[];
  const host={async request(route,options){calls.push({route,options});
    if(route==='/session/status')return {ses_restored_rating:{type:'busy'}};
    if(route==='/permission'||route==='/question'||route.endsWith('/message'))return [];
    if(route.endsWith('/prompt_async'))return {};
    throw Error(route);
  }};
  app=createApplication({backendRoot,host,store,dataRoot:restored,automaticWorkAllowed:false});
  assert.equal(app.modelRatings.status().id,'restored-rating-job');assert.deepEqual(calls,[],'Constructor-level guard applies before HTTP startup.');
  runtime=await startServer({application:app,assets:backendRoot,timers:true,recoveryDataHome:restored});
  const api=async(route,body)=>{
    const response=await fetch(runtime.url+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-Freelancer-Client':'webpage','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const original=JSON.stringify(app.localData.get().currentRatingJob());
  assert.equal((await api('models/ratings')).body.job.id,'restored-rating-job');
  assert.equal((await api(`models/ratings?project=${project.id}`,{model:'opencode/fixture'})).status,409);
  assert.equal((await api('data/recovery',{confirm:true,restoreID:'explicit-restore:stale'})).status,409);
  await delay(100);assert.deepEqual(calls,[]);assert.equal(JSON.stringify(app.localData.get().currentRatingJob()),original);
  assert.equal(app.automaticWorkAllowed(),false);
  assert.equal((await api('data/recovery',{confirm:true,restoreID:result.restore.id})).body.reviewed,true);
  assert.equal(app.automaticWorkAllowed(),true);
  assert.equal((await api('data/recovery',{confirm:true,restoreID:result.restore.id})).body.reviewed,true);
  const deadline=Date.now()+5000;
  while(!calls.some(call=>call.route.endsWith('/prompt_async'))&&Date.now()<deadline)await delay(20);
  assert.equal(calls.filter(call=>call.route.endsWith('/prompt_async')).length,1);
  await api('models/ratings');await delay(100);
  assert.equal(calls.filter(call=>call.route.endsWith('/prompt_async')).length,1,'Repeated review and status reads release only one retained batch.');
});

test('restore blocks automatic delivery until matching review, releases once, and closes timers',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-recovery-http-'));
  t.after(()=>rm(root,{recursive:true,force:true,maxRetries:8,retryDelay:100}));
  const source=path.join(root,'source'),bundle=path.join(root,'backup'),restored=path.join(root,'restored');
  const sourceStore=createLocalDataStore(source);
  sourceStore.initializeFreshRuntime(FRESH_RUNTIME_ID);
  sourceStore.close();
  await backupLocalData(source,bundle,{quiesced:true});
  const result=await restoreLocalData(bundle,restored,{quiesced:true});

  const fixture=await localDataFixture({timers:false,recoveryDataHome:restored});
  let closed=false;
  t.after(async()=>{if(!closed){closed=true;await fixture.close();}});
  const initial=await fixture.api('data/recovery');
  assert.equal(initial.automaticWorkBlocked,true);
  assert.equal(initial.restoreID,result.restore.id);

  await fixture.api('sender?project=history_project',{id:'recovery-delivery-0001',kind:'queue',text:'Deliver only after recovery review.',model:'opencode/free',session:'ses_history'});
  await delay(1700);
  assert.equal(fixture.calls.filter(call=>call.route==='/session/ses_history/prompt_async').length,0,
    'queued work must not dispatch while the restored workspace is awaiting review');

  await assert.rejects(fixture.api('data/recovery',{confirm:true,restoreID:'explicit-restore:stale'}),error=>error.status===409);
  assert.equal((await fixture.api('data/recovery')).automaticWorkBlocked,true);
  await assert.rejects(fixture.api('data/recovery',{confirm:false,restoreID:result.restore.id}),/Review restored chats/);
  assert.equal((await fixture.api('data/recovery')).automaticWorkBlocked,true);

  const reviewed=await fixture.api('data/recovery',{confirm:true,restoreID:result.restore.id});
  assert.equal(reviewed.reviewed,true);
  assert.equal(reviewed.automaticWorkBlocked,false);
  assert.equal((await fixture.api('data/recovery',{confirm:true,restoreID:result.restore.id})).reviewed,true,
    'repeating review for the current restore must remain idempotent');
  const deadline=Date.now()+5000;
  while(Date.now()<deadline&&fixture.calls.filter(call=>call.route==='/session/ses_history/prompt_async').length===0) await delay(50);
  assert.equal(fixture.calls.filter(call=>call.route==='/session/ses_history/prompt_async').length,1,
    'matching review should start the sender and dispatch the saved item');
  await delay(1800);
  assert.equal(fixture.calls.filter(call=>call.route==='/session/ses_history/prompt_async').length,1,
    'later timer ticks must not replay an accepted delivery');

  await fixture.close(); closed=true;
  const callsAtClose=fixture.calls.length;
  await delay(900);
  assert.equal(fixture.calls.length,callsAtClose,'closing the server must stop background timers');
});
