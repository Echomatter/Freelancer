import path from "node:path";
import { stat } from "node:fs/promises";
import { createLocalDataService, isLocalDataUnavailable } from "./data/store.mjs";
import { maintainLocalData } from './data/maintenance.mjs';
import { openDataFolder } from "./native-data.mjs";
import { importedChatID } from './chatgpt-import.mjs';
import { openCodeSourceIdentity } from './data/opencode-warehouse.mjs';
import { contentMatch, contentFilters } from '../domain/content-query.mjs';
import {
  idPattern,
  sessionKey,
  draftInput,
  organizedSessions,
  nativeArchiveSupported,
  conversationMarkdown,
  historyContract,
} from "../domain/history.mjs";

const sameDirectory = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  (process.platform === "win32"
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b));
const bad = (text) => {
  throw Error(text);
};
const bounded = (value) =>
  Number.isInteger(value) && value >= 100 && value <= 10000 ? value : 1000;
export function createHistoryService({
  app,
  host,
  backendRoot,
  dataRoot,
  localData = createLocalDataService(dataRoot ?? path.join(backendRoot, ".state", "local-data")),
  openFolder = openDataFolder,
}) {
  let capabilities, databaseLocation;
  const indexing = new Map();
  let openCodeSource;
  let projectArchiveIndexer;
  const data = () => localData.get();
  const projectsToIndex = (projects, projectID, includeArchivedProject = false) => {
    const annotations = data().projects();
    const targets = projectID ? projects.filter(project => project.id === projectID) : projects;
    if (projectID && !targets.length) throw Error("Choose a registered project.");
    if (projectID && annotations[projectID]?.archivedAt && !includeArchivedProject)
      throw Error("Restore this project before refreshing its search indexes.");
    return targets.filter(project => !annotations[project.id]?.archivedAt ||
      includeArchivedProject && project.id === projectID);
  };
  const request = (project, route, options = {}) =>
    host.request(route, { ...options, directory: project.directory });
  async function sourceIdentity() {
    if (!openCodeSource) {
      openCodeSource = (async () => {
        const locator = host.databasePath ? await host.databasePath() : undefined;
        return openCodeSourceIdentity(locator);
      })();
    }
    return openCodeSource;
  }
  async function captureOpenCode(projectID, session, messages) {
    const source = await sourceIdentity();
    return data().recordOpenCodeSnapshot({ ...source, projectID, session, messages });
  }
  async function own(project, id) {
    if (!idPattern.test(id || "")) throw Error("Choose a chat.");
    if (importedChatID(id)) {
      const chat = app.chatgpt.get(project.id, id);
      if (!chat) throw Error('This imported chat belongs to another project.');
      const { messages, ...header } = chat;
      return header;
    }
    const session = await request(
      project,
      `/session/${encodeURIComponent(id)}`,
    );
    if (
      session.id !== id ||
      !sameDirectory(session.directory, project.directory)
    )
      throw Error("This chat belongs to another project.");
    return session;
  }
  async function group(project, id) {
    const root = await own(project, id),
      result = [root],
      seen = new Set([root.id]);
    if (root.imported) return result;
    for (let i = 0; i < result.length; i++) {
      const children = await request(
        project,
        `/session/${result[i].id}/children`,
      );
      if (!Array.isArray(children))
        throw Error("Worker history is unavailable. Nothing was changed.");
      for (const child of children) {
        if (seen.has(child.id))
          throw Error(
            "Worker history contains an invalid cycle. Nothing was changed.",
          );
        if (
          !idPattern.test(child.id || "") ||
          child.parentID !== result[i].id ||
          !sameDirectory(child.directory, project.directory)
        )
          throw Error(
            "A worker belongs to another project. Nothing was changed.",
          );
        seen.add(child.id);
        result.push(child);
        if (result.length > 500)
          throw Error(
            "This conversation has too many workers for one operation. Use native OpenCode.",
          );
      }
    }
    return result;
  }
  async function idle(project, ids) {
    const [status, questions, permissions] = await Promise.all([
      request(project, "/session/status"),
      request(project, "/question"),
      request(project, "/permission"),
    ]);
    if (
      !status ||
      Array.isArray(status) ||
      typeof status !== "object" ||
      !Array.isArray(questions) ||
      !Array.isArray(permissions)
    )
      throw Error("Chat activity is unavailable. Nothing was changed.");
    const matches = (id) => !ids || ids.has(id);
    if (
      Object.entries(status).some(
        ([id, s]) => matches(id) && s.type !== "idle",
      ) ||
      [...questions, ...permissions].some((q) => matches(q.sessionID))
    )
      throw Error(
        "Finish or stop the running chats and answer pending requests before archiving.",
      );
  }
  async function archiveMode() {
    capabilities ??= host
      .request("/doc")
      .then((doc) => ({ native: nativeArchiveSupported(doc) }))
      .catch(() => ({ native: false }));
    return capabilities;
  }
  async function enrich(projectID, rows) {
    const project = await app.project(projectID);
    const valid = [...rows, ...(app.chatgpt?.list(projectID) ?? [])].filter(
      (s) =>
        idPattern.test(s.id || "") &&
        sameDirectory(s.directory, project.directory),
    );
    data().remember(projectID, valid);
    const annotations = data().annotations(projectID);
    const cached = data()
      .headers(projectID)
      .map((s) => ({
        id: s.id,
        parentID: s.parentID,
        title: s.title,
        directory: project.directory,
        time: {
          created: s.createdAt,
          updated: s.updatedAt,
          archived: s.nativeArchivedAt,
        },
        cached: true,
      }));
    const merged = new Map(cached.map((s) => [s.id, s]));
    for (const s of valid) merged.set(s.id, s);
    return organizedSessions(
      [...merged.values()],
      annotations,
      !!data().projects()[projectID]?.archivedAt,
      data().systemSessions(projectID),
    );
  }
  async function ensureWritable(projectID, id) {
    const project = await app.project(projectID);
    let archivedProject, localData;
    try {
      localData = data();
      archivedProject = localData.projects()[projectID]?.archivedAt;
    } catch (error) {
      if (!isLocalDataUnavailable(error)) throw error;
    }
    if (archivedProject)
      throw Error("Restore this project before starting work.");
    if (!id || id === "new") return;
    let current = await own(project, id);
    if (!localData) {
      if (current.time?.archived)
        throw Error("Restore this archived conversation in OpenCode before sending a message.");
      if (String(current.title ?? "").startsWith("Configuration ·"))
        throw Error("Configuration tasks are managed from Models.");
      return;
    }
    const seen = new Set();
    while (current) {
      if (localData.systemSessions(projectID).has(current.id)) throw Error('Configuration tasks are managed from Models.');
      if (seen.has(current.id) || seen.size > 100)
        throw Error("Invalid parent chat history.");
      seen.add(current.id);
      if (
        localData.annotation(projectID, current.id).hiddenAt ||
        current.time?.archived
      )
        throw Error(
          "Restore this archived conversation before sending a message.",
        );
      current = current.parentID ? await own(project, current.parentID) : null;
    }
  }
  return {
    ensureWritable,
    async indexCurrent(projectID, id, messages) {
      if (data().projects()[projectID]?.archivedAt || app.indexJobs?.isArchiving(projectID)) return false;
      const project = await app.project(projectID);
      const session = await own(project, id);
      if (data().projects()[projectID]?.archivedAt || app.indexJobs?.isArchiving(projectID)) return false;
      if (Array.isArray(messages)) {
        data().indexChat(projectID, session, messages);
        await captureOpenCode(projectID, session, messages);
      }
      return true;
    },
    async backfillOpenCode({projectID,resume=true,pageSize=100,onProgress=()=>{},signal}={}) {
      const page=Math.max(1,Math.min(500,Number(pageSize)||100));
      const registered=(await app.store.read('settings')).projects;
      const projects=projectID?registered.filter(row=>row.id===projectID):registered;
      if(projectID&&!projects.length) throw Error('Choose a registered project.');
      const results=[];
      for(const project of projects) {
        signal?.throwIfAborted();
        const source=await sourceIdentity(),started=data().beginOpenCodeIngest({...source,projectID:project.id,mode:'backfill',resume});
        let cursor=started.cursor,requestStart=Number(cursor?.start)||0,previousID=typeof cursor?.previousID==='string'?cursor.previousID:null,pendingFailureOffset=null,pendingFailurePreviousID=null,discovered=0,captured=0,messagesCaptured=0,failed=0,complete=false;
        onProgress(`Backfilling OpenCode history · ${project.name}`);
        try {
          while(true) {
            signal?.throwIfAborted();
            const pageStart=requestStart;
            const params=new URLSearchParams({directory:project.directory,limit:String(page),start:String(pageStart)});
            const batch=await host.request(`/session?${params.toString()}`,{directory:project.directory});
            if(!Array.isArray(batch)) throw Error('OpenCode did not return a session page.');
            if(pageStart>0&&batch.length) {
              const boundaryParams=new URLSearchParams({directory:project.directory,limit:'2',start:String(pageStart-1)});
              const boundary=await host.request(`/session?${boundaryParams.toString()}`,{directory:project.directory});
              if(!Array.isArray(boundary)||boundary.length<2||
                (previousID&&boundary[0]?.id!==previousID)||boundary[1]?.id!==batch[0]?.id) {
                cursor={start:0};
                throw Error('OpenCode session ordering changed across the backfill page boundary. Resume from the beginning to reconcile the observed session set.');
              }
            }
            const valid=batch.filter(session=>idPattern.test(session.id||'')&&sameDirectory(session.directory,project.directory));
            discovered+=valid.length;
            for(let position=0;position<valid.length;position++) {
              const session=valid[position];
              const sessionOffset=pageStart+batch.indexOf(session);
              const priorID=sessionOffset>0?(batch[batch.indexOf(session)-1]?.id??previousID):null;
              signal?.throwIfAborted();
              try {
                const nativeMessages=await request(project,`/session/${encodeURIComponent(session.id)}/message`);
                if(!Array.isArray(nativeMessages)) throw Error('OpenCode did not return a message array.');
                await captureOpenCode(project.id,session,nativeMessages);
                captured++;messagesCaptured+=nativeMessages.length;
              } catch(error) {
                failed++;if(pendingFailureOffset===null){pendingFailureOffset=sessionOffset;pendingFailurePreviousID=priorID;}
                data().recordOpenCodeIngestFailure({runID:started.runID,sessionID:session.id,error:error.message});
              }
              requestStart=sessionOffset+1;
              previousID=session.id;
              cursor={start:pendingFailureOffset??requestStart,previousID:pendingFailureOffset===null?previousID:pendingFailurePreviousID};
              data().checkpointOpenCodeIngest({runID:started.runID,cursor,discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed});
            }
            requestStart=pageStart+batch.length;
            previousID=batch.at(-1)?.id??previousID;
            if(batch.length<page) { complete=failed===0;cursor=complete?null:{start:pendingFailureOffset??requestStart,previousID:pendingFailureOffset===null?previousID:pendingFailurePreviousID};break; }
            if(!valid.length) { throw Error('OpenCode returned a full page with no valid sessions; cursor is unchanged.'); }
          }
          results.push(data().checkpointOpenCodeIngest({runID:started.runID,cursor,discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed,complete,status:complete?'complete':'partial'}));
        } catch(error) {
          const savedCursor=cursor??started.cursor??null;
          data().checkpointOpenCodeIngest({runID:started.runID,cursor:savedCursor,discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed,status:'partial'});
          results.push({runID:started.runID,status:'partial',cursor:savedCursor,error:error.message,discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed});
        }
      }
      return {projects:results.length,results,coverage:data().openCodeCoverage()};
    },
    async rebuildChatSearch({ projectID, includeArchivedProject = false, onProgress = () => {}, signal } = {}) {
      if (app.indexJobs?.isArchiving() && !includeArchivedProject)
        throw Object.assign(Error('A project is being put away. General index refresh is paused.'), { status: 409 });
      const key = projectID ?? '*';
      if (indexing.has(key)) return indexing.get(key);
      const refresh = (async () => {
        const registered = (await app.store.read("settings")).projects;
        const projects = projectsToIndex(registered, projectID, includeArchivedProject);
        if (app.indexJobs?.isArchiving() && !includeArchivedProject)
          throw Object.assign(Error('A project is being put away. General index refresh is paused.'), { status: 409 });
        const summary = { projects: 0, conversations: 0, messages: 0, warehouseSessions: 0, warehouseMessages: 0, warehouseRevisions: 0, failures: [] };
        for (const project of projects) {
          signal?.throwIfAborted();
          onProgress(`Reading conversations · ${project.name}`);
          try {
            const rows = await request(project, "/session");
            if (!Array.isArray(rows)) throw Error("OpenCode did not return a session list.");
            const systemSessions = data().systemSessions(project.id);
            const valid = rows.filter((session) =>
              idPattern.test(session.id || "") && sameDirectory(session.directory, project.directory) && !systemSessions.has(session.id));
            const imported = app.chatgpt?.list(project.id) ?? [];
            const seen = new Set([...valid, ...imported].map((session) => session.id));
            let current = 0;
            for (const session of valid) {
              current++;
              signal?.throwIfAborted();
              onProgress(`Indexing conversations · ${project.name} (${current}/${valid.length})`);
            try {
              const messages = await request(project, `/session/${encodeURIComponent(session.id)}/message`);
              if (!Array.isArray(messages)) throw Error("OpenCode did not return messages.");
              if (!includeArchivedProject && (app.indexJobs?.isArchiving(project.id) || data().projects()[project.id]?.archivedAt))
                throw Error("The project was put away during indexing; its archived search copy was left unchanged.");
              data().indexChat(project.id, session, messages);
                const warehouse = await captureOpenCode(project.id,session,messages);
                summary.conversations++;
                summary.messages += messages.length;
                summary.warehouseSessions++;
                summary.warehouseMessages += warehouse.messages;
                summary.warehouseRevisions += warehouse.messageRevisionsAdded;
              } catch (error) {
                summary.failures.push({ project: project.name, conversation: session.title || session.id, error: error.message });
              }
            }
            for (const session of imported) {
              signal?.throwIfAborted();
              const chat = app.chatgpt.get(project.id, session.id);
              data().indexChat(project.id, session, chat.messages);
              summary.conversations++; summary.messages += chat.messages.length;
            }
            // This endpoint returns the full native listing. Failed individual
            // reads keep their prior copy; only absent sessions are pruned.
            const stale = Object.keys(data().chatIndexState(project.id)).filter((id) => !seen.has(id));
            data().removeChatIndex(project.id, stale);
            summary.projects++;
          } catch (error) {
            summary.failures.push({ project: project.name, error: error.message });
          }
        }
        return summary;
      })().finally(() => { indexing.delete(key); });
      indexing.set(key, refresh);
      return refresh;
    },
    async searchChats(query, options = {}) {
      if (typeof query !== "string" || !query.trim() || query.length > 200) return { results: [], coverage: "Enter up to 200 characters." };
      const projects = (await app.store.read("settings")).projects;
      if (options.project && !projects.some((project) => project.id === options.project)) throw Error("Choose a registered project.");
      const allowed = new Map(projects.map((project) => [project.id, project.name]));
      const hits = data().searchChats(query, options).filter((row) => allowed.has(row.project));
      const matchingProjects = new Set(hits.map((row) => row.project));
      const archivedProjects = data().projects();
      const headers = new Map(projects.filter((project) => matchingProjects.has(project.id)).map((project) => {
        const sessions = data().headers(project.id).map((s) => ({
          id: s.id, parentID: s.parentID, title: s.title,
          time: { updated: s.updatedAt, archived: s.nativeArchivedAt },
        }));
        return [project.id, new Map(organizedSessions(sessions, data().annotations(project.id),
          !!archivedProjects[project.id]?.archivedAt, data().systemSessions(project.id)).map((s) => [s.id, s]))];
      }));
      const results = hits
        .map(({ rank, ...row }) => {
          const sessions = headers.get(row.project);
          let root = sessions?.get(row.session);
          const seen = new Set();
          while (root?.parentID && !seen.has(root.id)) {
            seen.add(root.id);
            root = sessions.get(root.parentID);
          }
          if (!root || root.parentID) return null;
          return { ...row, session: root.id, title: root.title, updatedAt: root.time?.updated,
            projectName: allowed.get(row.project), organization: root.organization };
        }).filter(Boolean);
      return { results, coverage: "Search covers OpenCode chats and imported ChatGPT / Codex snapshots, including archived chats and workers. Rebuild to refresh older conversations; current chats refresh when opened. Results are a local search copy, not a backup." };
    },
    async searchFiles(query, options = {}) {
      if (typeof query !== "string" || !query.trim())
        return { results: [], coverage: "Search indexed files across registered projects." };
      if (query.length > 200) throw Error("Search is limited to 200 characters.");
      const match=contentMatch(query,{phrase:options.phrase===true});
      if (!match)
        return { results: [], coverage: "Enter words to search indexed file content." };
      const filters=contentFilters(options);
      const settingsProjects = (await app.store.read("settings")).projects;
      if (options.project && !settingsProjects.some((item) => item.id === options.project))
        throw Error("Choose a registered project.");
      const organizations = data().projects();
      const projects = settingsProjects
        .filter((item) => !options.project || item.id === options.project)
        .map((item) => ({
          id: item.id,
          name: item.name,
          key: process.platform === "win32"
            ? path.resolve(item.directory).toLowerCase()
            : path.resolve(item.directory),
          archived: !!organizations[item.id]?.archivedAt,
        }));
      const byKey = new Map(projects.map((item) => [item.key, item]));
      const hits = data().searchFiles(match, [...byKey.keys()], filters, options.limit);
      return {
        results: hits.flatMap(({ projectKey, ...hit }) => {
          const project = byKey.get(projectKey);
          return project ? [{ ...hit, project: project.id, projectName: project.name, projectArchived: project.archived }] : [];
        }),
        coverage: "Search uses the local file index for registered projects, including archived projects. Open Content & Storage to refresh recent file changes; results are derived search copies, not project files.",
      };
    },
    async indexStats() {
      const projects = (await app.store.read("settings")).projects;
      const stats = data().indexStats();
      const byPath = new Map(stats.fileProjects.map((item) => [item.key, item]));
      const byID = new Map(stats.chatProjects.map((item) => [item.id, item]));
      return { ...stats, projects: projects.map((project) => {
        const key = process.platform === "win32" ? path.resolve(project.directory).toLowerCase() : path.resolve(project.directory);
        return { id: project.id, name: project.name, files: byPath.get(key) ?? null, chats: byID.get(project.id) ?? null };
      }) };
    },
    async maintainIndex(operation) {
      let release;
      if (operation === 'reset') {
        // The maintenance worker replaces the database file. Pause the
        // process-wide connection so no other service can attach to the old
        // file while that replacement is in progress.
        await app.modelRatings?.quiesceForLocalDataMaintenance();
        release = localData.beginMaintenance();
      }
      let result;
      try {
        result = await maintainLocalData(dataRoot ?? path.join(backendRoot, '.state', 'local-data'), operation);
      } finally {
        release?.();
      }
      return { ...result, stats: await this.indexStats() };
    },
    close() {},
    setProjectArchiveIndexer(indexer) { projectArchiveIndexer = indexer; },
    isProjectArchived(projectID) { return !!data().projects()[projectID]?.archivedAt; },
    projectArchiveRevision(projectID) { return data().projects()[projectID]?.revision ?? 0; },
    projectsToIndex,
    async decorateBootstrap(result) {
      try {
        if (result.localDataError) throw Object.assign(new Error(result.localDataError), { code: "ERR_SQLITE_UNAVAILABLE" });
        const projects = data().projects();
        const settings = {
          ...result.settings,
          projects: result.settings.projects.map((p) => ({
            ...p,
            organization: projects[p.id] ?? { revision: 0 },
          })),
        };
        const p = result.project;
        const sessions = p ? await enrich(p.id, result.sessions ?? []) : [];
        return {
          ...result,
          settings,
          historyContract,
          sessions,
          project: p
            ? { ...p, organization: projects[p.id] ?? { revision: 0 } }
            : p,
        };
      } catch (error) {
        if (!isLocalDataUnavailable(error)) throw error;
        const fallbackOrganization = { revision: 0, pinnedAt: null, hiddenAt: null,
          projectArchived: false, hiddenByParent: false, archived: false,
          nativeArchived: false, archiveScope: null };
        return {
          ...result,
          indexPreparation: false,
          localDataError: error.message,
          historyContract,
          settings: { ...result.settings, projects: result.settings.projects.map((p) => ({
            ...p, organization: fallbackOrganization,
          })) },
          project: result.project ? { ...result.project, organization: fallbackOrganization } : null,
          sessions: (result.sessions ?? []).map((session) => ({
            ...session,
            organization: { ...fallbackOrganization, archived: !!session.time?.archived,
              nativeArchived: !!session.time?.archived,
              archiveScope: session.time?.archived ? "opencode" : null },
          })),
        };
      }
    },
    async list(
      projectID,
      { limit = 1000, search = "", scope = "active" } = {},
    ) {
      const project = await app.project(projectID);
      if (
        !["active", "archived", "all"].includes(scope) ||
        typeof search !== "string" ||
        search.length > 200
      )
        throw Error("Choose a valid history filter.");
      limit = bounded(Number(limit));
      const rows = await request(project, `/session?limit=${limit}`);
      if (!Array.isArray(rows)) throw Error("Chat history is unavailable.");
      const sessions = await enrich(projectID, rows);
      const needle = search.toLocaleLowerCase();
      return {
        sessions: sessions.filter(
          (s) =>
            !s.parentID &&
            (!needle || s.title.toLocaleLowerCase().includes(needle)) &&
            (scope === "all" ||
              (scope === "archived") === s.organization.archived),
        ),
        loaded: rows.length,
        limit,
        hasMore: rows.length >= limit && limit < 10000,
        coverage:
          "Conversation history lists the loaded OpenCode window, imported snapshots and previously seen references. It is not a complete backup. Cached entries are checked when opened.",
        archive: await archiveMode(),
      };
    },
    async pin(projectID, id, body) {
      const project = await app.project(projectID),
        session = await own(project, id);
      if (typeof body.pinned !== "boolean" || !Number.isInteger(body.revision))
        throw Error("Choose Pin or Unpin.");
      data().remember(projectID, [session]);
      return data().setConversationPin({ projectID,sessionID:id,title:session.title,
        parentID:session.parentID,pinned:body.pinned,revision:body.revision });
    },
    async archive(projectID, id, body, fence) {
      if (
        typeof body.archived !== "boolean" ||
        !Number.isInteger(body.revision)
      )
        throw Error("Choose Archive or Restore.");
      const project = await app.project(projectID);
      // Serialize with the sender across the project, including queued requests.
      return fence(projectID, async (pending) => {
        if (data().projects()[projectID]?.archivedAt)
          throw Error(
            "Restore this project in Content & Storage before changing conversation archives.",
          );
        const sessions = await group(project, id),
          ids = new Set(sessions.map((s) => s.id));
        if (pending.some((row) => ids.has(row.session)))
          throw Error(
            "This conversation has queued or uncertain delivery. Resolve it before archiving.",
          );
        if (!sessions[0].imported) await idle(project, ids);
        const root = sessions[0];
        if (root.parentID)
          throw Error(
            "Archive the parent conversation to keep its worker history together.",
          );
        data().remember(projectID, sessions);
        const old = data().annotation(projectID, id);
        if (old.revision !== body.revision)
          throw Error(
            "This chat changed in another window. Reload its history.",
          );
        const capability = await archiveMode();
        if (root.imported || old.hiddenAt || !capability.native) {
          if (root.time?.archived && !body.archived)
            throw Error(
              "This archive is owned by OpenCode. Restore it in a compatible native client first.",
            );
          return {
            scope: "freelancer",
            annotation: data().annotate(
              projectID,
              id,
              { hiddenAt: body.archived ? Date.now() : null },
              body.revision,
            ),
          };
        }
        // Only update the parent. Child session identity/history are untouched.
        await request(project, `/session/${id}`, {
          method: "PATCH",
          body: { time: { archived: body.archived ? Date.now() : null } },
        });
        const verified = await own(project, id);
        if (!!verified.time?.archived !== body.archived)
          throw Error(
            "OpenCode did not confirm the archive change. Refresh before retrying.",
          );
        data().remember(projectID, [verified]);
        return {
          scope: "opencode",
          annotation: data().annotate(projectID, id, {}, body.revision),
        };
      });
    },
    async archiveProject(projectID, body, fence) {
      if (
        typeof body.archived !== "boolean" ||
        !Number.isInteger(body.revision)
      )
        throw Error("Choose Archive or Restore.");
      const project = await app.project(projectID);
      return fence(projectID, async (pending) => {
        if (pending.length)
          throw Error(
            "Resolve queued or uncertain messages before putting this project away.",
          );
        await idle(project); // all native sessions in this directory, not a bounded history list
        const commit = () => data().archiveProject(projectID, body.archived, body.revision);
        if (body.archived) {
          if (!projectArchiveIndexer) throw Error("Project indexes are unavailable. Nothing was put away.");
          return projectArchiveIndexer(projectID, body.revision, commit);
        }
        return commit();
      });
    },
    async draft(projectID, id = "") {
      const project = await app.project(projectID),
        key = sessionKey(id);
      if (key !== "new") await own(project, key);
      return data().draft(projectID, key);
    },
    async saveDraft(projectID, id, body) {
      const project = await app.project(projectID),
        key = sessionKey(id),
        input = draftInput(body);
      if (key !== "new") await own(project, key);
      return data().saveDraft(projectID, key, input.text, input.revision);
    },
    async rebindDraft(projectID, body) {
      const project = await app.project(projectID),
        to = sessionKey(body.to);
      if (to === "new") throw Error("Choose the created chat.");
      await own(project, to);
      if (!Number.isInteger(body.revision))
        throw Error("Reload the draft before moving it.");
      return data().rebindDraft(projectID, "new", to, body.revision);
    },
    async export(projectID, body) {
      const project = await app.project(projectID);
      if (
        !["json", "markdown"].includes(body.format) ||
        typeof body.includeWorkers !== "boolean"
      )
        throw Error("Choose an export format and worker option.");
      const ids = body.sessions;
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 20 ||
        new Set(ids).size !== ids.length
      )
        throw Error("Select between 1 and 20 conversations.");
      if (!host.exportSession && ids.some(id => !importedChatID(id)))
        throw Error(
          "Native conversation export is unavailable. Restart with a supported OpenCode executable.",
        );
      const selected = new Map();
      for (const id of ids)
        for (const session of body.includeWorkers
          ? await group(project, id)
          : [await own(project, id)])
          selected.set(session.id, session);
      if (selected.size > 100)
        throw Error("Select fewer conversations or export without workers.");
      const nativeIDs = new Set([...selected.keys()].filter(id => !importedChatID(id)));
      if (nativeIDs.size) await idle(project, nativeIDs);
      const sessions = [];
      let bytes = 0;
      for (const id of selected.keys()) {
        const imported = importedChatID(id) ? app.chatgpt.get(projectID, id) : null;
        const exported = imported ? { info: selected.get(id), messages: imported.messages, source: imported.source }
          : await host.exportSession(id, project.directory);
        if (
          exported.info?.id !== id ||
          !sameDirectory(exported.info.directory, project.directory) ||
          !Array.isArray(exported.messages)
        )
          throw Error(
            "OpenCode returned an unexpected export. Nothing was saved.",
          );
        bytes += Buffer.byteLength(JSON.stringify(exported));
        if (bytes > 32 * 1024 * 1024)
          throw Error("The export exceeds 32 MB. Select fewer conversations.");
        sessions.push(exported);
      }
      const bundle = {
        format: "freelancer-conversations",
        version: 1,
        title: project.name,
        exportedAt: new Date().toISOString(),
        source: ids.some(importedChatID) ? 'freelancer-conversations-with-chatgpt-snapshots' : "native-opencode-export",
        includeWorkers: body.includeWorkers,
        notice:
          "Sensitive conversation text and tool output may be included. This is a conversation export, not a full backup. Project files, external attachment bytes, Git history, credentials, drafts and live execution state are not included. Sessions are individual native exports, not an atomic project snapshot.",
        sessions,
      };
      return {
        filename: `freelancer-conversations-${Date.now()}.${body.format === "json" ? "json" : "md"}`,
        mime: body.format === "json" ? "application/json" : "text/markdown",
        content:
          body.format === "json"
            ? JSON.stringify(bundle, null, 2)
            : conversationMarkdown(bundle),
      };
    },
    async storage() {
      const local = data().info();
      let native = null,
        nativeWarning = "";
      try {
        if (!host.databasePath)
          throw Error("Native database discovery is unavailable.");
        native = databaseLocation ??= await host.databasePath();
      } catch {
        nativeWarning =
          "OpenCode did not report its database path. No location was guessed.";
      }
      const bytes = async (filename) => {
        try {
          return (await stat(filename)).size;
        } catch {
          return null;
        }
      };
      const locations = [
        {
          id: "local",
          name: "Freelancer organization & drafts",
          path: local.filename,
          bytes: await bytes(local.filename),
          owner: "Freelancer",
          note: `SQLite, schema ${local.schemaVersion}. Includes derived project and chat search text; not encrypted by Freelancer. Windows protection relies on your user profile permissions.`,
        },
        {
          id: "legacy",
          name: "Existing settings & operational records",
          path: app.store.directory,
          bytes: null,
          owner: "Freelancer",
          note: "Runtime receipts and usage use a separate SQLite ledger; settings and sender JSON remain in place. Archive does not reset them.",
        },
        {
          id: "native",
          name: "Conversation history",
          path: native,
          bytes: native ? await bytes(native) : null,
          owner: "OpenCode",
          note: "Shared engine storage, not the selected project’s size. Never edited directly by Freelancer.",
        },
      ];
      return {
        ...local,
        locations,
        nativeWarning,
        archive: await archiveMode(),
        projects: (await app.store.read("settings")).projects.map((p) => ({
          ...p,
          organization: data().projects()[p.id] ?? { revision: 0 },
        })),
        notice:
          "Archive hides work; it does not delete files or reclaim disk space. File sizes exclude SQLite sidecar files. These locations are not a complete backup list.",
      };
    },
    async openLocation(which) {
      const locations = {
        local: data().directory,
        legacy: app.store.directory,
        native: databaseLocation && path.dirname(databaseLocation),
      };
      if (!Object.hasOwn(locations, which) || !locations[which])
        throw Error("Choose an available data location.");
      await openFolder(locations[which]);
      return { opened: true };
    },
  };
}
