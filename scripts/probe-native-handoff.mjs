// Exercises the installed native runner with a deterministic local provider.
// No account credentials, paid inference, or user sessions are used.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { startHost } from '../server/host.mjs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { modelInputEvidence } from '../backend/tools/runtime/input-observations.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-handoff-'));
const calls = [];
let hold = false, release;
let toolMode = false, toolRelease, toolEntered = false;
const provider = http.createServer(async (req, res) => {
  if (req.url === '/gate') { toolEntered = true; await new Promise(resolve => toolRelease = resolve); res.end('Tool finished'); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); calls.push(body);
  if (hold) { hold = false; await new Promise(resolve => release = resolve); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  if (toolMode) { toolMode = false; chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_probe', type: 'function', function: { name: 'probe', arguments: '{}' } }] }); chunk({}, 'tool_calls'); }
  else { chunk({ role: 'assistant', content: 'Verified local probe response.' }); chunk({}, 'stop'); }
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
const configDir = path.join(root, 'config'); await mkdir(configDir);
// Both native config directories must already have dependencies. Otherwise
// first-instance setup may attempt a registry install unrelated to the probe.
for (const folder of [configDir, path.join(root, 'opencode')]) {
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'package.json'), JSON.stringify({ dependencies: { '@opencode-ai/plugin': '1.18.31' } }));
  await symlink(path.resolve('node_modules'), path.join(folder, 'node_modules'), 'junction');
}
await writeFile(path.join(root, 'probe-plugin.mjs'), `import {tool} from ${JSON.stringify(pathToFileURL(path.resolve('node_modules/@opencode-ai/plugin/dist/index.js')).href)};
import {recordModelInput} from ${JSON.stringify(pathToFileURL(path.resolve('backend/tools/runtime/input-observations.mjs')).href)};
export default async () => ({'experimental.chat.messages.transform':async(_input,output)=>recordModelInput(${JSON.stringify(root)},output.messages),tool:{probe:tool({description:'Run a local boundary probe',args:{},async execute(args,ctx){await ctx.ask({permission:'probe',patterns:['local'],always:[],metadata:{}});return await fetch('http://127.0.0.1:${provider.address().port}/gate').then(r=>r.text());}})}});`);
await writeFile(path.join(configDir, 'opencode.json'), JSON.stringify({
  $schema: 'https://opencode.ai/config.json', model: 'probe/probe', small_model: 'probe/probe',
  provider: { probe: { npm: '@ai-sdk/openai-compatible', name: 'Local probe', options: { baseURL: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'local-probe' }, models: { probe: { name: 'Probe', limit: { context: 32000, output: 1000 } } } } },
  plugin: [pathToFileURL(path.join(root, 'probe-plugin.mjs')).href],
  agent: { build: { permission: { '*': 'deny', probe: 'ask' } }, title: { disable: true } },
}));
const host = await startHost({ backendRoot: root, config: { backendRoot: root, opencodeConfigDir: configDir, xdgConfigHome: root, xdgDataHome: path.join(root, 'data'), dataRoot: root } });
const wait = async predicate => { for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Probe timed out'); };
try {
  const health = await host.request('/global/health');
  console.log('Native health', health);
  let session = await host.request('/session', { method: 'POST', directory: root, body: { title: 'Handoff boundary probe' } });
  const prompt = text => host.request(`/session/${session.id}/prompt_async`, { method: 'POST', directory: root, body: { agent: 'build', model: { providerID: 'probe', modelID: 'probe' }, parts: [{ type: 'text', text }] } });
  const messages = () => host.request(`/session/${session.id}/message`, { directory: root });
  hold = true; await prompt('INITIAL'); await wait(() => !!release);
  await prompt('STEER_ONE'); await prompt('STEER_TWO');
  await wait(async () => (await messages()).filter(m => m.info.role === 'user').length === 3);
  release(); await wait(async () => !(await host.request('/session/status', { directory: root }))[session.id]);
  const results = [{ scenario: 'input during inference and two rapid steers', calls: calls.length, messages: await messages() }];
  const observed = await modelInputEvidence(root, session.id, results[0].messages);
  const steerIDs = results[0].messages.filter(m => m.parts.some(p => /^STEER_/.test(p.text ?? ''))).map(m => m.info.id);
  assert.ok(observed.some(e => steerIDs.every(id => e.messageIDs.includes(id))), 'Both steers have durable input evidence backed by a native response');
  assert.ok(calls.some(c => JSON.stringify(c.messages).includes('STEER_ONE') && JSON.stringify(c.messages).includes('STEER_TWO')));
  console.log('PASS inference input, two rapid steers and durable input evidence');
  // A permission blocks the tool; input must remain saved without aborting it.
  toolMode = true; await prompt('TOOL_ROUND');
  let permission; await wait(async () => { permission = (await host.request('/permission', { directory: root }))[0]; return permission; });
  await prompt('STEER_DURING_PERMISSION');
  await host.request(`/permission/${permission.id}/reply`, { method: 'POST', directory: root, body: { reply: 'once' } });
  await wait(() => toolEntered); await prompt('STEER_DURING_TOOL'); toolRelease();
  await wait(async () => !(await host.request('/session/status', { directory: root }))[session.id]);
  results.push({ scenario: 'pending permission and input during tool call', messages: await messages() });
  assert.ok(calls.some(c => JSON.stringify(c.messages).includes('STEER_DURING_TOOL') && JSON.stringify(c.messages).includes('STEER_DURING_PERMISSION')));
  console.log('PASS permission and executing-tool boundaries');
  // Release the provider's final output and admit a correction concurrently.
  // A retained but unconsumed input is an inspectable outcome, never proof of
  // application and never a reason to resubmit the original assignment.
  hold = true; release = undefined;
  await prompt('TURN_END_RACE_START'); await wait(() => !!release);
  release(); await prompt('STEER_AT_TURN_END');
  await wait(async () => (await messages()).some(m => m.parts.some(p => p.text === 'STEER_AT_TURN_END')));
  await wait(async () => !(await host.request('/session/status', { directory: root }))[session.id]);
  const raceMessages = await messages();
  assert.equal(raceMessages.filter(m => m.parts.some(p => p.text === 'STEER_AT_TURN_END')).length, 1);
  const consumed = calls.some(c => JSON.stringify(c.messages).includes('STEER_AT_TURN_END'));
  results.push({ scenario: 'input concurrent with final output', consumed, messages: raceMessages });
  console.log('PASS turn-ending race: retained once, included in model input =', consumed);
  // Idle-after-completion is the other side of the turn-ending race.
  await prompt('LATE_AFTER_TURN'); await wait(async () => (await messages()).some(m => m.info.role === 'assistant' && m.info.time?.completed && m.info.parentID === (results.at(-1).lateID)) || calls.some(c => JSON.stringify(c.messages).includes('LATE_AFTER_TURN')));
  await wait(async () => !(await host.request('/session/status', { directory: root }))[session.id]);
  results.push({ scenario: 'input after turn completion', messages: await messages() });
  await host.request(`/session/${session.id}/summarize`, { method: 'POST', directory: root, body: { providerID: 'probe', modelID: 'probe' } });
  await wait(async () => !(await host.request('/session/status', { directory: root }))[session.id]);
  await prompt('AFTER_COMPACTION'); await wait(() => calls.some(c => JSON.stringify(c.messages).includes('AFTER_COMPACTION')));
  await wait(async () => !(await host.request('/session/status', { directory: root }))[session.id]);
  results.push({ scenario: 'compaction then same-session continuation', messages: await messages() });
  // The caller deliberately loses acceptance; inspection finds one native record.
  await prompt('LOST_ACK_INSPECT_ONLY').then(() => { throw Error('simulated lost client acknowledgement'); }).catch(() => {});
  await wait(async () => (await messages()).some(m => m.parts.some(p => p.text === 'LOST_ACK_INSPECT_ONLY')));
  results.push({ scenario: 'lost client acknowledgement without replay', messages: await messages() });
  const report = { root, native: health.version, calls: calls.map(c => c.messages), results, messages: await messages() };
  await mkdir('artifacts/verification', { recursive: true });
  await writeFile('artifacts/verification/native-handoff.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ inferenceCalls: calls.length, sessionID: session.id, scenarios: results.map(r => r.scenario), evidence: 'artifacts/verification/native-handoff.json' }, null, 2));
} finally { release?.(); toolRelease?.(); host.stop(); provider.closeAllConnections(); provider.close(); }
