import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { idPattern } from '../domain/history.mjs';
import { createEventInvalidator } from '../src/live-events.mjs';

const normalizeDirectory = value => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const result = path.resolve(value);
  return process.platform === 'win32' ? result.toLowerCase() : result;
};
function awaitSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? Object.assign(Error('Operation aborted.'), { name: 'AbortError' }));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? Object.assign(Error('Operation aborted.'), { name: 'AbortError' }));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function sessionHint(event) {
  const type = event?.type;
  const properties = event?.properties;
  if (typeof type !== 'string' || !properties || typeof properties !== 'object') return null;
  let id;
  if (type.startsWith('message.')) {
    id = properties.sessionID ?? properties.info?.sessionID ?? properties.part?.sessionID ?? properties.message?.sessionID;
  } else if (['session.updated', 'session.created', 'session.status', 'session.idle', 'session.compacted'].includes(type)) {
    id = properties.sessionID ?? properties.info?.id ?? properties.session?.id;
  } else return null;
  return typeof id === 'string' && idPattern.test(id) ? id : null;
}

// Native notifications are hints only. Each accepted identity is re-read from
// OpenCode and validated against the registered project before any local write.
export function createOpenCodeEventCoordinator({
  host,
  store,
  history,
  concurrency = 3,
  maxPending = 256,
  reconnectMs = 1000,
  projectRefreshMs = 30_000,
  reconciliationIntervalMs = 30 * 60_000,
  reconciliationPageSize = 50,
  reconciliationMaxPages = 8,
  reconciliationMaxSessions = 100,
  reconciliationMaxDurationMs = 20_000,
} = {}) {
  if (!host?.events || !store?.read || !history?.refreshSessionSnapshot || !history?.markWarehouseRefreshNeeded)
    throw Error('OpenCode event coordinator needs the native stream, project store, and snapshot reader.');
  const limit = Math.max(1, Math.min(8, Math.floor(concurrency) || 3));
  const queueLimit = Math.max(1, Math.min(1000, Math.floor(maxPending) || 256));
  reconciliationIntervalMs = Math.max(10, Math.min(24 * 60 * 60_000, Math.floor(Number(reconciliationIntervalMs) || 30 * 60_000)));
  reconciliationPageSize = Math.max(1, Math.min(500, Math.floor(Number(reconciliationPageSize) || 50)));
  reconciliationMaxPages = Math.max(1, Math.min(32, Math.floor(Number(reconciliationMaxPages) || 8)));
  reconciliationMaxSessions = Math.max(1, Math.min(500, Math.floor(Number(reconciliationMaxSessions) || 100)));
  reconciliationMaxDurationMs = Math.max(100, Math.min(120_000, Math.floor(Number(reconciliationMaxDurationMs) || 20_000)));
  const projects = new Map();
  const pending = new Map();
  const active = new Set();
  const activeKeys = new Set();
  const rerunAfterActive = new Map();
  const durableWrites = new Set();
  const projectDirtyWrites = new Map();
  const hintWrites = new Map();
  const maintenanceControllers = new Set();
  const backfillProjects = new Map();
  const shutdownController = new AbortController();
  let stopped = false;
  let started = false;
  let nextGeneration = 0;
  let projectTimer;
  let reconciliationTimer;
  let syncPromise;
  let startupPromise;
  let stopPromise;
  let recoveryPromise;
  let maintenancePromise;
  let nextReconciliationProject = 0;
  let recovered = false;
  let idleWaiters = [];
  const status = {
    subscribedProjects: 0,
    pendingSessions: 0,
    activeSnapshots: 0,
    snapshots: 0,
    failures: 0,
    unaddressableHints: 0,
    droppedHints: 0,
    lastEventAt: null,
    lastError: null,
  };

  const keyOf = (projectID, sessionID, generation) => `${projectID}\0${generation}\0${sessionID}`;
  const trackDurableWrite = promise => {
    let tracked;
    tracked = Promise.resolve(promise).finally(() => durableWrites.delete(tracked));
    durableWrites.add(tracked);
    return tracked;
  };
  function markProjectDirty(project, reason) {
    const key = `${project?.generation ?? 0}\0${project?.id ?? ''}\0${reason}`;
    if (projectDirtyWrites.has(key)) return projectDirtyWrites.get(key);
    const write = trackDurableWrite((async () => {
      try {
        return await history.markWarehouseRefreshNeeded({ projectID: project?.id ?? null, sessionID: null, reason,
          signal: shutdownController.signal });
      } catch {
        status.failures++;
        return null;
      }
    })()).finally(() => projectDirtyWrites.delete(key));
    projectDirtyWrites.set(key, write);
    return write;
  }
  function persistHint(project, sessionID, reason = 'event-hint') {
    const key = keyOf(project.id, sessionID, project.generation);
    const existing = hintWrites.get(key);
    if (existing) { existing.again = true; return existing.promise; }
    if (hintWrites.size >= queueLimit) {
      status.droppedHints++;
      void markProjectDirty(project, 'overflow');
      return Promise.resolve(null);
    }
    const state = { again: false, promise: null };
    state.promise = trackDurableWrite((async () => {
      let marker;
      do {
        state.again = false;
        try { marker = await history.markWarehouseRefreshNeeded({ projectID: project.id, sessionID, reason,
          signal: shutdownController.signal }); }
        catch { status.failures++; }
      } while (state.again && !stopped);
      enqueue(project, sessionID, marker);
      return marker;
    })()).finally(() => hintWrites.delete(key));
    hintWrites.set(key, state);
    return state.promise;
  }
  const notifyIdle = () => {
    status.pendingSessions = pending.size;
    status.activeSnapshots = active.size;
    if (!pending.size && !active.size) {
      for (const resolve of idleWaiters.splice(0)) resolve();
    }
  };
  const waitIdle = () => !pending.size && !active.size
    ? Promise.resolve()
    : new Promise(resolve => idleWaiters.push(resolve));

  function schedule() {
    while (!stopped && active.size < limit && pending.size) {
      const [key, task] = pending.entries().next().value;
      pending.delete(key);
      const current = projects.get(task.projectID);
      if (!current || current.generation !== task.generation || current.controller.signal.aborted || current.directory !== task.directory) continue;
      activeKeys.add(key);
      const work = Promise.resolve().then(() => history.refreshSessionSnapshot(task.projectID, task.sessionID, {
        signal: current.controller.signal,
      })).then(async result => {
        if (result?.captured) {
          status.snapshots++;
          if (task.refresh && result?.captured && (result.adequateCapture ?? (result.truncated !== true && result.projectionSafe !== false)))
            await history.clearWarehouseRefreshNeeded(task.refresh);
          else if (task.refresh) await history.failWarehouseRefreshNeeded({ ...task.refresh,
            error: 'The native source snapshot is partial; reconciliation must continue.', blocked: true });
        } else if (task.refresh) {
          await history.failWarehouseRefreshNeeded({ ...task.refresh,
            error: result?.reason || 'Native snapshot is not currently publishable.', blocked: true });
        }
      }).catch(async error => {
        if (!current.controller.signal.aborted) {
          status.failures++;
          status.lastError = 'Native snapshot refresh failed.';
          if (task.refresh) {
            const blocked = error?.status === 403 || error?.status === 404 || /belongs to another project|no longer registered|archiving or archived/i.test(String(error?.message ?? ''));
            try { await history.failWarehouseRefreshNeeded({ ...task.refresh, error, blocked }); } catch {}
          }
        }
      }).finally(() => {
        active.delete(work);
        activeKeys.delete(key);
        const rerun = rerunAfterActive.get(key);
        if (rerun) rerunAfterActive.delete(key);
        if (rerun && !stopped && !current.controller.signal.aborted) {
          if (pending.size < queueLimit || pending.has(key)) pending.set(key, rerun);
          else status.droppedHints++;
        }
        notifyIdle();
        schedule();
      });
      active.add(work);
      notifyIdle();
    }
    notifyIdle();
  }

  function enqueue(project, sessionID, refresh) {
    if (stopped || project.controller.signal.aborted) return;
    const key = keyOf(project.id, sessionID, project.generation);
    const task = { projectID: project.id, sessionID, directory: project.directory, generation: project.generation,
      ...(refresh?.id && Number.isSafeInteger(refresh.revision) ? { refresh: { id: refresh.id, revision: refresh.revision } } : {}) };
    if (pending.has(key)) { pending.set(key, task); return; }
    if (activeKeys.has(key)) { rerunAfterActive.set(key, task); return; }
    if (pending.size >= queueLimit) {
      status.droppedHints++;
      void markProjectDirty(project, 'overflow');
      return;
    }
    pending.set(key, task);
    schedule();
  }

  async function readStream(project) {
    const { signal } = project.controller;
    while (!stopped && !signal.aborted && projects.get(project.id) === project) {
      let reader;
      let streamReason = 'stream-ended';
      try {
        const body = await host.events(project.directory, signal);
        if (!body?.getReader) throw Error('OpenCode event stream has no readable body.');
        reader = body.getReader();
        const decoder = new TextDecoder();
        const invalidator = createEventInvalidator(events => {
          const affected = new Set();
          for (const event of events) {
            status.lastEventAt = new Date().toISOString();
            const sessionID = sessionHint(event);
            if (sessionID) affected.add(sessionID);
            else {
              status.unaddressableHints++;
              void markProjectDirty(project, 'unaddressable-hint');
            }
          }
          for (const sessionID of affected) void persistHint(project, sessionID);
        }, 256 * 1024);
        while (!stopped && !signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          invalidator(decoder.decode(value, { stream: true }));
        }
      } catch (error) {
        if (!stopped && !signal.aborted) {
          streamReason = 'stream-failed';
          status.failures++;
          status.lastError = 'Native event stream unavailable.';
        }
      } finally {
        try { await reader?.cancel(); } catch {}
        try { reader?.releaseLock(); } catch {}
      }
      if (!stopped && !signal.aborted && projects.get(project.id) === project) {
        void markProjectDirty(project, streamReason);
        try { await delay(reconnectMs, undefined, { signal }); }
        catch { /* Project removal or shutdown */ }
      }
    }
  }

  async function syncProjects() {
    if (stopped) return;
    if (syncPromise) return syncPromise;
    syncPromise = (async () => {
      const settings = await store.read('settings');
      if (stopped) return;
      const rows = Array.isArray(settings?.projects) ? settings.projects : [];
      const desired = new Map(rows.filter(row => typeof row?.id === 'string' && row.id && normalizeDirectory(row.directory))
        .map(row => [row.id, row]));
      for (const [id, old] of projects) {
        const next = desired.get(id);
        if (!next || normalizeDirectory(next.directory) !== old.directoryKey) {
          old.controller.abort();
          projects.delete(id);
          for (const [key, task] of pending) if (task.projectID === id) pending.delete(key);
          for (const key of rerunAfterActive.keys()) if (key.startsWith(`${id}\0`)) rerunAfterActive.delete(key);
        }
      }
      for (const [id, row] of desired) {
        if (projects.has(id)) continue;
        const project = { id, generation: ++nextGeneration, directory: row.directory, directoryKey: normalizeDirectory(row.directory),
          controller: new AbortController(), loop: null };
        projects.set(id, project);
        project.loop = readStream(project);
        void markProjectDirty(project, 'reconnect');
      }
      status.subscribedProjects = projects.size;
      notifyIdle();
    })().catch(() => {
      if (stopped) return;
      status.failures++;
      status.lastError = 'Registered project list unavailable.';
    }).finally(() => { syncPromise = null; });
    return syncPromise;
  }

  async function runMaintenance({ recovery = false } = {}) {
    if (stopped || maintenancePromise) return maintenancePromise;
    const controller = new AbortController();
    maintenanceControllers.add(controller);
    const signal = controller.signal;
    maintenancePromise = (async () => {
      if (typeof history.processWarehouseDerivationJobs === 'function') {
        try { await history.processWarehouseDerivationJobs({ limit: 50, signal }); }
        catch (error) { if (!signal.aborted) status.failures++; }
      }
      if (durableWrites.size) {
        try { await awaitSignal(Promise.allSettled([...durableWrites]), signal); }
        catch { if (!signal.aborted) status.failures++; }
      }
      if (typeof history.listWarehouseRefreshNeeded !== 'function') return;
      let markers;
      try {
        markers = await history.listWarehouseRefreshNeeded({ limit: 50, signal });
      } catch {
        if (!signal.aborted) status.failures++;
        return;
      }
      for (const marker of markers) {
        if (stopped || signal.aborted) break;
        if (!marker.projectID) {
          let registered = [];
          try { registered = (await awaitSignal(store.read('settings'), signal)).projects ?? []; } catch { registered = []; }
          if (signal.aborted) break;
          if (!registered.length) continue;
          let fannedOut = true;
          for (const row of registered) {
            if (typeof row?.id !== 'string' || !projects.has(row.id)) { fannedOut = false; continue; }
            try { await history.markWarehouseRefreshNeeded({ projectID: row.id, sessionID: null,
              reason: marker.reason || 'unaddressable-hint', signal }); }
            catch { fannedOut = false; }
          }
          if (fannedOut)
            await history.clearWarehouseRefreshNeeded({ id: marker.id, revision: marker.revision });
          continue;
        }
        const project = projects.get(marker.projectID);
        if (!project || project.controller.signal.aborted) {
          try { await history.failWarehouseRefreshNeeded({ id: marker.id, revision: marker.revision,
            error: 'The registered project scope is unavailable for reconciliation.', blocked: true }); }
          catch { status.failures++; }
          continue;
        }
        if (marker.sessionID) {
          try {
            const result = await history.refreshSessionSnapshot(marker.projectID, marker.sessionID, { signal });
            if (result?.captured && (result.adequateCapture ?? (result.truncated !== true && result.projectionSafe !== false)))
              await history.clearWarehouseRefreshNeeded({ id: marker.id, revision: marker.revision });
            else await history.failWarehouseRefreshNeeded({ id: marker.id, revision: marker.revision,
              error: result?.reason || 'Native snapshot is not currently publishable.', blocked: true });
          } catch (error) {
            if (signal.aborted) break;
            try { await history.failWarehouseRefreshNeeded({ id: marker.id, revision: marker.revision, error,
              blocked: error?.status === 403 || error?.status === 404 }); } catch { status.failures++; }
          }
          continue;
        }
        if (backfillProjects.has(project.id)) continue;
        const backfillController = new AbortController();
        maintenanceControllers.add(backfillController);
        const deadline = setTimeout(() => backfillController.abort(), reconciliationMaxDurationMs);
        deadline.unref?.();
        const backfillSignal = signal.aborted ? signal : AbortSignal.any([signal, backfillController.signal]);
        const backfill = Promise.resolve().then(() => history.backfillOpenCode({ projectID: project.id, resume: true,
          pageSize: reconciliationPageSize, maxPages: reconciliationMaxPages,
          maxSessions: reconciliationMaxSessions, maxDurationMs: reconciliationMaxDurationMs, signal: backfillSignal }));
        backfillProjects.set(project.id, backfill);
        try {
          const result = await backfill;
          const complete = Array.isArray(result?.results) && result.results.length > 0 &&
            result.results.every(row => row.status === 'complete');
          if (complete) await history.clearWarehouseRefreshNeeded({ id: marker.id, revision: marker.revision });
          else await history.failWarehouseRefreshNeeded({ id: marker.id, revision: marker.revision,
            error: 'Bounded project reconciliation remains incomplete.', blocked: false });
        } catch (error) {
          if (signal.aborted) break;
          try { await history.failWarehouseRefreshNeeded({ id: marker.id, revision: marker.revision, error }); }
          catch { status.failures++; }
        } finally { clearTimeout(deadline); maintenanceControllers.delete(backfillController); backfillProjects.delete(project.id); }
      }
    })().finally(() => {
      maintenanceControllers.delete(controller);
      maintenancePromise = null;
    });
    return maintenancePromise;
  }

  function scheduleReconciliation() {
    if (stopped || !started || reconciliationTimer) return;
    reconciliationTimer = setTimeout(() => {
      reconciliationTimer = null;
      void (async () => {
        await syncProjects();
        if (!stopped && !recovered) {
          recovered = true;
          await runMaintenance({ recovery: true });
        } else if (!stopped) {
          const registered = [...projects.values()];
          if (registered.length) {
            const index = nextReconciliationProject++ % registered.length;
            const project = registered[index];
            if (!backfillProjects.has(project.id)) {
              const controller = new AbortController();
              maintenanceControllers.add(controller);
              const deadline = setTimeout(() => controller.abort(), reconciliationMaxDurationMs);
              deadline.unref?.();
              const work = history.backfillOpenCode({ projectID: project.id, resume: true,
                pageSize: reconciliationPageSize, maxPages: reconciliationMaxPages,
                maxSessions: reconciliationMaxSessions, maxDurationMs: reconciliationMaxDurationMs, signal: controller.signal });
              backfillProjects.set(project.id, work);
              try { await work; } catch { if (!controller.signal.aborted) status.failures++; }
              finally { clearTimeout(deadline); backfillProjects.delete(project.id); maintenanceControllers.delete(controller); }
            }
            await runMaintenance();
          }
        }
      })().catch(() => { if (!stopped) status.failures++; }).finally(() => {
        if (!stopped) {
          reconciliationTimer = null;
          scheduleReconciliation();
        }
      });
    }, reconciliationIntervalMs);
    reconciliationTimer.unref?.();
  }

  return {
    status,
    async refreshProjects() { await syncProjects(); },
    async flush() {
      while (true) {
        await waitIdle();
        const draining = [...durableWrites, ...active, ...(maintenancePromise ? [maintenancePromise] : []), ...(startupPromise ? [startupPromise] : [])];
        if (draining.length) await Promise.allSettled(draining);
        if (!pending.size && !active.size && !durableWrites.size && !maintenancePromise) return;
      }
    },
    start() {
      if (started || stopped) return;
      started = true;
      startupPromise = syncProjects().then(async () => {
        await runMaintenance({ recovery: true });
        if (!stopped) await runMaintenance({ recovery: true });
        recovered = true;
      }).catch(() => { if (!stopped) status.failures++; });
      projectTimer = setInterval(() => void syncProjects(), projectRefreshMs);
      projectTimer.unref?.();
      scheduleReconciliation();
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopped = true;
      shutdownController.abort();
      clearInterval(projectTimer);
      clearTimeout(reconciliationTimer);
      for (const controller of maintenanceControllers) controller.abort();
      for (const project of projects.values()) project.controller.abort();
      pending.clear();
      rerunAfterActive.clear();
      const loops = [...projects.values()].map(project => project.loop).filter(Boolean);
      projects.clear();
      const syncing = syncPromise;
      stopPromise = (async () => {
        await Promise.allSettled([...loops, ...active, ...(syncing ? [syncing] : []),
          ...(maintenancePromise ? [maintenancePromise] : []), ...(startupPromise ? [startupPromise] : []),
          ...backfillProjects.values(), ...durableWrites]);
        notifyIdle();
        status.subscribedProjects = 0;
      })();
      return stopPromise;
    },
  };
}
