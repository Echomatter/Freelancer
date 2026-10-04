import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createLocalDataService } from './data/store.mjs';
import { createIndexJobState } from './data/index-job-state.mjs';

const runID = randomUUID();

function publicDiagnostic(value) {
  const text=String(value??'');
  if(text.length<=2000)return text;
  // Old execFile receipts may contain megabytes of ordinary per-file progress.
  // Preserve the durable receipt, but keep it out of polling/UI responses.
  if(text.startsWith('Content index rebuild failed:') && /\[\d+\/\d+\]/.test(text))
    return 'Content indexing stopped while processing an oversized file inventory. Generated and dependency folders are now excluded; refresh the project file index to try again.';
  return `${text.slice(0,1900)} … [diagnostic shortened]`;
}
function publicJob(value) {
  if(!value)return null;
  const failures=rows=>(rows??[]).slice(0,128).map(row=>({...row,error:publicDiagnostic(row.error)}));
  return {...value,label:publicDiagnostic(value.label),
    ...(value.failure?{failure:{...value.failure,message:publicDiagnostic(value.failure.message)}}:{}),
    ...(value.failures?{failures:failures(value.failures),failuresOmitted:(value.failureDiagnosticsOmitted??0)+Math.max(0,value.failures.length-128)}:{}),
    ...(value.checkpoints?{checkpoints:value.checkpoints.map(checkpoint=>({...checkpoint,
      ...(checkpoint.result?{result:{...checkpoint.result,failures:failures(checkpoint.result.failures),
        failuresOmitted:(checkpoint.result.failureDiagnosticsOmitted??0)+Math.max(0,(checkpoint.result.failures??[]).length-128)}}:{})}))}:{})};
}

const labels = { files: 'Refreshing file indexes', chats: 'Refreshing conversation indexes',
  prepare: 'Preparing project indexes', archive: 'Indexing project before putting it away',
  optimize: 'Optimizing SQLite search', check: 'Checking SQLite integrity', compact: 'Compacting SQLite database', reset: 'Resetting local search indexes' };
export function createIndexJobs({ app, backendRoot, dataRoot,
  localData }) {
  const ownsLocalData = !localData;
  const dataService = localData ?? (backendRoot || dataRoot
    ? createLocalDataService(dataRoot ?? path.join(backendRoot, '.state', 'local-data'))
    : null);
  let job = null, controller, work, state, loaded = false;
  const withData = fn => {
    if (!dataService) throw Error('Local index state requires a data directory.');
    return fn(dataService.get());
  };
  const publish = next => {
    const value = next ? { ...next, updatedAt:Date.now() } : null;
    const saved = state ? state.save(value,job) : value;
    job = saved;
    return job;
  };
  function load() {
    if (loaded) return;
    if (dataService) {
      const filename = withData(db=>db.filename);
      const configured = process.env.FREELANCER_DATA_HOME && path.resolve(path.dirname(filename)) === path.resolve(process.env.FREELANCER_DATA_HOME);
      const runtimeID = configured && process.env.FREELANCER_RUNTIME_ID || 'standalone-index-jobs';
      state = createIndexJobState(filename,runtimeID);
      job = state.read();
      if (job?.status === 'running' && job.ownerRunID !== runID) {
        publish({ ...job, status:'partial', interrupted:true, stoppable:false, finishedAt:Date.now(),
          label:`${labels[job.kind] ?? 'Index job'} was interrupted by a server restart. Completed indexes were kept. Retry explicitly to continue.` });
      }
    }
    loaded = true;
  }
  async function execute(current) {
    const signal = controller.signal;
    const onProgress = label => { if (!signal.aborted) publish({ ...job, label:String(label).slice(0,2000) }); };
    try {
      const checkpoints = [...(current.checkpoints ?? [])];
      const results = checkpoints.filter(item=>item.complete).map(item=>item.result);
      const completed = step=>checkpoints.some(item=>item.step===step && item.complete);
      const recordStep = (step,result) => {
        const retained = {sources:result.sources ?? 0,conversations:result.conversations ?? 0,failures:result.failures ?? [],
          ...(Number.isSafeInteger(result.skippedFiles) && result.skippedFiles>=0?{skippedFiles:result.skippedFiles}:{}),
          ...(Number.isSafeInteger(result.failedProjects) && result.failedProjects>=0?{failedProjects:result.failedProjects}:{}),
          ...(Number.isSafeInteger(result.failureDiagnosticsOmitted) && result.failureDiagnosticsOmitted>=0?{failureDiagnosticsOmitted:result.failureDiagnosticsOmitted}:{})};
        checkpoints.push({step,complete:!(retained.failedProjects>0)&&!retained.failures.some(failure=>!failure.source),completedAt:Date.now(),result:retained});
        results.push(retained);
        publish({...job,checkpoints:[...checkpoints]});
      };
      const options = { projectID: current.project || undefined, includeArchivedProject: current.kind === 'archive', signal, onProgress };
      if (['files','prepare','archive'].includes(current.kind) && !completed('files')) {
        publish({ ...job, step:'files' });
        recordStep('files',await app.rebuildContentIndex(options));
      }
      signal.throwIfAborted();
      if (['chats','prepare','archive'].includes(current.kind) && !completed('chats')) {
        publish({ ...job, step:'chats' });
        recordStep('chats',await app.history.rebuildChatSearch(options));
      }
      signal.throwIfAborted();
      if (['optimize', 'check', 'compact', 'reset'].includes(current.kind)) {
        const result = await app.history.maintainIndex(current.kind);
        if (result.healthy === false) throw Error(`SQLite reported: ${result.findings.join('; ')}`);
        publish({ ...job, status:'completed', finishedAt:Date.now(), label:result.message ?? 'SQLite quick check passed.' });
        return;
      }
      const failures = results.flatMap(result => result.failures ?? []);
      // A source-level extraction gap is an indexed, searchable fact about
      // that file: the rest of the published index remains usable. Only an
      // operation-level failure leaves a job partial and offers Retry.
      const skippedFiles=results.reduce((sum,result)=>sum+(result.skippedFiles ?? new Set((result.failures??[]).filter(failure=>failure.source).map(failure=>failure.source)).size),0);
      const operationalCount=results.reduce((sum,result)=>sum+(result.failedProjects ?? (result.failures??[]).filter(failure=>!failure.source).length),0);
      const failureDiagnosticsOmitted=results.reduce((sum,result)=>sum+(result.failureDiagnosticsOmitted??0),0);
      if (['prepare', 'archive'].includes(current.kind) && operationalCount === 0)
        withData(db => db.markProjectIndexesReady(current.project));
      const sources = results.reduce((sum, result) => sum + (result.sources ?? 0), 0);
      const conversations = results.reduce((sum, result) => sum + (result.conversations ?? 0), 0);
      const counts = current.kind === 'files' ? `${sources} files indexed` : current.kind === 'chats'
        ? `${conversations} conversations indexed` : `${sources} files and ${conversations} conversations indexed`;
      publish({ ...job, status: operationalCount ? 'partial' : 'completed', failures, finishedAt:Date.now(),
        skipped: skippedFiles,failureDiagnosticsOmitted,
        label: `${counts}${operationalCount ? ` · ${operationalCount} operation ${operationalCount === 1 ? 'failed' : 'failures'}` : skippedFiles ? ` · ${skippedFiles} file${skippedFiles === 1 ? '' : 's'} skipped` : ' · Done'}` });
    } catch (error) {
      const failed = { ...job, status:signal.aborted ? 'stopped' : 'failed', finishedAt:Date.now(),
        failure:{message:String(error.message),step:job?.step},
        label:signal.aborted ? `${labels[current.kind]} stopped. Completed indexes were kept.` : error.message };
      try { publish(failed); }
      catch (stateError) { job = {...failed,status:'failed',label:'Index job state could not be saved. Completed indexes were kept.',persistenceError:stateError.message}; }
    }
  }
  const archiveLocks = new Set();
  return {
    status: () => {load();return publicJob(job);},
    isArchiving: projectID => projectID ? archiveLocks.has(projectID) : archiveLocks.size > 0,
    async start(kind, projectID = '', retryID = '', internal = false) {
      load();
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
        if (job.kind === kind && job.project === projectID) return publicJob(job);
        throw Object.assign(Error('Another index or SQLite job is running. Let it finish or stop it first.'), { status: 409 });
      }
      if (retryID && (job?.id !== retryID || job.kind !== kind || job.project !== projectID))
        throw Error('This job changed. Refresh before retrying.');
      if (!retryID && kind === 'prepare' && withData(db => db.projectIndexesReady(projectID))) return null;
      controller = new AbortController();
      const resume = retryID && ['partial','stopped','failed'].includes(job?.status);
      publish({ id:randomUUID(), kind, project:projectID, status:'running', label:labels[kind]+'…',
        step:kind === 'prepare' || kind === 'archive' ? 'files' : kind, stoppable:['files','chats','prepare','archive'].includes(kind),
        checkpoints:resume ? (job.checkpoints ?? []).filter(item=>item.complete) : [], retryOf:retryID || null,
        createdAt:Date.now(), ownerRunID:runID });
      const current = job;
      // Send the initial status before potentially synchronous SQLite work.
      work = new Promise(resolve => setImmediate(resolve)).then(() => execute(current));
      return publicJob(current);
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
      load();
      if (job?.id !== id || job.status !== 'running' || !job.stoppable || !controller) throw Error('This job cannot be stopped.');
      controller.abort();
      publish({ ...job, label:'Stopping after the current operation…', stoppable:false });
      return publicJob(job);
    },
    dismiss(id) {
      load();
      if (job?.id !== id) return publicJob(job);
      if (job.status === 'running') throw Error('The job is still running.');
      publish(null);
      return null;
    },
    async close() {
      controller?.abort();
      await work;
      if (ownsLocalData) dataService?.close();
    },
  };
}
