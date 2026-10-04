import { readRuntimeText } from '../backend/tools/runtime/state-database.mjs';
import { delegationPool, delegationGuidance, effectiveDelegationPreferences, capturedDelegationPool } from "../domain/delegation-policy.mjs";
import { reserveWorkerSlot, releaseWorkerSession } from '../backend/tools/runtime/worker-dispatch-lock.mjs';
import { workerResultInstruction } from '../backend/tools/runtime/worker-result.mjs';
import { checkedCatalog } from "../backend/tools/runtime/agent-catalog.mjs";
import { normalizeFileAccessScope } from "../domain/workspace.mjs";
import { resolveFileAccessScope } from "../backend/tools/runtime/tool-operations.mjs";
import { executionContext } from "../backend/tools/runtime/execution-context.mjs";
import { modelInputEvidence } from '../backend/tools/runtime/input-observations.mjs';
import { ensureAgentProfiles } from "./agent-profiles.mjs";
import { createHistoryService } from "./history.mjs";
import { createKnowledgeQuery } from './data/knowledge-query.mjs';
import { createModelRatingService } from "./model-ratings.mjs";
import { createModelDataService } from "./model-data.mjs";
import { createEvidenceEvaluationService } from './evidence-evaluation.mjs';
import { rebuildContentIndex } from "./content-index.mjs";
import { createIndexJobs } from './index-jobs.mjs';
import { createImportedHistory, importedChatID } from './imported-history.mjs';
import { listProjectFolders } from './project-folders.mjs';
import { createMcpConnections } from './mcp.mjs';
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
import { nativeWorkerActivity } from "./worker-activity.mjs";
import {
  providerCatalog,
  usageRecord,
  summarizeCosts,
} from "../domain/costs.mjs";
import { createStore } from "./store.mjs";
import { createLocalDataService, isLocalDataUnavailable } from "./data/store.mjs";
import { createTypeSafeJudgmentProvider } from './data/judgment-provider.mjs';
import { normalizeAttachments } from "../domain/attachments.mjs";
import { publicCatalog } from "./catalog.mjs";
import { sessionSummary } from "../shared/view.mjs";
import { randomUUID } from "node:crypto";
import { authInputs, connectionMethods } from "../domain/auth.mjs";
import {
  workspaceCatalog,
  workspaceModels,
  normalizeAgent,
  modelAllowed,
  resolveChoices,
  resolvedVariant,
  modelVariant,
  normalizeVariant,
  agentDefaults,
} from "../domain/workspace.mjs";
import { executionPrompt, policyVersion } from "./execution.mjs";
import { createGitProjects } from "./git-project.mjs";
import { createContextSettings } from './context-settings.mjs';
import { createCapabilities } from './capabilities.mjs';
import { updateOpenCodeProjectModel } from './opencode-project-config.mjs';
import { gitExecutionContract } from "../domain/git-project.mjs";
import { senderState } from "../domain/sender.mjs";

import { defaults as runtimeDefaults, normalizePreferences } from "../shared/strategy.mjs";
import {
  sessionDefaults,
  startingChoices,
  normalizeSessionDefaults,
} from "../domain/session-defaults.mjs";

import { validatePanelWidths } from "../domain/panel-widths.mjs";
import { visibleTodosForRequest } from "../domain/todos.mjs";

import { isTheme } from "../domain/theme.mjs";
import { validateNewTheme } from '../domain/custom-themes.mjs';
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
  modelDataOptions = {},
  automaticWorkAllowed = true,
}) {
  const localData = createLocalDataService(dataRoot ?? path.join(backendRoot, ".state", "local-data"));
  const gitProjects = createGitProjects({ store, project, host, backendRoot, ...gitOptions });
  let connecting = false;
  let sending = 0;
  let refreshingAgents = false;
  let refreshingContext = false;
  let refreshingUsage;
  let providerFlight;
  let providerSnapshot;
  let automaticWork = automaticWorkAllowed === true;
  const sessionDefaultWrites = new Map();
  async function changeCredentials(change, checkDecisions = false) {
    if (connecting || sending || refreshingContext || refreshingAgents)
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
      if (checkDecisions) for (const directory of directories) {
        const [questions, permissions] = await Promise.all([
          host.request('/question', { directory }), host.request('/permission', { directory }),
        ]);
        if (!Array.isArray(questions) || !Array.isArray(permissions) || questions.length || permissions.length)
          throw Object.assign(Error('Finish pending native decisions before changing connections.'), { status: 409 });
      }
      const result = await change();
      // OpenCode caches provider clients per instance. Its native lifecycle
      // endpoint refreshes those clients; never dispose instances during work.
      await host.request("/global/dispose", { method: "POST" });
      return result;
    } finally {
      providerSnapshot = undefined;
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
  async function ownSession(p, id, options = {}) {
    if (importedChatID(id)) throw Error('Saved imported snapshots are read-only.');
    const value = await request(p, `/session/${part(sessionID(id))}`, options);
    if (!value.directory || !sameDirectory(value.directory, p.directory))
      throw Error("This chat belongs to another project");
    return value;
  }
  async function messages(p, id, knownSession) {
    const session = knownSession ?? await ownSession(p, id);
    const rows = await request(p, `/session/${part(sessionID(id))}/message`);
    await store.observe(
      rows.map((m) => usageRecord(m, p.directory, session.parentID)),
      { session, messages: rows },
    );
    return rows;
  }
  async function providers({ display = false } = {}) {
    // Streaming chat summaries only need catalog metadata. Bootstrap and every
    // execution/connection path still ask native OpenCode for current inventory.
    if (display && providerSnapshot && performance.now() - providerSnapshot.at < 30_000)
      return providerSnapshot.value;
    providerFlight ??= host.request("/provider")
      .then(native => {
        if (!native || !Array.isArray(native.all) || !Array.isArray(native.connected))
          throw Error('OpenCode provider inventory is unavailable. Stored model data was preserved.');
        const catalog = publicCatalog(native);
        // Extract asserted IDs before presentation sanitization discards native
        // request metadata. Only identity fields reach the private matcher.
        modelData.setNativeModels(workspaceModels(catalog.all.flatMap(provider => {
          const upstream = native.all?.find(row => row.id === provider.id);
          return Object.keys(provider.models).map(modelID => {
            const model = upstream?.models?.[modelID];
            return { id: `${provider.id}/${modelID}`, provider: provider.id, modelID,
              costClass: provider.id === 'opencode' ? 'free' : 'unknown',
              api: typeof model?.api?.id === 'string' ? { id: model.api.id } : undefined,
              sourceIdentities: model?.sourceIdentities, sourceAliases: model?.sourceAliases };
          });
        }), catalog.connected));
        return catalog;
      })
      .then(value => { providerSnapshot = { value, at: performance.now() }; return value; })
      .finally(() => { providerFlight = undefined; });
    return providerFlight;
  }
  function costClass(providerID, plans) {
    const configured = plans.providers[providerID]?.mode;
    const known = providerCatalog.find(provider => provider.id === providerID);
    const mode = configured ?? known?.mode ?? 'unknown';
    return mode === 'api' ? 'metered' : mode;
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
      { ...settings.sessionDefaults?.[p.id], parentModel: undefined },
      workspaceCatalog(settings),
      {
        parentModel: native.default ||
          (base?.parentModel && base.parentModel !== "auto" ? base.parentModel : ""),
        reasoningVariant: base?.reasoningVariant ?? "",
      },
    );
  }
  const contentIndexRefresh = new Map();
  const modelRatings = createModelRatingService({ host, backendRoot, dataRoot, localData, project, store,
    canRun: () => automaticWork,
    getCatalog: async (id) => app.bootstrap(id) });
  const modelData = createModelDataService({ localData, canRun: () => automaticWork, ...modelDataOptions });
  const app = {
    automaticWorkAllowed: () => automaticWork,
    setAutomaticWorkAllowed(allowed) {
      if (typeof allowed !== 'boolean') throw Error('Automatic work authorization must be explicit.');
      automaticWork = allowed;
      if (!allowed) modelRatings.suspendAutomaticWork();
    },
    async capabilities(projectID, options = {}) {
      const p = projectID ? await project(projectID) : null;
      let inspectionOnly = null;
      let observedAgent, observedModel;
      let instructionContext = {};
      if (options.sessionID) {
        if (!p) throw Error('Choose the project for this chat.');
        const nativeSession = await ownSession(p, options.sessionID);
        const rows = await request(p, `/session/${part(nativeSession.id)}/message`);
        const message = rows.findLast(row => row.info?.role === 'assistant');
        const execution = await executionContext(backendRoot, p.directory, nativeSession, message, rows);
        inspectionOnly = execution ? execution.readOnly : null;
        observedAgent = execution?.agent?.id ?? message?.info?.agent;
        const nativeModel = rows.findLast(row => row.info?.role === 'user' && row.info?.model)?.info.model;
        observedModel = message?.info?.providerID && message?.info?.modelID
          ? `${message.info.providerID}/${message.info.modelID}`
          : nativeModel?.providerID && nativeModel?.modelID ? `${nativeModel.providerID}/${nativeModel.modelID}` : null;
        instructionContext = { requestID: execution?.id, policyVersion: execution?.policyVersion,
          agentName: execution?.agent?.name, worker: !!nativeSession.parentID,
          loadedSkills: [...new Set(rows.flatMap(row => row.parts ?? []).filter(part => part.type === 'tool' && part.tool === 'skill'
            && part.state?.status === 'completed').map(part => part.state?.input?.name).filter(name => typeof name === 'string'))] };
      }
      const settings = await store.read('settings');
      const catalog = checkedCatalog(settings);
      const agent = options.agent ?? observedAgent ?? (p ? 'engineer' : null);
      if (agent !== null && !catalog.agents.some(row => row.id === agent)) throw Error('Choose a named agent');
      return createCapabilities({ host, backendRoot }).read({ directory: p?.directory ?? backendRoot, projectID: p?.id ?? null,
        sessionID: options.sessionID ?? null, agent, model: options.model ?? observedModel ?? null,
        boundaries: { inspectionOnly, gitInspectOnly: p ? settings.gitProjects?.[p.id]?.tracking === true && settings.gitProjects?.[p.id]?.preset === 'inspect' : null,
          fileAccessScope: resolveFileAccessScope(settings) },
        instructionContext });
    },
    mcp: createMcpConnections({ host, backendRoot, changeConnections: change => changeCredentials(change, true) }),
    contextSettings: createContextSettings({ store, host, project,
      canRefresh: () => !connecting && !sending && !refreshingAgents && !refreshingContext,
      setRefreshing: value => { refreshingContext = value; } }),
    store,
    project,
    gitProjects,
    judgmentProvider: createTypeSafeJudgmentProvider(),
    modelRatings,
    modelData,
    async refreshModelData(input) {
      await providers();
      return modelData.refresh(input);
    },
    async evidenceEvaluationAgentAction(input, { signal } = {}) {
      signal?.throwIfAborted();
      if (typeof input.directory !== 'string' || !input.directory.trim()) throw Error('A native project context is required.');
      const settings = await store.read('settings');
      const p = settings.projects.find(item => sameDirectory(item.directory, input.directory));
      if (!p) throw Error('Open this project in Freelancer first.');
      const session = await ownSession(p, input.actorSessionID, { signal });
      if (session.id !== input.actorSessionID) throw Error('Native conversation identity does not match the caller.');
      if (typeof input.messageID !== 'string' || !/^msg_[\w-]+$/.test(input.messageID)) throw Error('A native assistant message is required.');
      const message = await request(p, '/session/' + part(session.id) + '/message/' + part(input.messageID), { signal });
      if (message?.info?.role !== 'assistant' || message.info.id !== input.messageID || message.info.sessionID !== session.id)
        throw Error('A native assistant context in this conversation is required.');
      signal?.throwIfAborted();
      const owner = { projectID: p.id, sessionID: session.id };
      const service = app.evidenceEvaluation;
      if (input.operation === 'describe') return service.describe();
      if (input.operation === 'inspect') return service.inspect(input.receiptID, { owner });
      if (input.operation === 'prepare') return service.prepare(input.contract, { owner, signal });
      if (input.operation === 'evaluate') {
        if (input.contract !== undefined && input.receiptID !== undefined) throw Error('Choose a contract or an existing receipt.');
        const prepared = input.contract === undefined
          ? await service.inspect(input.receiptID, { owner })
          : await service.prepare(input.contract, { owner, signal });
        if (prepared.requiresInference) {
          const receipt = await executionContext(backendRoot, p.directory, session, message,
            () => request(p, '/session/' + part(session.id) + '/message', { signal }));
          if (receipt?.readOnly) throw Error('This assignment is inspection-only.');
        }
        signal?.throwIfAborted();
        return service.evaluate({ receiptID: prepared.receiptID,
          ...(input.composition === undefined ? {} : { composition: input.composition }) }, { owner, signal });
      }
      throw Error('Unknown evidence operation.');
    },
    async modelDataAgentAction(input) {
      const settings = await store.read('settings');
      const p = settings.projects.find(item => sameDirectory(item.directory, input.directory));
      if (!p) throw Error('Open this project in Freelancer first.');
      const session = await ownSession(p, input.sessionID);
      const message = await request(p, '/session/' + part(session.id) + '/message/' + part(input.messageID));
      if (message?.info?.role !== 'assistant' || message.info.id !== input.messageID || message.info.sessionID !== session.id)
        throw Error('A native assistant context in this conversation is required.');
      if (['schema', 'list', 'search', 'detail', 'status'].includes(input.operation)) return modelData.agentAction(input);
      if (input.operation === 'refresh') {
        const receipt = await executionContext(backendRoot, p.directory, session, message,
          () => request(p, '/session/' + part(session.id) + '/message'));
        if (receipt?.readOnly) throw Error('This assignment is inspection-only.');
        await app.refreshModelData(input);
        return modelData.agentAction({ operation: 'status' });
      }
      throw Error('Unknown model catalog operation.');
    },
    listProjectFolders,
    async rebuildContentIndex({ projectID, includeArchivedProject = false, onProgress = () => {}, signal } = {}) {
      if (app.indexJobs?.isArchiving() && !includeArchivedProject)
        throw Object.assign(Error('A project is being put away. General index refresh is paused.'), { status: 409 });
      const key = projectID ?? '*';
      if (contentIndexRefresh.has(key)) return contentIndexRefresh.get(key);
      const refresh = (async () => {
        const registered = (await store.read("settings")).projects;
        const projects = app.history?.projectsToIndex
          ? app.history.projectsToIndex(registered, projectID, includeArchivedProject)
          : projectID ? [await project(projectID)] : registered;
        if (app.indexJobs?.isArchiving() && !includeArchivedProject)
          throw Object.assign(Error('A project is being put away. General index refresh is paused.'), { status: 409 });
        const summary = { projects: 0, sources: 0, units: 0, skippedFiles: 0, failedProjects: 0, failureDiagnosticsOmitted: 0, failures: [] };
        let failureDiagnosticCount = 0;
        for (const item of projects) {
          signal?.throwIfAborted();
          if (!includeArchivedProject && app.history?.isProjectArchived && await app.history.isProjectArchived(item.id)) continue;
          onProgress(`Indexing files · ${item.name} (${summary.projects + 1}/${projects.length})`);
          try {
            const result = await rebuildContentIndex({ project: await project(item.id), backendRoot, dataRoot, signal, onProgress });
            summary.projects++;
            summary.sources += result.physical_sources_indexed ?? 0;
            summary.units += result.units ?? 0;
            summary.skippedFiles += result.extraction_skipped_files ?? result.extraction_failures?.length ?? 0;
            failureDiagnosticCount += result.extraction_failure_count ?? result.extraction_failures?.length ?? 0;
            for (const failure of result.extraction_failures ?? [])
              if (summary.failures.length < 128) summary.failures.push({ project: item.name, source: failure.source, error: failure.error });
          } catch (error) {
            summary.failedProjects++;
            failureDiagnosticCount++;
            summary.failures.unshift({ project: item.name, error: error.message });
            summary.failures.length = Math.min(summary.failures.length, 128);
          }
        }
        summary.failureDiagnosticsOmitted = Math.max(0, failureDiagnosticCount - summary.failures.length);
        return summary;
      })().finally(() => { contentIndexRefresh.delete(key); });
      contentIndexRefresh.set(key, refresh);
      return refresh;
    },
    async goalActor(input) {
      const settings = await store.read('settings');
      const p = settings.projects.find(p => sameDirectory(p.directory, input.directory));
      if (!p) throw Error('Unknown project.');
      const session = await ownSession(p, input.sessionID);
      const message = await request(p, `/session/${part(session.id)}/message/${part(input.messageID)}`);
      const receipt = await executionContext(backendRoot, p.directory, session, message,
        () => request(p, '/session/' + part(session.id) + '/message'));
      if (!receipt?.goalID || session.parentID || receipt.sessionID !== session.id) throw Error('Only the recorded goal parent may report its outcome.');
      return { receipt, message, project: p.id };
    },
    async workerHandoff(input) {
      if (!['steer', 'queue'].includes(input.delivery) || !input.task?.trim() || input.task.length > 180000) throw Error('Choose a worker, Steer or Queue, and a bounded task.');
      const settings = await store.read('settings');
      const p = settings.projects.find(p => sameDirectory(p.directory, input.directory));
      if (!p) throw Error('Unknown project.');
      const parent = await ownSession(p, input.sessionID), child = await ownSession(p, input.worker);
      const message = await request(p, `/session/${part(parent.id)}/message/${part(input.messageID)}`);
      const parentExecution = await executionContext(backendRoot, p.directory, parent, message,
        () => request(p, '/session/' + part(parent.id) + '/message'));
      if (!parentExecution || child.parentID !== parent.id) throw Error('This worker does not belong to the recorded parent assignment.');
      const latest = JSON.parse(await readRuntimeText(path.join(backendRoot, '.state/delegation/workers', createHash('sha256').update(child.id).digest('hex') + '.json'), 'utf8'));
      if (!/^[a-f0-9]{64}$/.test(latest.taskID)) throw Error('Invalid worker record.');
      const prior = JSON.parse(await readRuntimeText(path.join(backendRoot, '.state/delegation', latest.taskID + '.json'), 'utf8'));
      const attempt = prior.attempts?.at(-1);
      if (prior.parent_session !== parent.id || !sameDirectory(prior.directory, p.directory) || attempt?.child_session !== child.id || prior.status === 'stop_unverified' || prior.status === 'failed' && !attempt.abort_verified) throw Error('Worker ownership or delivery is uncertain. Inspect it before sending.');
      const root = (await store.read('requests')).records[prior.root_request_id];
      if (!root || root.sessionID !== prior.root_session || root.projectID !== p.id) throw Error('The captured worker assignment is unavailable.');
      const current = (await loadPreferences(backendRoot, p.directory, parent.id)).defaults;
      const preferences = effectiveDelegationPreferences(current, effectiveDelegationPreferences(parentExecution.preferences, root.preferences));
      if (preferences.delegation === 'manual' || !capturedDelegationPool(parentExecution, current, preferences).includes(attempt.selected_model) || !capturedDelegationPool(root, current, preferences).includes(attempt.selected_model)) throw Error('Worker delivery is outside the captured delegation budget.');
      const messages = await request(p, `/session/${part(child.id)}/message`);
      const user = messages.find(m => m.info?.id === attempt.user_message_id);
      if (!user) throw Error('Worker input has not been confirmed. Inspect it before sending.');
      const split = attempt.selected_model.indexOf('/');
      const captured = { ...root, id: attempt.user_message_id, sessionID: child.id, rootSessionID: prior.root_session, rootRequestID: prior.root_request_id,
        agent: prior.agent, readOnly: prior.read_only || parentExecution.readOnly || input.inspectionOnly === true,
        catalog: { ...root.catalog, agents: root.catalog.agents.map(a => a.id === prior.agent.id ? prior.agent : a) },
        preferences: { ...preferences, ...((prior.free_only || input.freeOnly) ? { costPreference: 'free-only' } : {}) },
        model: { providerID: attempt.selected_model.slice(0, split), modelID: attempt.selected_model.slice(split + 1) }, variant: user.info.variant ?? attempt.variant ?? '',
        delegationPool: (root.delegationPool ?? []).filter(id => (parentExecution.delegationPool ?? []).includes(id)),
      };
      const id = createHash('sha256').update(JSON.stringify([input.sessionID, input.messageID, input.callID, input.worker, input.delivery, input.task])).digest('hex');
      return { project: p.id, session: child.id, input: { id, text: input.task, kind: input.delivery, model: attempt.selected_model, agentID: prior.agent.id, variant: captured.variant },
        execution: { captured, worker: { parent: parent.id, root: prior.root_session, taskID: prior.task_id },
          ...(root.goalID ? { goal: { id: root.goalID, runID: root.goalRunID, revision: root.goalRevision } } : {}),
          contract: workerResultInstruction + '\nThis is a follow-up from your parent in the same assignment. Preserve its plan and partial results. ' + (captured.readOnly ? 'READ-ONLY: do not edit source or use mutating shell commands.' : '') } };
    },
    async workerDeliveryGuard(id, session, execution) {
      const p = await project(id), native = await ownSession(p, session);
      if (native.parentID !== execution.worker.parent) throw Error('Worker ownership changed. Nothing was sent.');
      const captured = execution.captured;
      if (captured.goalID) {
        const goal = (await store.read('goals')).records[captured.goalID];
        if (!goal || goal.status !== 'running' || goal.stopRequested || goal.archived || goal.runID !== captured.goalRunID) throw Error('The owning goal is not running. Resume it before delivering worker work.');
      }
      const current = (await loadPreferences(backendRoot, p.directory, execution.worker.parent)).defaults;
      const effective = effectiveDelegationPreferences(current, captured.preferences);
      const model = `${captured.model.providerID}/${captured.model.modelID}`;
      if (effective.delegation === 'manual' || !capturedDelegationPool(captured, current, effective, captured.variant).includes(model)) throw Error('Worker delivery is outside the current and captured budget.');
      const tree = await app.goalTree(id, execution.worker.root);
      if (!tree.some(s => s.id === session)) throw Error('Worker ancestry changed.');
      if (!tree.find(s => s.id === session).active && tree.filter(s => s.id !== execution.worker.root && s.active).length >= effective.maxParallel) return false;
      return effective.maxParallel;
    },
    async goalTree(id, session) {
      const p = await project(id); await ownSession(p, session);
      const [all, status] = await Promise.all([request(p, '/session?limit=1000'), request(p, '/session/status')]);
      const ids = new Set([session]);
      for (let i = 0; i < 32; i++) {
        const before = ids.size;
        for (const s of all) if (ids.has(s.parentID) && sameDirectory(s.directory, p.directory)) ids.add(s.id);
        if (before === ids.size) break;
      }
      return [...ids].map(id => ({ id, active: ['busy', 'retry'].includes(status[id]?.type) }));
    },
    async gitAgentAction(input) {
      const settings = await store.read("settings");
      const p = settings.projects.find((p) => sameDirectory(p.directory, input.directory));
      if (!p) throw Error("Open this project in Freelancer first.");
      const session = await ownSession(p, input.sessionID);
      const message = await request(p, `/session/${part(session.id)}/message/${part(input.messageID)}`);
      if (message?.info?.role !== "assistant") throw Error("A native assistant context is required.");
      const receipt = await executionContext(backendRoot, p.directory, session, message,
        () => request(p, '/session/' + part(session.id) + '/message'));
      if (input.action === "inspect") return gitProjects.inspect(p.id);
      if (receipt?.projectID !== p.id || receipt?.sessionID !== session.id)
        throw Error("Managed Git actions require a current Freelancer execution context for this project.");
      const actor = { sessionID: session.id, messageID: input.messageID, delegated: !!session.parentID, origin: "agent" };
      if (receipt.readOnly && input.action !== "inspect") throw Error("This assignment is inspection-only.");
      if (input.action === "prepare") {
        await gitProjects.prepareTask(p.id, session.id);
        gitProjects.finishDispatch(p.id, session.id, message.info.parentID);
        return { result: "The agreed working branch is ready. No files were checkpointed or uploaded." };
      }
      if (input.action === "preview") return gitProjects.preview(p.id, input, actor);
      if (input.action === "request") return input.planID
        ? gitProjects.requestExecute(p.id, { planID: input.planID, confirm: true, readMessages: () => messages(p, session.id) }, actor)
        : gitProjects.requestPreview(p.id, { ...input, readMessages: () => messages(p, session.id) }, actor);
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
        costClass: costClass(row.provider, settings.plans),
      }));
      let ratings = {}, localDataError;
      try { ratings = modelRatings.catalog(workspaceModels(catalogRows, catalog.connected)); }
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
          nativeProviders: catalog.all,
        }),
      };
    },
    async addProject(directory, { signal } = {}) {
      signal?.throwIfAborted();
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
      const marker = path.join(config, "freelancer.json");
      try {
        const previous = JSON.parse(await readFile(marker, "utf8"));
        if (previous.owner !== "freelancer-webpage")
          throw Error("A different Freelancer configuration already exists.");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      // Native configuration directories initialize independently. Observe
      // this project's plugin registry before authoring setup or acknowledging
      // success; global HTTP health does not establish project readiness.
      await host.ensureReady?.({ directory, signal, timeoutMs: 55_000 });
      signal?.throwIfAborted();
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
      // Cancellation while reading/warming must not later create a registered
      // project. Once authored writes begin, complete the idempotent setup.
      signal?.throwIfAborted();
      await mkdir(config, { recursive: true });
      if (snapshot.preferences.scope === "default")
        await backend.save({
          scope: "project",
          // Persist Freelancer's execution policy without shadowing the native
          // OpenCode model or reasoning defaults.
          preferences: { ...snapshot.preferences.preferences, parentModel: "auto", reasoningVariant: "" },
          revision: snapshot.preferences.revision,
        });
      // The app-local OpenCode resources supply the shared plugins, skills,
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
    async chat(id, session, { onTiming } = {}) {
      const timed = async (name, read) => {
        const start = performance.now();
        try { return await read(); }
        finally { onTiming?.(name, performance.now() - start); }
      };
      const p = await project(id);
      if (importedChatID(session)) {
        const imported = app.importedHistory.get(id, session);
        if (!imported) throw Error('This imported chat belongs to another project or is unavailable.');
        return { title: imported.title, messages: imported.messages, imported: imported.source,
          receipts: [], status: {}, permissions: [], questions: [], activity: [], summary: sessionSummary(), todos: [], diff: [] };
      }
      const nativeSession = await timed('session', () => ownSession(p, session));
      const reads = await Promise.allSettled([
        timed('transcript', () => messages(p, session, nativeSession)),
        timed('status', () => request(p, "/session/status")),
        timed('permissions', () => request(p, "/permission")),
        timed('questions', () => request(p, "/question")),
        timed('local', () => backendFactory(backendRoot, p.directory).snapshot(session, { chatOnly: true })),
        timed('providers', () => providers({ display: true })),
        timed('todos', () => request(p, `/session/${part(session)}/todo`)),
        timed('diff', () => request(p, `/session/${part(session)}/diff`)),
        timed('files', () => gitProjects.changedFiles(id)).then(files => ({ files }), () => ({ files: [], unavailable: true })),
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
      const messageByID = new Map(rows.map(row => [row.info.id, row]));
      const outcomes = new Map();
      for (const entry of snapshot.history?.entries ?? []) {
        const key = JSON.stringify([entry.task_id, entry.model]);
        if (entry.observation_kind !== 'operational' && !outcomes.has(key)) outcomes.set(key, entry);
      }
      let activity = reconcileActivity(
        rows.flatMap((m) => m.parts ?? []),
        snapshot.receipts,
      ).map((row) => {
        row = {
          ...row,
          requestID: row.raw?.parent_message_id ?? messageByID.get(row.raw?.user_task_id?.split("/").at(-1))?.info.parentID,
        };
        const outcome = outcomes.get(JSON.stringify([row.id, row.observed]));
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
      if (reads[1].status === 'fulfilled' && reads[1].value === status) {
        activity = await Promise.all(activity.map(async row => {
          if (!row.child || !['running', 'stop_unverified'].includes(row.status)) return row;
          try {
            const child = await ownSession(p, row.child);
            if (child.parentID !== session) return row;
            const native = status[row.child];
            const transcript = native && native.type !== 'idle' ? [] : await request(p, `/session/${part(row.child)}/message`);
            if (!Array.isArray(transcript)) return row;
            return nativeWorkerActivity(row, child, transcript, session, native);
          } catch { return row; }
        }));
      }
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
      const importedSource = app.importedHistory.source(id, session);
      const workerInputs = new Map();
      if (app.sender) {
        for (const child of new Set(rows.flatMap(m => m.parts ?? []).filter(p => p.state?.metadata?.freelancer_delivery).map(p => p.state.metadata.sessionId))) {
          for (const delivery of await app.sender.records(id, child)) workerInputs.set(delivery.id, delivery);
        }
      }
      let requestRows = [];
      try { requestRows = await timed('receipts', () => store.requestSummaries ? store.requestSummaries(id, session)
        : store.read("requests").then(value => Object.values(value.records))); }
      catch (error) { availabilityWarnings.push(`Request receipts: ${error.message}`); }
      return {
        title: nativeSession.title || "New chat",
        nativeStatus: status,
        inputEvidence: await modelInputEvidence(backendRoot, session, rows),
        // Workers and older chats may be absent from the bounded sidebar list.
        // Keep navigation identity with the verified transcript, including cache reads.
        session: { id: nativeSession.id, title: nativeSession.title || "New chat",
          parentID: nativeSession.parentID, time: nativeSession.time },
        messages: [...(importedSource?.messages ?? []), ...rows.map(row => ({ ...row,
          parts: row.parts?.filter(part => !part.metadata?.freelancer_chatgpt_orientation).map(part => {
            const delivery = workerInputs.get(part.state?.metadata?.freelancer_delivery);
            return delivery ? { ...part, state: { ...part.state, metadata: { ...part.state.metadata, delivery_status: delivery.status, delivery_included: !!delivery.includedAt } } } : part;
          }) }))],
        continuation: importedSource?.source ?? null,
        receipts: requestRows
          .filter((r) => r.sessionID === session && r.projectID === id)
          .map(({ agent, workflow: _legacyWorkflow, catalog: _catalog, catalogModels: _models, catalogConnected: _connected, ...r }) => ({
            ...r,
            agent: agent ? { id: agent.id, name: agent.name } : null,
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
        const imported = app.importedHistory.get(id, session);
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
        session: { id: nativeSession.id, title: nativeSession.title || "New chat",
          parentID: nativeSession.parentID, time: nativeSession.time },
        messages: rows.map(row => ({ ...row,
          parts: row.parts?.filter(part => !part.metadata?.freelancer_chatgpt_orientation) })),
        continuation: null,
        receipts: [], status: {}, permissions: [], questions: [], activity: [],
        summary: sessionSummary(rows.map(row => row.info), [], []), todos: [], diff: [],
        availabilityWarnings: [`Chat details unavailable: ${reason}`],
      };
    },
    async chatPreview(id, session) {
      const p = await project(id);
      if (importedChatID(session)) {
        const imported = app.importedHistory.get(id, session);
        if (!imported) throw Error('This imported chat belongs to another project or is unavailable.');
        return { title: imported.title, session: { id: session, title: imported.title }, messages: imported.messages,
          receipts: [], status: {}, permissions: [], questions: [], activity: [], summary: sessionSummary(), todos: [], diff: [], preview: true };
      }
      const nativeSession = await ownSession(p, session);
      const rows = await request(p, `/session/${part(session)}/message`);
      if (!Array.isArray(rows)) throw Error('OpenCode returned no chat transcript.');
      return {
        title: nativeSession.title || "New chat",
        session: { id: nativeSession.id, title: nativeSession.title || "New chat", parentID: nativeSession.parentID, time: nativeSession.time },
        messages: rows.map(row => ({ ...row, parts: row.parts?.filter(part => !part.metadata?.freelancer_chatgpt_orientation) })),
        continuation: null, receipts: [], status: {}, permissions: [], questions: [], activity: [],
        summary: sessionSummary(rows.map(row => row.info), [], []), todos: [], diff: [], preview: true,
      };
    },
    async saveSessionDefaults(id, input) {
      const p = await project(id);
      const previousWrite = sessionDefaultWrites.get(id) ?? Promise.resolve();
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const queuedWrite = previousWrite.catch(() => {}).then(() => gate);
      sessionDefaultWrites.set(id, queuedWrite);
      await previousWrite.catch(() => {});
      let nativeSave;
      try {
        const catalog = await providers();
        const settings = await store.read("settings");
        const previous = settings.sessionDefaults?.[id];
        if (input.revision !== (previous?.revision ?? 0))
          throw Error("Defaults changed elsewhere. Reload before saving.");
        const workspace = workspaceCatalog(settings);
        const value = normalizeSessionDefaults(input, workspace);
        const modelChoice = startingChoices(value, workspace).model;
        let nativeParentModel;
        if (value.parentModel && modelChoice !== "inherit") {
          const slash = value.parentModel.indexOf("/");
          const providerID = value.parentModel.slice(0, slash),
            modelID = value.parentModel.slice(slash + 1);
          const model = catalog.all.find((provider) => provider.id === providerID)?.models[modelID];
          if (!model || (providerID !== "opencode" && !catalog.connected.includes(providerID)))
            throw Error("Choose an available parent model");
          if (value.reasoningVariant && !model.variants.includes(value.reasoningVariant))
            throw Error("Choose an intelligence level reported by this model");
          // Save supported native config files; some OpenCode builds write an
          // unread config.json when PATCH /config is used.
          await changeCredentials(async () => {
            nativeSave = await updateOpenCodeProjectModel(p.directory, value.parentModel);
            await request(p, '/instance/dispose', { method: 'POST' });
            const confirmed = await request(p, '/config');
            if (confirmed?.model !== value.parentModel)
              throw Error('OpenCode did not confirm the project model default.');
            nativeParentModel = confirmed.model;
          }, true);
        } else {
          nativeParentModel = (await request(p, '/config')).model || '';
        }
        const result = await store.update("settings", current => {
          const currentRevision = current.sessionDefaults?.[id]?.revision ?? 0;
          if (currentRevision !== input.revision)
            throw Error("Defaults changed elsewhere. Reload before saving.");
          return {
            ...current,
            revision: current.revision + 1,
            sessionDefaults: {
              ...current.sessionDefaults,
              [id]: { agentID: value.agentID, reasoningVariant: value.reasoningVariant,
                revision: currentRevision + 1 },
            },
          };
        });
        return { ...result.sessionDefaults[id], parentModel: nativeParentModel };
      } catch (error) {
        if (nativeSave) {
          try {
            await nativeSave.rollback();
            await request(p, '/instance/dispose', { method: 'POST' });
          } catch (rollbackError) {
            throw Error(`The model setting could not be saved, and its OpenCode project config could not be restored: ${rollbackError.message}`);
          }
        }
        throw error;
      } finally {
        release();
        if (sessionDefaultWrites.get(id) === queuedWrite) sessionDefaultWrites.delete(id);
      }
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
        agentID = "engineer",
        attachments,
      },
      execution = {},
    ) {
      if (connecting || refreshingAgents || refreshingContext)
        throw Error(
          "Finish refreshing the connection, context settings or agent catalog before sending a message.",
        );
      sending++;
      let gitAcceptedMessage;
      let workerSlot, workerSubmitted = false;
      try {
        if (execution.worker) {
          const limit = await app.workerDeliveryGuard(id, session, execution);
          const p = await project(id);
          workerSlot = limit && await reserveWorkerSlot(backendRoot, execution.worker.root, { limit, sessionID: session,
            active: async () => new Set((await app.goalTree(id, execution.worker.root)).filter(t => t.id !== execution.worker.root && t.active).map(t => t.id)),
            settled: async r => {
              if (!r.messageID) return false;
              const messages = await request(p, `/session/${part(r.childID)}/message`);
              return messages.some(m => m.info?.parentID === r.messageID && m.info.time?.completed && (m.info.error || m.info.finish && m.info.finish !== 'tool-calls'));
            },
          });
          if (!workerSlot) throw Object.assign(Error('Waiting for a free worker slot. No inference was sent.'), { code: 'WORKER_CAPACITY' });
        }
        const fileParts = normalizeAttachments(attachments);
        if (typeof text !== "string" || (!text.trim() && !fileParts.length) || text.length > 200000)
          throw Error("Write a message or attach a file first");
        const settings = await store.read("settings");
        const workspace = execution.captured?.catalog ?? checkedCatalog(settings);
        const p = await project(id);
        await ensureAgentProfiles(host, p.directory, workspace.agents, () => sending === 1 && !connecting,
          refreshing => { refreshingAgents = refreshing; });
        const backend = backendFactory(backendRoot, p.directory);
        const snapshot = await backend.snapshot(session);
        const defaults = normalizePreferences(
          execution.captured?.preferences ?? snapshot.preferences.defaults ?? snapshot.preferences.preferences);
        const choice = resolveChoices(
          workspace,
          {
            agentID,
            model: modelChoice,
          },
          defaults,
        );
        const { agent } = choice;
        normalizeVariant(variantChoice);
        let variant =
          variantChoice === "inherit"
            ? resolvedVariant(agent?.variant, defaults)
            : variantChoice;
        const childVariant = defaults.childVariant ?? "";
        const nativeSession = await ownSession(p, session);
        const gitAgreement = await gitProjects.policy(id);
        const catalog = await providers();
        const candidates = catalog.all.flatMap((p) =>
          Object.keys(p.models).map((m) => ({
            id: `${p.id}/${m}`,
            provider: p.id,
            variants: p.models[m].variants ?? [],
            costClass: costClass(p.id, settings.plans),
          })),
        );
        const allowedModels = delegationPool(defaults, candidates, catalog.connected, childVariant)
          .filter(id => !Array.isArray(execution.captured?.delegationPool) || execution.captured.delegationPool.includes(id));
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
                      modelAllowed(m, catalog.connected),
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
        // Chat delivery must stay available to ask about agreement exceptions.
        // Branch preparation is an explicit managed tool action, never a send gate.
        // Apply the same restriction to the existing child selector, not a second router.
        const preferences = {
          ...defaults,
          allowedModels,
          maxParallel: defaults.maxParallel,
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
              agentID: agent.id,
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
        await workerSlot?.bind(session, messageID);
        const metadata = {
          policyVersion: execution.captured?.policyVersion ?? policyVersion,
          requestID: messageID,
          projectID: id,
          agentID: agent.id,
          mode: "build",
          ...(execution.goal ? { goalID: execution.goal.id, runID: execution.goal.runID, revision: execution.goal.revision } : {}),
        };
        await store.recordRequest({
          id: messageID,
          sessionID: session,
          projectID: id,
          createdAt: Date.now(),
          status: "prepared",
          policyVersion: execution.captured?.policyVersion ?? policyVersion,
          mode: "build",
          agent,
          directory: p.directory,
          catalog: workspace,
          catalogModels: candidates,
          // An empty captured pool means no children, not unrestricted routing.
          delegationPool: allowedModels,
          catalogConnected: catalog.connected,
          readOnly: execution.captured?.readOnly === true,
          ...(execution.captured?.workflow ? { workflow: execution.captured.workflow } : {}),
          model: model ?? null,
          variant: variant || null,
          preferences,
          rootRequestID: execution.captured?.rootRequestID ?? execution.captured?.id ?? messageID,
          rootSessionID: execution.captured?.rootSessionID ?? session,
          ...(execution.goal ? { goalID: execution.goal.id, goalRunID: execution.goal.runID, goalRevision: execution.goal.revision } : {}),
        });
        try {
          if (execution.automatic && execution.goal) {
            const goal = (await store.read('goals')).records[execution.goal.id];
            if (goal?.status !== 'running' || goal.stopRequested || goal.runID !== execution.goal.runID) throw Object.assign(Error('Automatic goal delivery inhibited by Stop or pause.'), { code: 'GOAL_INHIBITED' });
          }
          workerSubmitted = !!workerSlot;
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
                system: executionPrompt(agent, metadata, workspace) +
                  "\n\n" + delegationGuidance(preferences, allowedModels) +
                  (gitAgreement.tracking ? "\n\n" + gitExecutionContract(gitAgreement) : "") +
                  (execution.contract ? "\n\n" + execution.contract : ""),
                parts: [...(text.trim() ? [{ type: "text", text }] : []), ...fileParts],
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
        if (!workerSubmitted) await workerSlot?.release();
        gitProjects.finishDispatch(id, session, gitAcceptedMessage);
        sending--;
      }
    },
    async stop(id, session) {
      const p = await project(id);
      const native = await ownSession(p, session);
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
      const stoppedStatus = native.parentID ? (await request(p, '/session/status'))[session]?.type : null;
      if (native.parentID && (!stoppedStatus || stoppedStatus === 'idle')) {
        let root = native, seen = new Set();
        while (root.parentID && !seen.has(root.id) && seen.size < 32) { seen.add(root.id); root = await ownSession(p, root.parentID); }
        await releaseWorkerSession(backendRoot, root.id, session);
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
      if (action === "summarize" && !(await providers()).all.some((provider) => provider.id === payload.providerID))
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
    async saveAppearance({ theme, customTheme, removeCustomTheme, showDepletedModels, todoLayout, panelWidths, providerColors, fileAccessScope }) {
      const colors = providerColors === undefined ? undefined : normalizeProviderPatch(providerColors);
      const widths = panelWidths === undefined ? undefined : validatePanelWidths(panelWidths);
      const accessScope = fileAccessScope === undefined ? undefined : normalizeFileAccessScope(fileAccessScope);
      if (customTheme !== undefined && removeCustomTheme !== undefined) throw Error('Save or remove one custom theme at a time.');
      if (
        showDepletedModels !== undefined &&
        typeof showDepletedModels !== "boolean"
      )
        throw Error("Choose model visibility");
      if (todoLayout !== undefined && !["inline", "docked"].includes(todoLayout))
        throw Error("Choose todo placement");
      const saved = await store.update("settings", (s) => {
        let customThemes = s.appearance?.customThemes ?? [];
        let selected = theme ?? s.appearance?.theme ?? 'light';
        if (customTheme !== undefined) customThemes = [...customThemes, validateNewTheme(customTheme, customThemes)];
        if (removeCustomTheme !== undefined) {
          const removed = customThemes.find(p => p.id === removeCustomTheme);
          if (!removed) throw Error('This custom theme is no longer saved.');
          customThemes = customThemes.filter(p => p.id !== removeCustomTheme);
          if (selected === removeCustomTheme) selected = removed.mode;
        }
        if (theme !== undefined && !isTheme(selected, customThemes)) throw Error('Choose a theme');
        return {
          ...s,
          ...(accessScope !== undefined ? { fileAccessScope: accessScope } : {}),
          appearance: {
            ...s.appearance,
            ...(widths ? { panelWidths: { ...s.appearance?.panelWidths, ...widths } } : {}),
            ...((theme !== undefined || removeCustomTheme !== undefined) ? { theme: selected } : {}),
            ...((customTheme !== undefined || removeCustomTheme !== undefined) ? { customThemes } : {}),
            ...(colors ? { providerColors: mergeProviderColors(s.appearance?.providerColors, colors) } : {}),
            ...(showDepletedModels !== undefined ? { showDepletedModels } : {}),
            ...(todoLayout !== undefined ? { todoLayout } : {}),
          },
        };
      });
      return { saved: true, ...((theme !== undefined || removeCustomTheme !== undefined) ? { theme: saved.appearance.theme } : {}),
        ...((customTheme !== undefined || removeCustomTheme !== undefined) ? { customThemes: saved.appearance.customThemes } : {}),
        ...(widths ? { panelWidths: saved.appearance.panelWidths } : {}),
        ...(colors ? { providerColors: saved.appearance.providerColors } : {}),
        ...(accessScope !== undefined ? { fileAccessScope: saved.fileAccessScope } : {}) };
    },
    async authMethods() {
      const methods = await host.request("/provider/auth");
      return connectionMethods(methods, (await providers()).all);
    },
    async auth(id, action, body) {
      if (
        typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ||
        !["authorize", "callback", "key", "disconnect"].includes(action)
      )
        throw Error("Unsupported provider");
      const nativeMethodsResponse = await host.request("/provider/auth");
      const nativeProviders = (await providers()).all;
      const nativeMethods = connectionMethods(nativeMethodsResponse, nativeProviders);
      const methods = nativeMethods[id] ?? [];
      const inCatalog = action === "disconnect"
        ? nativeProviders.some((provider) => provider.id === id)
        : false;
      if (!inCatalog && !methods.length) throw Error("Unsupported provider");
      if (action === "key") {
        if (!methods.some(method => method.type === "api"))
          throw Error("OpenCode does not offer API-key authentication for this provider.");
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
      const method = methods[body.method];
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
          sessionDefaults: Object.fromEntries(Object.entries(s.sessionDefaults ?? {}).map(([projectID, value]) => [
            projectID,
            value?.agentID === id ? { ...value, agentID: "engineer", revision: (value.revision ?? 0) + 1 } : value,
          ])),
          chatChoices: Object.fromEntries(
            Object.entries(s.chatChoices ?? {}).map(([session, choice]) => [
              session,
              choice.agentID === id ? { ...choice, agentID: "engineer" } : choice,
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
  app.localData = localData;
  app.knowledgeQuery = createKnowledgeQuery({ data: () => localData.get(),
    getProjects: async () => (await store.read('settings')).projects });
  app.evidenceEvaluation = createEvidenceEvaluationService({ data: () => localData.get(),
    modelData: () => app.modelData, knowledgeQuery: app.knowledgeQuery, provider: () => app.judgmentProvider });
  app.history = createHistoryService({ app, host, backendRoot, dataRoot, localData });
  app.importedHistory = createImportedHistory(localData);
  app.indexJobs = createIndexJobs({ app, backendRoot, dataRoot, localData });
  app.history.setProjectArchiveIndexer((projectID, revision, commit) =>
    app.indexJobs.archiveProject(projectID, revision, commit));
  return app;
}
