// One simulated native engine around the real application, JSON store, catalog,
// preference resolver and delegator. No network provider or inference is used.
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApplication } from "../../server/application.mjs";
import { createStore } from "../../server/store.mjs";
import {
  checkedCatalog,
  configureAgentProfiles,
} from "../../backend/tools/runtime/agent-catalog.mjs";
import { createDelegator } from "../../backend/tools/runtime/delegation.mjs";
import {
  loadPreferences,
  savePreferences,
} from "../../backend/tools/runtime/preferences.mjs";

export async function unifiedFixture(t) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "freelancer-named-")),
  );
  const directory = path.join(root, "project");
  await mkdir(directory);
  await mkdir(path.join(root, "routing"));
  await writeFile(
    path.join(root, "routing/policy.json"),
    JSON.stringify({
      allowed_surfaces: ["opencode-free", "opencode-go"],
      allow_overage: false,
    }),
  );
  const store = createStore(root),
    calls = [],
    prompts = [],
    permissions = [],
    selections = [];
  const sessions = new Map(),
    rows = new Map(),
    status = {};
  let profiles,
    next = 0;
  const config = { model: "opencode/free-a", subagent_depth: 2 };
  const provider = {
    connected: ["opencode", "opencode-go"],
    all: [
      {
        id: "opencode",
        models: {
          "free-a": {
            name: "Free A",
            cost: { input: 0, output: 0 },
            variants: { low: {}, high: {} },
          },
          "free-b": {
            name: "Free B",
            cost: { input: 0, output: 0 },
            variants: { low: {}, high: {} },
          },
        },
      },
      {
        id: "opencode-go",
        models: {
          paid: { name: "Paid test route", cost: { input: 1, output: 1 } },
        },
      },
    ],
  };
  const host = {
    async *events(_, signal) {
      while (!signal.aborted) {
        try {
          await delay(500, undefined, { signal });
        } catch {
          return;
        }
        yield "data: {}\n\n";
      }
    },
    async request(route, options = {}) {
      calls.push({ route, options: structuredClone(options) });
      if (route === "/agent") {
        if (!profiles) {
          const c = configureAgentProfiles(
            {},
            checkedCatalog(await store.read("settings")),
          );
          profiles = Object.entries(c.agent)
            .filter(([, a]) => !a.disable)
            .map(([name, a]) => ({
              ...a,
              name,
              permission: [
                { permission: "todowrite", pattern: "*", action: "allow" },
              ],
            }));
        }
        return structuredClone(profiles);
      }
      if (route === "/instance/dispose") {
        profiles = undefined;
        return true;
      }
      if (route === "/provider") return structuredClone(provider);
      if (route === "/config") return config;
      if (route === "/config/providers") return { providers: provider.all };
      if (route === "/session/status") return structuredClone(status);
      if (route === "/question" || route === "/permission") return [];
      if (route.startsWith("/session?"))
        return [...sessions.values()].filter(
          (s) => s.directory === options.directory,
        );
      if (route === "/session" && options.method === "POST") {
        const value = {
          ...options.body,
          id: `ses_named_${++next}`,
          directory: options.directory,
          time: { created: Date.now(), updated: Date.now() },
        };
        sessions.set(value.id, value);
        rows.set(value.id, []);
        return structuredClone(value);
      }
      const match = route.match(/^\/session\/(ses_[\w-]+)(?:\/(.*))?$/);
      if (!match) return [];
      const session = sessions.get(match[1]);
      if (!session) throw Error("Unknown native session");
      const action = match[2];
      if (!action) return structuredClone(session);
      if (action === "children")
        return [...sessions.values()].filter((s) => s.parentID === session.id);
      if (action === "message") return structuredClone(rows.get(session.id));
      if (action.startsWith("message/"))
        return structuredClone(
          rows.get(session.id).find((m) => m.info.id === action.slice(8)),
        );
      if (action === "abort") {
        delete status[session.id];
        return true;
      }
      if (action !== "prompt_async") return [];
      const body = structuredClone(options.body);
      prompts.push({ sessionID: session.id, body });
      const when = Date.now();
      rows
        .get(session.id)
        .push({
          info: {
            id: body.messageID,
            sessionID: session.id,
            role: "user",
            model: body.model,
            time: { created: when },
          },
          parts: body.parts,
        });
      rows
        .get(session.id)
        .push({
          info: {
            id: `${body.messageID}_answer`,
            parentID: body.messageID,
            sessionID: session.id,
            role: "assistant",
            agent: body.agent,
            ...body.model,
            time: {
              created: when,
              ...(session.parentID ? { completed: when + 1 } : {}),
            },
            finish: session.parentID ? "stop" : "tool-calls",
            tokens: {
              input: 5,
              output: 3,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            cost: 0,
          },
          parts: session.parentID
            ? [{ type: "text", text: "Simulated native result; no inference." }]
            : [],
        });
      if (!session.parentID) status[session.id] = { type: "busy" };
      return true;
    },
  };
  const app = createApplication({
    backendRoot: root,
    host,
    store,
    backendFactory: (_, directory) => ({
      snapshot: async (session) => ({
        preferences: await loadPreferences(root, directory, session),
        usage: { providers: [] },
        receipts: await Promise.all(
          (await readdir(path.join(root, ".state/delegation")).catch(() => []))
            .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))
            .map((n) =>
              readFile(path.join(root, ".state/delegation", n), "utf8").then(
                JSON.parse,
              ),
            ),
        ),
        history: { entries: [] },
      }),
      save: (input) => savePreferences(root, directory, input),
    }),
  });
  t?.after(async () => {
    await app.sender?.close();
    await app.gitProjects.close();
    await store.flush();
    await rm(root, { recursive: true, force: true });
  });
  const project = await app.addProject(directory),
    parent = await app.createChat(project.id, "Named agent test");
  const sdk = (route, options) =>
    host.request(route, options).then((data) => ({ data }));
  const client = {
    config: { get: () => sdk("/config") },
    app: { agents: () => sdk("/agent", { directory }) },
    session: {
      get: ({ path: p, query }) => sdk(`/session/${p.id}`, query),
      message: ({ path: p, query }) =>
        sdk(`/session/${p.id}/message/${p.messageID}`, query),
      messages: ({ path: p, query }) => sdk(`/session/${p.id}/message`, query),
      create: ({ body, query }) =>
        sdk("/session", { ...query, method: "POST", body }),
      promptAsync: ({ path: p, body, query }) =>
        sdk(`/session/${p.id}/prompt_async`, {
          ...query,
          method: "POST",
          body,
        }),
      children: ({ path: p, query }) => sdk(`/session/${p.id}/children`, query),
      status: ({ query }) => sdk("/session/status", query),
      abort: ({ path: p, query }) => sdk(`/session/${p.id}/abort`, query),
    },
  };
  const delegator = createDelegator({
    client,
    toolkitRoot: root,
    directory,
    select: async (args) => {
      selections.push(args);
      const selected = args.selectedModel ?? "opencode/free-b";
      return {
        selected_model: selected,
        surface: selected.startsWith("opencode/")
          ? "opencode-free"
          : "opencode-go",
        adequacy: "adequate",
        candidates: [{ id: selected }],
        quota_state: {},
      };
    },
    limits: { requestMs: 3000, pollMs: 1, taskMs: 1000, stopMs: 20 },
  });
  const context = (session = parent.id) => ({
    sessionID: session,
    directory,
    messageID: rows.get(session).findLast((m) => m.info.role === "assistant")
      .info.id,
    callID: "delegate_exact",
    abort: new AbortController().signal,
    ask: async (input) => {
      permissions.push(input);
    },
    metadata: () => {},
  });
  const send = async (input = {}) => {
    delete status[parent.id];
    await app.send(project.id, parent.id, {
      text: "Work on the requested task.",
      model: "opencode/free-a",
      ...input,
    });
    return context();
  };
  return {
    root,
    directory,
    app,
    store,
    host,
    client,
    project,
    parent,
    rows,
    sessions,
    status,
    prompts,
    permissions,
    selections,
    delegator,
    send,
    context,
    calls,
    close: async () => {
      await app.sender?.close();
      await app.gitProjects.close();
      await store.flush();
      await rm(root, { recursive: true, force: true });
    },
  };
}
