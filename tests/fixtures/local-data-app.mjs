import { checkedCatalog } from '../../backend/tools/runtime/agent-catalog.mjs';
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createApplication } from "../../server/application.mjs";
import { createStore } from "../../server/store.mjs";
import { startServer } from "../../server/http.mjs";
import { createActivityReader } from "../../server/activity.mjs";
import { defaults } from "../../shared/strategy.mjs";

export async function localDataFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-history-"));
  const directory = path.join(root, "project");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "source.txt"),
    "DO NOT MODIFY PROJECT FILES",
  );
  const nativeFile = path.join(root, "native-opencode.db");
  await writeFile(nativeFile, "Native ownership sentinel");
  const project = { id: "history_project", name: "History project", directory };
  const store = createStore(root);
  await store.update("settings", (s) => ({
    ...s,
    projects: [project],
    github: { preserved: true },
    appearance: { theme: "dark" },
  }));
  const state = {
    sessions: [
      {
        id: "ses_history",
        title: "Important conversation",
        directory,
        time: { created: 100, updated: 300 },
      },
      {
        id: "ses_worker",
        parentID: "ses_history",
        title: "Linked worker",
        directory,
        time: { created: 110, updated: 290 },
      },
      {
        id: "ses_other",
        title: "Another conversation",
        directory,
        time: { created: 200, updated: 400 },
      },
    ],
    messages: {},
    todos: {},
    status: {},
    questions: [],
    permissions: [],
    nativeArchive: false,
    unavailable: false,
    holdPrompt: null,
  };
  const calls = [],
    exports = [];
  const row = (id) => state.sessions.find((s) => s.id === id);
  const host = {
    async request(route, options = {}) {
      calls.push({ route, options });
      if (state.unavailable) throw Error("Engine unavailable");
      if (route === "/provider")
        return {
          connected: ["opencode"],
          all: [
            {
              id: "opencode",
              models: {
                  free: {
                    cost: { input: 0, output: 0 },
                    limit: { context: 64000, output: 8192 },
                    toolcall: true,
                    variants: { low: {}, high: {} },
                  },
              },
            },
          ],
        };
      if (route === "/agent") return checkedCatalog(await store.read("settings")).agents.map(a=>({name:a.id,mode:"all",permission:[]}));
      if (route === "/config") return { model: "opencode/free" };
      if (route === "/config/providers")
        return { providers: [{ id: "opencode", models: { free: {} } }] };
      if (route === "/session/status") return state.status;
      if (route === "/question") return state.questions;
      if (route === "/permission") return state.permissions;
      if (route === "/doc")
        return {
          paths: {
            "/session/{sessionID}": {
              patch: {
                requestBody: {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          time: {
                            properties: {
                              archived: {
                                type: state.nativeArchive
                                  ? ["number", "null"]
                                  : "number",
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        };
      if (route === '/session' && options.method !== 'POST') return structuredClone(state.sessions);
      if (route.startsWith("/session?"))
        return structuredClone(
          state.sessions.slice(
            0,
            Number(new URL("http://local" + route).searchParams.get("limit")) ||
              1000,
          ),
        );
      if (route === "/session" && options.method === "POST") {
        const session = {
          id: `ses_created_${state.sessions.length}`,
          directory,
          title: options.body?.title || "New conversation",
          time: { created: Date.now(), updated: Date.now() },
        };
        state.sessions.push(session);
        return structuredClone(session);
      }
      const match = route.match(/^\/session\/(ses_[\w-]+)(?:\/(.*))?$/);
      if (match) {
        const session = row(match[1]);
        if (!session)
          throw Object.assign(Error("Chat missing"), { status: 404 });
        const action = match[2];
        if (!action && options.method === "PATCH") {
          if ("archived" in (options.body.time || {}))
            session.time.archived = options.body.time.archived;
          if (options.body.title) session.title = options.body.title;
        }
        if (!action) return structuredClone(session);
        if (action === "children")
          return structuredClone(
            state.sessions.filter((s) => s.parentID === session.id),
          );
        if (action === "message")
          return structuredClone(state.messages[session.id] ?? []);
        if (action === "todo") return structuredClone(state.todos[session.id] ?? []);
        if (action === "diff") return [];
        if (action === "prompt_async") {
          state.status[session.id] = { type: "busy" };
          if (state.holdPrompt) await state.holdPrompt;
          (state.messages[session.id] ??= []).push({
            info: {
              id: options.body.messageID,
              role: "user",
              model: options.body.model,
            },
            parts: options.body.parts,
          });
          return null;
        }
        if (action === "abort") {
          delete state.status[session.id];
          return true;
        }
      }
      return [];
    },
    async exportSession(id, dir) {
      exports.push({ id, dir });
      return {
        info: structuredClone(row(id)),
        messages: structuredClone(
          state.messages[id] ?? [
            {
              info: { id: "msg_export", role: "user" },
              parts: [{ type: "text", text: "Original conversation text" }],
            },
          ],
        ),
      };
    },
    async databasePath() {
      return nativeFile;
    },
    async *events(_, signal) {
      while (!signal.aborted) {
        try {
          await delay(1000, undefined, { signal });
        } catch {
          return;
        }
        if (!signal.aborted) yield "data: {}\n\n";
      }
    },
  };
  const snapshot = {
    preferences: {
      scope: "default",
      revision: 0,
      preferences: { ...defaults, parentModel: "opencode/free" },
    },
    usage: { providers: [] },
    receipts: [],
    history: { entries: [] },
  };
  const app = createApplication({
    backendRoot: root,
    store,
    host,
    dataRoot: path.join(root, "user-data"),
    backendFactory: () => ({
      snapshot: async () => snapshot,
      save: async () => {},
      refreshQuota: async () => {},
    }),
  });
  const runtime = await startServer({
    application: app,
    readActivity: createActivityReader({ project: app.project, host }),
    assets: fileURLToPath(new URL("../../dist/", import.meta.url)),
  });
  const api = async (
    route,
    body,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const response = await fetch(runtime.url + "/api/" + route, {
      method,
      headers: {
        "X-Freelancer-Client": "webpage",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(Error(result.error), { status: response.status });
    return result;
  };
  return {
    ...runtime,
    root,
    directory,
    nativeFile,
    project,
    app,
    store,
    host,
    state,
    calls,
    exports,
    api,
    async close() {
      await runtime.sender.close();
      await app.indexJobs.close();
      runtime.server.closeAllConnections();
      await new Promise((resolve) => runtime.server.close(resolve));
      app.history.close();
      app.modelRatings.close();
      app.localData.close();
      await store.flush();
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
