// Isolated browser acceptance workspace: simulated native messages/permissions,
// actual application, HTTP adapter and temporary project. No model inference.
import { unifiedFixture } from './unified-agents.mjs';
import { startServer } from '../../server/http.mjs';
import path from 'node:path';
const cleanup = [];
const f = await unifiedFixture({ after: fn => cleanup.push(fn) });
await f.send();
let pending = true;
const original = f.host.request.bind(f.host);
f.host.request = async (route, options) => {
  if (route === '/permission') return pending ? [{ id:'per_fixture', sessionID:f.parent.id, permission:'paid_delegate', patterns:['opencode-go/paid'], metadata:{ description:'Test paid agent approval' } }] : [];
  if (route === '/permission/per_fixture/reply') { pending = false; f.status[f.parent.id] = {type:'idle'}; return true; }
  return original(route, options);
};
f.status[f.parent.id] = {type:'busy'};
f.rows.set(f.parent.id, [
 { info:{id:'qa-user',role:'user'},parts:[{type:'text',text:'Inspect this disposable project and explain the result.'}] },
 { info:{id:'qa-assistant',role:'assistant',agent:'engineer',modelID:'free-a',providerID:'opencode'},parts:[
  {id:'qa-read',type:'tool',tool:'read',state:{status:'completed',input:{filePath:'sample.txt'},output:'A sample project file.'}},
  {id:'qa-prose',type:'text',text:'The project is ready. A paid helper is waiting for your decision.'}
 ]}
]);
const web = await startServer({application:f.app,assets:path.resolve('dist')});
console.log(JSON.stringify({url:web.url,project:f.project.id,session:f.parent.id,directory:f.directory}));
process.on('SIGINT',async()=>{await web.sender.close();web.server.closeAllConnections();await new Promise(r=>web.server.close(r));for(const fn of cleanup.reverse())await fn();process.exit();});
