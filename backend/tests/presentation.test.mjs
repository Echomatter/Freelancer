import test from 'node:test';
import assert from 'node:assert/strict';
import {taskCard,restoreDelegateTools,createPresenter,completionMetadata,handoffPreview} from '../tools/runtime/presentation.mjs';
import { activityOf } from '../tools/runtime/activity.mjs';
const part=()=>({id:'prt_1',sessionID:'parent',messageID:'msg_1',callID:'call1',type:'tool',tool:'delegate',state:{status:'running',input:{role:'researcher',task:'Inspect math',needsWrites:false},metadata:{sessionId:'child',role:'researcher',selected_model:'opencode/free'},time:{start:1}}});
test('host completion can replace all metadata without losing original delegate identity',()=>{
 const original=part(), card=taskCard(original);
 const receipt={parent_session:'parent',role:'researcher',status:'completed',task_id:'id',activity:{label:'Finished'},attempts:[{child_session:'child',selected_model:'opencode/free'}]};
 card.state.status='completed';card.state.output=JSON.stringify(receipt);
 card.state.metadata=completionMetadata(receipt,original.state.input);
 restoreDelegateTools([{parts:[card]}]);
 assert.equal(card.tool,'delegate');assert.deepEqual(card.state.input,original.state.input);
 assert.equal(card.callID,original.callID);assert.equal(card.state.metadata.sessionId,'child');
});
test('native card points to the real child and restores exact model-visible tool history',()=>{
 const original=part(),card=taskCard(original);assert.equal(card.tool,'task');assert.equal(card.state.metadata.sessionId,'child');assert.equal(card.callID,original.callID);
 const messages=[{parts:[card]}];restoreDelegateTools(messages);assert.deepEqual(messages[0].parts[0],original);
});
test('completion recovers child link from durable receipt; no-route has no fake agent',()=>{
 const p=part();p.state.status='completed';p.state.metadata={truncated:false};p.state.output=JSON.stringify({parent_session:'parent',role:'researcher',attempts:[{child_session:'child',selected_model:'opencode/free'}]});
 assert.equal(taskCard(p).state.metadata.sessionId,'child');p.state.output=JSON.stringify({parent_session:'parent',role:'researcher',status:'selection_required',attempts:[]});
 const request=taskCard(p);assert.notEqual(request.tool,'task');assert.equal(request.state.metadata.sessionId,undefined);assert.match(request.tool,/Choosing a model/);
});
test('display adapter never prompts or creates sessions; ignores its own updates',async()=>{
 let updated;const client={session:{get:async()=>({data:{parentID:'parent',metadata:{freelancer:{selected:'opencode/free'}}}})},part:{update:async args=>{updated=args.body;return{data:args.body}}}};
 const present=createPresenter({client,directory:'repo'});assert.equal(await present(part()),true);assert.equal(updated.id,'prt_1');assert.equal(await present(updated),false);
 client.session.get=async()=>({data:{parentID:'other'}});assert.equal(await present(part()),false);
});
test('restored display-disabled calls are not automatically converted again',()=>{
 const p=part();p.state.metadata.freelancer_display_disabled=true;assert.equal(taskCard(p),null);
});
test('injected v1 transport supports the documented part endpoint',async()=>{
 let request;const client={session:{get:async()=>({data:{parentID:'parent',metadata:{freelancer:{selected:'opencode/free'}}}})},_client:{patch:async args=>{request=args;return{data:args.body}}}};
 assert.equal(await createPresenter({client,directory:'repo'})(part()),true);
 assert.equal(request.url,'/session/{sessionID}/message/{messageID}/part/{partID}');assert.equal(request.path.partID,'prt_1');
});

test('live metadata uses authenticated part updates, preserves linkage and isolates simultaneous calls', async()=>{
 let saved=part(); saved.state.title="Existing title";
 const client={session:{message:async()=>({data:{parts:[saved]}}),get:async()=>({data:{parentID:'parent',metadata:{freelancer:{selected:'opencode/free'}}}})},part:{update:async args=>{saved=args.body;return{data:saved}}}};
 const present=createPresenter({client,directory:'repo'});
 const ctx={sessionID:'parent',messageID:'msg_1',callID:'call1'};
 await present.metadata(ctx,{metadata:{freelancer_activity:{label:'read · model-evidence.json'}}});
 assert.equal(saved.state.input.description,'Inspect math'); assert.equal(saved.state.title,'Existing title');
 assert.equal(saved.tool,'task'); assert.equal(saved.state.metadata.sessionId,'child');
 await present.metadata(ctx,{metadata:{freelancer_activity:{label:'Working · 2 tool calls completed'}}});
 assert.equal(saved.state.input.description,'Inspect math');assert.match(saved.state.metadata.freelancer_activity.label,/2 tool calls/);
 const prior=structuredClone(saved);
 assert.equal(await present.metadata({...ctx,callID:'other'},{metadata:{}}),false);
 assert.deepEqual(saved,prior);
 restoreDelegateTools([{parts:[saved]}]);
 assert.equal(saved.tool,'delegate'); assert.equal(saved.state.input.task,'Inspect math');
});

test('status reveals current tool and basename, never reasoning, command or raw output',()=>{
 const result=activityOf([{info:{role:'assistant'},parts:[{type:'reasoning',text:'private reasoning'},
 {id:'p',type:'tool',tool:'read',state:{status:'running',input:{filePath:'C:\\private\\code.ps1',command:'secret command'},output:'secret output'}}]}],5000);
 assert.equal(result.label,'read · code.ps1'); assert.equal(result.elapsed_ms,5000);
 assert.doesNotMatch(JSON.stringify(result),/private|secret/);
});
test('unknown display marker versions are ignored without recursion',()=>{
 const p=part();p.tool='task';p.state.metadata.freelancer_delegate_display={version:999,original_tool:'delegate'};
 assert.equal(taskCard(p),null);
});

test('two concurrent delegate calls update separate native cards and restore both histories', async () => {
 const first=part(), second=part();
 second.id='prt_2'; second.callID='call2'; second.state.input.task='Inspect tests'; second.state.metadata.sessionId='child2';
 const saved=new Map([[first.id,first],[second.id,second]]);
 const client={session:{message:async()=>({data:{parts:[...saved.values()]}}),get:async()=>({data:{parentID:'parent',metadata:{freelancer:{selected:'opencode/free'}}}})},
  part:{update:async args=>{saved.set(args.body.id,args.body);return{data:args.body}}}};
 const present=createPresenter({client,directory:'repo'});
 await Promise.all(['call1','call2'].map((callID,i)=>present.metadata({sessionID:'parent',messageID:'msg_1',callID},
  {metadata:{freelancer_activity:{label:`Working ${i+1}`}}})));
 const cards=[...saved.values()];
 assert.deepEqual(cards.map(p=>p.tool),['task','task']);
 assert.deepEqual(cards.map(p=>p.state.metadata.sessionId),['child','child2']);
 assert.equal(cards[0].state.input.description,'Inspect math'); assert.equal(cards[1].state.input.description,'Inspect tests');
 restoreDelegateTools([{parts:cards}]);
 assert.deepEqual(cards.map(p=>p.state.input.task),['Inspect math','Inspect tests']);
 assert.deepEqual(cards.map(p=>p.callID),['call1','call2']);
});

test('legacy display markers remain reversible after V1 migration',()=>{
 const original=part();const card=taskCard(original);
 card.state.metadata.ai_toolkit_delegate_display=card.state.metadata.freelancer_delegate_display;
 delete card.state.metadata.freelancer_delegate_display;
 restoreDelegateTools([{parts:[card]}]);assert.deepEqual(card,original);
});
test('request previews contain prompt text without argument blobs and restore exact history',()=>{
 const original=part();original.state.metadata={};original.state.input.task='Inspect math. '.repeat(80);
 const card=taskCard(original);assert.deepEqual(card.state.input,{});assert.match(card.tool,/Inspect math/);assert.ok(card.tool.length<430);
 assert.doesNotMatch(card.tool,/needsWrites|task=|selected_model/);assert.equal(taskCard(card),null);
 restoreDelegateTools([{parts:[card]}]);assert.deepEqual(card,original);
 assert.equal(handoffPreview('first\n\nsecond\u001b[31m'),'first second');
});
test('completion updates request phase and failed child cards without claiming success',()=>{
 const original=part();original.state.metadata={};const request=taskCard(original);
 const receipt={parent_session:'parent',role:'researcher',status:'selection_required',attempts:[]};
 request.state.status='completed';request.state.output=JSON.stringify(receipt);request.state.metadata=completionMetadata(receipt,original.state.input);
 const complete=taskCard(request);assert.match(complete.tool,/Choosing a model/);assert.equal(taskCard(complete),null);
 const failed=part();failed.state.status='completed';failed.state.output=JSON.stringify({parent_session:'parent',role:'researcher',status:'decision_required',attempts:[{child_session:'child',selected_model:'opencode/free',status:'failed'}]});
 assert.match(taskCard(failed).state.input.description,/^Stopped/);
});
