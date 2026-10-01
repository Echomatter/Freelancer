import { DatabaseSync } from 'node:sqlite';
import { recordDatabasePath, readRuntimeRequest, withRecordDatabase } from '../backend/tools/runtime/record-database.mjs';
import { executionContext } from '../backend/tools/runtime/execution-context.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "../server/store.mjs";
async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('legacy ledgers migrate once, retain backup bytes and survive reopening', async t => {
  const root = await temporaryRoot(t), store = createStore(root);
  await mkdir(store.directory, { recursive: true });
  for (const name of ['requests', 'usage']) {
    const file = path.join(store.directory, `${name}.json`);
    const legacy = JSON.stringify({ version: 1, records: { old: { id: 'old', tokens: 12 } } }, null, 2);
    await writeFile(file, legacy);
    assert.equal((await store.read(name)).records.old.tokens, 12);
    await store.update(name, data => ({ ...data, records: { ...data.records, new: { id: 'new' } } }));
    assert.equal(await readFile(file, 'utf8'), legacy);
    // A leftover or older-version JSON writer must not overwrite migrated rows.
    await writeFile(file, '{stale');
    assert.deepEqual(Object.keys((await createStore(root).read(name)).records), ['old', 'new']);
  }
  assert.equal((await readRuntimeRequest(root, 'old')).tokens, 12);
  assert.equal(await readRuntimeRequest(root, 'missing'), null);
});

test('invalid legacy records abort migration and cannot be overwritten', async t => {
  const root = await temporaryRoot(t), store = createStore(root);
  await mkdir(store.directory, { recursive: true });
  const file = path.join(store.directory, 'requests.json');
  for (const text of ['{broken', '{"version":2,"records":{}}', '{"version":1,"records":{"valid":{"id":"valid"},"broken":null}}']) {
    await writeFile(file, text);
    await assert.rejects(store.recordRequest({ id: 'new' }), /Cannot read requests/);
    assert.equal(await readFile(file, 'utf8'), text);
    const db = new DatabaseSync(recordDatabasePath(root), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT count(*) n FROM records').get().n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM collections').get().n, 0);
    } finally { db.close(); }
  }
});

test('row transactions roll back a failed batch and the store remains usable', async t => {
  const root = await temporaryRoot(t), store = createStore(root);
  await store.observe([{ id: 'one', tokens: 1 }]);
  const db = new DatabaseSync(recordDatabasePath(root));
  try {
    db.exec("CREATE TRIGGER reject_bad BEFORE INSERT ON records WHEN NEW.id='bad' BEGIN SELECT RAISE(ABORT,'injected write failure'); END;");
    await assert.rejects(store.observe([{ id: 'one', tokens: 99 }, { id: 'bad', tokens: 2 }]), /injected write failure/);
    assert.deepEqual((await store.read('usage')).records, { one: { id: 'one', tokens: 1 } });
  } finally { db.close(); }
  await store.observe([{ id: 'two', tokens: 2 }]);
  assert.equal((await store.read('usage')).records.two.tokens, 2);
});

test('an interrupted import transaction leaves its backup and can safely retry', async t => {
  const root = await temporaryRoot(t), store = createStore(root);
  withRecordDatabase(root, true, db => db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON records WHEN NEW.id='second' BEGIN SELECT RAISE(ABORT,'import interrupted'); END;"));
  const file = path.join(store.directory, 'requests.json');
  const legacy = JSON.stringify({ version: 1, records: { first: { id: 'first' }, second: { id: 'second' } } });
  await writeFile(file, legacy);
  await assert.rejects(store.read('requests'), /Cannot read requests/);
  withRecordDatabase(root, true, db => {
    assert.equal(db.prepare('SELECT count(*) n FROM records').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM collections').get().n, 0);
    db.exec('DROP TRIGGER fail_import');
  });
  assert.deepEqual(Object.keys((await store.read('requests')).records), ['first', 'second']);
  assert.equal(await readFile(file, 'utf8'), legacy);
});

test('native authority uses migrated receipts and still rejects an agent mismatch', async t => {
  const root = await temporaryRoot(t), store = createStore(root);
  await store.recordRequest({ id: 'msg_root', sessionID: 'ses_root', directory: root,
    policyVersion: 6, agent: { id: 'engineer', name: 'Captured engineer' }, preferences: { concurrency: 2 } });
  const message = { role: 'assistant', parentID: 'msg_root', agent: 'engineer' };
  assert.equal((await executionContext(root, root, { id: 'ses_root' }, message)).preferences.concurrency, 2);
  await assert.rejects(executionContext(root, root, { id: 'ses_root' }, { ...message, agent: 'designer' }), /Agent identity differs/);
  assert.equal(await executionContext(root, root, { id: 'ses_other' }, message), null);
});
test('request summaries scope display data before cloning captured catalogs', async t => {
  const root = await temporaryRoot(t);
  const store = createStore(root);
  await store.recordRequest({ id: 'one', projectID: 'project', sessionID: 'chat', status: 'accepted',
    agent: { id: 'engineer', name: 'Engineer', instructions: 'captured' },
    catalog: { instructions: 'large capture'.repeat(100000) }, catalogModels: ['private'], catalogConnected: ['provider'] });
  await store.recordRequest({ id: 'two', projectID: 'another', sessionID: 'chat' });
  const rows = await store.requestSummaries('project', 'chat');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].agent, { id: 'engineer', name: 'Engineer' });
  assert.equal(rows[0].catalog, undefined);
  assert.equal(rows[0].catalogModels, undefined);
  rows[0].agent.name = 'Changed';
  assert.equal((await store.requestSummaries('project', 'chat'))[0].agent.name, 'Engineer');
  assert.equal((await store.read('requests')).records.one.catalog.instructions.length, 1300000);
});
test("concurrent observations persist exactly once and prices can be edited", async (t) => {
  const root = await temporaryRoot(t);
  const s = createStore(root);
  await Promise.all([
    s.observe([{ id: "a", tokens: 10 }]),
    s.observe([{ id: "b", tokens: 20 }]),
    s.observe([{ id: "a", tokens: 30 }]),
  ]);
  assert.deepEqual((await s.read("usage")).records, {
    a: { id: "a", tokens: 30 },
    b: { id: "b", tokens: 20 },
  });
  await s.savePlans(
    { providers: { openai: { monthlyPrice: 100 } } },
    "2026-09",
  );
  await s.savePlans({ providers: { openai: { monthlyPrice: 20 } } }, "2026-10");
  const state = await s.read("settings");
  assert.equal(state.plans.providers.openai.monthlyPrice, 20);
  assert.equal(
    state.monthlyPlans["2026-09"].providers.openai.monthlyPrice,
    100,
  );
});
test("malformed state cannot be overwritten by a save", async (t) => {
  const root = await temporaryRoot(t);
  const s = createStore(root);
  await mkdir(s.directory, { recursive: true });
  const file = path.join(s.directory, "settings.json");
  await writeFile(file, "{broken");
  await assert.rejects(s.savePlans({}));
  assert.equal(await readFile(file, "utf8"), "{broken");
});

test("usage stays attached to the agent snapshot for its request across rescans and edits", async (t) => {
  const root = await temporaryRoot(t);
  const store = createStore(root);
  await store.recordRequest({
    id: "msg_request1",
    sessionID: "ses_one",
    status: "prepared",
    agent: { id: "engineer", name: "Engineer" },
  });
  await store.recordRequest({
    id: "msg_request2",
    sessionID: "ses_one",
    status: "prepared",
    agent: { id: "designer", name: "Designer" },
  });
  const rows = [
    {
      id: "msg_a",
      sessionID: "ses_one",
      parentMessageID: "msg_request1",
      providerID: "opencode",
      modelID: "free",
      tokens: 10,
      completed: true,
    },
    {
      id: "msg_b",
      sessionID: "ses_one",
      parentMessageID: "msg_request2",
      providerID: "opencode",
      modelID: "free",
      tokens: 20,
      completed: true,
    },
  ];
  await store.observe(rows);
  await store.recordRequest({ id: "msg_request1", status: "accepted" });
  await store.observe(rows);
  const usage = (await store.read("usage")).records;
  assert.equal(usage.msg_a.agentID, "engineer");
  assert.equal(usage.msg_b.agentID, "designer");
  assert.equal(
    Object.values(usage).reduce((n, r) => n + r.tokens, 0),
    30,
  );
  const receipt = (await store.read("requests")).records.msg_request1;
  assert.equal(receipt.status, "observed");
  assert.equal(receipt.responses.msg_a.model, "opencode/free");
  await store.observe([
    { ...rows[0], id: "msg_foreign", sessionID: "ses_other" },
  ]);
  assert.equal(
    (await store.read("usage")).records.msg_foreign.agentID,
    undefined,
  );
});

test("request observations reuse the request snapshot and skip no-op rewrites", async (t) => {
  const root = await temporaryRoot(t);
  const store = createStore(root);
  await store.recordRequest({
    id: "msg_request",
    sessionID: "ses_one",
    status: "prepared",
    agent: { id: "engineer", name: "Engineer" },
    catalog: Object.fromEntries(
      Array.from({ length: 1000 }, (_, index) => [
        `agent-${index}`,
        { instructions: "captured".repeat(20) },
      ]),
    ),
  });
  const rows = [
    {
      id: "msg_response",
      sessionID: "ses_one",
      parentMessageID: "msg_request",
      providerID: "opencode",
      modelID: "free",
      completed: true,
      tokens: 12,
    },
  ];
  await store.observe(rows);
  const before = await readFile(recordDatabasePath(root));
  await store.observe(rows);
  assert.deepEqual(await readFile(recordDatabasePath(root)), before);
  assert.equal((await store.read("usage")).records.msg_response.agentID, "engineer");
  assert.equal(
    (await store.read("requests")).records.msg_request.catalog["agent-999"]
      .instructions,
    "captured".repeat(20),
  );
});

test("database reads are isolated, current across stores and fail closed on corrupt replacement", async (t) => {
  const root = await temporaryRoot(t);
  const store = createStore(root);
  await store.recordRequest({
    id: "msg_request",
    sessionID: "ses_one",
    agent: { id: "engineer", name: "Engineer" },
  });
  const first = await store.read("requests");
  first.records.msg_request.agent.name = "Mutated";
  assert.equal(
    (await store.read("requests")).records.msg_request.agent.name,
    "Engineer",
  );
  const other = createStore(root);
  await other.recordRequest({ id: 'msg_request', agent: { id: 'designer', name: 'Designer' } });
  assert.equal((await store.read('requests')).records.msg_request.agent.name, 'Designer');
  const file = recordDatabasePath(root);
  await writeFile(file, '{broken');
  await assert.rejects(store.read('requests'), /Cannot read requests/);
  await assert.rejects(store.recordRequest({ id: 'new' }), /Cannot read requests/);
  await assert.rejects(readRuntimeRequest(root, 'msg_request'));
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('worker usage attribution retains native identity checks with the shared request reader', async t => {
  const root = await temporaryRoot(t);
  const store = createStore(root);
  const taskID = 'a'.repeat(64);
  await store.recordRequest({ id: 'msg_root', sessionID: 'ses_root', directory: root,
    policyVersion: 6, agent: { id: 'engineer', name: 'Engineer' } });
  const dir = path.join(root, '.state', 'delegation');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${taskID}.json`), JSON.stringify({
    parent_session: 'ses_root', root_session: 'ses_root', root_request_id: 'msg_root',
    directory: root, policy_version: 6, read_only: false,
    agent: { id: 'engineer', name: 'Engineer' },
    attempts: [{ child_session: 'ses_worker', user_message_id: 'msg_worker' }],
  }));
  const session = { id: 'ses_worker', parentID: 'ses_root', metadata: { freelancer: { taskID } } };
  const row = { id: 'msg_answer', parentMessageID: 'msg_worker', sessionID: 'ses_worker', directory: root,
    nativeAgent: 'engineer', providerID: 'opencode', modelID: 'free', tokens: 1 };
  await store.observe([row, { ...row, id: 'msg_answer2' }], { session });
  assert.equal((await store.read('usage')).records.msg_answer.agentID, 'engineer');
  await assert.rejects(store.observe([{ ...row, nativeAgent: 'designer' }], { session }), /Agent identity differs/);
  await writeFile(recordDatabasePath(root), '{broken');
  await assert.rejects(store.observe([row], { session }), /Cannot read requests/);
});

test("update inputs and results cannot mutate cached durable snapshots", async t => {
  const root = await temporaryRoot(t);
  const store = createStore(root);
  const input = { id: "request", agent: { id: "engineer" } };
  const result = await store.recordRequest(input);
  input.agent.id = "changed-input";
  result.records.request.agent.id = "changed-result";
  assert.equal((await store.read("requests")).records.request.agent.id, "engineer");
  let retained;
  const settings = await store.update("settings", s => {
    retained = s;
    s.appearance = { theme: "light" };
    return s;
  });
  settings.appearance.theme = "dark";
  retained.revision = 123;
  const saved = await store.read("settings");
  assert.equal(saved.appearance.theme, "light");
  assert.equal(saved.revision, 0);
});
