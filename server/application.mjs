import { delegationPool, delegationGuidance } from "../domain/delegation-policy.mjs";
import { checkedCatalog } from "../backend/tools/runtime/agent-catalog.mjs";
import { executionContext } from "../backend/tools/runtime/execution-context.mjs";
import { ensureAgentProfiles } from "./agent-profiles.mjs";
import { createHistoryService } from "./history.mjs";
import { createModelRatingService } from "./model-ratings.mjs";
import { rebuildContentIndex } from "./content-index.mjs";
import { createIndexJobs } from './index-jobs.mjs';
import { createChatGPTImport, importedChatID, orientationPart, listProjectFolders } from './chatgpt-import.mjs';
import {
  mkdir,
  realpath,
  stat,
  readFile,
  writeFile,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createUiBackend } from "../backend/tools/runtime/ui.mjs";
import { loadPreferences } from "../backend/tools/runtime/preferences.mjs";
import { modelRows, reconcileActivity } from "../shared/view.mjs";
import {
  providerCatalog,
  usageRecord,
  summarizeCosts,
} from "../domain/costs.mjs";
import { createStore } from "./store.mjs";
import { isLocalDataUnavailable } from "./data/store.mjs";
import { normalizeAttachments } from "../domain/attachments.mjs";
import { publicCatalog } from "./catalog.mjs";
import { sessionSummary } from "../shared/view.mjs";
import { randomUUID } from "node:crypto";
import { authInputs, connectionMethods } from "../domain/auth.mjs";
import {
  workspaceCatalog,
  normalizeAgent,
  normalizeWorkflow,
  modelAllowed,
  resolveChoices,
  resolvedVariant,
  modelVariant,
  normalizeVariant,
  agentDefaults,
  workflowDefaults,
} from "../domain/workspace.mjs";
import { executionPrompt, policyVersion } from "./execution.mjs";
import { createGitProjects } from "./git-project.mjs";
import { gitExecutionContract } from "../domain/git-project.mjs";
import { senderState } from "../domain/sender.mjs";

import { defaults as runtimeDefaults } from "../shared/strategy.mjs";
import {
  sessionDefaults,
  startingChoices,
  normalizeSessionDefaults,
} from "../domain/session-defaults.mjs";

import { validatePanelWidths } from "../domain/panel-widths.mjs";
import { visibleTodosForRequest } from "../domain/todos.mjs";

import { isTheme } from "../domain/theme.mjs";
import { normalizeProviderPatch, mergeProviderColors } from "../domain/provider-colors.mjs";

import { uiContract } from "../domain/protocol.mjs";
import { chatChanges } from "../domain/chat-changes.mjs";

const part = (value) => encodeURIComponent(value);
const sessionID = (value) => {
  if (!/^ses_[\w-]+$/.test(value || "")) throw Error("Choose a chat");
  return value;
};
export function createApplication({
  backendRoot,
  host,
  store = createStore(backendRoot),
  backendFactory = createUiBackend,
  dataRoot,
  gitOptions = {},
  importOptions = {},
}) {
  const supported = new Set(providerCatalog.map((p) => p.id));
  const gitProjects = createGitProjects({ store, project, host, backendRoot, ...gitOptions });
  let connecting = false;
  let sending = 0;
  let refreshingAgents = false;
  let refreshingUsage;
  let providerFlight;
  async function changeCredentials(change) {
    if (connecting || sending)
      throw Error("Wait for the current action to finish before connecting.");
    connecting = true;
    try {
      const settings = await store.read("settings");
      const directories = new Set([
        backendRoot,
        ...settings.projects.map((p) => p.directory),
      ]);
      for (const directory of directories) {
        const status = await host.request("/session/status", { directory });
        if (
          Object.values(status).some(
            (s) => s.type === "busy" || s.type === "retry",
          )
        )
          throw Error(
            "Wait for running chats to finish before changing connections.",
          );
      }
      const result = await change();
      // OpenCode caches provider clients per instance. Its native lifecycle
      // endpoint refreshes those clients; never dispose instances during work.
      await host.request("/global/dispose", { method: "POST" });
      return result;
    } finally {
      connecting = false;
    }
  }
  async function project(id) {
    const state = await store.read("settings");
    const p = state.projects.find((p) => p.id === id);
    if (!p) throw Error("Choose a project");
    return p;
  }
  const request = (p, route, options = {}) =>
    host.request(route, { ...options, directory: p.directory });
  const sameDirectory = (a, b) =>
    process.platform === "win32"
      ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
      : path.resolve(a) === path.resolve(b);
  async function ownSession(p, id) {
    if (importedChatID(id)) throw Error('Continue this imported chat in Freelancer before using native chat actions.');
    const value = await request(p, `/session/${part(sessionID(id))}`);
    if (!value.directory || !sameDirectory(value.directory, p.directory))
      throw Error("This chat belongs to another project");
    return value;
  }
  async function messages(p, id) {
    const session = await ownSession(p, id);
    const rows = await request(p, `/session/${part(sessionID(id))}/message`);
    await store.observe(
      rows.map((m) => usageRecord(m, p.directory, session.parentID)),
      { session },
    );
    return rows;
  }
  async function providers() {
    providerFlight ??= host.request("/provider")
      .then(publicCatalog)
      .finally(() => { providerFlight = undefined; });
    return providerFlight;
  }
  async function nativeModels(p, session) {
    const [agents, config, history] = await Promise.all([
      request(p, "/agent"),
      request(p, "/config"),
      session ? request(p, `/session/${part(session.id)}/message`) : [],
    ]);
    const recent = history.findLast(
      (m) => m.info.role === "user" && m.info.model,
    )?.info.model;
    const id = (m) =>
      typeof m === "string"
        ? m
        : m?.providerID && (m.modelID || m.id)
          ? `${m.providerID}/${m.modelID ?? m.id}`
          : null;
    return Object.fromEntries(
      ["default", ...checkedCatalog(await store.read("settings")).agents.map(a => a.id)].map((agentID) => [
        agentID,
        id(agents.find((a) => a.name === agentID)?.model) ??
          id(session?.model) ??
          id(recent) ??
          id(config.model),
      ]),
    );
  }
  async function chatDefaults(settings, p, preferences, native) {
    preferences ??= await loadPreferences(backendRoot, p.directory);
    native ??= await nativeModels(p, null).catch(() => ({}));
    const base = preferences.defaults ?? preferences.preferences;
    return sessionDefaults(
      settings.sessionDefaults?.[p.id],
      workspaceCatalog(settings),
      {
        parentModel:
          base?.parentModel && base.parentModel !== "auto"
            ? base.parentModel
            : native.default,
        reasoningVariant: base?.reasoningVariant ?? "",
      },
    );
  }
  const contentIndexRefresh = new Map();
  const modelRatings = createModelRatingService({ host, backendRoot, dataRoot, project, store,
    getCatalog: async (id) => app.bootstrap(id) });
  const app = {
    store,
    project,
    gitProjects,
    modelRatings,
    listProjectFolders,
    async rebuildContentIndex({ projectID, onProgress = () => {}, signal } = {}) {
      const key = projectID ?? '*';
      if (contentIndexRefresh.has(key)) return contentIndexRefresh.get(key);
      const refresh = (async () => {
        const projects = projectID ? [await project(projectID)] : (await store.read("settings")).projects;
        const summary = { projects: 0, sources: 0, units: 0, failures: [] };
        for (const item of projects) {
          signal?.throwIfAborted();
          onProgress(`Indexing files · ${item.name} (${summary.projects + 1}/${projects.length})`);
          try {
            const result = await rebuildContentIndex({ project: await project(item.id), backendRoot, dataRoot, signal, onProgress });
            summary.projects++;
            summary.sources += result.physical_sources_indexed ?? 0;
            summary.units += result.units ?? 0;
            for (const failure of result.extraction_failures ?? [])
              summary.failures.push({ project: item.name, source: failure.source, error: failure.error });
          } catch (error) {
            summary.failures.push({ project: item.name, error: error.message });
          }
        }
        return summary;
      })().finally(() => { contentIndexRefresh.delete(key); });
      contentIndexRefresh.set(key, refresh);
      return refresh;
    },
    async gitAgentAction(input) {
      const settings = await store.read("settings");
      const p = settings.projects.find((p) => sameDirectory(p.directory, input.directory));
      if (!p) throw Error("Open this project in Freelancer first.");
      const session = await ownSession(p, input.sessionID);
      const message = await request(p, `/session/${part(session.id)}/message/${part(input.messageID)}`);
      if (message?.info?.role !== "assistant") throw Error("A native assistant context is required.");
      const receipt = await executionContext(backendRoot, p.directory, session, message);
      if (input.action === "inspect") return gitProjects.inspect(p.id);
      if (receipt?.projectID !== p.id || receipt?.sessionID !== session.id)
        throw Error("Managed Git actions require a current Freelancer execution context for this project.");
      const actor = { sessionID: session.id, messageID: input.messageID, delegated: !!session.parentID, origin: "agent" };
      if (input.action === "preview") return gitProjects.preview(p.id, input, actor);
      if (input.action === "execute") return gitProjects.execute(p.id, { planID: input.planID, confirm: true }, actor);
      if (input.action === "merge") return gitProjects.merge(p.id, input.planID ? { ...input, confirm: true } : input, actor);
      throw Error("The agent cannot change setup, accounts or the project agreement.");
    },
    async bootstrap(id, selected) {
      const settings = await store.read("settings"),
        p = id ? await project(id) : settings.projects.find((row) => row.id === settings.lastProjectID) ?? settings.projects[0];
      const backend = backendFactory(backendRoot, p?.directory ?? backendRoot);
      const [catalog, initialSnapshot, sessions, ledger, savedPreferences, native] = await Promise.all([
        providers(),
        backend.snapshot(selected),
        p ? request(p, "/session?limit=1000").then((rows) => rows.filter(
          (s) => s.directory && sameDirectory(s.directory, p.directory),
        )) : Promise.resolve([]),
        store.read("usage"),
        p && selected ? loadPreferences(backendRoot, p.directory) : Promise.resolve(null),
        (async () => nativeModels(
          p ?? { directory: backendRoot },
          selected ? await ownSession(p, selected) : null,
        ))().catch(() => ({})),
      ]);
      let snapshot = initialSnapshot;
      const projectPreferences = p && selected ? savedPreferences : snapshot.preferences;
      const start = p
        ? await chatDefaults(
            settings,
            p,
            projectPreferences,
            selected ? undefined : native,
          )
        : null;
      if (start && !selected) {
        const preferences = {
          ...(projectPreferences.defaults ?? projectPreferences.preferences ?? runtimeDefaults),
          parentModel: start.parentModel || "auto",
        };
        snapshot = {
          ...snapshot,
          preferences: {
            ...snapshot.preferences,
            defaults: preferences,
            preferences,
          },
        };
      }
      const catalogRows = modelRows(catalog.all, snapshot).map(({ host, ...row }) => ({
        ...row,
        native: host,
        variants: host.variants ?? [],
        quota: snapshot.usage?.providers?.find((p) => p.id === (row.surface ??
          providerCatalog.find((p) => p.id === row.provider)?.surface))?.availableRemaining ?? null,
        surface: row.surface ?? providerCatalog.find((p) => p.id === row.provider)?.surface,
        costClass: settings.plans.providers[row.provider].mode === 'free' ? 'free'
          : settings.plans.providers[row.provider].mode === 'api' ? 'metered' : 'subscription',
      }));
      let ratings = {}, localDataError;
      try { ratings = modelRatings.catalog(catalogRows); }
      catch (error) {
        if (!isLocalDataUnavailable(error)) throw error;
        localDataError = error.message;
      }
      const models = catalogRows.map(({ native, ...row }) => row);
      return {
        uiContract,
        indexPreparation: !localDataError,
        ...(localDataError ? { localDataError } : {}),
        settings: { ...settings, ...workspaceCatalog(settings) },
        project: p ?? null,
        providers: catalog,
        nativeModels: native,
        sessionDefaults: start,
        models: models.map((row) => ({ ...row, ratingStatus: ratings[row.id]?.status ?? 'Missing information',
          rating: ratings[row.id]?.rating ?? null, ratingUpdatedAt: ratings[row.id]?.updatedAt ?? null })),
        sessions,
        snapshot,
        projectPreferences,
        costs: summarizeCosts({
          plans: settings.plans,
          records: Object.values(ledger.records),
          usage: snapshot.usage,
          connected: catalog.connected,
        }),
      };
    },
    async addProject(directory) {
      if (typeof directory !== "string" || !path.isAbsolute(directory))
        throw Error("Choose an existing project folder");
      try {
        directory = await realpath(directory);
      } catch (e) {
        if (e.code === "ENOENT" || e.code === "ENOTDIR")
          throw Error(
            "This folder does not exist. Choose an existing project folder.",
          );
        throw e;
      }
      if (!(await stat(directory)).isDirectory())
        throw Error("Choose a folder");
      const config = path.join(directory, ".opencode");
      try {
        if ((await lstat(config)).isSymbolicLink())
          throw Error(
            "The project configuration folder is a link. Choose its actual folder.",
          );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await mkdir(config, { recursive: true });
      const marker = path.join(config, "freelancer.json");
      try {
        const previous = JSON.parse(await readFile(marker, "utf8"));
        if (previous.owner !== "freelancer-webpage")
          throw Error("A different Freelancer configuration already exists.");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const id = createHash("sha256")
        .update(
          process.platform === "win32" ? directory.toLowerCase() : directory,
        )
        .digest("hex")
        .slice(0, 24);
      const value = {
        id,
        directory,
        name: path.basename(directory) || directory,
        openedAt: new Date().toISOString(),
      };
      const settingsBefore = await store.read("settings");
      const alreadyRegistered = settingsBefore.projects.find((p) => p.id === id);
      const backend = backendFactory(backendRoot, directory),
        snapshot = await backend.snapshot();
      if (!snapshot.preferences)
        throw Error("Project setup could not load. Please try again.");
      if (snapshot.preferences.scope === "default")
        await backend.save({
          scope: "project",
          preferences: snapshot.preferences.preferences,
          revision: snapshot.preferences.revision,
        });
      // The app-local OpenCode resources supply the plugin, five skills,
      // and helpers to every project. Persist project policy, not duplicate plugins.
      await writeFile(
        marker,
        JSON.stringify(
          { owner: "freelancer-webpage", version: 1, projectID: id },
          null,
          2,
        ) + "\n",
        { flag: "w" },
      );
      await store.update("settings", (s) => ({
        ...s,
        revision: s.revision + 1,
        lastProjectID: id,
        projects: [{ ...value, ...(alreadyRegistered ? { name: alreadyRegistered.name } : {}) }, ...s.projects.filter((p) => p.id !== id)],
      }));
      return { ...value, ...(alreadyRegistered ? { name: alreadyRegistered.name } : {}) };
    },
    async updateProject(id, input) {
      await project(id);
      if (typeof input?.name !== "string" || !input.name.trim() || input.name.trim().length > 80)
        throw Error("Enter a project name up to 80 characters.");
      const name = input.name.trim();
      let updated;
      await store.update("settings", (s) => {
        const current = s.projects.find((p) => p.id === id);
        if (!current) throw Error("Choose a project");
        if (s.projects.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase()))
          throw Error("Another project already uses that name.");
        updated = { ...current, name };
        return { ...s, revision: s.revision + 1, projects: s.projects.map((p) => p.id === id ? updated : p) };
      });
      return updated;
    },
    async removeProject(id) {
      const current = await project(id);
      const [status, questions, permissions] = await Promise.all([
        request(current, "/session/status"),
        request(current, "/question"),
        request(current, "/permission"),
      ]);
      if (!status || typeof status !== "object" || Array.isArray(status) || !Array.isArray(questions) || !Array.isArray(permissions))
        throw Error("Chat activity is unavailable. Nothing was removed.");
      if (Object.values(status).some((state) => state.type !== "idle") || questions.length || permissions.length)
        throw Error("Finish running chats and resolve pending requests before removing this project.");
      await store.update("settings", (s) => {
        if (!s.projects.some((p) => p.id === id)) throw Error("Choose a project");
        const projects = s.projects.filter((p) => p.id !== id);
        const fallback = projects.toSorted((a, b) => Date.parse(b.openedAt ?? "") - Date.parse(a.openedAt ?? ""))[0]?.id ?? null;
        return {
          ...s,
          revision: s.revision + 1,
          projects,
          lastProjectID: s.lastProjectID === id ? fallback : s.lastProjectID,
        };
      });
      return { removed: id };
    },
    async selectProject(id) {
      await project(id);
      await store.update("settings", (s) => s.lastProjectID === id ? s : ({
        ...s,
        revision: s.revision + 1,
        lastProjectID: id,
        projects: s.projects.map((p) => p.id === id ? { ...p, openedAt: new Date().toISOString() } : p),
      }));
      return { selected: id };
    },
    async chat(id, session) {
      const p = await project(id);
      if (importedChatID(session)) {
        const imported = app.chatgpt.get(id, session);
        if (!imported) throw Error('This imported chat belongs to another project or is unavailable.');
        return { title: imported.title, messages: imported.messages, imported: imported.source,
          receipts: [], status: {}, permissions: [], questions: [], activity: [], summary: sessionSummary(), todos: [], diff: [] };
      }
      const nativeSession = await ownSession(p, session);
      const reads = await Promise.allSettled([
        messages(p, session),
        request(p, "/session/status"),
        request(p, "/permission"),
        request(p, "/question"),
        backendFactory(backendRoot, p.directory).snapshot(session),
        providers(),
        request(p, `/session/${part(session)}/todo`),
        request(p, `/session/${part(session)}/diff`),
        gitProjects.changedFiles(id).then(files => ({ files }), () => ({ files: [], unavailable: true })),
      ]);
      const availabilityWarnings = [];
      const value = (index, label, fallback, valid = () => true) => {
        const read = reads[index];
        if (read.status === "fulfilled" && valid(read.value)) return read.value;
        const error = read.status === "rejected" ? read.reason?.message : "returned an invalid response";
        availabilityWarnings.push(`${label}: ${error || "unavailable"}`);
        return fallback;
      };
      const rows = value(0, "Transcript", null, Array.isArray);
      if (!rows) throw Error(`Native transcript is unavailable: ${availabilityWarnings.at(-1)?.replace(/^Transcript: /, "") || "OpenCode returned no messages."}`);
      const status = value(1, "Activity status", {}, result => result && typeof result === "object" && !Array.isArray(result));
      const permissions = value(2, "Permissions", [], Array.isArray);
      const questions = value(3, "Questions", [], Array.isArray);
      const snapshot = value(4, "Chat state", { receipts: [], history: { entries: [] } }, result => result && typeof result === "object");
      snapshot.receipts ??= [];
      const catalog = value(5, "Model catalog", { all: [] }, result => Array.isArray(result?.all));
      const todos = value(6, "Todos", [], Array.isArray);
      const diff = value(7, "Diff", [], Array.isArray);
      const fileStatus = value(8, "Project changes", { files: [], unavailable: true }, result => Array.isArray(result?.files));
      const activity = reconcileActivity(
        rows.flatMap((m) => m.parts ?? []),
        snapshot.receipts,
      ).map((row) => {
        row = {
          ...row,
          requestID: rows.find(
            (m) => m.info.id === row.raw?.user_task_id?.split("/").at(-1),
          )?.info.parentID,
        };
        const outcome = snapshot.history?.entries?.find(
          (entry) =>
            entry.task_id === row.id &&
            entry.model === row.observed &&
            entry.observation_kind !== "operational",
        );
        return outcome
          ? {
              ...row,
              validation: outcome.success
                ? outcome.tests_passed
                  ? "Passed checks"
                  : "Completed acceptance checks"
                : "Needs attention",
            }
          : row;
      });
      // Native transport can retain `busy` after its assistant message has
      // already ended in an error. Preserve the raw record, but expose an idle
      // status for this failed turn so the composer and durable sender do not
      // remain frozen until an unrelated native restart changes it.
      const deliveryState = senderState({ messages: rows, status, permissions, questions,
        receipts: snapshot.receipts }, session);
      const displayStatus = deliveryState.failed || deliveryState.interrupted
        ? { ...status, [session]: { ...(status[session] ?? {}), type: 'idle', failure: deliveryState.failure } }
        : status;
      // Surface only this session's verified descendants, never another project's
      // pending decisions. Native identity/ancestry remains the authority.
      const decisionOrigins = new Map([[session, nativeSession]]);
      const inspected = new Map([[session, Promise.resolve(nativeSession)]]);
      const inspect = target => {
        if (!inspected.has(target)) inspected.set(target, ownSession(p, target).catch(() => null));
        return inspected.get(target);
      };
      await Promise.all([...new Set([...permissions, ...questions].map(row => row.sessionID))].map(async target => {
        if (!target || target === session) return;
        let node = await inspect(target);
        const origin = node, visited = new Set();
        while (node && visited.size < 32 && !visited.has(node.id)) {
          if (node.id === session) { decisionOrigins.set(target, origin); return; }
          visited.add(node.id);
          node = node.parentID ? await inspect(node.parentID) : null;
        }
      }));
      const scopedDecisions = rows => rows.filter(row => decisionOrigins.has(row.sessionID)).map(row => ({ ...row,
        worker: row.sessionID !== session || !!nativeSession.parentID,
        sessionTitle: decisionOrigins.get(row.sessionID)?.title || 'Subagent',
      }));
      const importedSource = app.chatgpt.source(id, session);
      let requestRows = [];
      try { requestRows = Object.values((await store.read("requests")).records); }
      catch (error) { availabilityWarnings.push(`Request receipts: ${error.message}`); }
      return {
        title: nativeSession.title || "New chat",
        messages: [...(importedSource?.messages ?? []), ...rows.map(row => ({ ...row,
          parts: row.parts?.filter(part => !part.metadata?.freelancer_chatgpt_orientation) }))],
        continuation: importedSource?.source ?? null,
        receipts: requestRows
          .filter((r) => r.sessionID === session && r.projectID === id)
          .map(({ agent, workflow, catalog: _catalog, catalogModels: _models, catalogConnected: _connected, ...r }) => ({
            ...r,
            agent: { id: agent.id, name: agent.name },
            workflow: {
              id: workflow.id,
              name: workflow.name,
              mode: workflow.mode,
            },
          })),
        status: displayStatus,
        permissions: scopedDecisions(permissions),
        questions: scopedDecisions(questions),
        activity,
        summary: sessionSummary(
          rows.map((m) => m.info),
          catalog.all,
          activity,
        ),
        todos: visibleTodosForRequest(todos, rows),
        diff: chatChanges(diff, rows, fileStatus.files, p.directory),
        changesUnavailable: fileStatus.unavailable === true,
        availabilityWarnings,
      };
    },
    async chatTranscript(id, session, reason) {
      const p = await project(id);
      if (importedChatID(session)) {
        const imported = app.chatgpt.get(id, session);
        if (!imported) throw Error('This imported chat belongs to another project or is unavailable.');
        return { title: imported.title, messages: imported.messages, imported: imported.source,
          receipts: [], status: {}, permissions: [], questions: [], activity: [], summary: sessionSummary(),
          todos: [], diff: [], availabilityWarnings: [`Chat details unavailable: ${reason}`] };
      }
      const nativeSession = await ownSession(p, session);
      const rows = await request(p, `/session/${part(session)}/message`);
      if (!Array.isArray(rows)) throw Error('OpenCode returned no chat transcript.');
      return {
        title: nativeSession.title || "New chat",
        messages: rows.map(row => ({ ...row,
          parts: row.parts?.filter(part => !part.metadata?.freelancer_chatgpt_orientation) })),
        continuation: null,
        receipts: [], status: {}, permissions: [], questions: [], activity: [],
        summary: sessionSummary(rows.map(row => row.info), [], []), todos: [], diff: [],
        availabilityWarnings: [`Chat details unavailable: ${reason}`],
      };
    },
    async saveSessionDefaults(id, input) {
      await project(id);
      const catalog = await providers();
      const result = await store.update("settings", (s) => {
        const previous = s.sessionDefaults?.[id];
        if (input.revision !== (previous?.revision ?? 0))
          throw Error("Defaults changed elsewhere. Reload before saving.");
        const value = normalizeSessionDefaults(input, workspaceCatalog(s));
        if (
          value.parentModel &&
          startingChoices(value, workspaceCatalog(s)).model !== "inherit"
        ) {
          const slash = value.parentModel.indexOf("/");
          const providerID = value.parentModel.slice(0, slash),
            modelID = value.parentModel.slice(slash + 1);
          const model = catalog.all.find((p) => p.id === providerID)?.models[
            modelID
          ];
          if (
            !model ||
            (providerID !== "opencode" &&
              !catalog.connected.includes(providerID))
          )
            throw Error("Choose an available parent model");
          if (
            value.reasoningVariant &&
            !model.variants.includes(value.reasoningVariant)
          )
            throw Error("Choose an intelligence level reported by this model");
        }
        return {
          ...s,
          revision: s.revision + 1,
          sessionDefaults: {
            ...s.sessionDefaults,
            [id]: { ...value, revision: (previous?.revision ?? 0) + 1 },
          },
        };
      });
      return result.sessionDefaults[id];
    },
    async createChat(id, title) {
      const p = await project(id),
        settings = await store.read("settings");
      const defaults = await chatDefaults(settings, p);
      const session = await request(p, "/session", {
        method: "POST",
        body: {
          title: typeof title === "string" ? title.slice(0, 120) : undefined,
        },
      });
      sessionID(session.id);
      // Starting model choices are separate from execution restrictions. Preserve
      // the user's project limits (including migrated agent access) in new chats.
      const projectPolicy = (await loadPreferences(backendRoot, p.directory)).defaults;
      await backendFactory(backendRoot, p.directory).save({
        scope: "session",
        sessionID: session.id,
        preferences: {
          ...projectPolicy,
          parentModel: defaults.parentModel || "auto",
        },
      });
      await store.update("settings", (s) => ({
        ...s,
        chatChoices: {
          ...s.chatChoices,
          [session.id]: startingChoices(defaults, workspaceCatalog(settings)),
        },
      }));
      return session;
    },
    async send(
      id,
      session,
      {
        text,
        model: modelChoice = "inherit",
        variant: variantChoice = "inherit",
        agentID = "inherit",
        workflowID = "build",
        attachments,
      },
    ) {
      if (connecting || refreshingAgents)
        throw Error(
          "Finish refreshing the connection or agent catalog before sending a message.",
        );
      sending++;
      let gitAcceptedMessage;
      try {
        const fileParts = normalizeAttachments(attachments);
        if (typeof text !== "string" || (!text.trim() && !fileParts.length) || text.length > 200000)
          throw Error("Write a message or attach a file first");
        const settings = await store.read("settings");
        const workspace = checkedCatalog(settings);
        const p = await project(id);
        await ensureAgentProfiles(host, p.directory, workspace.agents, () => sending === 1 && !connecting,
          refreshing => { refreshingAgents = refreshing; });
        const backend = backendFactory(backendRoot, p.directory);
        const snapshot = await backend.snapshot(session);
        const defaults =
          snapshot.preferences.defaults ?? snapshot.preferences.preferences;
        const choice = resolveChoices(
          workspace,
          {
            workflowID,
            agentID,
            model: modelChoice,
          },
          defaults,
        );
        const { workflow, agent } = choice;
        normalizeVariant(variantChoice);
        let variant =
          variantChoice === "inherit"
            ? resolvedVariant(agent?.variant, defaults)
            : variantChoice;
        const childVariant = resolvedVariant(workflow.variant, defaults);
        const nativeSession = await ownSession(p, session);
        const gitAgreement = await gitProjects.policy(id);
        const catalog = await providers();
        const candidates = catalog.all.flatMap((p) =>
          Object.keys(p.models).map((m) => ({
            id: `${p.id}/${m}`,
            provider: p.id,
            variants: p.models[m].variants ?? [],
            costClass:
              settings.plans.providers[p.id].mode === "free"
                ? "free"
                : settings.plans.providers[p.id].mode === "api"
                  ? "metered"
                  : "subscription",
          })),
        );
        const allowedModels = delegationPool(defaults, workflow, candidates, catalog.connected, childVariant);
        let model;
        const parseModel = (value) => {
          const slash = value.indexOf("/");
          return {
            providerID: value.slice(0, slash),
            modelID: value.slice(slash + 1),
          };
        };
        if (choice.model !== "auto") model = parseModel(choice.model);
        else {
          const native = await nativeModels(p, nativeSession);
          if (native[agent.id] ?? native.default) model = parseModel(native[agent.id] ?? native.default);
          if (!model) {
            // Native fallback can use its recent model or provider default. Only
            // leave it unresolved when every available native choice is in policy.
            const native = await request(p, "/config/providers");
            const possible = (native.providers ?? []).flatMap((provider) =>
              Object.keys(provider.models ?? {}).map(
                (id) => `${provider.id}/${id}`,
              ),
            );
            if (
              !possible.length ||
              possible.some(
                (id) =>
                  !candidates.some(
                    (m) =>
                      m.id === id &&
                      modelAllowed(
                        { category: "connected" },
                        m,
                        catalog.connected,
                      ),
                  ),
              )
            )
              throw Error(
                "Set a default model for this agent or choose a model for this message.",
              );
          }
        }
        if (model) {
          if (
            !supported.has(model.providerID) ||
            !catalog.all.find((p) => p.id === model.providerID)?.models[
              model.modelID
            ] ||
            (!catalog.connected.includes(model.providerID) &&
              model.providerID !== "opencode")
          )
            throw Error(
              "The chosen model is unavailable. Connect its provider or choose another model.",
            );
          if (
            variantChoice !== "inherit" &&
            variant &&
            !catalog.all
              .find((p) => p.id === model.providerID)
              ?.models[model.modelID]?.variants.includes(variant)
          )
            throw Error(
              "The parent model does not support this intelligence level. Choose a reported option in the workspace picker.",
            );
          variant = modelVariant(
            catalog.all.find((p) => p.id === model.providerID)?.models[
              model.modelID
            ]?.variants,
            variant,
          );
          model = { providerID: model.providerID, modelID: model.modelID };
        }
        if (variant && !model)
          throw Error("Choose a parent model to use this intelligence level.");
        if (!nativeSession.parentID)
          await gitProjects.beforeBuild(id, session, workflow);
        // Apply the same restriction to the existing child selector, not a second router.
        const preferences = {
          ...defaults,
          allowedModels,
          maxParallel: defaults.maxParallel,
          childVariant,
        };
        await backend.save({
          scope: "execution",
          sessionID: session,
          revision: snapshot.preferences.revision,
          preferences,
        });
        await store.update("settings", (s) => ({
          ...s,
          chatChoices: {
            ...s.chatChoices,
            [session]: {
              agentID,
              workflowID,
              ...(variantChoice !== "inherit"
                ? { variant: variantChoice }
                : {}),
              model:
                typeof modelChoice === "object"
                  ? `${modelChoice.providerID}/${modelChoice.modelID}`
                  : modelChoice,
            },
          },
        }));
        const messageID = `msg_${randomUUID().replaceAll("-", "")}`;
        const importedSource = app.chatgpt.source(id, session);
        const orientation = importedSource && !(await request(p, `/session/${part(session)}/message`)).length
          ? orientationPart(importedSource, Math.min(48000, catalog.all.find(p => p.id === model?.providerID)?.models[model?.modelID]?.limit?.context || 12000)) : null;
        const metadata = {
          policyVersion,
          requestID: messageID,
          projectID: id,
          workflowID: workflow.id,
          agentID: agent.id,
          mode: workflow.mode,
        };
        await store.recordRequest({
          id: messageID,
          sessionID: session,
          projectID: id,
          createdAt: Date.now(),
          status: "prepared",
          policyVersion,
          agent,
          directory: p.directory,
          catalog: workspace,
          catalogModels: candidates,
          // An empty captured pool means no children, not unrestricted routing.
          delegationPool: allowedModels,
          catalogConnected: catalog.connected,
          workflow,
          model: model ?? null,
          variant: variant || null,
          preferences,
          orienting: !!orientation,
        });
        try {
          const result = await request(
            p,
            `/session/${part(sessionID(session))}/prompt_async`,
            {
              method: "POST",
              body: {
                messageID,
                model,
                ...(variant ? { variant } : {}),
                agent: agent.id,
                system: executionPrompt(agent, workflow, metadata, workspace) +
                  "\n\n" + delegationGuidance(preferences, allowedModels) +
                  (gitAgreement.tracking ? "\n\n" + gitExecutionContract(gitAgreement) : ""),
                parts: [...(orientation ? [orientation] : []), ...(text.trim() ? [{ type: "text", text }] : []), ...fileParts],
              },
            },
          );
          await store.recordRequest({ id: messageID, status: "accepted" });
          gitAcceptedMessage = messageID;
          return result;
        } catch (error) {
          await store.recordRequest({
            id: messageID,
            status: "dispatch_error",
          });
          throw error;
        }
      } finally {
        gitProjects.finishDispatch(id, session, gitAcceptedMessage);
        sending--;
      }
    },
    async stop(id, session) {
      const p = await project(id);
      await ownSession(p, session);
      const result = await request(
        p,
        `/session/${part(sessionID(session))}/abort`,
        {
          method: "POST",
        },
      );
      // Native abort can leave tool questions pending. A stopped turn must not
      // retain actionable prompts; dismiss only requests belonging to this chat.
      const [questions, permissions] = await Promise.all([
        request(p, "/question"),
        request(p, "/permission"),
      ]);
      for (const [kind, rows] of [
        ["question", questions],
        ["permission", permissions],
      ]) {
        for (const row of rows.filter((row) => row.sessionID === session)) {
          try {
            await request(
              p,
              `/${kind}/${part(row.id)}/${kind === "question" ? "reject" : "reply"}`,
              {
                method: "POST",
                ...(kind === "permission" ? { body: { reply: "reject" } } : {}),
              },
            );
          } catch (e) {
            if (e.status !== 404) throw e;
          }
        }
      }
      return result;
    },
    async changeChat(id, session, body) {
      const p = await project(id);
      await ownSession(p, session);
      if (typeof body.title !== "string" || !body.title.trim())
        throw Error("Give the chat a name");
      return request(p, `/session/${part(session)}`, {
        method: "PATCH",
        body: { title: body.title.trim().slice(0, 120) },
      });
    },
    async sessionAction(id, session, action, body) {
      const p = await project(id);
      await ownSession(p, session);
      if (!["fork", "summarize", "revert", "unrevert"].includes(action))
        throw Error("Unknown chat action");
      const payload =
        action === "summarize"
          ? { providerID: body.providerID, modelID: body.modelID }
          : action === "revert"
            ? { messageID: body.messageID }
            : {};
      if (action === "summarize" && !supported.has(payload.providerID))
        throw Error("Choose a connected model");
      if (action === "revert" && !/^msg_[\w-]+$/.test(payload.messageID ?? ""))
        throw Error("Choose a message");
      return request(p, `/session/${part(session)}/${action}`, {
        method: "POST",
        body: payload,
      });
    },
    async files(id, relative = "", content = false) {
      const p = await project(id),
        target = await realpath(path.resolve(p.directory, relative));
      const rel = path.relative(p.directory, target);
      if (
        rel.startsWith(".." + path.sep) ||
        rel === ".." ||
        path.isAbsolute(rel)
      )
        throw Error("Choose a file inside this project");
      if (content && (await stat(target)).size > 1024 * 1024)
        throw Error("This file is too large to preview");
      return request(
        p,
        `${content ? "/file/content" : "/file"}?path=${part(rel.replaceAll("\\", "/"))}`,
      );
    },
    async respond(id, type, requestID, body) {
      if (
        !["permission", "question"].includes(type) ||
        !/^\w+$/.test(requestID)
      )
        throw Error("Invalid request");
      if (
        type === "permission" &&
        !["once", "always", "reject"].includes(body.reply)
      )
        throw Error("Choose a permission response");
      const p = await project(id),
        pending = await request(p, `/${type}`),
        item = pending.find((v) => v.id === requestID);
      if (!item) throw Error("This request has already been answered");
      await ownSession(p, item.sessionID);
      if (type === "question" && body.reject)
        return request(p, `/question/${part(requestID)}/reject`, {
          method: "POST",
        });
      if (
        type === "question" &&
        (!Array.isArray(body.answers) ||
          body.answers.length !== item.questions.length ||
          body.answers.some(
            (answer, i) =>
              !Array.isArray(answer) ||
              !answer.length ||
              (!item.questions[i].multiple && answer.length !== 1) ||
              answer.some(
                (value) =>
                  typeof value !== "string" ||
                  !value.trim() ||
                  value.length > 20000 ||
                  (item.questions[i].custom === false &&
                    !item.questions[i].options.some(
                      (option) => option.label === value,
                    )),
              ),
          ))
      )
        throw Error("Answer each question using its available choices");
      return request(p, `/${type}/${part(requestID)}/reply`, {
        method: "POST",
        body,
      });
    },
    async readPreferences(id, session) {
      const p = await project(id);
      if (session) await ownSession(p, session);
      return loadPreferences(backendRoot, p.directory, session);
    },
    async savePreferences(id, body) {
      const p = await project(id);
      if (body.sessionID) await ownSession(p, body.sessionID);
      return backendFactory(backendRoot, p.directory).save(body);
    },

    async refreshUsage() {
      if (!refreshingUsage)
        refreshingUsage = backendFactory(backendRoot, backendRoot)
          .refreshQuota()
          .finally(() => {
            refreshingUsage = null;
          });
      await refreshingUsage;
      return { refreshed: true };
    },
    async savePlans(plans) {
      await store.savePlans(plans);
      return { saved: true };
    },
    async saveAppearance({ theme, showDepletedModels, todoLayout, panelWidths, providerColors }) {
      const colors = providerColors === undefined ? undefined : normalizeProviderPatch(providerColors);
      const widths = panelWidths === undefined ? undefined : validatePanelWidths(panelWidths);
      if (theme !== undefined && !isTheme(theme))
        throw Error("Choose a theme");
      if (
        showDepletedModels !== undefined &&
        typeof showDepletedModels !== "boolean"
      )
        throw Error("Choose model visibility");
      if (todoLayout !== undefined && !["inline", "docked"].includes(todoLayout))
        throw Error("Choose todo placement");
      const saved = await store.update("settings", (s) => ({
        ...s,
        appearance: {
          ...s.appearance,
          ...(widths ? { panelWidths: { ...s.appearance?.panelWidths, ...widths } } : {}),
          ...(theme !== undefined ? { theme } : {}),
          ...(colors ? { providerColors: mergeProviderColors(s.appearance?.providerColors, colors) } : {}),
          ...(showDepletedModels !== undefined ? { showDepletedModels } : {}),
          ...(todoLayout !== undefined ? { todoLayout } : {}),
        },
      }));
      return { saved: true, ...(theme !== undefined ? { theme: saved.appearance.theme } : {}),
        ...(widths ? { panelWidths: saved.appearance.panelWidths } : {}),
        ...(colors ? { providerColors: saved.appearance.providerColors } : {}) };
    },
    async authMethods() {
      const methods = await host.request("/provider/auth");
      return connectionMethods(methods);
    },
    async auth(id, action, body) {
      if (
        !supported.has(id) ||
        !["authorize", "callback", "key", "disconnect"].includes(action)
      )
        throw Error("Unsupported provider");
      if (action === "key") {
        if (typeof body.key !== "string" || !body.key.trim())
          throw Error("Enter an API key");
        return changeCredentials(() =>
          host.request(`/auth/${part(id)}`, {
            method: "PUT",
            body: { type: "api", key: body.key },
          }),
        );
      }
      if (action === "disconnect")
        return changeCredentials(() =>
          host.request(`/auth/${part(id)}`, { method: "DELETE" }),
        );
      if (!Number.isInteger(body.method) || body.method < 0)
        throw Error("Choose a connection method");
      const methods = await host.request("/provider/auth");
      const method = methods[id]?.[body.method];
      if (method?.type !== "oauth")
        throw Error("Choose a valid connection method");
      const call = () =>
        host.request(`/provider/${part(id)}/oauth/${action}`, {
          method: "POST",
          body:
            action === "authorize"
              ? { method: body.method, inputs: authInputs(method, body.inputs) }
              : { method: body.method, code: body.code },
          signal: AbortSignal.timeout(300000),
        });
      return action === "callback" ? changeCredentials(call) : call();
    },
    async saveWorkflow(value) {
      const id = value.id ?? randomUUID();
      let workflow;
      await store.update("settings", (s) => {
        const catalog = workspaceCatalog(s);
        if (value.id && !catalog.workflows.some((w) => w.id === id))
          throw Error("Workflow no longer exists");
        workflow = normalizeWorkflow(value, id, catalog.agents);
        return {
          ...s,
          revision: s.revision + 1,
          workflows: [...s.workflows.filter((w) => w.id !== id), workflow],
        };
      });
      return workflow;
    },
    async removeWorkflow(id) {
      if (workflowDefaults.some((w) => w.id === id))
        throw Error("Default workflows cannot be removed");
      await store.update("settings", (s) => ({
        ...s,
        revision: s.revision + 1,
        workflows: s.workflows.filter((w) => w.id !== id),
        chatChoices: Object.fromEntries(
          Object.entries(s.chatChoices ?? {}).map(([session, choice]) => [
            session,
            choice.workflowID === id
              ? { ...choice, workflowID: "build" }
              : choice,
          ]),
        ),
      }));
      return { saved: true };
    },
    async saveAgent(value) {
      const id = value.id ?? randomUUID();
      const agent = normalizeAgent(value, id);
      await store.update("settings", (s) => {
        if (value.id && !workspaceCatalog(s).agents.some((a) => a.id === id))
          throw Error("Agent no longer exists");
        return {
          ...s,
          revision: s.revision + 1,
          agents: [...(s.agents ?? []).filter((a) => a.id !== id), agent],
        };
      });
      return agent;
    },
    async removeAgent(id) {
      if (agentDefaults.some((a) => a.id === id))
        throw Error("Default agents cannot be removed");
      await store.update("settings", (s) => {
        return {
          ...s,
          revision: s.revision + 1,
          agents: (s.agents ?? []).filter((a) => a.id !== id),
          workflows: s.workflows.map((w) =>
            w.agentID === id ? { ...w, agentID: "engineer" } : w,
          ),
          chatChoices: Object.fromEntries(
            Object.entries(s.chatChoices ?? {}).map(([session, choice]) => [
              session,
              choice.agentID === id ? { ...choice, agentID: "inherit" } : choice,
            ]),
          ),
        };
      });
      return { saved: true };
    },
    async events(id, signal) {
      return host.events((await project(id)).directory, signal);
    },
  };
  app.history = createHistoryService({ app, host, backendRoot, dataRoot });
  app.chatgpt = createChatGPTImport({ app, backendRoot, dataRoot, ...importOptions });
  app.indexJobs = createIndexJobs({ app, backendRoot, dataRoot });
  return app;
}
