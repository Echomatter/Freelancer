import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { senderState } from "../domain/sender.mjs";
import { replaceFile } from "./replace-file.mjs";

const frequencies = new Set(["once", "daily", "weekly"]);
const intervals = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 };
const maxDelay = 2 ** 31 - 1;
const historyLimit = 20;
const lateGrace = 60 * 1000;
const idPattern = /^[a-zA-Z0-9_-]{8,80}$/;
const modelPattern = /^[\w.:-]+\/[^\s]+$/;

function iso(value, label) {
  if (typeof value !== "string") throw Error(`${label} must be an ISO instant.`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value)
    throw Error(`${label} must be an ISO instant.`);
  return ms;
}

function publicSchedule(row) {
  const { running, ...rest } = row;
  return rest;
}

function nextAfter(row, now) {
  if (row.frequency === "once") return null;
  const first = iso(row.firstRunAt, "firstRunAt"), interval = intervals[row.frequency];
  const steps = Math.max(1, Math.floor((now - first) / interval) + 1);
  return new Date(first + steps * interval).toISOString();
}

function normalizeInput(input, previous = {}) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const project = typeof input.project === "string" ? input.project : "";
  const agent = typeof input.agent === "string" ? input.agent : "";
  const model = typeof input.model === "string" ? input.model : "";
  const frequency = input.frequency;
  iso(input.firstRunAt, "firstRunAt");
  if (!title || title.length > 120) throw Error("Choose a schedule title of 1 to 120 characters.");
  if (!prompt || prompt.length > 190000) throw Error("Write a prompt of at most 190,000 characters.");
  if (!project) throw Error("Choose a project for this schedule.");
  if (!agent) throw Error("Choose an agent for this schedule.");
  if (!model || model === "auto" || model === "inherit" || !modelPattern.test(model))
    throw Error("Choose an explicit available model for this schedule.");
  if (!frequencies.has(frequency)) throw Error("Choose once, daily, or weekly frequency.");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw Error("Enabled must be true or false.");
  const { workflow: _retiredWorkflow, ...retained } = previous;
  return {
    ...retained,
    title,
    prompt,
    project,
    agent,
    model,
    frequency,
    firstRunAt: input.firstRunAt,
    enabled: input.enabled === undefined ? (previous.enabled ?? true) : !!input.enabled,
  };
}

function changedFields(input) {
  return Object.keys(input).filter(key => key !== "id");
}

export function createSchedules(app, {
  sender,
  readActivity,
  file = app.store?.directory && path.join(app.store.directory, "schedules.json"),
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  replace = replaceFile,
} = {}) {
  if (!sender) throw Error("Schedules require the sender service.");
  let rows = [], timer, closed = false, writing = Promise.resolve(), ticking, queue = Promise.resolve(), lastError;
  const dueAt = () => Math.min(...rows.filter(r => r.enabled && r.nextRunAt && !r.running).map(r => iso(r.nextRunAt, "nextRunAt")));

  async function save() {
    if (!file) return;
    const text = JSON.stringify({ version: 1, schedules: rows.map(publicSchedule) }, null, 2);
    const work = writing.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temp, text, { mode: 0o600 }); await replace(temp, file); }
      finally { await unlink(temp).catch(() => {}); }
    });
    writing = work.catch(error => { lastError = error; arm(); });
    return work;
  }

  function addHistory(row, entry) {
    row.history = [{ at: new Date(now()).toISOString(), ...entry }, ...(row.history ?? [])].slice(0, historyLimit);
    row.lastRunAt = row.history[0].at;
    row.lastStatus = entry.status;
    if (entry.error) row.lastError = entry.error;
    else delete row.lastError;
  }

  function advance(row) {
    if (row.frequency === "once") {
      row.nextRunAt = null;
      row.enabled = false;
    } else row.nextRunAt = nextAfter(row, now());
  }

  async function validate(row) {
    const boot = await app.bootstrap(row.project);
    if (!boot?.project?.id || boot.project.id !== row.project) throw Error("Choose an existing project.");
    if (!boot.settings?.agents?.some(agent => agent.id === row.agent)) throw Error("Choose an available agent.");
    const model = boot.models?.find(model => model.id === row.model);
    if (!model) throw Error("Choose an available model.");
    const provider = model.provider ?? row.model.slice(0, row.model.indexOf("/"));
    if (!(boot.providers?.connected ?? []).includes(provider) && !(provider === "opencode" && model.costClass === "free"))
      throw Error("Choose a connected model or a free OpenCode model for this schedule.");
    return boot;
  }

  function markUncertainDispatches() {
    let changed = false;
    for (const row of rows.filter(row => row.lastStatus === "dispatching")) {
      row.enabled = false;
      addHistory(row, {
        status: "uncertain",
        scheduledFor: row.history?.[0]?.scheduledFor ?? row.nextRunAt,
        session: row.lastSession,
        error: "The server stopped during scheduled dispatch. Inspect the native chat before enabling this schedule.",
      });
      changed = true;
    }
    return changed;
  }

  async function skipMissed() {
    let changed = markUncertainDispatches();
    for (const row of rows.filter(r => r.enabled && r.nextRunAt && iso(r.nextRunAt, "nextRunAt") + lateGrace < now())) {
      addHistory(row, { status: "skipped_missed", scheduledFor: row.nextRunAt });
      advance(row);
      changed = true;
    }
    if (changed) await save();
  }

  const ready = (async () => {
    if (!file) return;
    try {
      const data = JSON.parse(await readFile(file, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.schedules)) throw Error("Invalid schedules");
      let removedWorkflow = false;
      rows = data.schedules.map((row) => {
        const { workflow: _workflow, ...current } = row;
        if (Object.hasOwn(row, "workflow")) removedWorkflow = true;
        if (current.agent === "git") { current.agent = "engineer"; removedWorkflow = true; }
        return { ...current, running: false };
      });
      for (const row of rows) {
        if (!row.id || !idPattern.test(row.id) || !frequencies.has(row.frequency)) throw Error("Invalid schedules");
        if (row.nextRunAt) iso(row.nextRunAt, "nextRunAt");
      }
      if (removedWorkflow) await save();
      await skipMissed();
    } catch (error) {
      if (error.code !== "ENOENT") throw Error("Cannot read schedules; existing data was preserved.");
    }
  })();

  function arm() {
    clearTimer(timer);
    timer = undefined;
    if (closed || lastError) return;
    const at = dueAt();
    if (!Number.isFinite(at)) return;
    timer = setTimer(() => { void serialized(() => tick()).catch(error => { lastError = error; arm(); }); }, Math.max(0, Math.min(maxDelay, at - now())));
    timer.unref?.();
  }

  async function previousRunOpen(row) {
    if (!row.lastSession) return false;
    if (row.lastStatus === "dispatching" || (row.lastStatus === "uncertain" && !row.enabled)) return true;
    try {
      const project = row.lastSessionProject ?? row.project;
      const chat = await app.chat(project, row.lastSession);
      if (chat.availabilityWarnings?.length) return true;
      const state = senderState(chat, row.lastSession);
      if (state.busy || state.approvals) return true;
      if (readActivity) {
        const activity = (await readActivity(project)).sessions?.[row.lastSession];
        if (!activity || activity.active || activity.waiting) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  async function run(row) {
    row.running = true;
    const scheduledFor = row.nextRunAt;
    try {
      if (iso(scheduledFor, "nextRunAt") + lateGrace < now()) {
        addHistory(row, { status: "skipped_missed", scheduledFor });
        advance(row);
        return;
      }
      await validate(row);
      if (await previousRunOpen(row)) {
        addHistory(row, { status: "skipped_overlap", scheduledFor, session: row.lastSession });
        advance(row);
        return;
      }
      addHistory(row, { status: "dispatching", scheduledFor, session: row.lastSession });
      row.lastDispatchAt = new Date(now()).toISOString();
      await save();
      const session = await sender.organize(row.project, async () => app.createChat(row.project, row.title));
      row.lastSession = session.id;
      row.lastSessionProject = row.project;
      addHistory(row, { status: "dispatching", scheduledFor, session: session.id });
      await save();
      await sender.send(row.project, session.id, {
        text: row.prompt,
        model: row.model,
        agentID: row.agent,
      });
      addHistory(row, { status: "dispatched", scheduledFor, session: session.id });
      advance(row);
    } catch (error) {
      const uncertain = row.lastStatus === "dispatching";
      row.enabled = false;
      addHistory(row, {
        status: uncertain ? "uncertain" : "error",
        scheduledFor,
        session: row.lastSession,
        error: uncertain
          ? `Dispatch outcome is uncertain. Inspect the native chat before enabling this schedule. ${error.message}`
          : error.message,
      });
      if (!uncertain) advance(row);
    } finally {
      row.running = false;
      await save();
    }
  }

  async function tick() {
    if (ticking) return ticking;
    const work = (async () => {
      await ready;
      if (lastError) throw Error(`The scheduler is paused after a storage error. Restart the server after resolving it. ${lastError.message}`);
      const due = rows.filter(r => r.enabled && r.nextRunAt && !r.running && iso(r.nextRunAt, "nextRunAt") <= now());
      for (const row of due) await run(row);
      arm();
    })();
    ticking = work;
    const done = () => { if (ticking === work) ticking = undefined; };
    work.then(done, done);
    return work;
  }

  function serialized(action) {
    const work = queue.then(async () => {
      if (closed) throw Error("The scheduler is closing. Restart Freelancer before making changes.");
      await ready;
      if (lastError) throw Error(`The scheduler is paused after a storage error. Restart the server after resolving it. ${lastError.message}`);
      return action();
    });
    queue = work.catch(() => {});
    return work;
  }

  return {
    ready,
    async list() { await ready; return { schedules: structuredClone(rows.map(publicSchedule)), ...(lastError ? { error: `Scheduling paused after a storage error. Resolve it and restart the server. ${lastError.message}` } : {}) }; },
    create(input) {
      return serialized(async () => {
        const row = normalizeInput(input);
        row.id = `sch_${randomUUID().replaceAll("-", "")}`;
        row.createdAt = new Date(now()).toISOString();
        row.updatedAt = row.createdAt;
        row.nextRunAt = iso(row.firstRunAt, "firstRunAt") <= now() ? nextAfter(row, now()) : row.firstRunAt;
        row.history = [];
        if (row.frequency === "once" && iso(row.firstRunAt, "firstRunAt") <= now()) throw Error("Choose a future time for a one-time schedule.");
        await validate(row);
        rows.push(row);
        try { await save(); }
        catch (error) { rows = rows.filter(current => current !== row); throw error; }
        arm();
        return publicSchedule(row);
      });
    },
    update(input) {
      return serialized(async () => {
        if (typeof input.id !== "string") throw Error("Choose a schedule to update.");
        const index = rows.findIndex(row => row.id === input.id);
        if (index < 0) throw Error("Schedule not found.");
        const previous = rows[index];
        const keys = changedFields(input);
        const pauseOnly = keys.length === 1 && keys[0] === "enabled" && input.enabled === false;
        if (pauseOnly) {
          rows[index] = { ...previous, enabled: false, updatedAt: new Date(now()).toISOString() };
          try { await save(); } catch (error) { rows[index] = previous; throw error; }
          arm();
          return publicSchedule(rows[index]);
        }
        const row = normalizeInput({ ...previous, ...input }, previous);
        const projectChanged = row.project !== previous.project;
        if (projectChanged && await previousRunOpen(previous))
          throw Error("Wait for the previous scheduled chat to finish before changing projects.");
        row.id = previous.id;
        row.createdAt = previous.createdAt;
        row.updatedAt = new Date(now()).toISOString();
        row.history = projectChanged ? [] : (previous.history ?? []);
        row.nextRunAt = row.enabled ? (iso(row.firstRunAt, "firstRunAt") <= now() ? nextAfter(row, now()) : row.firstRunAt) : previous.nextRunAt;
        if (!projectChanged) {
          row.lastRunAt = previous.lastRunAt;
          row.lastDispatchAt = previous.lastDispatchAt;
          row.lastStatus = previous.lastStatus;
          row.lastError = previous.lastError;
          row.lastSession = previous.lastSession;
          row.lastSessionProject = previous.lastSessionProject;
        } else {
          delete row.lastRunAt;
          delete row.lastDispatchAt;
          delete row.lastStatus;
          delete row.lastError;
          delete row.lastSession;
          delete row.lastSessionProject;
        }
        if (row.frequency === "once" && row.enabled && iso(row.firstRunAt, "firstRunAt") <= now()) throw Error("Choose a future time for a one-time schedule.");
        if (row.enabled) await validate(row);
        rows[index] = row;
        try { await save(); } catch (error) { rows[index] = previous; throw error; }
        arm();
        return publicSchedule(row);
      });
    },
    delete(id) {
      return serialized(async () => {
        const previous = rows;
        const before = rows.length;
        rows = rows.filter(row => row.id !== id);
        if (rows.length === before) throw Error("Schedule not found.");
        try { await save(); } catch (error) { rows = previous; throw error; }
        arm();
        return { deleted: true };
      });
    },
    start() { arm(); },
    tick() { return serialized(() => tick()); },
    async close() { closed = true; clearTimer(timer); await queue; await ticking; await writing; },
  };
}
