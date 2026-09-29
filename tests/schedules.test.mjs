import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSchedules } from "../server/schedules.mjs";

function fixture({ start = Date.parse("2026-01-01T00:00:00.000Z"), file, bootstrap, sender: senderPatch = {}, app: appPatch = {}, replace, readActivity } = {}) {
  let clock = start, sessions = 0;
  const sent = [], chats = new Map(), timers = [];
  const app = {
    store: { directory: file ? path.dirname(file) : undefined },
    bootstrap: bootstrap ?? (async (project) => {
      if (project !== "project" && project !== "other") throw Error("Choose an existing project.");
      return {
        project: { id: project },
        providers: { connected: ["opencode"] },
        settings: { agents: [{ id: "engineer" }] },
        models: [{ id: "opencode/free", provider: "opencode", costClass: "free" }],
      };
    }),
    createChat: async (_project, title) => {
      const session = { id: `ses_${++sessions}`, title };
      chats.set(session.id, { messages: [], status: { [session.id]: { type: "idle" } }, permissions: [], questions: [], receipts: [] });
      return session;
    },
    chat: async (_project, session) => chats.get(session),
    ...appPatch,
  };
  const sender = {
    organize: async (_project, action) => action(),
    send: async (project, session, input) => {
      sent.push({ project, session, input });
      const state = chats.get(session);
      if (state) {
        state.status[session] = { type: "busy" };
        state.messages.push({ info: { id: `msg_${sent.length}`, role: "user", time: { created: clock } }, parts: [{ type: "text", text: input.text }] });
      }
    },
    ...senderPatch,
  };
  const schedules = createSchedules(app, {
    sender,
    readActivity,
    file,
    replace,
    now: () => clock,
    setTimer: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.cleared = true; },
  });
  return { schedules, sent, chats, timers, set clock(value) { clock = value; }, get clock() { return clock; } };
}

const input = (firstRunAt, extra = {}) => ({
  title: "Scheduled work",
  prompt: "Run the scheduled prompt",
  project: "project",
  agent: "engineer",
  model: "opencode/free",
  frequency: "daily",
  firstRunAt,
  enabled: true,
  ...extra,
});

test("scheduled prompt dispatches through sender with explicit catalog choices", async () => {
  const f = fixture();
  await f.schedules.ready;
  await f.schedules.create(input("2026-01-01T00:01:00.000Z"));
  f.clock = Date.parse("2026-01-01T00:01:00.000Z");
  await f.schedules.tick();
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0].input, {
    text: "Run the scheduled prompt",
    model: "opencode/free",
    agentID: "engineer",
  });
  const schedule = (await f.schedules.list()).schedules[0];
  assert.equal(schedule.lastStatus, "dispatched");
  assert.equal(schedule.nextRunAt, "2026-01-02T00:01:00.000Z");
});

test("same schedule does not overlap a busy or permission-pending native run", async () => {
  const f = fixture();
  await f.schedules.ready;
  await f.schedules.create(input("2026-01-01T00:01:00.000Z"));
  f.clock = Date.parse("2026-01-01T00:01:00.000Z");
  await f.schedules.tick();
  f.clock = Date.parse("2026-01-02T00:01:00.000Z");
  await f.schedules.tick();
  assert.equal(f.sent.length, 1);
  assert.equal((await f.schedules.list()).schedules[0].lastStatus, "skipped_overlap");
  const session = f.sent[0].session;
  const chat = f.chats.get(session);
  chat.status[session] = { type: "idle" };
  chat.permissions.push({ id: "perm" });
  f.clock = Date.parse("2026-01-03T00:01:00.000Z");
  await f.schedules.tick();
  assert.equal(f.sent.length, 1);
});

test("restart and sleep/wake skip missed occurrences without catch-up bursts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-schedules-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "schedules.json");
  let f = fixture({ file });
  await f.schedules.ready;
  await f.schedules.create(input("2026-01-01T00:01:00.000Z"));
  f.clock = Date.parse("2026-01-01T00:02:01.000Z");
  await f.schedules.tick();
  assert.equal(f.sent.length, 0);
  assert.equal((await f.schedules.list()).schedules[0].lastStatus, "skipped_missed");
  await f.schedules.close();
  f = fixture({ file, start: Date.parse("2026-01-05T00:00:00.000Z") });
  await f.schedules.ready;
  const schedule = (await f.schedules.list()).schedules[0];
  assert.equal(f.sent.length, 0);
  assert.equal(schedule.lastStatus, "skipped_missed");
  assert.equal(schedule.nextRunAt, "2026-01-05T00:01:00.000Z");
});

test("legacy workflow schedule fields migrate away and remain editable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-schedules-migrate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "schedules.json");
  const old = input("2026-01-02T00:00:00.000Z", { workflow: "review", agent: "engineer" });
  old.id = "sch_legacy01";
  await writeFile(file, JSON.stringify({ version: 1, schedules: [old] }));
  const f = fixture({ file });
  await f.schedules.ready;
  const migrated = (await f.schedules.list()).schedules[0];
  assert.equal(Object.hasOwn(migrated, "workflow"), false);
  assert.equal(JSON.parse(await readFile(file, "utf8")).schedules[0].workflow, undefined);
  const changed = await f.schedules.update({ id: migrated.id, title: "Updated title" });
  assert.equal(changed.title, "Updated title");
  assert.equal(Object.hasOwn(changed, "workflow"), false);
  await f.schedules.close();
});

test("validation rejects missing explicit or disconnected model", async () => {
  const f = fixture();
  await f.schedules.ready;
  await assert.rejects(f.schedules.create(input("2026-01-01T00:01:00.000Z", { model: "auto" })), /explicit/);
  const disconnected = fixture({ bootstrap: async () => ({
    project: { id: "project" },
    providers: { connected: [] },
    settings: { agents: [{ id: "engineer" }] },
    models: [{ id: "anthropic/claude", provider: "anthropic", costClass: "subscription" }],
  }) });
  await disconnected.schedules.ready;
  await assert.rejects(disconnected.schedules.create(input("2026-01-01T00:01:00.000Z", { model: "anthropic/claude" })), /connected model or a free/);
});

test("dispatch uncertainty pauses schedule and is not retried automatically", async () => {
  let attempts = 0;
  let clock = Date.parse("2026-01-01T00:00:00.000Z");
  const app = {
    store: {},
    bootstrap: async () => ({ project: { id: "project" }, providers: { connected: ["opencode"] }, settings: { agents: [{ id: "engineer" }] }, models: [{ id: "opencode/free", provider: "opencode", costClass: "free" }] }),
    createChat: async () => ({ id: "ses_fail" }),
    chat: async () => ({ messages: [], status: { ses_fail: { type: "idle" } }, permissions: [], questions: [], receipts: [] }),
  };
  const schedules = createSchedules(app, { sender: { organize: async (_p, action) => action(), send: async () => { attempts++; throw Error("uncertain dispatch"); } }, file: null, now: () => clock });
  await schedules.ready;
  await schedules.create(input("2026-01-01T00:01:00.000Z", { frequency: "weekly" }));
  clock = Date.parse("2026-01-01T00:01:00.000Z");
  await schedules.tick();
  await schedules.tick();
  assert.equal(attempts, 1);
  const row = (await schedules.list()).schedules[0];
  assert.equal(row.enabled, false);
  assert.equal(row.lastStatus, "uncertain");
  assert.equal(row.nextRunAt, "2026-01-01T00:01:00.000Z");
});

test("restart marks durable dispatch claim uncertain and paused", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-schedules-claim-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "schedules.json");
  const f = fixture({ file, sender: { send: async () => { throw Error("network lost"); } } });
  await f.schedules.ready;
  await f.schedules.create(input("2026-01-01T00:01:00.000Z", { frequency: "weekly" }));
  f.clock = Date.parse("2026-01-01T00:01:00.000Z");
  await f.schedules.tick();
  const disk = JSON.parse(await readFile(file, "utf8"));
  disk.schedules[0].lastStatus = "dispatching";
  disk.schedules[0].enabled = true;
  await writeFile(file, JSON.stringify(disk));
  const reopened = fixture({ file, start: Date.parse("2026-01-02T00:00:00.000Z") });
  await reopened.schedules.ready;
  const row = (await reopened.schedules.list()).schedules[0];
  assert.equal(row.enabled, false);
  assert.equal(row.lastStatus, "uncertain");
});

test("partial pause and delete do not require current project catalog", async () => {
  let valid = true;
  const f = fixture({ bootstrap: async () => {
    if (!valid) throw Error("catalog gone");
    return { project: { id: "project" }, providers: { connected: ["opencode"] }, settings: { agents: [{ id: "engineer" }] }, models: [{ id: "opencode/free", provider: "opencode", costClass: "free" }] };
  } });
  await f.schedules.ready;
  const created = await f.schedules.create(input("2026-01-01T00:01:00.000Z"));
  valid = false;
  const paused = await f.schedules.update({ id: created.id, enabled: false });
  assert.equal(paused.enabled, false);
  assert.deepEqual(await f.schedules.delete(created.id), { deleted: true });
});

test("save failure rolls back create without phantom schedule", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-schedules-save-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let fail = true;
  const f = fixture({ file: path.join(root, "schedules.json"), replace: async () => { if (fail) throw Error("disk full"); } });
  await f.schedules.ready;
  await assert.rejects(f.schedules.create(input("2026-01-01T00:01:00.000Z")), /disk full/);
  assert.deepEqual((await f.schedules.list()).schedules, []);
  fail = false;
});

test("timer callback exposes background failure and keeps scheduler readable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-schedules-timer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let fail = false;
  const f = fixture({ file: path.join(root, "schedules.json"), replace: async (source, target) => {
    if (fail) throw Error("timer save failed");
    await import("node:fs/promises").then(fs => fs.rename(source, target));
  } });
  await f.schedules.ready;
  await f.schedules.create(input("2026-01-01T00:01:00.000Z"));
  f.clock = Date.parse("2026-01-01T00:01:00.000Z");
  fail = true;
  f.timers.at(-1).fn();
  for (let i = 0; i < 20 && !(await f.schedules.list()).error; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.match((await f.schedules.list()).error, /timer save failed/);
});

test("once schedules disable after dispatch and update/delete edit timing", async () => {
  const f = fixture();
  await f.schedules.ready;
  const created = await f.schedules.create(input("2026-01-01T00:01:00.000Z", { frequency: "once" }));
  const edited = await f.schedules.update({ id: created.id, firstRunAt: "2026-01-01T00:02:00.000Z", title: "Edited" });
  assert.equal(edited.title, "Edited");
  f.clock = Date.parse("2026-01-01T00:01:00.000Z");
  await f.schedules.tick();
  assert.equal(f.sent.length, 0);
  f.clock = Date.parse("2026-01-01T00:02:00.000Z");
  await f.schedules.tick();
  let row = (await f.schedules.list()).schedules[0];
  assert.equal(f.sent.length, 1);
  assert.equal(row.enabled, false);
  assert.equal(row.nextRunAt, null);
  await f.schedules.delete(created.id);
  assert.deepEqual((await f.schedules.list()).schedules, []);
});

test("project change clears prior run linkage", async () => {
  const f = fixture();
  await f.schedules.ready;
  const created = await f.schedules.create(input("2026-01-01T00:01:00.000Z"));
  f.clock = Date.parse("2026-01-01T00:01:00.000Z");
  await f.schedules.tick();
  await assert.rejects(f.schedules.update({ id: created.id, project: "other" }), /previous scheduled chat/);
  const chat = f.chats.get(f.sent[0].session);
  chat.status[f.sent[0].session] = { type: "idle" };
  chat.messages.push({ info: { id: "msg_done", role: "assistant", parentID: "msg_1", time: { completed: f.clock }, finish: "stop" }, parts: [] });
  const moved = await f.schedules.update({ id: created.id, project: "other", firstRunAt: "2026-01-03T00:01:00.000Z" });
  assert.equal(moved.project, "other");
  assert.equal(moved.lastSession, undefined);
  assert.deepEqual(moved.history, []);
});

test("real timer dispatch serializes with pause and retains its session receipt", async () => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture({ sender: { send: async () => { started(); await gate; } } });
  const created = await f.schedules.create(input("2026-01-01T00:01:00.000Z"));
  f.clock = Date.parse("2026-01-01T00:01:00.000Z");
  f.timers.at(-1).fn();
  await entered;
  let paused = false;
  const pausing = f.schedules.update({ id: created.id, enabled: false }).then(row => { paused = true; return row; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(paused, false, "pause must not replace the row while dispatch is updating it");
  release();
  const row = await pausing;
  assert.equal(row.enabled, false);
  assert.equal(row.lastStatus, "dispatched");
  assert.equal(row.lastSession, "ses_1");
  await f.schedules.close();
});

for (const action of ["pause", "edit", "delete"]) test(`failed ${action} preserves the persisted schedule and stops timers`, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-schedules-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let fail = false;
  const f = fixture({ file: path.join(root, "schedules.json"), replace: async (source, target) => {
    if (fail) throw Error("storage unavailable");
    await rename(source, target);
  } });
  const created = await f.schedules.create(input("2026-01-01T00:01:00.000Z"));
  fail = true;
  await assert.rejects(action === "delete" ? f.schedules.delete(created.id)
    : f.schedules.update({ id: created.id, ...(action === "pause" ? { enabled: false } : { title: "Changed" }) }), /storage unavailable/);
  const result = await f.schedules.list();
  assert.equal(result.schedules.length, 1);
  assert.equal(result.schedules[0].enabled, true);
  assert.equal(result.schedules[0].title, "Scheduled work");
  assert.match(result.error, /Scheduling paused/);
  assert.equal(f.timers.at(-1).cleared, true);
  await f.schedules.close();
});

test("partial native state and detached workers both block another scheduled run", async () => {
  let activity = { active: true, waiting: false };
  const f = fixture({ readActivity: async () => ({ sessions: { ses_1: activity } }) });
  await f.schedules.create(input("2026-01-01T00:01:00.000Z"));
  f.clock = Date.parse("2026-01-01T00:01:00.000Z");
  await f.schedules.tick();
  const chat = f.chats.get("ses_1");
  chat.status = {};
  chat.messages = [];
  f.clock += 86400000;
  await f.schedules.tick();
  assert.equal(f.sent.length, 1, "a detached worker must finish first");
  activity = { active: false, waiting: false };
  chat.availabilityWarnings = ["Permissions: native API unavailable"];
  f.clock += 86400000;
  await f.schedules.tick();
  assert.equal(f.sent.length, 1, "unavailable permission state is not idle evidence");
  chat.availabilityWarnings = [];
  f.clock += 86400000;
  await f.schedules.tick();
  assert.equal(f.sent.length, 2);
});
