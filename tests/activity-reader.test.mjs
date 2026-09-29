import assert from "node:assert/strict";
import test from "node:test";
import { createActivityReader } from "../server/activity.mjs";

test("activity reader adds bounded recent headers and retains active parent/child sessions", async () => {
  const directory = "C:\\work\\project";
  const recentSessions = Array.from({ length: 42 }, (_, index) => ({
    id: `ses_recent_${index}`,
    title: `Recent ${index}`,
    directory,
    time: { created: index + 10, updated: index + 10 },
  }));
  const sessions = [
    { id: "ses_old_parent", title: "Working parent", directory, time: { created: 1, updated: 1 } },
    { id: "ses_old_child", parentID: "ses_old_parent", title: "Working child", directory, time: { created: 2, updated: 2 } },
    ...recentSessions,
    { id: "ses_foreign", title: "Foreign", directory: "C:\\other", time: { updated: 999 } },
  ];
  const calls = [];
  const readActivity = createActivityReader({
    project: async id => ({ id, directory }),
    host: { request: async (route, options) => {
      calls.push([route, options.directory]);
      if (route === "/session?limit=1000") return sessions;
      if (route === "/session/status") return { ses_old_child: { type: "busy" } };
      if (route === "/question" || route === "/permission") return [];
      throw Error(`Unexpected route ${route}`);
    } },
  });

  const result = await readActivity("project-a");
  assert.equal(result.project, "project-a");
  assert.equal(result.recent.length, 42, "the recent slice stays bounded but active ancestry is added");
  assert.ok(result.recent.some(row => row.id === "ses_old_parent"));
  assert.ok(result.recent.some(row => row.id === "ses_old_child"));
  assert.equal(result.recent.some(row => row.id === "ses_foreign"), false);
  assert.equal(result.sessions.ses_old_child.active, true);
  assert.equal(result.sessions.ses_old_parent.active, true, "native child activity rolls up to its parent");
  assert.deepEqual(Object.keys(result.recent[0]).sort(), ["id", "parentID", "time", "title"]);
  assert.equal(calls.length, 4, "candidate discovery reuses the existing read-only activity calls");
});
