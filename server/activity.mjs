import path from "node:path";
import { projectActivity } from "../domain/chat-activity.mjs";

// Injected into the local HTTP server by main.mjs. Uses existing project
// validation and native GET endpoints; no message reads, observer writes,
// provider calls, inference, or alternative session store.
export function createActivityReader({ project, host }) {
  return async (projectID) => {
    const selected = await project(projectID);
    const options = { directory: selected.directory };
    const [all, status, questions, permissions] = await Promise.all([
      host.request("/session?limit=1000", options),
      host.request("/session/status", options),
      host.request("/question", options),
      host.request("/permission", options),
    ]);
    if (!Array.isArray(all) || !status || typeof status !== "object" ||
        Array.isArray(status) || !Array.isArray(questions) || !Array.isArray(permissions))
      throw Error("Activity unavailable. Restart Freelancer and try again.");
    const normalize = (directory) => process.platform === "win32"
      ? path.resolve(directory).toLowerCase() : path.resolve(directory);
    const sessions = all.filter((s) => s?.id && typeof s.directory === "string" &&
      normalize(s.directory) === normalize(selected.directory));
    const activity = projectActivity(sessions, status, questions, permissions);
    const recent = [...new Map([
      ...sessions.filter(row => activity[row.id]?.active || activity[row.id]?.waiting),
      ...sessions.toSorted((a, b) => Number(b.time?.updated ?? b.time?.created ?? 0) - Number(a.time?.updated ?? a.time?.created ?? 0)).slice(0, 40),
    ].map(row => [row.id, row])).values()]
      .map(({ id, parentID, title, time }) => ({ id, parentID, title, time }));
    return { project: projectID, sessions: activity, recent };
  };
}
