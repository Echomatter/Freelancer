import { executionContext } from "../backend/tools/runtime/execution-context.mjs";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizePlans } from "../domain/costs.mjs";
import { replaceFile } from "./replace-file.mjs";

// Single application process serializes mutations and atomically replaces files.
// A malformed existing document is an error, never an invitation to overwrite it.
export function createStore(root, { replace = replaceFile } = {}) {
  const directory = path.join(root, ".state", "webpage");
  let queue = Promise.resolve();
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
      workflows: [],
    }),
    usage: () => ({ version: 1, records: {} }),
    requests: () => ({ version: 1, records: {} }),
    gitOperations: () => ({ version: 1, records: {} }),
  };
  async function read(name) {
    if (!files[name]) throw Error("Unknown document");
    try {
      const value = JSON.parse(
        await readFile(path.join(directory, files[name]), "utf8"),
      );
      if (value.version !== 1) throw Error("Unsupported document");
      if (
        name === "settings" &&
        (!Array.isArray(value.projects) ||
          !Array.isArray(value.workflows) ||
          !Number.isInteger(value.revision))
      )
        throw Error("Invalid settings");
      if (
        ["usage", "requests", "gitOperations"].includes(name) &&
        (!value.records ||
          typeof value.records !== "object" ||
          Array.isArray(value.records))
      )
        throw Error("Invalid usage");
      return value;
    } catch (e) {
      if (e.code === "ENOENT") return defaults[name]();
      throw Error(`Cannot read ${name}; your existing data was preserved.`);
    }
  }
  function update(name, change) {
    const work = queue.then(async () => {
      const data = await read(name),
        next = await change(structuredClone(data));
      if (JSON.stringify(data) === JSON.stringify(next)) return next;
      await mkdir(directory, { recursive: true });
      const target = path.join(directory, files[name]),
        temp = target + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
        await replace(temp, target);
      } finally {
        await unlink(temp).catch(() => {});
      }
      return next;
    });
    queue = work.catch(() => {});
    return work;
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
      await update("requests", (s) => {
        for (const row of records.filter(Boolean)) {
          const receipt = s.records[row.parentMessageID];
          if (!receipt || receipt.sessionID !== row.sessionID) continue;
          receipt.status = "observed";
          receipt.responses = {
            ...receipt.responses,
            [row.id]: {
              model: `${row.providerID}/${row.modelID}`,
              completed: row.completed,
            },
          };
        }
        return s;
      });
      return update("usage", async (s) => {
        const requests = await read("requests");
        for (const row of records)
          if (row) {
            let receipt = requests.records[row.parentMessageID];
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
                    workflowID: receipt.workflow.id,
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
    recordRequest(record) {
      return update("requests", (s) => {
        const previous = s.records[record.id];
        s.records[record.id] = {
          ...previous,
          ...record,
          ...(previous?.status === "observed" ? { status: "observed" } : {}),
        };
        return s;
      });
    },
  };
}
