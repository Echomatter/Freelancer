import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Badge, Button, Field, Panel } from './echoflex/Controls';
import { ProgressStatus } from './echoflex/ProgressStatus';
import { Dialog } from './echoflex/Dialog';
import { HelpHint } from './HelpHint';

const sourceNames: Record<string, string> = { modelsdev: 'models.dev', 'artificial-analysis': 'Artificial Analysis' };
const running = (job: any) => ['running', 'cancelling'].includes(job?.status);
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not load model data.';
const when = (value: unknown) => {
  if (value == null || value === '') return 'Unknown';
  const date = new Date(value as string | number);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown';
};
const words = (value: unknown) => String(value ?? '').replace(/[_-]/g, ' ');
function shown(value: unknown, limit = 1200) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text == null ? 'Unknown' : text.length > limit ? `${text.slice(0, limit)}… (summary shortened)` : text;
}
const count = (value: unknown): number | undefined => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
function sourceRecordSummary(row: any, source?: any) {
  const scope = source?.current?.metadata?.sourceMetadata?.scope;
  const received = count(row.receivedRecordCount) ?? count(scope?.receivedRecordCount);
  const retained = count(row.recordCount) ?? count(scope?.retainedRecordCount) ?? count(source?.recordCount);
  const matched = count(row.matchedNativeModelCount) ?? count(scope?.matchedNativeModelCount) ?? count(source?.matchedNativeModelCount);
  const parts = received != null && retained != null
    ? [`${received} downloaded`, `${retained} linked ${retained === 1 ? 'record' : 'records'}`]
    : retained != null ? [`${retained} stored ${retained === 1 ? 'record' : 'records'}`] : [];
  if (matched != null) parts.push(`${matched} ${matched === 1 ? 'model' : 'models'} linked`);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}
function jobSourceSummary(result: any, sources: any[]) {
  const source = result.snapshotID && sources.find(row => row.id === result.source && row.currentSnapshotID === result.snapshotID);
  return sourceRecordSummary(result, source);
}
// The server owns refresh jobs. Polling reads stored status and never starts a refresh.
export function useModelDataUpdate(onComplete: () => Promise<void>) {
  const [job, setJob] = useState<any>(null), [sources, setSources] = useState<any[]>([]);
  const [legacy, setLegacy] = useState<any>(null);
  const [maintenance, setMaintenance] = useState<any>(null);
  const [error, setError] = useState(''), [pollError, setPollError] = useState('');
  const [pending, setPending] = useState(false), [hidden, setHidden] = useState('');
  const [version, setVersion] = useState(0);
  const generation = useRef(0), completed = useRef(''), mounted = useRef(true), mutation = useRef(false);
  const latestComplete = useRef(onComplete); latestComplete.current = onComplete;
  const accept = (result: any) => {
    const visibleJob = result.job?.status === 'dismissed' ? null : result.job;
    setJob(visibleJob ?? null); setSources(result.sources ?? []);
    if (Object.hasOwn(result, 'maintenance')) setMaintenance(result.maintenance ?? null);
    if (Object.hasOwn(result, 'legacy')) setLegacy(result.legacy ?? null);
    if (visibleJob && !running(visibleJob) && visibleJob.id !== completed.current) {
      completed.current = visibleJob.id; setHidden(''); setVersion(value => value + 1);
      void latestComplete.current().catch(() => {
        if (mounted.current) setError('Model data was stored, but the workspace could not reload. Reopen Models to read it.');
      });
    }
  };
  useEffect(() => {
    mounted.current = true;
    let inFlight = false;
    const controller = new AbortController();
    const poll = async () => {
      if (inFlight || mutation.current) return;
      inFlight = true;
      const request = generation.current;
      try {
        const result = await api('models/data?operation=status', undefined, 'GET', controller.signal);
        if (controller.signal.aborted || request !== generation.current) return;
        accept(result); setPollError('');
      } catch (error) { if (!controller.signal.aborted && request === generation.current) setPollError(message(error)); }
      finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => { mounted.current = false; controller.abort(); generation.current++; clearInterval(timer); };
  }, []);
  const mutate = async (body: any) => {
    if (mutation.current) return false;
    mutation.current = true; const request = ++generation.current; setPending(true); setError('');
    try {
      const result = await api('models/data', body);
      if (!mounted.current || request !== generation.current) return false;
      accept(result); setHidden(''); setPollError('');
      return true;
    } catch (error) {
      if (mounted.current && request === generation.current) setError(`${message(error)} Check the stored job status before trying again.`);
      return false;
    } finally {
      mutation.current = false; generation.current++;
      if (mounted.current) setPending(false);
    }
  };
  return { job, sources, legacy, version, error: error || pollError, pending, hidden: hidden === job?.id,
    maintenance, updateBlocked: ['cleaning', 'failed'].includes(maintenance?.state),
    start: (selected: string[]) => ['cleaning', 'failed'].includes(maintenance?.state) ? Promise.resolve(false) : mutate({ operation: 'refresh', sources: selected }),
    dismiss: () => job ? mutate({ operation: 'dismiss', id: job.id }) : Promise.resolve(true),
    stop: () => job ? mutate({ operation: 'cancel', id: job.id }) : Promise.resolve(false),
    clearError: () => { setError(''); setPollError(''); }, reveal: () => setHidden(''), hide: () => setHidden(job?.id ?? '') };
}

export function ModelDataDialog({ onClose, onSetup, update }: { onClose: () => void; onSetup: () => void; update: ReturnType<typeof useModelDataUpdate> }) {
  const [selected, setSelected] = useState(['modelsdev']);
  // Selection needs only safe configuration status, available to paired clients too.
  // Reading the host-only credential editor here would falsely disable a configured source remotely.
  const artificialAnalysis = update.sources.find(source => source.id === 'artificial-analysis');
  const configurationStatus = artificialAnalysis?.configured;
  const configured = configurationStatus === true;
  useEffect(() => {
    if (configurationStatus === false) setSelected(value => value.filter(id => id !== 'artificial-analysis'));
  }, [configurationStatus]);
  const eligible = selected.filter(id => id !== 'artificial-analysis' || configured);
  return <Dialog title="Update model data" size="compact" onClose={onClose} busy={update.pending} initialFocus="first"
    onSubmit={event => { event.preventDefault(); if (eligible.length) void update.start(eligible).then(started => { if (started) onClose(); }); }}
    footer={<><Button type="button" disabled={update.pending} onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!eligible.length || update.pending || update.updateBlocked}>{update.pending ? 'Starting…' : 'Update selected sources'}</Button></>}>
    <fieldset disabled={update.pending}><legend>Sources to update</legend>
      {Object.entries(sourceNames).map(([id, name]) => <label className="check" key={id}>
        <input type="checkbox" checked={eligible.includes(id)} disabled={id === 'artificial-analysis' && !configured}
          onChange={event => {
            const checked = event.target.checked;
            setSelected(value => checked ? [...new Set([...value, id])] : value.filter(source => source !== id));
          }} />{name}
      </label>)}
    </fieldset>
    {!artificialAnalysis && <p role="status">{update.error ? 'Source setup status is unavailable. Checking again automatically…' : 'Checking source setup…'}</p>}
    {artificialAnalysis?.configured === false && <p role="status">Artificial Analysis: API key needed.</p>}
    <Button type="button" disabled={update.pending} onClick={onSetup}>Set up data sources</Button>
    <HelpHint topic="model-data-sources" />
    {update.maintenance?.state === 'cleaning' && <p role="status">Clearing interrupted model data… Stored records remain readable.</p>}
    {update.maintenance?.state === 'failed' && <p className="notice error" role="alert">{update.maintenance.error}</p>}
    {update.error && <p className="notice error" role="alert">{update.error}</p>}
  </Dialog>;
}

export function ModelDataProgress({ update }: { update: ReturnType<typeof useModelDataUpdate> }) {
  const { job, legacy, error, pending, maintenance } = update;
  const unresolved = ['retiring', 'retirement-unverified'].includes(legacy?.status);
  if (!job && !error && !unresolved && maintenance?.state !== 'failed') return null;
  return <div className="model-rating-progress">
    {maintenance?.state === 'failed' && <ProgressStatus className="model-data-maintenance-error" label={maintenance.error || 'Stored model data needs attention before another update.'} state="error" />}
    {unresolved && <ProgressStatus className="model-data-legacy-warning" label="Previous ratings research has not been confirmed stopped." state="warning"
      detail={<details><summary>Retained research reference</summary><p>{legacy.summary}</p>
        <p>Project: {legacy.project ?? 'Not recorded'} · Inspect retained session: {legacy.session ?? 'Not recorded'}</p>
        <p>No new research is started or retried from this status.</p></details>} />}
    {!job && error && <ProgressStatus className="model-rating-job" label={error} state="error"
      onDismiss={update.clearError} dismissLabel="Dismiss model data error" />}
    {job && !update.hidden && <ProgressStatus className="model-rating-job"
    label={error || job.error || job.summary || `Model data update: ${words(job.status)}`}
    state={error ? 'error' : running(job) ? 'running' : job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'warning'}
    detail={!!job.results?.length && <ul>{job.results.map((result: any) => <li key={result.source}>
      {sourceNames[result.source] ?? result.source}: {words(result.status)}{jobSourceSummary(result, update.sources)}
      {result.error ? ` · ${result.error}` : ''}</li>)}</ul>}
    disabled={pending} onDismiss={() => { if (running(job)) update.hide(); else void update.dismiss(); }}
    dismissLabel={running(job) ? 'Hide model data progress' : 'Dismiss model data update'}
    action={running(job) ? { label: 'Stop', disabled: job.status === 'cancelling', onClick: () => void update.stop() } : { label: 'OK', onClick: () => void update.dismiss() }} />}</div>;
}

function SourceStatus({ sources, configured }: { sources: any[]; configured?: boolean }) {
  return <ul className="connection-rows model-source-list" aria-label="Published model data sources">{sources.map(source => {
    const ready = source.id === 'artificial-analysis' ? configured : source.configured;
    const scope = source.current?.metadata?.sourceMetadata?.scope;
    const retained = count(scope?.retainedRecordCount) ?? count(source.recordCount);
    return <li key={source.id}>
      <div className="connection-row-main">
        <div className="connection-row-title"><strong>{source.name ?? sourceNames[source.id] ?? source.id}</strong>
          <Badge tone={ready === true ? 'success' : 'neutral'}>{ready === true ? 'Configured' : ready === false ? 'Key needed' : 'Status unavailable'}</Badge></div>
        <dl className="connection-row-facts">
          <div><dt>Data</dt><dd>{words(source.state) || 'Not downloaded'}</dd></div>
          <div><dt>Updated</dt><dd>{source.lastSuccessAt != null ? when(source.lastSuccessAt) : 'Never'}</dd></div>
          {retained != null && <div><dt>Linked records</dt><dd>{retained.toLocaleString()}</dd></div>}
        </dl>
        {source.error && <p className="connection-row-issue notice error">{source.error}</p>}
      </div>
    </li>;
  })}</ul>;
}

function SourceDetails({ sources }: { sources: any[] }) {
  return <details className="connection-details"><summary>Source details</summary>{sources.map(source => <div key={source.id}>
    <strong>{source.name ?? sourceNames[source.id] ?? source.id}</strong>
    <p>{sourceRecordSummary(source, source).replace(/^ · /, '') || 'No stored source counts.'}</p>
    {source.lastAttemptAt != null && <p>Last attempt: {when(source.lastAttemptAt)}</p>}
    {source.version && <p>Version: {shown(source.version, 160)}</p>}
    {source.attribution && <p>{shown(source.attribution, 600)}</p>}
  </div>)}</details>;
}

export function ModelDataSettings({ onChange, busy = false, sources = [] }: { onChange: () => void; busy?: boolean; sources?: any[] }) {
  const [config, setConfig] = useState<any>(null), [key, setKey] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [check, setCheck] = useState(0), [hostOnly, setHostOnly] = useState(false);
  const mounted = useRef(true), flight = useRef(false), generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController(), request = ++generation.current;
    setLoading(true); setError(''); setHostOnly(false);
    void api('models/data/credentials', undefined, 'GET', controller.signal).then(result => {
      if (!controller.signal.aborted && request === generation.current) setConfig(result);
    }).catch(error => {
      if (!controller.signal.aborted && request === generation.current) {
        setConfig(null); setHostOnly(error?.status === 403); setError(message(error));
      }
    }).finally(() => { if (!controller.signal.aborted && request === generation.current) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); generation.current++; };
  }, [check]);
  const save = async (remove = false) => {
    if (flight.current || busy || !config || (!remove && !key.trim())) return;
    flight.current = true; generation.current++; setPending(true); setError(''); setNotice('');
    const submittedKey = key.trim(); setKey('');
    try {
      const result = await api('models/data/credentials', remove ? undefined : { artificialAnalysisKey: submittedKey }, remove ? 'DELETE' : 'PUT');
      if (!mounted.current) return;
      // Only configuration status is retained in browser state; responses never contain the key.
      setConfig(result); setNotice(remove ? 'Saved Artificial Analysis key removed.' : 'Artificial Analysis key saved.'); onChange();
    } catch (error) {
      if (mounted.current) setError(`${message(error)} The key field was cleared. Reopen this section to check configuration before resubmitting.`);
    } finally { flight.current = false; if (mounted.current) setPending(false); }
  };
  const visibleSources = sources.length ? sources : config?.sources ?? [];
  const configured = config?.artificialAnalysis?.configured ?? visibleSources.find((source: any) => source.id === 'artificial-analysis')?.configured;
  return <Panel title="Model data sources" className="capability-section connection-panel" collapsible storageKey="model-data-settings"
    summaryText={visibleSources.length ? `${visibleSources.length} sources · ${visibleSources.filter((source: any) => (source.id === 'artificial-analysis' ? configured : source.configured) === true).length} configured` : loading ? 'Checking…' : 'Status unavailable'}
    help="model-data-sources" helpDetails={<SourceDetails sources={visibleSources} />}>
    <SourceStatus sources={visibleSources} configured={configured} />
    {!visibleSources.length && <p role="status">{loading ? 'Checking source setup…' : 'Source setup status unavailable.'}</p>}
    <form className="model-source-key-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="model-source-key-heading"><strong>Source key</strong>
        {config?.artificialAnalysis?.storage && <span className="connection-row-meta">Key source: {words(config.artificialAnalysis.storage)}</span>}</div>
      <Field label="Artificial Analysis API key"><input type="password" autoComplete="off" maxLength={4096} value={key} disabled={pending || busy || !config || loading}
        onChange={event => { setKey(event.target.value); setNotice(''); }} /></Field>
      <div className="connection-actions"><Button variant="primary" disabled={pending || busy || !config || loading || !key.trim()}>{pending ? 'Saving…' : 'Save source key'}</Button>
        <Button type="button" disabled={pending || busy || loading || !config?.artificialAnalysis?.configured}
          onClick={() => void save(true)}>Remove saved source key</Button></div>
    </form>
    {busy && <p role="status">Source update running · Key changes unavailable.</p>}
    {hostOnly && <p className="notice">Source keys can only be managed on the server computer.</p>}
    {error && !hostOnly && <Button type="button" disabled={pending || loading} onClick={() => setCheck(value => value + 1)}>Retry source setup</Button>}
    {error && <p className="notice error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </Panel>;
}
