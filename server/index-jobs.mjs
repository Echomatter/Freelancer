import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createLocalDataService } from './data/store.mjs';

const labels = { files: 'Refreshing file indexes', chats: 'Refreshing conversation indexes',
  prepare: 'Preparing project indexes', archive: 'Indexing project before putting it away',
  optimize: 'Optimizing SQLite search', check: 'Checking SQLite integrity', compact: 'Compacting SQLite database', reset: 'Resetting local search indexes' };
export function createIndexJobs({ app, backendRoot, dataRoot,
  localData }) {
  const ownsLocalData = !localData;
  const dataService = localData ?? (backendRoot || dataRoot
    ? createLocalDataService(dataRoot ?? path.join(backendRoot, '.state', 'local-data'))
    : null);
  let job = null, controller, work;
  const withData = fn => {
    if (!dataService) throw Error('Local index state requires a data directory.');
    return fn(dataService.get());
  };
  async function execute(current) {
    const signal = controller.signal;
    const onProgress = label => { if (!signal.aborted) job = { ...job, label }; };
    try {
      let results = [];
      const options = { projectID: current.project || undefined, includeArchivedProject: current.kind === 'archive', signal, onProgress };
      if (current.kind === 'files' || current.kind === 'prepare' || current.kind === 'archive') {
        job = { ...job, step: 'files' };
        results.push(await app.rebuildContentIndex(options));
      }
      signal.throwIfAborted();
      if (current.kind === 'chats' || current.kind === 'prepare' || current.kind === 'archive') {
        job = { ...job, step: 'chats' };
        results.push(await app.history.rebuildChatSearch(options));
      }
      signal.throwIfAborted();
      if (['optimize', 'check', 'compact', 'reset'].includes(current.kind)) {
        const result = await app.history.maintainIndex(current.kind);
        if (result.healthy === false) throw Error(`SQLite reported: ${result.findings.join('; ')}`);
        job = { ...job, status: 'completed', label: result.message ?? 'SQLite quick check passed.' };
        return;
      }
      const failures = results.flatMap(result => result.failures ?? []);
      // A source-level extraction gap is an indexed, searchable fact about
      // that file: the rest of the published index remains usable. Only an
      // operation-level failure leaves a job partial and offers Retry.
      const skipped = failures.filter(failure => failure.source);
      const operational = failures.filter(failure => !failure.source);
      if (['prepare', 'archive'].includes(current.kind) && operational.length === 0)
        withData(db => db.markProjectIndexesReady(current.project));
      const sources = results.reduce((sum, result) => sum + (result.sources ?? 0), 0);
      const conversations = results.reduce((sum, result) => sum + (result.conversations ?? 0), 0);
      const counts = current.kind === 'files' ? `${sources} files indexed` : current.kind === 'chats'
        ? `${conversations} conversations indexed` : `${sources} files and ${conversations} conversations indexed`;
      job = { ...job, status: operational.length ? 'partial' : 'completed', failures,
        skipped: skipped.length,
        label: `${counts}${operational.length ? ` · ${operational.length} operation ${operational.length === 1 ? 'failed' : 'failures'}` : skipped.length ? ` · ${skipped.length} file${skipped.length === 1 ? '' : 's'} skipped` : ' · Done'}` };
    } catch (error) {
      job = { ...job, status: signal.aborted ? 'stopped' : 'failed',
        label: signal.aborted ? `${labels[current.kind]} stopped. Completed indexes were kept.` : error.message };
    }
  }
  const archiveLocks = new Set();
  return {
    status: () => job,
    isArchiving: projectID => projectID ? archiveLocks.has(projectID) : archiveLocks.size > 0,
    async start(kind, projectID = '', retryID = '', internal = false) {
      if (!Object.hasOwn(labels, kind)) throw Error('Choose an index or SQLite operation.');
      if (kind === 'archive' && !internal) throw Error('Project indexing before archive is part of the Put project away action.');
      if (archiveLocks.size && !(kind === 'archive' && internal && archiveLocks.has(projectID)))
        throw Object.assign(Error('A project is being put away. Wait for its final index to finish.'), { status: 409 });
      if (projectID) await app.project(projectID);
      if (kind === 'prepare' && !projectID) throw Error('Choose a project to prepare.');
      if (kind === 'archive' && !projectID) throw Error('Choose a project to put away.');
      if (projectID && app.history?.isProjectArchived && await app.history.isProjectArchived(projectID))
        throw Error('Restore this project before refreshing its search indexes.');
      if (job?.status === 'running') {
        if (job.kind === kind && job.project === projectID) return job;
        throw Object.assign(Error('Another index or SQLite job is running. Let it finish or stop it first.'), { status: 409 });
      }
      if (retryID && (job?.id !== retryID || job.kind !== kind || job.project !== projectID))
        throw Error('This job changed. Refresh before retrying.');
      if (!retryID && kind === 'prepare' && withData(db => db.projectIndexesReady(projectID))) return null;
      controller = new AbortController();
      job = { id: randomUUID(), kind, project: projectID, status: 'running', label: labels[kind] + '…',
        step: kind === 'prepare' || kind === 'archive' ? 'files' : kind, stoppable: ['files', 'chats', 'prepare', 'archive'].includes(kind), createdAt: Date.now() };
      const current = job;
      // Send the initial status before potentially synchronous SQLite work.
      work = new Promise(resolve => setImmediate(resolve)).then(() => execute(current));
      return current;
    },
    async archiveProject(projectID, revision, commit) {
      if (!Number.isInteger(revision) || typeof commit !== 'function')
        throw Error('Refresh project details before putting this project away.');
      if (archiveLocks.has(projectID)) throw Object.assign(Error('This project is already being put away.'), { status: 409 });
      archiveLocks.add(projectID);
      try {
        await app.project(projectID);
        if (app.history?.isProjectArchived && await app.history.isProjectArchived(projectID))
          throw Error('This project is already put away. Refresh its details before retrying.');
        if (app.history?.projectArchiveRevision && revision !== await app.history.projectArchiveRevision(projectID))
          throw Error('Project organization changed. Refresh before putting it away.');
        const started = await this.start('archive', projectID, '', true);
        await work;
        if (job?.id !== started.id || job.status !== 'completed')
          throw Error(job?.label || 'Final project indexing did not complete. The project remains active.');
        return await commit();
      } finally { archiveLocks.delete(projectID); }
    },
    stop(id) {
      if (job?.id !== id || job.status !== 'running' || !job.stoppable) throw Error('This job cannot be stopped.');
      controller.abort();
      job = { ...job, label: 'Stopping after the current operation…', stoppable: false };
      return job;
    },
    dismiss(id) {
      if (job?.id !== id) return job;
      if (job.status === 'running') throw Error('The job is still running.');
      job = null;
      return null;
    },
    async close() {
      controller?.abort();
      await work;
      if (ownsLocalData) dataService?.close();
    },
  };
}
