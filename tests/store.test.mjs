import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "../server/store.mjs";
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
    workflow: { id: "build" },
  });
  await store.recordRequest({
    id: "msg_request2",
    sessionID: "ses_one",
    status: "prepared",
    agent: { id: "designer", name: "Designer" },
    workflow: { id: "build" },
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
    workflow: { id: "build" },
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
    workflow: { id: "build" },
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
          workflow: { id: "build" },
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
