import { checkedCatalog } from '../../backend/tools/runtime/agent-catalog.mjs';
// Real HTTP/application/settings/drafts with only native runtime transport and
// quota collection substituted. All models and values are synthetic fixtures.
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createApplication } from "../../server/application.mjs";
import { createStore } from "../../server/store.mjs";
import { startServer } from "../../server/http.mjs";
import { createActivityReader } from "../../server/activity.mjs";
import { defaults } from "../../shared/strategy.mjs";
import { usageView } from "../../shared/usage.mjs";
import { providerCatalog } from "../../domain/costs.mjs";
import { quotaFixture } from "./usage-data.mjs";

export async function usageFixture() {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "freelancer-usage-ui-")),
  );
  const directory = path.join(root, "project");
  await mkdir(directory);
  const project = { id: "usage_project", name: "Usage checks", directory };
  const session = {
    id: "ses_usage",
    title: "Availability test chat",
    directory,
  };
  const store = createStore(root);
  await store.update("settings", (s) => ({
    ...s,
    projects: [project],
    appearance: { theme: "light" },
  }));
  const nativeProviders = [
    ["openai", "atlas", "Atlas"],
    ["github-copilot", "forge", "Forge"],
    ["opencode-go", "mimo", "MiMo"],
    ["opencode", "free", "Free model"],
  ];
  let raw = quotaFixture(),
    connected = nativeProviders.map((p) => p[0]),
    events = true,
    fixedNow;
  let refreshCount = 0,
    refreshFault = false,
    gate,
    release,
    afterRefresh;
  const mutations = [];
  const modelStates = {};
  const clock = () => fixedNow ?? Date.now();
  const messages = [
    {
      info: {
        id: "msg_usage_u",
        role: "user",
        sessionID: session.id,
        model: { providerID: "openai", modelID: "atlas" },
        time: { created: Date.now() },
      },
      parts: [
        {
          type: "text",
          id: "prt_usage_u",
          text: "Keep this chat and my draft in place.",
        },
      ],
    },
    {
      info: {
        id: "msg_usage_a",
        parentID: "msg_usage_u",
        role: "assistant",
        sessionID: session.id,
        providerID: "openai",
        modelID: "atlas",
        agent: "build",
        time: { created: Date.now(), completed: Date.now() },
        finish: "stop",
        cost: 5,
        tokens: { input: 12, output: 8, cache: { read: 0, write: 0 } },
      },
      parts: [
        {
          type: "text",
          id: "prt_usage_a",
          text:
            "User content is unchanged: $9 and 42 tokens.\n\n" +
            "This is a harmless test conversation.\n\n".repeat(30),
        },
      ],
    },
  ];
  const host = {
    async request(route, options = {}) {
      if (options.method && options.method !== "GET")
        mutations.push({ route, method: options.method });
      if (route === "/provider")
        return {
          connected,
          all: nativeProviders.map(([id, model, name]) => ({
            id,
            models: {
              [model]: {
                name,
                status: modelStates[id],
                cost: { input: 0, output: 0 },
                limit: { context: 32768, output: 2048 },
                toolcall: true,
              },
            },
          })),
        };
      if (route === "/provider/auth")
        return { openai: [{ type: "oauth", label: "Sign in with browser" }] };
      if (route === "/agent") return checkedCatalog(await store.read("settings")).agents.map(a=>({name:a.id,mode:"all",permission:[]}));
      if (route === "/config") return { model: "openai/atlas" };
      if (route === "/session?limit=1000") return [session];
      if (route === "/session/" + session.id) return session;
      if (route === "/session/" + session.id + "/message") return messages;
      if (route === "/session/status") return {};
      if (route.endsWith("/todo"))
        return [{ content: "Preserve the current task", status: "pending" }];
      return [];
    },
    async *events(_, signal) {
      while (!signal.aborted) {
        try {
          await delay(700, undefined, { signal });
        } catch {
          return;
        }
        if (events) yield "data: {}\n\n";
      }
    },
  };
  const app = createApplication({
    backendRoot: root,
    dataRoot: path.join(root, "user-data"),
    host,
    store,
    backendFactory: () => ({
      snapshot: async () => ({
        preferences: {
          scope: "default",
          revision: 0,
          preferences: { ...defaults, parentModel: "openai/atlas" },
        },
        usage: usageView(
          raw,
          providerCatalog.map((p) => p.surface),
          {},
          clock(),
        ),
        receipts: [],
        history: { entries: [] },
      }),
      save: async () => {},
      refreshQuota: async () => {
        refreshCount++;
        if (gate) await gate;
        if (refreshFault) throw Error("Deliberate usage refresh failure");
        if (afterRefresh) afterRefresh(raw, clock());
      },
    }),
  });
  const runtime = await startServer({
    application: app,
    assets: fileURLToPath(new URL("../../dist/", import.meta.url)),
    readActivity: createActivityReader({ project: app.project, host }),
  });
  return {
    ...runtime,
    app,
    store,
    mutations,
    project,
    session,
    raw: () => raw,
    replace(value) {
      raw = value;
    },
    setNow(value) {
      fixedNow = value;
    },
    setEvents(value) {
      events = value;
    },
    setConnected(value) {
      connected = value;
    },
    setModelStatus(id, status) {
      modelStates[id] = status;
    },
    refreshCount: () => refreshCount,
    failRefresh(value) {
      refreshFault = value;
    },
    onRefresh(callback) {
      afterRefresh = callback;
    },
    pauseRefresh() {
      gate = new Promise((r) => {
        release = r;
      });
    },
    resumeRefresh() {
      release?.();
      gate = undefined;
    },
    async close() {
      release?.();
      await runtime.sender.close();
      runtime.server.closeAllConnections();
      await new Promise((r) => runtime.server.close(r));
      await store.flush();
      await rm(root, { recursive: true, force: true });
    },
  };
}
