import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSender } from '../server/sender.mjs';

// Real outbox persistence and production sender/state logic; native execution is
// deliberately simulated. These are lifecycle regressions, not inference proof.
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-sender-recovery-'));
  const file = path.join(root, 'outbox.json');
  const states = new Map(['parent', 'other'].map(session => [session, {
    messages: [], status: { [session]: { type: 'busy' } }, permissions: [], questions: [], receipts: [],
  }]));
  let settings = { chatChoices: { parent: { model: 'opencode/original' }, other: { model: 'opencode/original' } } };
  const records = {}, accepted = [], stops = [], senders = [];
  const controls = { onAccept: null, onBootstrap: null };
  const state = session => {
    const value = states.get(session);
    if (!value) throw Error('Foreign conversation');
    return value;
  };
  const app = {
    store: {
      read: async kind => structuredClone(kind === 'requests' ? { records } : settings),
      update: async (_kind, change) => { settings = change(structuredClone(settings)); },
    },
    chat: async (project, session) => {
      assert.equal(project, 'project');
      return structuredClone(state(session));
    },
    bootstrap: async (_project, session) => {
      await controls.onBootstrap?.(session);
      return { models: [{ id: 'opencode/free', provider: 'opencode', costClass: 'free' }],
        providers: { connected: ['opencode'] }, sessions: [...states.keys()].map(id => ({ id })) };
    },
    send: async (project, session, input) => {
      const id = `native_${accepted.length}`;
      records[id] = { id, projectID: project, sessionID: session };
      accepted.push({ id, session, text: input.text, model: input.model });
      state(session).messages.push({ info: { id, role: 'user', time: { created: Date.now() } },
        parts: [{ type: 'text', text: input.text }] });
      state(session).status = { [session]: { type: 'busy' } };
      settings.chatChoices[session] = { model: input.model };
      await controls.onAccept?.({ id, session });
    },
    stop: async (_project, session) => { stops.push(session); state(session).status = {}; },
  };
  let current;
  const open = async location => {
    current = createSender(app, { file: location });
    senders.push(current);
    await current.ready;
  };
  t.after(async () => {
    for (const sender of senders) await sender.close();
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  });
  await open(file);
  return {
    root, file, accepted, stops, controls, state,
    get sender() { return current; },
    get settings() { return settings; },
    queue: (id, text, session = 'parent') => current.enqueue('project', session,
      { id, kind: 'queue', text, model: 'opencode/free', workflowID: 'build', agentID: 'inherit' }),
    async restart(location = file) { await current.close(); await open(location); },
    complete(session = 'parent') {
      const chat = state(session), user = chat.messages.findLast(message => message.info.role === 'user');
      assert.ok(user, 'Only an observed native request can complete');
      chat.messages.push({ info: { id: `reply_${user.info.id}`, role: 'assistant', parentID: user.info.id,
        finish: 'stop', time: { completed: Date.now() } }, parts: [{ type: 'text', text: 'Recorded fixture completion' }] });
      chat.status = {};
    },
  };
}

test('durable queue survives unavailable state, approval, restart and repeated observations without duplicate delivery', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  await Promise.all(Array.from({ length: 8 }, () => f.queue('queue_first_00001', 'First')));
  await f.queue('queue_second_0002', 'Second');
  await f.sender.tick();
  assert.equal(f.accepted.length, 0);
  f.state('parent').status = { parent: { type: 'disconnected' } };
  await f.sender.tick();
  assert.equal(f.accepted.length, 0);
  assert.match((await f.sender.list('project', 'parent'))[0].notice, /unknown/);
  await f.restart();
  f.state('parent').status = {};
  f.state('parent').permissions = [{ id: 'pending-permission' }];
  await f.sender.tick();
  assert.equal(f.accepted.length, 0);
  f.state('parent').permissions = [];
  await Promise.all(Array.from({ length: 8 }, () => f.sender.tick()));
  assert.deepEqual(f.accepted.map(row => row.text), ['First']);
  await f.restart();
  await Promise.all(Array.from({ length: 8 }, () => f.sender.tick()));
  assert.equal(f.accepted.length, 1, 'A submitted native request is not replayed on restart');
  f.complete();
  await f.sender.tick();
  assert.deepEqual(f.accepted.map(row => row.text), ['First', 'Second']);
  f.complete();
  await f.sender.tick();
  await f.restart();
  assert.deepEqual(await f.sender.list('project', 'parent'), []);
  const previous = await f.queue('queue_first_00001', 'First');
  assert.equal(previous.status, 'delivered');
  await f.sender.tick();
  assert.equal(f.accepted.length, 2);
  assert.equal(f.settings.chatChoices.parent.model, 'opencode/original');
  const disk = JSON.parse(await readFile(f.file, 'utf8'));
  assert.ok(disk.rows.every(row => row.text === undefined), 'Accepted text belongs to native history, not the outbox');
});

test('an actual persisted sending claim recovers as uncertain and never replays a lost acknowledgement', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const crashSnapshot = path.join(f.root, 'acceptance-gap.json');
  f.controls.onAccept = async () => {
    const bytes = await readFile(f.file);
    assert.equal(JSON.parse(bytes).rows[0].status, 'sending');
    // Preserve the exact bytes present at the acceptance/crash boundary. The
    // second controller recovers this snapshot; no process-kill claim is made.
    await writeFile(crashSnapshot, bytes);
    throw Error('Native accepted the request, but its acknowledgement was lost');
  };
  await f.queue('queue_uncertain_01', 'Accepted once');
  await f.queue('queue_after_loss02', 'After review');
  f.state('parent').status = {};
  await f.sender.tick();
  assert.equal(f.accepted.length, 1);
  assert.equal((await f.sender.list('project', 'parent'))[0].status, 'uncertain');
  f.complete();
  await f.restart(crashSnapshot);
  assert.equal((await f.sender.list('project', 'parent'))[0].status, 'uncertain');
  await Promise.all(Array.from({ length: 16 }, () => f.sender.tick()));
  assert.equal(f.accepted.length, 1, 'Native idle cannot authorize replay or bypass an uncertain delivery');
  assert.equal((await f.queue('queue_uncertain_01', 'Accepted once')).status, 'uncertain');
  await f.sender.cancel('project', 'parent', 'queue_uncertain_01');
  f.controls.onAccept = null;
  await f.sender.tick();
  assert.deepEqual(f.accepted.map(row => row.text), ['Accepted once', 'After review']);
  assert.equal(f.settings.chatChoices.parent.model, 'opencode/original');
});

test('stop and restart cancel only the selected conversation queue while another native turn survives', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  await f.queue('queue_cancelled_01', 'Never send');
  await f.queue('queue_other_chat02', 'Other conversation', 'other');
  f.state('other').status = {};
  await f.sender.tick();
  assert.deepEqual(f.accepted.map(row => row.session), ['other']);
  await f.sender.stop('project', 'parent');
  assert.deepEqual(f.stops, ['parent']);
  assert.equal(f.state('other').status.other.type, 'busy');
  await f.restart();
  await f.sender.tick();
  assert.deepEqual(await f.sender.list('project', 'parent'), []);
  assert.equal((await f.sender.list('project', 'other'))[0].status, 'submitted');
  f.complete('other');
  await f.sender.tick();
  assert.equal(f.accepted.length, 1);
  assert.deepEqual(await f.sender.list('project', 'other'), []);
  await assert.rejects(f.sender.list('foreign-project', 'other'));
});

test('a new approval arriving during model lookup is rechecked before a delivery claim is written', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  await f.queue('queue_lookup_race1', 'Wait for approval');
  f.state('parent').status = {};
  f.controls.onBootstrap = async session => { f.state(session).questions = [{ id: 'new-question' }]; };
  await f.sender.tick();
  assert.equal(f.accepted.length, 0);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).rows[0].status, 'waiting');
  f.controls.onBootstrap = null;
  f.state('parent').questions = [];
  await f.sender.tick();
  assert.equal(f.accepted.length, 1);
});
