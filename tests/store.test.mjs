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
