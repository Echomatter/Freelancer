// Real app/HTTP/store, with only native OpenCode data stubbed. No inference.
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createApplication } from "../../server/application.mjs";
import { startServer } from "../../server/http.mjs";
import { createStore } from "../../server/store.mjs";
import { defaults } from "../../shared/strategy.mjs";
export async function panelFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "freelancer-panel-browser-"));
  const directory = path.join(root, "project"); await mkdir(directory);
  const project = { id: "panel_project", name: "Panel test", directory };
  const session = { id: "ses_panel", title: "Resize test chat", directory };
  const child = { id: "ses_panel_child", parentID: session.id, title: "Browser worker job", directory };
  const store = createStore(root);
  await store.update("settings", (s) => ({ ...s, projects: [project], appearance: { theme: "dark", todoLayout: "docked" } }));
  const snapshot = { preferences: { scope: "default", revision: 0, preferences: defaults }, usage: { providers: [] }, receipts: [], history: { entries: [] } };
  let activityPhase = "working";
  const activityMessages = () => [{
    info: {
      id: "msg_panel_agent",
      role: "assistant",
      providerID: "opencode",
      modelID: "free",
      time: { created: Date.now(), completed: activityPhase === "completed" ? Date.now() : undefined },
      tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    },
    parts: [{
      id: "prt_panel_agent",
      type: "tool",
      tool: "delegate",
      state: {
        metadata: {
          task_id: "task_panel_agent",
          child_session: child.id,
          selected_model: "opencode/free",
          observed_model: "opencode/free",
          freelancer_activity: {
            schema_version: 1,
            agentID: "engineer",
            agentName: "Engineer",
            workflowID: "build",
            child_session: child.id,
            selected_model: "opencode/free",
            observed_model: "opencode/free",
            phase: activityPhase,
            subject: "Browser worker job",
            completed_tools: activityPhase === "completed" ? 2 : 1,
            updated_at: new Date().toISOString(),
          },
        },
      },
    }],
  }];
  const host = {
    async request(route) {
      if (route === "/provider") return { connected: [], all: [] };
      if (route === "/session?limit=1000") return [session, child];
      if (route === "/session/ses_panel") return session;
      if (route === "/session/ses_panel_child") return child;
      if (route === "/session/ses_panel_child/message") return [{ info: { id: "msg_child", role: "assistant", providerID: "opencode", modelID: "free", time: { created: Date.now(), completed: Date.now() } }, parts: [{ id: "part_child", type: "text", text: "Child conversation content" }] }];
      if (route === "/session/ses_panel/message") return activityMessages();
      if (route === "/session/status" || route === "/config") return {};
      if (route.endsWith("/todo")) return [{ content: "Preserve this task", status: "pending" }];
      return [];
    },
    async *events(_, signal) {
      while (!signal.aborted) {
        try { await delay(1000, undefined, { signal }); } catch { return; }
        yield "data: {}\n\n";
      }
    },
  };
  const app = createApplication({ backendRoot: root, store, host, backendFactory: () => ({ snapshot: async () => snapshot }) });
  const runtime = await startServer({ application: app, assets: fileURLToPath(new URL("../../dist/", import.meta.url)) });
  return {
    ...runtime,
    store,
    setActivity(phase) { activityPhase = phase; },
    async close() {
    runtime.server.closeAllConnections(); await new Promise((r) => runtime.server.close(r));
    await store.flush(); await rm(root, { recursive: true, force: true });
  } };
}
