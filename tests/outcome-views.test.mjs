import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../server/data/store.mjs';
import { FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';

const runtimeA=FRESH_RUNTIME_ID;
const runtimeB='outcome-fixture-runtime';
const taskID=n=>String(n).repeat(64).slice(0,64);
const entry=(id,{type=['api'],model='provider/model-a',success,verification,extra={}}={})=>({
  task_id:id,user_task_id:`user-${id.slice(0,4)}`,timestamp:'2026-10-01T12:00:00.000Z',repo:'C:/Fixture',
  task_type:type,model,success,verification_status:verification,secret_token:'never-select-this',...extra,
});

test('outcome views normalize verification states, keep execution success separate, and group by runtime/type/model in readonly analytics',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-outcome-views-'));
  const store=createLocalDataStore(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.initializeFreshRuntime(runtimeA);
  const db=new DatabaseSync(store.filename);
  assert.deepEqual(db.prepare("SELECT table_name,lifecycle,owner,introduced_version FROM data_table_lifecycle WHERE owner='task-outcomes' ORDER BY table_name")
    .all().map(row=>({...row})),[
      {table_name:'knowledge_outcome_summary',lifecycle:'derived',owner:'task-outcomes',introduced_version:20},
      {table_name:'knowledge_task_outcomes',lifecycle:'derived',owner:'task-outcomes',introduced_version:20},
    ]);
  const outcomes=[
    entry(taskID(1),{success:true,verification:'passed',type:['api','repair']}),
    entry(taskID(2),{success:false,verification:'failed'}),
    entry(taskID(3),{success:false,verification:'skipped'}),
    entry(taskID(4),{success:false,verification:'unavailable'}),
    entry(taskID(5),{success:true,verification:'not-run'}),
    entry(taskID(6),{success:true,verification:'unverified'}),
    entry(taskID(7),{success:false,verification:'cancelled'}),
    entry(taskID(8),{success:null,verification:undefined}),
  ];
  db.prepare('INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?)')
    .run(runtimeA,'task-history.json',JSON.stringify({version:1,entries:[...outcomes,'interrupted',null,99,true,['nested']]}));
  const workerID=taskID(1);
  db.prepare('INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?)')
    .run(runtimeA,`delegation/${workerID}.json`,JSON.stringify({status:'completed',attempts:[{status:'completed',observed_model:'provider/model-a',secret:'not projected'}]}));
  db.prepare('INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?)')
    .run(runtimeB,'task-history.json',JSON.stringify({version:1,entries:[entry(taskID(9),{success:true,verification:'passed',model:'provider/model-b'})]}));
  db.prepare('INSERT INTO application_documents(runtime_id,document_key,data) VALUES(?,?,?)')
    .run(runtimeA,`delegation/${taskID(8)}.json`,'not-json');
  db.close();

  const summary=await store.analyze(`SELECT runtime_id,task_type,model,total,passed,failed,skipped,unavailable,not_run,unknown,cancelled,
    verified_denominator,verified_passes,execution_successes,execution_failures,execution_unknown
    FROM knowledge_outcome_summary WHERE runtime_id=$runtime AND task_type=$type AND model=$model`,
    {$runtime:runtimeA,$type:'api',$model:'provider/model-a'});
  assert.equal(summary.rows.length,1);
  assert.deepEqual(summary.rows[0],{
    runtime_id:runtimeA,task_type:'api',model:'provider/model-a',total:8,passed:1,failed:1,skipped:1,unavailable:1,
    not_run:1,unknown:2,cancelled:1,verified_denominator:2,verified_passes:1,
    execution_successes:3,execution_failures:4,execution_unknown:1,
  });

  const worker=await store.analyze(`SELECT task_id,outcome_status,execution_success,native_worker_status,native_worker_attempt_status,
    native_worker_observed_model FROM knowledge_task_outcomes WHERE runtime_id=$runtime AND task_id=$id`,
    {$runtime:runtimeA,$id:workerID});
  assert.deepEqual(worker.rows,[{
    task_id:workerID,outcome_status:'passed',execution_success:1,native_worker_status:'completed',
    native_worker_attempt_status:'completed',native_worker_observed_model:'provider/model-a',
  },{
    task_id:workerID,outcome_status:'passed',execution_success:1,native_worker_status:'completed',
    native_worker_attempt_status:'completed',native_worker_observed_model:'provider/model-a',
  }]);
  assert.equal(worker.columns.some(name=>/secret|token|attempts_json|consumption/i.test(name)),false);
  const malformedWorker=await store.analyze('SELECT outcome_status,native_worker_status FROM knowledge_task_outcomes WHERE runtime_id=$runtime AND task_id=$id',
    {$runtime:runtimeA,$id:taskID(8)});
  assert.deepEqual(malformedWorker.rows,[{outcome_status:'unknown',native_worker_status:null}],
    'primitive history entries and malformed worker receipts cannot poison aggregate reads');

  const otherRuntime=await store.analyze('SELECT runtime_id,task_type,model,total FROM knowledge_outcome_summary WHERE runtime_id=$runtime',{$runtime:runtimeB});
  assert.deepEqual(otherRuntime.rows,[{runtime_id:runtimeB,task_type:'api',model:'provider/model-b',total:1}]);
});
