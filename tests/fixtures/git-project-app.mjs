import { checkedCatalog } from '../../backend/tools/runtime/agent-catalog.mjs';
// Real application, HTTP, store and Git; only native OpenCode/GitHub are stubbed.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createApplication } from "../../server/application.mjs";
import { createStore } from "../../server/store.mjs";
import { startServer } from "../../server/http.mjs";
import { defaults } from "../../shared/strategy.mjs";
import { command, executable } from "../../server/git-command.mjs";
export async function gitProjectFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "git-project-ui-"));
  const directory = path.join(root, "project"),
    home = path.join(root, "home");
  await mkdir(directory);
  await mkdir(home);
  await writeFile(
    path.join(directory, "hello.txt"),
    "Hello, project history.\n",
  );
  const project = { id: "git_project", name: "History test", directory };
  const store = createStore(root);
  await store.update("settings", (s) => ({
    ...s,
    projects: [project],
    appearance: { theme: "dark" },
  }));
  const snapshot = {
    preferences: { scope: "default", revision: 0, preferences: defaults },
    usage: { providers: [] },
    receipts: [],
    history: { entries: [] },
  };
  const host = {
    async request(route) {
      if (route === "/agent") return checkedCatalog(await store.read("settings")).agents.map(a=>({name:a.id,mode:"all",permission:[]}));
      if (route === "/provider") return { connected: [], all: [] };
      if (route === "/session/status" || route === "/config") return {};
      return [];
    },
    async *events(_, signal) {
      while (!signal.aborted) {
        try {
          await delay(1000, undefined, { signal });
        } catch {
          return;
        }
        yield "data: {}\n\n";
      }
    },
  };
  const gitPath = await executable("git");
  const app = createApplication({
    backendRoot: root,
    host,
    store,
    backendFactory: () => ({ snapshot: async () => snapshot }),
    gitOptions: {
      resolveExecutable: async (name) => {
        if (name === "git") return gitPath;
        throw Error("GitHub CLI is not installed.");
      },
      runner: (file, args, options) =>
        command(file, args, {
          ...options,
          env: {
            HOME: home,
            USERPROFILE: home,
            XDG_CONFIG_HOME: home,
            GIT_CONFIG_NOSYSTEM: "1",
          },
        }),
    },
  });
  const runtime = await startServer({
    application: app,
    assets: fileURLToPath(new URL("../../dist", import.meta.url)),
  });
  return {
    ...runtime,
    project,
    store,
    app,
    root,
    directory,
    async close() {
      await runtime.close();
      await store.flush();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}
