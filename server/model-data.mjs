import { randomUUID } from 'node:crypto';
import { fetchModelDataSource, ModelDataSourceError } from './model-data-sources.mjs';
import { matchModelDataIdentity, scopeModelDataSnapshot, withModelDataCanonicalIdentities } from '../domain/model-data.mjs';
import { createModelDataVault } from './model-data-secrets.mjs';
import { runModelDataWorker } from './model-data-worker-client.mjs';
import { summarizeNativeModelSources,MODEL_CARD_DEPLOYMENT_KEYS,MODEL_CARD_RATING_KEYS } from '../domain/model-card-summary.mjs';
import { modelObservationSchema, toModelObservationRecord,compactModelDataSource,compactModelDataStatus,
  modelObservationAttributeFilter,MODEL_CATALOG_AGENT_RESPONSE_BYTES } from '../domain/model-data-unified.mjs';

export const modelDataSources = Object.freeze([
  { id: 'modelsdev', name: 'Models.dev', url: 'https://models.dev', attribution: 'Model specifications and published pricing: Models.dev.' },
  { id: 'artificial-analysis', name: 'Artificial Analysis', url: 'https://artificialanalysis.ai', attribution: 'Independent evaluations and performance data: Artificial Analysis. Free API data is for internal use only.' },
]);
const active = job => job && ['running', 'cancelling'].includes(job.status);
const failure = (message, status = 400) => Object.assign(Error(message), { status });
const sourceIDs = new Set(modelDataSources.map(row => row.id));
const safeFailure = error => error instanceof ModelDataSourceError
  ? error.message + ' Stored data was preserved.'
  : error?.code === 'MODEL_DATA_QUOTA' ? 'Artificial Analysis free request limit reached. Stored data was preserved.'
  : error?.code === 'MODEL_DATA_WORKER_TIMEOUT' ? 'The source update exceeded its deadline. Stored data was preserved.'
  : error?.code === 'MODEL_DATA_WORKER_SUPERSEDED' ? 'A newer refresh owns this source. This older update was not published.'
  : error?.code === 'MODEL_DATA_IDENTITY_CONTEXT' ? 'Models.dev identity data could not update. Artificial Analysis data was preserved; retry both sources.'
  : 'The source update failed. Stored data was preserved.';

export function createModelDataService({ localData, fetchSource = fetchModelDataSource,
  vault = createModelDataVault(), env = process.env, now = Date.now, canRun = () => true,
  workerRunner = runModelDataWorker } = {}) {
  let closed = false, work = null, nativeModels = null, recovered = false, savingKey = false, cleanup = null, cleanupError = null;
  let nativeRevision = 0, identityCache = null;
  const data = () => {
    const store = localData.get();
    if (!recovered) {
      // Recovery writes durable status only; never replays a request or fetches a source.
      let retainedJobs = store.modelDataActiveJobs?.().jobs ?? [store.modelDataStatus().job].filter(active);
      while (retainedJobs.length) {
        for (const retained of retainedJobs) {
          const sources = store.modelDataStatus().sources;
          const results = (retained.sources ?? []).map(source => {
            const row = sources.find(item => (item.id ?? item.source) === source);
            const prior = retained.results?.find(item => item.source === source);
            if (row?.currentJobID === retained.id && ['complete', 'completed'].includes(row.state))
              return { source, status: 'completed', recordCount: row.recordCount, snapshotID: row.currentSnapshotID };
            if (row?.currentJobID === retained.id) store.saveModelDataSourceStatus(source,
              { state: 'interrupted', error: 'The previous refresh was interrupted. Request another update explicitly.' }, retained.id);
            return prior && ['complete', 'completed', 'failed', 'needs-key'].includes(prior.status) ? prior
              : { source, status: 'interrupted', error: 'The previous refresh was interrupted.' };
          });
          store.finishModelDataRefresh(retained.id, { status: 'interrupted', results,
            summary: 'Previous model-data refresh interrupted. Published sources were retained; unfinished sources were preserved.', error: null });
        }
        retainedJobs = store.modelDataActiveJobs?.().jobs ?? [];
      }
      recovered = true;
      const orphans = store.modelDataStagingJobs?.().jobs ?? [];
      if (orphans.length) {
        cleanup = (async () => {
          let batch = orphans;
          while (batch.length) {
            for (const orphan of batch) await store.modelDataCleanupStaging(orphan.jobID);
            batch = store.modelDataStagingJobs().jobs;
          }
        })().catch(() => { cleanupError = 'Interrupted staging could not be cleared. Stored data is preserved; inspect local storage before another update.'; })
          .finally(() => { cleanup = null; });
      }
    }
    return store;
  };
  const environmentKey = () => String(env.ARTIFICIAL_ANALYSIS_API_KEY || '').trim();
  const hasKey = () => !!environmentKey() || !!data().modelDataSecret('artificial-analysis');
  function sources() {
    const stored = data().modelDataStatus().sources ?? [];
    return modelDataSources.map(source => {
      const row = stored.find(item => (item.id ?? item.source) === source.id) ?? {};
      return { ...source, ...row, id: source.id, configured: source.id === 'modelsdev' || hasKey(),
        state: row.state ?? row.status ?? 'never-refreshed' };
    });
  }
  function status() { return { ...data().modelDataStatus(), sources: sources(),
    maintenance: { state: cleanup ? 'cleaning' : cleanupError ? 'failed' : 'ready', error: cleanupError } }; }
  // Let application bootstrap report unavailable local storage through its recovery UI.
  try { data(); } catch {}
  function canonicalModels(rows) {
    const records = []; let cursor;
    do {
      const page = data().modelDataList({ source: 'modelsdev', limit: 100, ...(cursor ? { cursor } : {}) });
      records.push(...page.records); cursor = page.nextCursor;
      if (records.length > 20_000) throw failure('Stored source identity context exceeds its limit.', 409);
    } while (cursor);
    return withModelDataCanonicalIdentities(rows, records);
  }
  function identityModels() {
    const snapshotID = data().modelDataStatus().sources.find(row => (row.id ?? row.source) === 'modelsdev')?.currentSnapshotID;
    if (!identityCache || identityCache.revision !== nativeRevision || identityCache.snapshotID !== snapshotID)
      identityCache = { revision: nativeRevision, snapshotID, models: canonicalModels(nativeModels ?? []) };
    return identityCache.models;
  }
  const identity = record => {
    const matched = matchModelDataIdentity(record, identityModels());
    const source = record.identifiers?.source ?? (record.id?.startsWith('modelsdev:') ? 'modelsdev' : 'artificial-analysis');
    const stored = source === 'modelsdev' && record.kind === 'model'
      ? data().modelDataStatus().sources.find(row => (row.id ?? row.source) === source) : null;
    const links = stored && (!record.snapshotID || stored.currentSnapshotID === record.snapshotID)
      ? stored.current?.metadata?.sourceMetadata?.scope?.canonicalLinks : null;
    const configured = new Set((nativeModels ?? []).map(row => row.id));
    const linkedIDs = Array.isArray(links) ? links.filter(row => row.recordID === record.id &&
      row.canonicalModelID === record.modelID && Array.isArray(row.nativeModelIDs))
      .flatMap(row => row.nativeModelIDs).filter(id => configured.has(id)) : [];
    const candidateIDs = [...new Set([...(matched.candidateIDs ?? []), ...linkedIDs])].sort();
    return { ...matched, candidateIDs, nativeIDs: candidateIDs,
      status: candidateIDs.length > 1 ? 'ambiguous' : matched.status !== 'unmatched' ? matched.status : candidateIDs.length ? 'alias' : 'unmatched',
      method: linkedIDs.length && !matched.candidateIDs.length ? 'source-declared-canonical-model' : matched.method };
  };
  const decorate = record => ({ ...record, identityMatch: identity(record) });
  const ownsSource = (source, id) => data().modelDataStatus().sources
    .some(row => (row.id ?? row.source) === source && row.currentJobID === id);
  const decorateDetail = detail => ({ ...detail, record: decorate(detail.record),
    facts: detail.facts.map(fact => ({ ...fact, identityMatch: identity(detail.record) })),
    missingness: detail.record.missingness ?? [], identityMatch: identity(detail.record) });
  function saveQuota(source, quota, id, retryAfterMs = null) {
    if (!quota) return;
    const prior = data().modelDataStatus().sources.find(row => (row.id ?? row.source) === source)?.quota ?? {};
    const retryAt = quota.remaining === 0 ? quota.resetAt ?? (retryAfterMs ? now() + retryAfterMs : null) : null;
    data().saveModelDataSourceStatus(source, { quota: { ...prior, ...quota }, retryAt }, id);
  }
  async function run(current) {
    let index = 0;
    try {
      while (index < current.sources.length) {
        const source = current.sources[index++];
        current.controller.signal.throwIfAborted();
        data().saveModelDataSourceStatus(source, { state: 'updating', lastAttemptAt: now(), error: null }, current.id);
        try {
          if (source === 'artificial-analysis' && current.requiresModelsdev &&
            !current.results.some(row => row.source === 'modelsdev' && row.status === 'completed'))
            throw Object.assign(Error('Required source identity context is unavailable.'), { code: 'MODEL_DATA_IDENTITY_CONTEXT' });
          let apiKey;
          if (source === 'artificial-analysis') {
            apiKey = environmentKey();
            if (!apiKey) {
              const encrypted = data().modelDataSecret(source);
              if (encrypted) apiKey = await vault.open(encrypted);
            }
            if (!apiKey) {
              current.results.push({ source, status: 'needs-key', error: 'Add an Artificial Analysis key in Application settings → Capabilities → Model data sources on the server computer.' });
              data().saveModelDataSourceStatus(source, { state: 'needs-key', error: 'Artificial Analysis key is not configured.' }, current.id);
              continue;
            }
          }
          const onRequest = async () => {
              current.controller.signal.throwIfAborted();
              if (source !== 'artificial-analysis') return;
              const row = data().modelDataStatus().sources.find(item => (item.id ?? item.source) === source);
              if (row?.quota?.remaining === 0 && row.quota.resetAt > now())
                throw Object.assign(Error('Artificial Analysis shared quota reached.'), { code: 'MODEL_DATA_QUOTA' });
              const requestTimes = (row?.quota?.requestTimes ?? []).filter(time => Number.isFinite(time) && time > now() - 86400000);
              if (requestTimes.length >= 100) throw Object.assign(Error('Artificial Analysis daily quota reached.'), {
                code: 'MODEL_DATA_QUOTA', publicMessage: 'Artificial Analysis free request limit reached. Stored data was preserved.' });
              requestTimes.push(now());
              data().saveModelDataSourceStatus(source, { quota: { ...row?.quota, requestTimes } }, current.id);
          };
          const sourceNativeModels = source === 'artificial-analysis' ? canonicalModels(current.nativeModels) : current.nativeModels;
          if (fetchSource === fetchModelDataSource && typeof data().filename === 'string') {
            const releaseCheckpointLease = data().beginModelDataBackgroundWrite?.();
            let receipt;
            try {
              receipt = await workerRunner({ filename: data().filename, source, apiKey, jobID: current.id, nativeModels: sourceNativeModels,
              signal: current.controller.signal, onRequest,
              onQuota: quota => saveQuota(source, quota, current.id),
              onProgress: progress => {
                current.controller.signal.throwIfAborted();
                const name = modelDataSources.find(row => row.id === source).name;
                const summary = progress.stage === 'fetching' ? 'Downloading ' + name + ' data.'
                  : progress.stage === 'normalized' ? 'Validated ' + name + ' source data: ' + progress.recordCount + ' records.'
                  : progress.stage === 'publishing-preparation' ? 'Preparing ' + name + ' data for storage.'
                  : 'Saving ' + name + ' data: ' + progress.processedOperations + ' of ' + progress.totalOperations + ' rows.';
                data().finishModelDataRefresh(current.id, { status: 'running', results: current.results,
                  summary });
              } });
            } catch (error) {
              if (error?.whenExited && typeof error.whenExited.then === 'function') {
                data().finishModelDataRefresh(current.id, { status: 'cancelling',
                  summary: 'Waiting for the model-data worker to stop. Its outcome is not yet confirmed.' });
                await error.whenExited;
              }
              throw error;
            } finally { releaseCheckpointLease?.(); }
            current.results.push({ source, status: 'completed', recordCount: receipt.recordCount,
              receivedRecordCount: receipt.receivedRecordCount, matchedNativeModelCount: receipt.matchedNativeModelCount,
              snapshotID: receipt.snapshotID, unchanged: receipt.unchanged === true });
          } else {
            const received = await fetchSource(source, { apiKey, signal: current.controller.signal, now, onRequest });
            current.controller.signal.throwIfAborted();
            const snapshot = scopeModelDataSnapshot(received, sourceNativeModels);
            saveQuota(source, snapshot.quota, current.id);
            const published = data().publishModelDataSource(snapshot, { jobID: current.id });
            current.results.push({ source, status: 'completed', recordCount: snapshot.records.length,
              receivedRecordCount: snapshot.sourceMetadata?.scope?.receivedRecordCount,
              matchedNativeModelCount: snapshot.sourceMetadata?.scope?.matchedNativeModelCount,
              snapshotID: published?.snapshotID, unchanged: published?.unchanged === true });
          }
        } catch (error) {
          if (current.controller.signal.aborted) throw error;
          if (error instanceof ModelDataSourceError) saveQuota(source, error.quota, current.id, error.retryAfterMs);
          const message = safeFailure(error);
          current.results.push({ source, status: 'failed', error: message });
          if (ownsSource(source, current.id)) data().saveModelDataSourceStatus(source, { state: 'failed', error: message }, current.id);
        }
        data().finishModelDataRefresh(current.id, { status: 'running', results: current.results,
          summary: 'Updated ' + current.results.filter(row => row.status === 'completed').length + ' of ' + current.sources.length + ' model-data sources.' });
      }
      const successful = current.results.filter(row => row.status === 'completed').length;
      data().finishModelDataRefresh(current.id, { status: successful === current.sources.length ? 'completed' : successful ? 'partial' : 'failed',
        results: current.results, summary: successful + ' of ' + current.sources.length + ' model-data sources updated.',
        error: successful === current.sources.length ? null : 'Some sources could not update. Their stored data was preserved.' });
    } catch {
      const outcome = closed ? 'interrupted' : current.controller.signal.aborted ? 'cancelled' : 'failed';
      for (const source of current.sources.filter(id => !current.results.some(row => row.source === id))) {
        const retained = data().modelDataStatus().sources.find(row => (row.id ?? row.source) === source);
        // Publication may have committed just before cancellation reached the
        // worker. Reconcile that durable outcome after the worker really exits.
        if (retained?.currentJobID === current.id && ['complete','completed'].includes(retained.state))
          current.results.push({ source, status: 'completed', recordCount: retained.recordCount, snapshotID: retained.currentSnapshotID });
        else if (ownsSource(source, current.id)) data().saveModelDataSourceStatus(source, { state: outcome, error: null }, current.id);
      }
      data().finishModelDataRefresh(current.id, { status: outcome, results: current.results,
        summary: 'Model-data refresh ' + outcome + '. Published sources were retained; unfinished sources were preserved.',
        error: outcome === 'failed' ? 'The refresh could not finish. Stored source data was preserved.' : null });
    } finally {
      try {
        cleanup = Promise.resolve(data().modelDataCleanupStaging?.(current.id));
        await cleanup;
      }
      catch { cleanupError = 'Incomplete staging could not be cleared. Stored data is preserved; inspect local storage before another update.'; }
      finally { cleanup = null; if (work === current) work = null; }
    }
  }
  return {
    status,
    setNativeModels(rows) {
      if (!Array.isArray(rows) || rows.length > 20_000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) ||
          typeof row.id !== 'string' || !row.id.trim() || row.id.length > 512))
        throw failure('Native model inventory is unavailable. Refresh your provider connections before updating model data.', 409);
      nativeModels = structuredClone(rows);
      nativeRevision++; identityCache = null;
    },
    list(input = {}) {
      const result = data().modelDataList(input);
      return { ...result, records: result.records.map(decorate), ...status() };
    },
    detail(input = {}) {
      if (typeof input.id !== 'string' || !input.id || input.id.length > 512) throw failure('Choose a stable catalog or native model ID.');
      if (input.source !== undefined && !sourceIDs.has(input.source)) throw failure('Choose Models.dev or Artificial Analysis.');
      const result = data().modelDataDetail(input.id, input);
      if (result?.record) {
        if (input.source && result.record.source !== input.source) throw failure('Model data was not found in the selected source.',404);
        return { ...decorateDetail(result), sources: sources() };
      }
      const slash = input.id.indexOf('/');
      if (slash < 1) throw failure('Model data was not found.', 404);
      if (input.cursor) throw failure('Continue a fact page using its exact source record ID from records[].id.');
      const recordResponseLimit = input.recordResponseLimit ?? 20;
      if (!Number.isInteger(recordResponseLimit) || recordResponseLimit < 1 || recordResponseLimit > 20) throw failure('Native record page size must be from 1 to 20.');
      const nativeModel = identityModels().find(row => row.id === input.id);
      const candidates = data().modelDataNativeMatches({ providerID: input.id.slice(0, slash), modelID: input.id.slice(slash + 1),
        aliases: [nativeModel?.api?.id, nativeModel?.apiID].filter(value => typeof value === 'string'), nativeModel }, { limit: recordResponseLimit, source: input.source ?? null });
      const rows = candidates.records ?? candidates;
      const matches = rows.filter(record => !input.source || record.source === input.source)
        .map(record => data().modelDataDetail(record.id, { limit: input.limit,responseLimit:input.responseLimit,attributes: input.attributes }))
        .filter(detail => detail.record && identity(detail.record).nativeIDs.includes(input.id)).map(decorateDetail);
      const matchStatus = matches.some(row => row.identityMatch.status === 'ambiguous') ? 'ambiguous'
        : matches.some(row => row.identityMatch.status === 'exact') ? 'exact' : matches.length ? 'alias' : 'unmatched';
      return { matches, sources: sources(), identityMatch: { status: matchStatus, nativeIDs: [input.id] },
        recordsTruncated: candidates.truncated === true,
        recordPage: { limit:20,...(recordResponseLimit < 20 ? {responseLimit:recordResponseLimit,boundedBy:'native-response-bytes'} : {}),returned:matches.length,continuation:candidates.truncated ? 'Use source list/search to discover remaining exact record IDs.' : 'complete' },
        missingness: matches.length ? [] : ['No exact or documented source identity match.'] };
    },
    card({id} = {}) {
      if(typeof id!=='string'||!id||id.length>512)throw failure('Choose an available native model ID.');
      if(nativeModels===null)throw failure('Native model inventory is unavailable. Reload Models to read its source summaries.',409);
      const model=nativeModels.find(row=>row.id===id);
      if(!model)throw failure('This model is not in the current configured inventory.',404);
      // Select each source before its record/fact bounds. AA configurations must
      // not consume the deployment page or supply provider limits/prices.
      const baseDeploymentAttributes=modelObservationAttributeFilter('modelsdev',MODEL_CARD_DEPLOYMENT_KEYS).exact;
      const results=[['modelsdev',baseDeploymentAttributes],['artificial-analysis',MODEL_CARD_RATING_KEYS]]
        .map(([source,attributes])=>({source,result:this.detail({id,source,attributes,limit:200})}));
      return summarizeNativeModelSources(model,{matches:results.flatMap(row=>row.result.matches??(row.result.record?[row.result]:[])),
        sourceCoverage:Object.fromEntries(results.map(({source,result})=>[source,{recordsReturned:result.matches?.length??(result.record?1:0),
          recordsTruncated:result.recordsTruncated===true,recordLimit:result.recordPage?.limit??null}])),
        recordsTruncated:results.some(row=>row.result.recordsTruncated===true)});
    },
    agentAction(input = {}) {
      const schema = modelObservationSchema();
      const bounded=result=>{
        if(Buffer.byteLength(JSON.stringify(result),'utf8')>MODEL_CATALOG_AGENT_RESPONSE_BYTES)
          throw failure('Catalog response exceeds its 40 KB native tool budget. Select fewer attributes or request a smaller page using an exact source record ID. Stored facts remain intact.',413);
        return result;
      };
      if (input.operation === 'schema') return bounded({ schema, records: [], sources: sources().map(compactModelDataSource) });
      if (input.operation === 'status') return bounded({ schema: { id:schema.id,version:schema.version },records:[],...compactModelDataStatus(status()) });
      if (input.operation === 'list' || input.operation === 'search') {
        let responseLimit=input.limit??25;
        while(true){
          const result = this.list({...input,responseLimit});
          const {sources:sourceStatus,job,maintenance,...page}=result;
          const view={ ...page,schema:{ id:schema.id,version:schema.version },
            ...compactModelDataStatus({sources:sourceStatus,job,maintenance}),
            records:result.records.map(record => toModelObservationRecord(record)) };
          if(Buffer.byteLength(JSON.stringify(view),'utf8')<=MODEL_CATALOG_AGENT_RESPONSE_BYTES||responseLimit===1)return bounded(view);
          responseLimit=Math.max(1,Math.floor(responseLimit/2));
        }
      }
      if (input.operation === 'detail') {
        let responseLimit=input.limit??100,recordResponseLimit=20;
        while(true){
          const result = this.detail({...input,responseLimit,recordResponseLimit});
          const view={ schema:{ id:schema.id,version:schema.version },records:(result.record ? [result] : result.matches ?? [])
            .map(detail => toModelObservationRecord(detail,{ attributes:input.attributes })),sources:result.sources.map(compactModelDataSource),
            recordsTruncated:result.recordsTruncated === true,recordPage:result.recordPage ?? null,
            identityMatch:result.identityMatch ?? null,missingness:result.missingness ?? result.record?.missingness ?? [] };
          if(Buffer.byteLength(JSON.stringify(view),'utf8')<=MODEL_CATALOG_AGENT_RESPONSE_BYTES)return bounded(view);
          if(responseLimit>1)responseLimit=Math.max(1,Math.floor(responseLimit/2));
          else if(!result.record&&recordResponseLimit>1)recordResponseLimit=Math.max(1,Math.floor(recordResponseLimit/2));
          else return bounded(view);
        }
      }
      throw failure('Choose schema, list, search, detail or status for a stored catalog read.');
    },
    refresh({ sources: requested } = {}) {
      if (closed || canRun() !== true) throw failure('Review restored work before updating model data.', 409);
      if (cleanup) throw failure('Interrupted model data is being cleared. Stored data is readable; retry this update after cleanup.', 409);
      if (cleanupError) throw failure(cleanupError, 409);
      if (savingKey) throw failure('Wait for the model-data key to finish saving.', 409);
      requested ??= hasKey() ? [...sourceIDs] : ['modelsdev'];
      if (!Array.isArray(requested) || !requested.length || requested.length > 2 || requested.some(id => !sourceIDs.has(id)))
        throw failure('Choose Models.dev and/or Artificial Analysis.');
      requested = [...new Set(requested)];
      // Canonical identity context must be published before joining AA configurations.
      if (requested.includes('modelsdev')) requested = ['modelsdev', ...requested.filter(source => source !== 'modelsdev')];
      let requiresModelsdev = false;
      if (requested.includes('artificial-analysis') && nativeModels !== null) {
        const modelsdev = data().modelDataStatus().sources.find(row => (row.id ?? row.source) === 'modelsdev');
        const covered = new Set(modelsdev?.current?.metadata?.sourceMetadata?.scope?.nativeModelIDs ?? []);
        requiresModelsdev = (work?.nativeModels ?? nativeModels).some(row => !row.sourceIdentities?.['artificial-analysis'] &&
          !row.sourceAliases?.['artificial-analysis']?.length && !covered.has(row.id));
        if (requiresModelsdev && !requested.includes('modelsdev')) requested = ['modelsdev', ...requested];
      }
      if (work) {
        if (work.controller.signal.aborted) throw failure('Wait for the current refresh to finish cancelling.', 409);
        work.requiresModelsdev ||= requiresModelsdev;
        for (const source of requested) if (!work.sources.includes(source)) {
          work.sources.push(source);
          data().beginModelDataRefresh({ id: work.id, sources: work.sources, createdAt: work.createdAt });
        }
        return status();
      }
      if (nativeModels === null) throw failure('Native model inventory is unavailable. Refresh your provider connections before updating model data.', 409);
      const current = { id: randomUUID(), sources: requested, createdAt: now(), controller: new AbortController(), results: [],
        nativeModels: structuredClone(nativeModels), requiresModelsdev };
      data().beginModelDataRefresh({ id: current.id, sources: current.sources, createdAt: current.createdAt });
      work = current;
      // A storage outage may prevent a terminal receipt. Keep the durable active
      // receipt for restart recovery, and never let detached work crash the host.
      current.promise = run(current).catch(() => {});
      return status();
    },
    cancel(id) {
      if (!work || work.id !== id) throw failure('This model-data refresh is no longer running.', 409);
      work.controller.abort();
      data().finishModelDataRefresh(id, { status: 'cancelling', summary: 'Cancelling model-data requests…' });
      return status();
    },
    dismiss(id) {
      const job = status().job;
      if (job?.id !== id || active(job)) throw failure('Wait for this model-data refresh to finish.', 409);
      data().finishModelDataRefresh(id, { status: 'dismissed' });
      return status();
    },
    credentials() { return { artificialAnalysis: { configured: hasKey(),
      storage: environmentKey() ? 'environment' : vault.available ? 'Windows protected storage' : 'unavailable' }, sources: sources() }; },
    async saveCredentials(input) {
      if (closed || work || savingKey) throw failure('Wait for the model-data operation before changing its key.', 409);
      const key = input?.artificialAnalysisKey;
      if (typeof key !== 'string' || key.trim().length < 8 || key.length > 4096 || /[\s\x00-\x1f]/.test(key))
        throw failure('Provide a valid Artificial Analysis API key.');
      savingKey = true;
      try {
        const encrypted = await vault.seal(key);
        if (closed || work) throw failure('The model-data service changed. The key was not saved.', 409);
        data().saveModelDataSecret('artificial-analysis', encrypted);
        return this.credentials();
      } finally { savingKey = false; }
    },
    removeCredentials() {
      if (closed || work || savingKey) throw failure('Wait for the model-data operation before removing its key.', 409);
      data().saveModelDataSecret('artificial-analysis', null);
      return this.credentials();
    },
    isRunning() { return !!work || !!cleanup; },
    async close() { closed = true; if (work) { work.controller.abort(); await work.promise; } if (cleanup) await cleanup; },
  };
}
