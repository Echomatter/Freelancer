import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "../server/store.mjs";
test('request summaries scope display data before cloning captured catalogs', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-summaries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-web-"));
  t.after(() => rm(root, { recursive: true, force: true }));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-web-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const s = createStore(root);
  await s.savePlans({});
  const file = path.join(s.directory, "settings.json");
  await writeFile(file, "{broken");
  await assert.rejects(s.savePlans({}));
  assert.equal(await readFile(file, "utf8"), "{broken");
});

test("usage stays attached to the agent snapshot for its request across rescans and edits", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-receipts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let writes = 0;
  const store = createStore(root, {
    replace: async (source, target) => {
      writes++;
      await writeFile(target, await readFile(source));
    },
  });
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
  const afterFirstObserve = writes;
  await store.observe(rows);
  assert.equal(writes, afterFirstObserve);
  assert.equal((await store.read("usage")).records.msg_response.agentID, "engineer");
  assert.equal(
    (await store.read("requests")).records.msg_request.catalog["agent-999"]
      .instructions,
    "captured".repeat(20),
  );
});

test("cached reads are isolated, stat-invalidated and fail closed on corrupt replacement", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-invalidated-"));
  t.after(() => rm(root, { recursive: true, force: true }));
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
  const file = path.join(store.directory, "requests.json");
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      records: {
        msg_request: {
          id: "msg_request",
          sessionID: "ses_one",
          agent: { id: "designer", name: "Designer" },
        },
      },
    }),
  );
  assert.equal(
    (await store.read("requests")).records.msg_request.agent.name,
    "Designer",
  );
  await writeFile(file, "{broken");
  await assert.rejects(store.read("requests"), /Cannot read requests/);
  await assert.rejects(store.recordRequest({ id: "new" }), /Cannot read requests/);
  assert.equal(await readFile(file, "utf8"), "{broken");
});

test('worker usage attribution retains native identity checks with the shared request reader', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-worker-usage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
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
  await writeFile(path.join(store.directory, 'requests.json'), '{broken');
  await assert.rejects(store.observe([row], { session }), /Cannot read requests/);
});

test("update inputs and results cannot mutate cached durable snapshots", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-cache-ownership-"));
  t.after(() => rm(root, { recursive: true, force: true }));
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
