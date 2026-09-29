import test from "node:test";
import assert from "node:assert/strict";
import { localDataFixture } from "./fixtures/local-data-app.mjs";
import { createSchedules } from "../server/schedules.mjs";

test("scheduled dispatch reaches normal execution receipts and native prompt without widening permissions", async t => {
  const f = await localDataFixture();
  let now = Date.now();
  const schedules = createSchedules(f.app, { sender: f.sender, file: null, now: () => now,
    setTimer: () => ({ unref() {} }), clearTimer: () => {} });
  t.after(async () => { await schedules.close(); await f.close(); });
  const agreementBefore = await f.app.gitProjects.policy(f.project.id);
  const row = await schedules.create({ title: "Scheduled review", prompt: "Review the project and report findings.",
    project: f.project.id, agent: "engineer", model: "opencode/free",
    frequency: "daily", firstRunAt: new Date(now + 60000).toISOString(), enabled: true });
  now += 60000;
  await schedules.tick();
  let result = (await schedules.list()).schedules[0];
  assert.equal(result.lastStatus, "dispatched", result.lastError);
  assert.ok(result.lastSession.startsWith("ses_created_"));
  const promptCalls = () => f.calls.filter(call => call.route.endsWith("/prompt_async"));
  assert.equal(promptCalls().length, 1);
  const body = promptCalls()[0].options.body;
  assert.equal(body.agent, "engineer");
  assert.deepEqual(body.model, { providerID: "opencode", modelID: "free" });
  assert.deepEqual(body.parts, [{ type: "text", text: row.prompt }]);
  assert.equal(body.permission, undefined);
  assert.equal(body.permissions, undefined);
  assert.equal(f.calls.some(call => /\/permission\/.+\/reply/.test(call.route)), false);
  const receipt = (await f.store.read("requests")).records[body.messageID];
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.agent.id, "engineer");
  assert.equal(receipt.mode, "build");
  assert.equal(Object.hasOwn(receipt, "workflow"), false);
  assert.deepEqual(await f.app.gitProjects.policy(f.project.id), agreementBefore);

  // A later due time cannot start another chat while this one awaits a native decision.
  delete f.state.status[result.lastSession];
  f.state.permissions.push({ id: "perm_scheduled", sessionID: result.lastSession, permission: "bash", patterns: ["npm test"] });
  now += 86400000;
  await schedules.tick();
  result = (await schedules.list()).schedules[0];
  assert.equal(result.lastStatus, "skipped_overlap");
  assert.equal(promptCalls().length, 1);
  assert.equal(f.state.permissions.length, 1);
});
