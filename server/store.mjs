import { executionContext } from "../backend/tools/runtime/execution-context.mjs";
import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizePlans } from "../domain/costs.mjs";
import { replaceFile } from "./replace-file.mjs";

const legacyWorkflowAgent = (id, workflows = []) => {
  const custom = workflows.find((workflow) => workflow.id === id)?.agentID;
  if (custom && !["inherit", "none", "git"].includes(custom)) return custom;
  return ({ build: "engineer", plan: "engineer", explore: "researcher", review: "engineer", sync: "engineer" })[id] ?? "engineer";
};

function migrateSettings(settings) {
  const workflows = Array.isArray(settings.workflows) ? settings.workflows : [];
  let changed = Object.hasOwn(settings, "workflows");
  const choices = Object.fromEntries(Object.entries(settings.chatChoices ?? {}).map(([session, choice]) => {
    if (!choice || typeof choice !== "object") return [session, choice];
    const next = { ...choice };
    if (Object.hasOwn(next, "workflowID")) {
      if (!next.agentID || ["inherit", "none", "git"].includes(next.agentID))
        next.agentID = legacyWorkflowAgent(next.workflowID, workflows);
      delete next.workflowID;
      changed = true;
    } else if (next.agentID === "git") {
      next.agentID = "engineer";
      changed = true;
    }
    return [session, next];
  }));
  const sessionDefaults = Object.fromEntries(Object.entries(settings.sessionDefaults ?? {}).map(([project, value]) => {
    if (!value || typeof value !== "object") return [project, value];
    const next = { ...value };
    if (Object.hasOwn(next, "workflowID")) {
      if (!next.agentID || ["inherit", "none", "git"].includes(next.agentID))
        next.agentID = legacyWorkflowAgent(next.workflowID, workflows);
      delete next.workflowID;
      changed = true;
    } else if (next.agentID === "git") {
      next.agentID = "engineer";
      changed = true;
    }
    return [project, next];
  }));
  if (!changed) return settings;
  const next = { ...settings, chatChoices: choices, sessionDefaults };
  delete next.workflows;
  return next;
}

// Single application process serializes mutations and atomically replaces files.
// A malformed existing document is an error, never an invitation to overwrite it.
export function createStore(root, { replace = replaceFile } = {}) {
  const directory = path.join(root, ".state", "webpage");
  let queue = Promise.resolve();
  const cache = new Map();
  const files = {
    settings: "settings.json",
    usage: "usage.json",
    requests: "requests.json",
    gitOperations: "git-operations.json",
  };
  const defaults = {
    settings: () => ({
      version: 1,
      revision: 0,
      projects: [],
      plans: normalizePlans(),
      monthlyPlans: {},
    }),
    usage: () => ({ version: 1, records: {} }),
    requests: () => ({ version: 1, records: {} }),
    gitOperations: () => ({ version: 1, records: {} }),
  };
  const filePath = (name) => path.join(directory, files[name]);
  const signature = (stats) =>
    stats ? `${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}` : null;
  async function currentSignature(name) {
    try {
      return signature(await stat(filePath(name), { bigint: true }));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  function validate(name, value) {
    if (value.version !== 1) throw Error("Unsupported document");
    if (
      name === "settings" &&
      (!Array.isArray(value.projects) || !Number.isInteger(value.revision))
    )
      throw Error("Invalid settings");
    if (
      ["usage", "requests", "gitOperations"].includes(name) &&
      (!value.records ||
        typeof value.records !== "object" ||
        Array.isArray(value.records))
    )
      throw Error("Invalid usage");
  }
  async function load(name) {
    if (!files[name]) throw Error("Unknown document");
    try {
      const seen = await currentSignature(name),
        cached = cache.get(name);
      if (cached && cached.signature === seen) return cached.data;
      if (seen === null) {
        const value = defaults[name]();
        cache.set(name, { signature: null, data: value });
        return value;
      }
      const parsed = JSON.parse(await readFile(filePath(name), "utf8"));
      validate(name, parsed);
      const value = name === "settings" ? migrateSettings(parsed) : parsed;
      if (value !== parsed) {
        await writeDocument(name, value);
        return value;
      }
      cache.set(name, { signature: seen, data: value });
      return value;
    } catch (e) {
      if (e.code === "ENOENT") {
        const value = defaults[name]();
        cache.set(name, { signature: null, data: value });
        return value;
      }
      throw Error(`Cannot read ${name}; your existing data was preserved.`);
    }
  }
  async function read(name) {
    return structuredClone(await load(name));
  }
  async function writeDocument(name, next) {
    if (name === "settings") next = migrateSettings(next);
    validate(name, next);
    await mkdir(directory, { recursive: true });
    const target = filePath(name),
      temp = target + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await replace(temp, target);
      cache.set(name, {
        signature: await currentSignature(name),
        data: next,
      });
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
  function update(name, change) {
    const work = queue.then(async () => {
      const data = await load(name),
        next = await change(structuredClone(data));
      if (JSON.stringify(data) === JSON.stringify(next)) return next;
      // The callback and caller may keep next; neither may mutate our cache.
      await writeDocument(name, structuredClone(next));
      return next;
    });
    queue = work.catch(() => {});
    return work;
  }
  async function updateRequests(change) {
    const work = queue.then(async () => {
      const data = await load("requests"),
        next = await change(data);
      if (next === data) return data;
      await writeDocument("requests", next);
      return next;
    });
    queue = work.catch(() => {});
    return work;
  }
  async function observeRequests(records) {
    return updateRequests((current) => {
      let next = current,
        nextRecords = current.records;
      for (const row of records.filter(Boolean)) {
        const receipt = nextRecords[row.parentMessageID];
        if (!receipt || receipt.sessionID !== row.sessionID) continue;
        const response = {
            model: `${row.providerID}/${row.modelID}`,
            completed: row.completed,
          },
          previous = receipt.responses?.[row.id];
        if (
          receipt.status === "observed" &&
          previous?.model === response.model &&
          previous?.completed === response.completed
        )
          continue;
        if (next === current) {
          nextRecords = { ...current.records };
          next = { ...current, records: nextRecords };
        }
        const responses = { ...receipt.responses, [row.id]: response };
        nextRecords[row.parentMessageID] = {
          ...receipt,
          status: "observed",
          responses,
        };
      }
      return next;
    });
  }
  return {
    read,
    update,
    directory,
    flush: () => queue,
    async savePlans(input, month = new Date().toISOString().slice(0, 7)) {
      const plans = normalizePlans(input);
      return update("settings", (s) => ({
        ...s,
        revision: s.revision + 1,
        plans,
        monthlyPlans: { ...s.monthlyPlans, [month]: plans },
      }));
    },
    async observe(records, { session } = {}) {
      const requestSnapshot = await observeRequests(records);
      return update("usage", async (s) => {
        for (const row of records)
          if (row) {
            let receipt = requestSnapshot.records[row.parentMessageID];
            if (!receipt && session?.id === row.sessionID && session?.metadata?.freelancer?.taskID) {
              receipt = await executionContext(root, row.directory, session, {info:{
                role:"assistant", agent:row.nativeAgent, parentID:row.parentMessageID,
              }});
            }
            const attribution =
              receipt && receipt.sessionID === row.sessionID
                  ? {
                    agentID: receipt.agent.id,
                    agentName: receipt.agent.name,
                    requestID: receipt.id,
                  }
                : {};
            s.records[row.id] = {
              ...s.records[row.id],
              ...row,
              ...attribution,
            };
          }
        return s;
      });
    },
    async recordRequest(record) {
      const captured = structuredClone(record);
      const result = await updateRequests((current) => {
        const previous = current.records[captured.id],
          nextRecord = {
          ...previous,
          ...captured,
          ...(previous?.status === "observed" ? { status: "observed" } : {}),
        };
        if (JSON.stringify(previous) === JSON.stringify(nextRecord)) return current;
        return {
          ...current,
          records: { ...current.records, [captured.id]: nextRecord },
        };
      });
      return structuredClone(result);
    },
  };
}
