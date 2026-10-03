import path from "node:path";
import { createHash } from 'node:crypto';
import { stat } from "node:fs/promises";
import { createLocalDataService, isLocalDataUnavailable } from "./data/store.mjs";
import { maintainLocalData } from './data/maintenance.mjs';
import { openDataFolder } from "./native-data.mjs";
import { importedChatID } from './chatgpt-import.mjs';
import { openCodeSourceIdentity, openCodeSnapshotProof } from './data/opencode-warehouse.mjs';
import { createKnowledgeQuery } from './data/knowledge-query.mjs';
import { createMemoryCaptureRunner } from './memory-capture.mjs';
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
const maxEventSnapshotBytes = 8 * 1024 * 1024;
const directoryHash = value => createHash('sha256').update(value).digest('hex');
function directoryHashCandidates(directory) {
  const resolved = path.resolve(directory), candidates = new Set([directory, resolved]);
  for (const value of [...candidates]) {
    candidates.add(value.replace(/\\/g, '/'));
    candidates.add(value.replace(/\//g, '\\'));
    const trimmed = value.replace(/[\\/]+$/, '');
    if (trimmed) candidates.add(trimmed);
    candidates.add(`${trimmed}${path.sep}`);
  }
  return new Set([...candidates].map(value => directoryHash(process.platform === 'win32' ? value.toLowerCase() : value)));
}
function boundedEventMessages(messages, sessionID) {
  const retained = [], seen = new Set();
  let bytes = 0, truncated = messages.length > 5000;
  for (const row of messages.slice(0, 5000)) {
    const info = row?.info;
    if (!row || typeof row !== 'object' || Array.isArray(row) || !info || typeof info !== 'object' ||
        typeof info.id !== 'string' || !/^[A-Za-z0-9][\w-]{0,199}$/.test(info.id) || !['user', 'assistant'].includes(info.role) ||
        info.sessionID !== undefined && info.sessionID !== sessionID || !Array.isArray(row.parts) || seen.has(info.id))
      throw Error('OpenCode returned a malformed message snapshot.');
    const stack = [row];
    let rowBytes = 0, nodes = 0, oversized = false;
    while (stack.length) {
      const value = stack.pop();
      if (++nodes > 100_000) { oversized = true; break; }
      if (typeof value === 'string') {
        if (value.length > maxEventSnapshotBytes - bytes - rowBytes) { oversized = true; break; }
        rowBytes += Buffer.byteLength(value);
      } else if (Array.isArray(value)) {
        rowBytes += 2;
        for (const child of value) stack.push(child);
      } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          rowBytes += Buffer.byteLength(key) + 3;
          stack.push(child);
          if (rowBytes + bytes > maxEventSnapshotBytes) { oversized = true; break; }
        }
        if (oversized) break;
      } else rowBytes += 16;
      if (rowBytes + bytes > maxEventSnapshotBytes) { oversized = true; break; }
    }
    if (oversized) { truncated = true; break; }
    bytes += rowBytes;
    seen.add(info.id);
    retained.push(row);
  }
  return { messages: retained, truncated };
}
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
  let openCodeSourceFlight;
  let closed = false;
  let closePromise;
  const indexControllers = new Set();
  const currentIndexes = new Set();
  let projectArchiveIndexer;
  const data = () => localData.get();
  const knowledgeQuery = app.knowledgeQuery ?? createKnowledgeQuery({ data,
    getProjects: async () => (await app.store.read('settings')).projects });
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
  function waitWithSignal(promise, signal) {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason ?? Object.assign(Error('The operation was aborted.'), { name: 'AbortError' }));
      signal.addEventListener('abort', abort, { once: true });
      promise.then(value => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      }, error => {
        signal.removeEventListener('abort', abort);
        reject(error);
      });
    });
  }
  async function sourceIdentity({ signal } = {}) {
    signal?.throwIfAborted();
    if (openCodeSource) return openCodeSource;
    if (!openCodeSourceFlight) {
      const flight = (async () => {
        const locator = host.databasePath ? await host.databasePath() : undefined;
        return { ...openCodeSourceIdentity(locator), apiVersion: typeof host.nativeVersion === 'string' ? host.nativeVersion : null };
      })();
      openCodeSourceFlight = flight;
      flight.then(value => {
        if (openCodeSourceFlight === flight) {
          openCodeSource = value;
          openCodeSourceFlight = null;
        }
      }, () => {
        if (openCodeSourceFlight === flight) openCodeSourceFlight = null;
      });
    }
    return waitWithSignal(openCodeSourceFlight, signal);
  }
  async function captureOpenCode(projectID, session, messages, completeWindow=false, signal, beforeWrite, projectionSafe=false) {
    if (session.imported) return null;
    if(!Array.isArray(messages)) throw Error('OpenCode did not return a message window.');
    const source = await sourceIdentity({ signal });
    signal?.throwIfAborted();
    if (signal || beforeWrite) {
      const registered = await app.project(projectID);
      if (!sameDirectory(registered.directory, session.directory)) throw Error('This chat is no longer registered to this project.');
      if (data().projects()[projectID]?.archivedAt || app.indexJobs?.isArchiving(projectID))
        throw Error('This project is archiving or archived; the native snapshot was not saved.');
      signal?.throwIfAborted();
    }
    const complete=completeWindow && messages.length<=5000 && Number.isSafeInteger(session.time?.archived) && session.time.archived>0;
    const input = { ...source, projectID, session, messages:messages.slice(0,5000),
      snapshotCompleteness:complete?'complete':'partial',snapshotProof:complete?openCodeSnapshotProof(session,messages):undefined,
      projectionSafe:projectionSafe===true };
    return beforeWrite ? beforeWrite(input) : data().recordOpenCodeSnapshot(input);
  }
  const captures = createMemoryCaptureRunner({ data, async readSource(job,signal) {
    const project = await app.project(job.projectID), startedAt = Date.now();
    let session, native;
    try {
      session = await own(project,job.sessionID,{signal});
      native = session.imported ? app.chatgpt.get(job.projectID,job.sessionID)?.messages
        : await request(project,`/session/${encodeURIComponent(job.sessionID)}/message`,{signal});
      if (!Array.isArray(native)) throw Error('Conversation messages are unavailable.');
    } catch (error) {
      signal.throwIfAborted();
      const availability=error?.status===404?'missing_source':'unknown_source';
      const previous=data().getMemory(job.memoryID), previousBoundary=previous?.revision.captureBoundary ?? {};
      const retainedSource=(previous?.members ?? []).filter(member=>member.kind==='message'&&member.locator&&
        ['user','assistant'].includes(member.locator.role)&&typeof member.locator.text==='string');
      const retained=retainedSource.slice(0,4999),truncated=retainedSource.length>retained.length;
      const messages=retained.map(member=>member.locator);
      const marker={kind:'conversation',ref:`${job.projectID}/${job.sessionID}`,availability,
        locator:{availability,attemptedAt:startedAt,error:String(error?.message ?? error).slice(0,1000),truncated}};
      return {messages,members:[marker,...retained],
        boundary:{status:availability,active:null,truncated,attemptedAt:startedAt,
          capturedAt:previousBoundary.capturedAt ?? null,retainedMessageCount:messages.length,messageCount:messages.length,
          sourceMessageCount:previousBoundary.sourceMessageCount ?? null,error:String(error?.message ?? error).slice(0,1000)},
        provenance:{...(previous?.revision.provenance ?? {}),projectID:job.projectID,sessionID:job.sessionID,
          sourceAvailability:availability,attemptedAt:startedAt}};
    }
    const messages=[],members=[]; let bytes=0,omitted=0,truncated=false,retainedNative=native;
    if (!session.imported) {
      let projectionSafe=false;
      const bounded=boundedEventMessages(native,job.sessionID);
      retainedNative=bounded.messages;
      truncated=bounded.truncated;
      projectionSafe=!bounded.truncated&&bounded.messages.length===native.length&&native.length<=5000;
      await captureOpenCode(job.projectID,session,retainedNative,projectionSafe,signal,undefined,projectionSafe);
    }
    const source = session.imported ? undefined : await sourceIdentity({ signal });
    const retained = source ? data().openCodeMessageRefs({projectID:job.projectID,sessionID:job.sessionID,sourceSystemID:source.sourceSystemID,limit:5000}) : null;
    for (const row of retainedNative) {
      signal.throwIfAborted();
      const info=row.info ?? row;
      if (!['user','assistant'].includes(info.role)) { omitted++; continue; }
      const text=(row.parts ?? []).filter(part=>part.type==='text'&&!part.ignored).map(part=>String(part.text ?? '')).join('\n');
      if (!text) { omitted++; continue; }
      const available = 900_000-bytes;
      if (available <= 0) { truncated=true; break; }
      let clipped=Buffer.from(text).subarray(0,Math.min(available,200_000)).toString('utf8');
      if (Buffer.byteLength(clipped) < Buffer.byteLength(text)) truncated=true;
      bytes+=Buffer.byteLength(clipped);
      const model=info.model ?? {}, ordinal=messages.length;
      const value={ordinal,role:info.role,text:clipped,createdAt:info.time?.created ?? null,
        providerID:info.providerID ?? model.providerID ?? null,modelID:info.modelID ?? model.modelID ?? null,messageID:info.id};
      const evidence=retained?.messages.find(message=>message.messageID===info.id);
      messages.push(value);
      members.push({kind:'message',ref:evidence?.sourceRef ?? `${source?.sourceSystemID ?? 'imported'}/${job.projectID}/${job.sessionID}/${info.id}`,
        revision:evidence?.revisionSha256,locator:value,availability:'retained'});
    }
    if (native.length>5000) truncated=true;
    let active=true;
    if (session.imported) active=false;
    else {
      try { const status=await request(project,'/session/status',{signal}); active=!!status?.[job.sessionID]&&status[job.sessionID].type!=='idle'; }
      catch { /* unknown activity is an incomplete boundary */ }
    }
    return {messages,members,boundary:{status:active||truncated?'incomplete':'complete',active,truncated,
      startedAt,attemptedAt:startedAt,sourceUpdatedAt:session.time?.updated ?? null,sourceMessageCount:native.length,messageCount:messages.length,
      omittedMessages:omitted,firstMessageID:messages[0]?.messageID ?? null,lastMessageID:messages.at(-1)?.messageID ?? null,
      scope:'user and assistant text from the observed conversation window; tool output, reasoning and attachments are excluded'},
      provenance:{sourceSystem:source?.sourceSystemID ?? 'imported',projectID:job.projectID,sessionID:job.sessionID}};
  }});
  // Resume only previously queued source captures after the app constructor returns.
  captures.start();
  async function own(project, id, { signal } = {}) {
    signal?.throwIfAborted();
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
      { signal },
    );
    signal?.throwIfAborted();
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
  const derivationWorkers = new Set();
  const derivationControllers = new Set();
  const derivationJobsInFlight = new Set();
  async function processWarehouseDerivationJobs({ limit = 25, projectID, signal } = {}) {
    if (closed) return { processed: 0, completed: 0, superseded: 0, blocked: 0, failed: 0, remaining: 0 };
    if (typeof data().listWarehouseDerivationJobs !== 'function')
      return { processed: 0, completed: 0, superseded: 0, blocked: 0, failed: 0, remaining: 0 };
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const localSignal = controller.signal;
    derivationControllers.add(controller);
    const work = (async () => {
      const source = await sourceIdentity({ signal: localSignal });
      const jobs = data().listWarehouseDerivationJobs({ sourceID: source.sourceSystemID, projectID, limit: Math.max(1, Math.min(50, Math.floor(Number(limit) || 25))) });
      const result = { processed: 0, completed: 0, superseded: 0, blocked: 0, failed: 0, remaining: jobs.length };
      for (const job of jobs) {
        localSignal.throwIfAborted();
        if (derivationJobsInFlight.has(job.id)) continue;
        derivationJobsInFlight.add(job.id);
        result.processed++;
        try {
          const snapshot = data().readWarehouseDerivationSnapshot({ id: job.id, revisionToken: job.revisionToken });
          if (snapshot.status === 'stale') { result.superseded++; continue; }
          if (snapshot.status === 'blocked') { result.blocked++; continue; }
          if (snapshot.status !== 'ok' || !snapshot.job) throw Error('A retained warehouse derivation snapshot is unavailable.');
          if (!snapshot.isCurrent) {
            const completed = data().completeWarehouseDerivationJob({ id: job.id, revisionToken: job.revisionToken, status: 'superseded' });
            if (completed.status === 'superseded') result.superseded++;
            continue;
          }
          if (!snapshot.projectionSafe) {
            data().failWarehouseDerivationJob({ id: job.id, revisionToken: job.revisionToken, error: 'The retained message window is not complete enough to publish.', blocked: true });
            result.blocked++;
            continue;
          }
          const project = await waitWithSignal(app.project(snapshot.job.projectID), localSignal);
          localSignal.throwIfAborted();
          const directoryMatches = typeof snapshot.session.directorySha256 === 'string' &&
            directoryHashCandidates(project.directory).has(snapshot.session.directorySha256);
          if (!directoryMatches) {
            data().failWarehouseDerivationJob({ id: job.id, revisionToken: job.revisionToken, error: 'The retained project scope cannot be verified.', blocked: true });
            result.blocked++;
            continue;
          }
          if (data().projects()[snapshot.job.projectID]?.archivedAt || app.indexJobs?.isArchiving(snapshot.job.projectID)) {
            data().failWarehouseDerivationJob({ id: job.id, revisionToken: job.revisionToken, error: 'The project is temporarily unavailable for indexing.' });
            result.failed++;
            continue;
          }
          const published = data().publishWarehouseDerivationJob({ id: job.id, revisionToken: job.revisionToken });
          if (published.status === 'complete') result.completed++;
          else if (published.status === 'superseded' || published.status === 'stale') result.superseded++;
          else if (published.status === 'blocked') {
            data().failWarehouseDerivationJob({ id: job.id, revisionToken: job.revisionToken, error: published.reason || 'The retained window cannot be published.', blocked: true });
            result.blocked++;
          }
        } catch (error) {
          if (localSignal.aborted || error?.name === 'AbortError') throw error;
          try { data().failWarehouseDerivationJob({ id: job.id, revisionToken: job.revisionToken, error,
            blocked: error?.status === 403 || error?.status === 404 || /belongs to another project|no longer registered|archiving or archived/i.test(String(error?.message ?? '')) }); } catch {}
          result.failed++;
        } finally {
          derivationJobsInFlight.delete(job.id);
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      result.remaining = Math.max(0, jobs.length - result.completed - result.superseded);
      return result;
    })();
    derivationWorkers.add(work);
    try { return await work; }
    finally {
      derivationWorkers.delete(work);
      derivationControllers.delete(controller);
      signal?.removeEventListener('abort', abort);
    }
  }
  return {
    ensureWritable,
    async warehouseSourceIdentity(options = {}) { return sourceIdentity(options); },
    async markWarehouseRefreshNeeded({ projectID = null, sessionID = null, reason = 'event-hint', signal } = {}) {
      const source = await sourceIdentity({ signal });
      signal?.throwIfAborted();
      return data().markWarehouseRefreshNeeded({ sourceID: source.sourceSystemID, projectID, sessionID, reason });
    },
    async listWarehouseRefreshNeeded({ projectID, limit = 50, includeBlocked = false, includeDeferred = false, signal } = {}) {
      const source = await sourceIdentity({ signal });
      signal?.throwIfAborted();
      return data().listWarehouseRefreshNeeded({ sourceID: source.sourceSystemID, projectID, limit, includeBlocked, includeDeferred });
    },
    clearWarehouseRefreshNeeded(input) { return data().clearWarehouseRefreshNeeded(input); },
    failWarehouseRefreshNeeded(input) { return data().failWarehouseRefreshNeeded(input); },
    async openCodeIngestStatus({ projectID, signal } = {}) {
      const source = await sourceIdentity({ signal });
      signal?.throwIfAborted();
      return data().openCodeIngestStatus({ sourceSystemID: source.sourceSystemID, projectID });
    },
    processWarehouseDerivationJobs,
    async refreshSessionSnapshot(projectID, id, { signal } = {}) {
      signal?.throwIfAborted();
      if (!idPattern.test(id || "") || importedChatID(id)) return { captured: false, reason: "unsupported-session" };
      const project = await app.project(projectID);
      if (data().projects()[projectID]?.archivedAt || app.indexJobs?.isArchiving(projectID))
        return { captured: false, reason: "project-not-writable" };
      const session = await own(project, id, { signal });
      signal?.throwIfAborted();
      const messages = await request(project, `/session/${encodeURIComponent(id)}/message`, { signal });
      signal?.throwIfAborted();
      if (!Array.isArray(messages)) throw Error("OpenCode did not return a message array.");
      const snapshot = boundedEventMessages(messages, id);
      const registered = await app.project(projectID);
      if (!sameDirectory(registered.directory, project.directory)) throw Error('This chat is no longer registered to this project.');
      signal?.throwIfAborted();
      const result = await captureOpenCode(projectID, session, snapshot.messages,
        !snapshot.truncated && snapshot.messages.length === messages.length, signal, input => {
          const saved = data().recordOpenCodeSnapshot(input);
          data().remember(projectID, [session]);
          return saved;
        }, !snapshot.truncated && snapshot.messages.length === messages.length);
      signal?.throwIfAborted();
      await processWarehouseDerivationJobs({ projectID, signal, limit: 25 });
      return { captured: true, sessionID: id, messages: result.messages, completeness: result.snapshotCompleteness,
        truncated: snapshot.truncated, projectionSafe: !snapshot.truncated && snapshot.messages.length === messages.length,
        adequateCapture: !snapshot.truncated && snapshot.messages.length === messages.length,
        capturedMessageCount: snapshot.messages.length };
    },
    indexCurrent(projectID, id, messages) {
      if (closed) return Promise.resolve(false);
      const controller = new AbortController();
      const { signal } = controller;
      indexControllers.add(controller);
      const work = (async () => {
        if (data().projects()[projectID]?.archivedAt || app.indexJobs?.isArchiving(projectID)) return false;
        const project = await app.project(projectID);
        const session = await own(project, id, { signal });
        signal.throwIfAborted();
        if (data().projects()[projectID]?.archivedAt || app.indexJobs?.isArchiving(projectID)) return false;
        if (Array.isArray(messages)) {
          if (session.imported) {
            // Imported transcripts remain searchable but never receive an
            // OpenCode source identity or warehouse snapshot.
            signal.throwIfAborted();
            data().indexChat(projectID, session, messages);
          } else {
            let projectionSafe=false,boundedMessages;
            try {
              const bounded=boundedEventMessages(messages,id);
              boundedMessages=bounded.messages;
              projectionSafe=!bounded.truncated&&bounded.messages.length===messages.length;
            } catch { throw Error('OpenCode message snapshot is malformed; its previous source and search projection were preserved.'); }
            await captureOpenCode(projectID, session, boundedMessages, false, signal, input => {
              signal.throwIfAborted();
              return data().recordOpenCodeSnapshot(input);
            }, projectionSafe);
            await processWarehouseDerivationJobs({ projectID, signal, limit: 25 });
          }
        }
        return true;
      })();
      let tracked;
      tracked = work.finally(() => {
        indexControllers.delete(controller);
        currentIndexes.delete(tracked);
      });
      currentIndexes.add(tracked);
      return tracked;
    },
    async backfillOpenCode({projectID,resume=true,pageSize=100,onProgress=()=>{},signal,
      maxPages=Number.POSITIVE_INFINITY,maxSessions=Number.POSITIVE_INFINITY,maxDurationMs=Number.POSITIVE_INFINITY}={}) {
      const deadlineMs=Number.isFinite(maxDurationMs)?Math.max(100,Math.floor(maxDurationMs)):Number.POSITIVE_INFINITY;
      const deadlineController=new AbortController();
      const deadlineTimer=Number.isFinite(deadlineMs)?setTimeout(()=>deadlineController.abort(),deadlineMs):null;
      deadlineTimer?.unref?.();
      const callerSignal=signal;
      signal=deadlineTimer?(callerSignal?AbortSignal.any([callerSignal,deadlineController.signal]):deadlineController.signal):callerSignal;
      try {
      const {createHash}=await import('node:crypto');
      const page=Math.max(1,Math.min(500,Math.floor(Number(pageSize)||100))),bucketCap=5000;
      const pageBudget=Number.isFinite(maxPages)?Math.max(1,Math.floor(maxPages)):Number.POSITIVE_INFINITY;
      const sessionBudget=Number.isFinite(maxSessions)?Math.max(1,Math.floor(maxSessions)):Number.POSITIVE_INFINITY;
      const timeBudget=deadlineMs;
      const registered=(await waitWithSignal(app.store.read('settings'),signal)).projects;
      const projects=projectID?registered.filter(row=>row.id===projectID):registered;
      if(projectID&&!projects.length) throw Error('Choose a registered project.');
      const results=[];
      for(const project of projects) {
        if(callerSignal?.aborted) {
          if(results.length) break;
          callerSignal.throwIfAborted();
        }
        signal?.throwIfAborted();
        const source=await sourceIdentity({signal}),started=data().beginOpenCodeIngest({...source,projectID:project.id,mode:'backfill',resume});
        const contract='opencode-updated-v1';
        // Earlier versions mistakenly treated native start (updated >= start)
        // as an offset. Such cursors cannot establish coverage and restart here.
        const prior=started.cursor?.contract===contract&&
          (started.cursor.before===null||Number.isSafeInteger(started.cursor.before)&&started.cursor.before>=0)?started.cursor:null;
        let before=prior?.before??null,head=prior?.head??null,resumePage=prior?.page&&typeof prior.page==='object'?prior.page:null,
          cursor={contract,before,retryIDs:Array.isArray(prior?.retryIDs)?prior.retryIDs.filter(id=>typeof id==='string'&&idPattern.test(id)):[],...(resumePage?{page:resumePage}:{})};
        const retryIDs=new Set(cursor.retryIDs),discoveredIDs=new Set(),capturedIDs=new Set();
        let failureBefore=retryIDs.size?before:undefined,discovered=0,captured=0,messagesCaptured=0,failed=0;
        let pageReads=0,visited=0,budgetExhausted=false;
        const runStartedAt=Date.now();
        const checkpoint=(pageBefore,bucket,pageProgress=null)=>{
          cursor={contract,before:failureBefore===undefined?pageBefore:failureBefore,retryIDs:[...retryIDs].sort(),...(head?{head}:{}),...(bucket?{bucket}:{}),...(pageProgress?{page:pageProgress}:{})};
          data().checkpointOpenCodeIngest({runID:started.runID,cursor,discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed});
        };
        const signature=rows=>createHash('sha256').update(JSON.stringify(rows.map(session=>({id:session.id,updatedAt:session.time.updated})))).digest('hex');
        const readPage=async({before=null,start,limit=page}={})=>{
          signal?.throwIfAborted();
          if(pageReads>=pageBudget||Date.now()-runStartedAt>=timeBudget)
            throw Object.assign(Error('The bounded OpenCode backfill slice is complete.'),{code:'ERR_WAREHOUSE_BACKFILL_BUDGET'});
          pageReads++;
          const params=new URLSearchParams({directory:project.directory,archived:'true',limit:String(limit)});
          if(before!==null) params.set('cursor',String(before));
          if(start!==undefined) params.set('start',String(start));
          const response=await host.request(`/experimental/session?${params}`,{directory:project.directory,signal,responseMetadata:true});
          signal?.throwIfAborted();
          const rows=response?.body,raw=response?.metadata?.['x-next-cursor'];
          if(!Array.isArray(rows)||rows.length>limit) throw Error('OpenCode did not return a bounded native session page.');
          const seen=new Set();
          for(let i=0;i<rows.length;i++) {
            const row=rows[i],updated=row?.time?.updated,previous=rows[i-1];
            if(!idPattern.test(row?.id||'')||!sameDirectory(row.directory,project.directory)||!Number.isSafeInteger(updated)||updated<0||
              before!==null&&updated>=before||start!==undefined&&updated<start||seen.has(row.id)||
              previous&&(previous.time.updated<updated||previous.time.updated===updated&&previous.id<row.id))
              throw Error('OpenCode returned an invalid or reordered native session page; its cursor is unchanged.');
            seen.add(row.id);
          }
          if(raw!==null&&(typeof raw!=='string'||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||!rows.length||Number(raw)!==rows.at(-1).time.updated))
            throw Error('OpenCode did not return a valid native x-next-cursor.');
          return {rows,next:raw===null?null:Number(raw)};
        };
        const expandPage=async batch=>{
          let rows=batch.rows,cappedBucket;
          if(batch.next!==null) {
            const updatedAt=rows.at(-1).time.updated;
            if(updatedAt===Number.MAX_SAFE_INTEGER) throw Error('OpenCode timestamp cannot be safely bounded.');
            // The native cursor is only a timestamp. Read the bounded full
            // sibling bucket once so every finite slice can reserve calls for
            // capture progress and final-head verification.
            const bucket=await readPage({start:updatedAt,before:updatedAt+1,limit:bucketCap});
            if(bucket.next!==null) cappedBucket={updatedAt,limit:bucketCap};
            const observed=new Set(bucket.rows.map(row=>row.id));
            if(rows.some(row=>row.time.updated===updatedAt&&!observed.has(row.id)))
              throw Error('OpenCode session ordering changed while draining a timestamp boundary; resume to reconcile the observed set.');
            rows=[...rows.filter(row=>row.time.updated!==updatedAt),...bucket.rows];
          }
          return {...batch,rows,cappedBucket};
        };
        onProgress(`Backfilling OpenCode history · ${project.name}`);
        try {
          const first=await expandPage(await readPage());
          const currentHead=signature(first.rows);
          if(prior&&JSON.stringify(head)!==JSON.stringify(currentHead)) {before=null;failureBefore=retryIDs.size?null:undefined;resumePage=null;}
          head=currentHead;
          checkpoint(before);
          let initial=before===null?first:null;
          while(true) {
            signal?.throwIfAborted();
            const pageBefore=before,batch=initial??await expandPage(await readPage({before}));initial=null;
            const {rows,cappedBucket}=batch;
            const pageSignature=signature(rows),cachedPage=resumePage&&resumePage.before===pageBefore&&resumePage.signature===pageSignature?resumePage:null;
            const processedIDs=new Set((cachedPage?.processedIDs??[]).filter(id=>rows.some(row=>row.id===id)&&!retryIDs.has(id)));
            for(const id of processedIDs) capturedIDs.add(id);
            const pageProgress={before:pageBefore,next:batch.next,signature:pageSignature,processedIDs:[...processedIDs],
              capturedMessages:Number.isSafeInteger(cachedPage?.capturedMessages)?cachedPage.capturedMessages:0};
            resumePage=null;
            for(const session of rows) {
              if(!discoveredIDs.has(session.id)){discoveredIDs.add(session.id);discovered++;}
              if(capturedIDs.has(session.id)) continue;
              visited++;
              signal?.throwIfAborted();
              try {
                const nativeMessages=await request(project,`/session/${encodeURIComponent(session.id)}/message`,{signal});
                signal?.throwIfAborted();
                if(!Array.isArray(nativeMessages)) throw Error('OpenCode did not return a message array.');
                let boundedMessages,projectionSafe=false;
                const bounded=boundedEventMessages(nativeMessages,session.id);
                boundedMessages=bounded.messages;
                projectionSafe=!bounded.truncated&&bounded.messages.length===nativeMessages.length;
                await captureOpenCode(project.id,session,boundedMessages,projectionSafe,signal,undefined,projectionSafe);
                if(!projectionSafe) throw Error('The native message window was truncated; retained source remains partial and requires reconciliation.');
                capturedIDs.add(session.id);retryIDs.delete(session.id);captured++;messagesCaptured+=nativeMessages.length;
                processedIDs.add(session.id);pageProgress.processedIDs=[...processedIDs];
                pageProgress.capturedMessages+=nativeMessages.length;
                // The retained snapshot has committed; account for it before
                // observing cancellation so the durable run can checkpoint a
                // truthful partial result instead of rejecting after success.
                signal?.throwIfAborted();
              } catch(error) {
                signal?.throwIfAborted();
                if (error?.name==='AbortError') throw error;
                failed++;retryIDs.add(session.id);if(failureBefore===undefined)failureBefore=pageBefore;
                data().recordOpenCodeIngestFailure({runID:started.runID,sessionID:session.id,error:error.message});
              }
              checkpoint(pageBefore,cappedBucket,pageProgress);
              if(visited>=sessionBudget||Date.now()-runStartedAt>=timeBudget) {budgetExhausted=true;break;}
            }
            if(budgetExhausted) break;
            if(cappedBucket) throw Error(`OpenCode has more than ${bucketCap} sessions at one updated timestamp; coverage remains partial and the timestamp bucket is retained for explicit retry.`);
            if(batch.next===null) break;
            before=batch.next;resumePage=null;
            checkpoint(before);
          }
          if(budgetExhausted) {
            const savedCursor=cursor??started.cursor??null;
            results.push(data().checkpointOpenCodeIngest({runID:started.runID,cursor:savedCursor,discoveredSessions:discovered,
              capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed,status:'partial'}));
            continue;
          }
          // Keep the final processed page in the cursor until the fresh head
          // comparison succeeds. A finite slice that runs out here resumes
          // without rereading already committed message bodies.
          if(pageReads+2>pageBudget) {
            const savedCursor=cursor??started.cursor??null;
            results.push(data().checkpointOpenCodeIngest({runID:started.runID,cursor:savedCursor,discoveredSessions:discovered,
              capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed,status:'partial'}));
            continue;
          }
          // Include the entire head boundary bucket: an equal-time insertion
          // beyond its first-page ID prefix must also invalidate completion.
          const finalHead=await expandPage(await readPage());
          if(finalHead.cappedBucket) {checkpoint(null,finalHead.cappedBucket);throw Error('OpenCode head timestamp bucket exceeded the bounded reconciliation window; coverage remains partial.');}
          if(JSON.stringify(head)!==JSON.stringify(signature(finalHead.rows))) {
            failureBefore=retryIDs.size?null:undefined;checkpoint(null);
            throw Error('OpenCode session inventory changed during backfill. Resume from the head to reconcile the observed session set.');
          }
          for(const sessionID of retryIDs) if(!discoveredIDs.has(sessionID)) {
            failed++;data().recordOpenCodeIngestFailure({runID:started.runID,sessionID,error:'A previously failed session was absent from the observed native inventory; its retained source was left unchanged.'});
          }
          const complete=retryIDs.size===0;
          if(complete) cursor=null;
          else checkpoint(before);
          results.push(data().checkpointOpenCodeIngest({runID:started.runID,cursor,discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed,complete,status:complete?'complete':'partial'}));
        } catch(error) {
          const savedCursor=cursor??started.cursor??null;
          data().checkpointOpenCodeIngest({runID:started.runID,cursor:savedCursor,discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed,status:'partial'});
          if(callerSignal?.aborted) {
            if(captured===0) throw error;
            results.push({runID:started.runID,status:'partial',cursor:savedCursor,
              discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed});
            break;
          }
          if(deadlineController.signal.aborted) {
            results.push({runID:started.runID,status:'partial',cursor:savedCursor,budgetLimited:true,
              discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed});
            break;
          }
          results.push({runID:started.runID,status:'partial',cursor:savedCursor,
            ...(error?.code==='ERR_WAREHOUSE_BACKFILL_BUDGET'?{budgetLimited:true}:{error:error.message}),
            discoveredSessions:discovered,capturedSessions:captured,capturedMessages:messagesCaptured,failedSessions:failed});
        }
      }
      if(!signal?.aborted) await processWarehouseDerivationJobs({ projectID, signal, limit: 50 });
      return {projects:results.length,results,coverage:data().openCodeCoverage()};
      } finally { if(deadlineTimer) clearTimeout(deadlineTimer); }
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
            const rows = await request(project, "/session", {signal});
            signal?.throwIfAborted();
            if (!Array.isArray(rows)) throw Error("OpenCode did not return a session list.");
            const systemSessions = data().systemSessions(project.id);
            const valid = rows.filter((session) =>
              idPattern.test(session.id || "") && sameDirectory(session.directory, project.directory) && !systemSessions.has(session.id));
            const imported = app.chatgpt?.list(project.id) ?? [];
            let current = 0;
            for (const session of valid) {
              current++;
              signal?.throwIfAborted();
              onProgress(`Indexing conversations · ${project.name} (${current}/${valid.length})`);
            try {
              const messages = await request(project, `/session/${encodeURIComponent(session.id)}/message`, {signal});
              signal?.throwIfAborted();
              if (!Array.isArray(messages)) throw Error("OpenCode did not return messages.");
              if (!includeArchivedProject && (app.indexJobs?.isArchiving(project.id) || data().projects()[project.id]?.archivedAt))
                throw Error("The project was put away during indexing; its archived search copy was left unchanged.");
              let boundedMessages=messages.slice(0,5000),projectionSafe=false;
              try {
                const bounded=boundedEventMessages(messages,session.id);
                boundedMessages=bounded.messages;
                projectionSafe=!bounded.truncated&&bounded.messages.length===messages.length;
              } catch { /* malformed, truncated and over-limit windows preserve the old projection */ }
                const warehouse = await captureOpenCode(project.id,session,boundedMessages,projectionSafe,signal,undefined,projectionSafe);
                summary.conversations++;
                summary.messages += messages.length;
                summary.warehouseSessions++;
                summary.warehouseMessages += warehouse.messages;
                summary.warehouseRevisions += warehouse.messageRevisionsAdded;
              } catch (error) {
                signal?.throwIfAborted();
                summary.failures.push({ project: project.name, conversation: session.title || session.id, error: error.message });
              }
            }
            for (const session of imported) {
              signal?.throwIfAborted();
              const chat = app.chatgpt.get(project.id, session.id);
              data().indexChat(project.id, session, chat.messages);
              summary.conversations++; summary.messages += chat.messages.length;
            }
            await processWarehouseDerivationJobs({ projectID: project.id, signal, limit: 50 });
            // Native /session is a recent window, not an authoritative complete
            // inventory. Keep older/archived search copies absent from it.
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
      const projects = (await app.store.read("settings")).projects;
      if (options.project && !projects.some((project) => project.id === options.project)) throw Error("Choose a registered project.");
      const allowed = new Map(projects.map((project) => [project.id, project.name]));
      const limit=options.limit ?? 50;
      const found = await knowledgeQuery.query({ domain: 'conversations', query, projectID: options.project || undefined,
        model: options.model || undefined, phrase: options.phrase === true, limit, cursor: options.cursor });
      const hits = found.results;
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
        .map(row => {
          const sessions = headers.get(row.project);
          let root = sessions?.get(row.session);
          const seen = new Set();
          while (root?.parentID && !seen.has(root.id)) {
            seen.add(root.id);
            root = sessions.get(root.parentID);
          }
          const navigation = root && !root.parentID ? root : null;
          return { ...row, navigationSession: navigation?.id ?? row.session, navigationTitle: navigation?.title ?? row.title,
            projectName: allowed.get(row.project), organization: navigation?.organization ?? sessions?.get(row.session)?.organization };
        });
      return { ...found, results, coverage: `${found.coverage} Worker hits retain their source identity; live navigation can open the parent conversation. Retained evidence reads the exact indexed source window.` };
    },
    async searchFiles(query, options = {}) {
      const settingsProjects = (await app.store.read("settings")).projects;
      if (options.project && !settingsProjects.some((item) => item.id === options.project))
        throw Error("Choose a registered project.");
      const organizations = data().projects();
      const projects = settingsProjects
        .filter((item) => !options.project || item.id === options.project)
        .map((item) => ({
          id: item.id,
          name: item.name,
          archived: !!organizations[item.id]?.archivedAt,
        }));
      const byID = new Map(projects.map((item) => [item.id, item]));
      const limit=options.limit ?? 50;
      const found = await knowledgeQuery.query({ domain: 'files', query, projectID: options.project || undefined,
        source: options.source || undefined, role: options.role || undefined, status: options.status || undefined,
        phrase: options.phrase === true, limit, cursor: options.cursor });
      return {
        ...found,
        results: found.results.flatMap(({ projectKey, ...hit }) => {
          const project = byID.get(hit.projectID);
          return project ? [{ ...hit, project: project.id, projectName: project.name, projectArchived: project.archived }] : [];
        }),
        coverage: `${found.coverage} Search includes archived projects. Open Content & Storage to refresh recent file changes; pages follow the moving index and results are derived search copies.`,
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
        // The maintenance worker repairs derived indexes in place. Pause the
        // process-wide connection so services wait for the repair to finish.
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
    close() {
      if (closePromise) return closePromise;
      closed = true;
      for (const controller of indexControllers) controller.abort();
      for (const controller of derivationControllers) controller.abort();
      closePromise = Promise.allSettled([captures.close(), ...currentIndexes, ...derivationWorkers]).then(() => undefined);
      return closePromise;
    },
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
      if (typeof body.pinned !== "boolean" || !Number.isInteger(body.revision))
        throw Error("Choose Pin or Unpin.");
      if (!idPattern.test(id||'')) throw Error('Choose a chat.');
      const project=await app.project(projectID);
      const header=data().headers(projectID).find(row=>row.id===id);
      let session=header ? {id,title:header.title,parentID:header.parentID,directory:project.directory} : null;
      if (body.pinned || !session) {
        try { session=await own(project,id); }
        catch (error) { if (!session) throw error; }
      }
      data().remember(projectID, [session]);
      const annotation=data().setConversationPin({ projectID,sessionID:id,title:session.title,
        parentID:session.parentID,pinned:body.pinned,revision:body.revision });
      if (body.pinned) {
        const job=data().queueMemoryCapture({memoryID:`conversation:${projectID}:${id}`,projectID,sessionID:id});
        captures.start();
        return {...annotation,capture:job};
      }
      return annotation;
    },
    async refreshMemory(id) {
      const memory=data().getMemory(id);
      if (!memory || memory.kind!=='conversation_snapshot') throw Error('Choose a retained conversation memory.');
      await app.project(memory.source_project_id);
      const job=data().queueMemoryCapture({memoryID:id,projectID:memory.source_project_id,sessionID:memory.source_session_id});
      captures.start();
      return {job};
    },
    async readMemory(id,revision) {
      const memory=data().getMemory(id,revision);
      if (!memory) return null;
      const settings=await app.store.read('settings'),project=settings.projects.find(row=>row.id===memory.source_project_id);
      const boundary=memory.revision.captureBoundary;
      return {id:memory.memory_id,kind:memory.kind,title:memory.title,body:memory.revision.body,
        project:memory.source_project_id,projectName:project?.name ?? 'Shared memory',session:memory.source_session_id,
        status:memory.status,coverage:boundary.status ?? 'authored',boundary,
        revision:memory.revision.revision,pinnedAt:memory.pinnedAt ?? null,pinRevision:memory.pinRevision ?? 0,archiveRevision:memory.archiveRevision ?? 0,
        originalPinnedAt:memory.originalPinnedAt ?? null,capturedAt:boundary.capturedAt ?? null,
        snapshotHash:memory.revision.provenance.snapshotHash ?? '',revisions:memory.revisions,members:memory.members,
        annotationRevision:memory.source_session_id ? data().annotation(memory.source_project_id,memory.source_session_id).revision : undefined,
        job:data().memoryCaptureJob(id),messages:memory.members.filter(member=>member.kind==='message').map(member=>member.locator),
        messageCount:boundary.messageCount ?? 0,excerpt:memory.revision.body.slice(0,240)};
    },
    async searchMemory(query,options={}) {
      if (options.projectID) await app.project(options.projectID);
      const found=await knowledgeQuery.query({ domain: 'memories', query, projectID: options.projectID,
        kind: options.kind, model: options.model, phrase: options.phrase === true, pinnedOnly: options.pinned === true,
        includeArchived: options.includeArchived === true, limit: options.limit, cursor: options.cursor });
      const settings=await app.store.read('settings');
      const projects=new Map(settings.projects.map(project=>[project.id,project]));
      const results=found.results.map(item=>({...item,project:item.projectID,session:item.sessionID,
        projectName:projects.get(item.projectID)?.name ?? 'Shared memory',
        annotationRevision:item.sessionID ? data().annotation(item.projectID,item.sessionID).revision : undefined,
        job:data().memoryCaptureJob(item.id)}));
      return {...found,status:results.length?'ok':'empty',results,
        coverage:`${found.coverage} Native sources may have changed; pages follow the moving index.`};
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
