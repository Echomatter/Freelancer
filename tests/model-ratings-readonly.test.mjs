import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModelRatingService } from '../server/model-ratings.mjs';
import { createStore } from '../server/store.mjs';
import { createExecutionContextReader } from '../backend/tools/runtime/execution-context.mjs';
import { createDelegator } from '../backend/tools/runtime/delegation.mjs';

const scores = { coding: 70, reasoning: 60, research: 55, tool_use: 80, instruction_following: 75 };
const denied = permission => permission.filter(rule => rule.action === 'deny' && rule.pattern === '*').map(rule => rule.permission);

async function until(condition, label) {
  for (let i = 0; i < 150; i++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.fail(label);
}

async function fixture(t, targetCount = 1, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-ratings-readonly-'));
  const targets = Array.from({ length: targetCount }, (_, i) => ({ id: `opencode/rating${i}`, provider: 'opencode', name: `Target ${i}` }));
  const models = [...targets, { id: 'opencode/worker', provider: 'opencode', name: 'Worker' }];
  const store = createStore(root);
  const calls = [], sessions = new Map(), messages = new Map();
  let created = 0;
  const host = { async request(route, requestOptions = {}) {
    calls.push({ route, options: requestOptions });
    if (route === '/session' && requestOptions.method === 'POST') {
      const id = `ses_config${++created}`;
      const session = { id, directory: root };
      // 'echo' keeps the submitted rules, 'drop' returns an unprotected session,
      // 'omit' answers without a permission field at all.
      if (options.permission === 'drop') session.permission = [];
      else if (options.permission !== 'omit') session.permission = requestOptions.body?.permission;
      sessions.set(id, session);
      messages.set(id, []);
      return session;
    }
    if (route.endsWith('/prompt_async')) return {};
    if (route.endsWith('/message')) return messages.get(route.split('/')[2]) ?? [];
    if (route === '/session/status') return Object.fromEntries([...sessions.keys()].map(id => [id, { type: 'idle' }]));
    if (route === '/permission' || route === '/question') return [];
    if (route.endsWith('/abort')) return true;
    throw Error(route);
  } };
  const serviceOptions = { host, backendRoot: root, dataRoot: root, store,
    project: async () => ({ id: 'p', directory: root }),
    getCatalog: async () => ({ models, providers: { connected: ['opencode'] } }) };
  const open = new Set();
  const make = () => { const service = createModelRatingService(serviceOptions); open.add(service); return service; };
  const f = { root, store, calls, sessions, messages, targets, service: make() };
  f.service.catalog(targets);
  f.restart = () => { f.service.close(); open.delete(f.service); f.service = make(); return f.service; };
  f.prompts = () => calls.filter(call => call.route.endsWith('/prompt_async'));
  f.recordOf = async messageID => (await store.read('requests')).records[messageID];
  f.reply = ids => {
    const prompt = f.prompts().at(-1);
    messages.get(prompt.route.split('/')[2]).push({ info: { role: 'assistant', parentID: prompt.options.body.messageID,
      finish: 'stop', time: { completed: Date.now() } },
      parts: [{ type: 'text', text: JSON.stringify({ models: ids.map(id => ({ id, scores, summary: 'Estimated from model card', sources: [] })) }) }] });
  };
  t.after(async () => { for (const service of open) { try { service.close(); } catch {} } await rm(root, { recursive: true, force: true }); });
  return f;
}

test('background configuration prompts capture authoritative readOnly and native deny rules', async t => {
  const f = await fixture(t, 1);
  const job = await f.service.start('p', 'opencode/worker');
  const creation = f.calls.find(call => call.route === '/session');
  assert.deepEqual(denied(creation.options.body.permission), ['write', 'apply_patch', 'edit']);
  assert.ok(creation.options.body.permission.some(rule => rule.permission === 'edit' &&
    rule.pattern === 'content-index database' && rule.action === 'allow'), 'scoped content-index rebuild stays allowed');
  assert.deepEqual(denied(f.sessions.get(job.session).permission), ['write', 'apply_patch', 'edit'],
    'the native session keeps the inspection-only deny rules');
  const prompt = f.prompts()[0];
  const record = await f.recordOf(prompt.options.body.messageID);
  assert.equal(record.readOnly, true, 'the root batch request is captured read-only');
  assert.equal(record.sessionID, job.session);
  assert.equal(record.directory, f.root);
  assert.equal(record.policyVersion, 6);
  assert.equal(record.agent?.id, 'researcher');
  const context = await createExecutionContextReader()(f.root, f.root, { id: job.session },
    { info: { role: 'assistant', agent: 'researcher', parentID: prompt.options.body.messageID } });
  assert.equal(context?.readOnly, true, 'execution context resolves inspection-only for native guards');
});

test('later batches and a resumed service preserve the captured inspection-only state', async t => {
  const f = await fixture(t, 7);
  const job = await f.service.start('p', 'opencode/worker');
  await until(() => f.prompts().length === 1, 'first batch dispatched');
  f.reply(job.targets.slice(0, 6));
  await until(async () => f.prompts().length === 2, 'second batch dispatched');
  const [first, second] = f.prompts();
  assert.equal((await f.recordOf(first.options.body.messageID)).readOnly, true, 'root batch stays read-only');
  assert.equal((await f.recordOf(second.options.body.messageID)).readOnly, true, 'later batch stays read-only');
  f.restart();
  // A record written before this change carries no readOnly state at all.
  await f.store.recordRequest({ id: second.options.body.messageID, readOnly: false });
  f.service.status();
  await until(async () => (await f.recordOf(second.options.body.messageID)).readOnly === true,
    'resume reasserts inspection-only on the in-flight batch');
  f.reply(job.targets.slice(6));
  await until(async () => f.service.status().status === 'completed', 'job completes after resume');
  const records = await f.store.read('requests');
  const own = Object.values(records.records).filter(row => row.sessionID === job.session);
  assert.ok(own.length >= 2, 'both batches left durable request records');
  assert.ok(own.every(row => row.readOnly === true), 'every captured background request stays inspection-only');
});

test('mutating tools cannot be silently authorized for background research sessions', async t => {
  const f = await fixture(t, 1);
  const job = await f.service.start('p', 'opencode/worker');
  const messageID = f.prompts()[0].options.body.messageID;
  f.messages.get(job.session).push({ info: { id: 'msg_answer', role: 'assistant', agent: 'researcher',
    parentID: messageID, time: { created: 1, completed: 2 }, finish: 'tool-calls' }, parts: [] });
  const delegator = createDelegator({ client: { session: {
    get: async ({ path: { id } }) => ({ data: f.sessions.get(id) }),
    messages: async ({ path: { id } }) => ({ data: f.messages.get(id) ?? [] }),
  } }, toolkitRoot: f.root, directory: f.root });
  const call = tool => delegator.checkTool({ sessionID: job.session, directory: f.root, tool }, { args: {} });
  for (const tool of ['edit', 'write', 'apply_patch']) await assert.rejects(call(tool), /Read-only/);
  await call('read');
  // The guard reads the captured record: a prose-only record would authorize writes.
  await f.store.recordRequest({ id: messageID, readOnly: false });
  await call('edit');
  await f.store.recordRequest({ id: messageID, readOnly: true });
  await assert.rejects(call('edit'), /Read-only/);
});

test('a native session that drops the inspection-only rules fails closed', async t => {
  const f = await fixture(t, 1, { permission: 'drop' });
  await assert.rejects(f.service.start('p', 'opencode/worker'), /native configuration session could not be verified/);
  assert.equal(f.prompts().length, 0, 'no research prompt is dispatched into an unprotected session');
});

test('a host that omits the permission field still records inspection-only requests', async t => {
  const f = await fixture(t, 1, { permission: 'omit' });
  const job = await f.service.start('p', 'opencode/worker');
  assert.equal(f.sessions.get(job.session).permission, undefined);
  const record = await f.recordOf(f.prompts()[0].options.body.messageID);
  assert.equal(record.readOnly, true, 'the recorded execution context remains the authoritative guard');
});
