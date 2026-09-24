import test from "node:test";
import assert from "node:assert/strict";
import { createObserver } from "../server/observer.mjs";

test("background observation includes children and repeated scans replace response IDs", async () => {
  const directory = process.cwd(),
    records = {};
  let version = Date.now(),
    count = 10,
    calls = 0;
  const store = {
    read: async () => ({ projects: [{ id: "p", directory }] }),
    observe: async (rows) => {
      for (const row of rows) if (row) records[row.id] = row;
    },
  };
  const host = {
    request: async (route) => {
      if (route.startsWith("/session?"))
        return [
          { id: "ses_parent", directory, time: { updated: version } },
          {
            id: "ses_child",
            directory,
            parentID: "ses_parent",
            time: { updated: version },
          },
        ];
      calls++;
      const child = route.includes("ses_child");
      return [
        {
          info: {
            role: "assistant",
            id: child ? "msg_child" : "msg_parent",
            sessionID: child ? "ses_child" : "ses_parent",
            providerID: "opencode",
            modelID: "free",
            time: { created: version, completed: version },
            tokens: { total: count },
          },
          parts: [],
        },
      ];
    },
  };
  const observer = createObserver({ host, store });
  await Promise.all([observer.refresh(), observer.refresh()]);
  assert.equal(calls, 2);
  assert.equal(Object.keys(records).length, 2);
  count = 25;
  version++;
  await observer.refresh();
  assert.equal(
    Object.values(records).reduce((s, r) => s + r.tokens, 0),
    50,
  );
  await observer.stop();
  assert.ok(observer.status.lastUpdated);
});
