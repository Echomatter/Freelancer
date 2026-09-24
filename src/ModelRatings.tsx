import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Button } from './echoflex/Controls';
import { ProgressStatus } from './echoflex/ProgressStatus';
import { ProviderSelect } from './ProviderColors';
import { ModelIntelligence } from './ModelSetup';
import { Questions } from './Question';
import { Dialog } from './echoflex/Dialog';
import { Permissions } from './Permissions';

export function useModelRatings(onComplete: () => Promise<void>) {
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [pending, setPending] = useState(false);
  const [hidden, setHidden] = useState('');
  const revision = useRef(0), completed = useRef('');
  const latestComplete = useRef(onComplete);
  latestComplete.current = onComplete;
  useEffect(() => {
    let active = true, inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      const version = revision.current;
      try {
        const result = await api('models/ratings');
        if (!active || version !== revision.current) return;
        setJob(result.job);
        setPollError('');
        if (result.job && !['starting', 'running'].includes(result.job.status) && result.job.id !== completed.current) {
          completed.current = result.job.id;
          setHidden('');
          await latestComplete.current().catch(() => setError('Ratings were saved, but the model list could not refresh. Use Refresh.'));
        }
      } catch (e) { if (active) setPollError((e as Error).message); }
      finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const mutate = async (route: string, body: any) => {
    revision.current++;
    setPending(true); setError('');
    try { const result = await api(route, body); setJob(result.job); setHidden(''); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { revision.current++; setPending(false); }
  };
  const start = (project: string, model: string, variant = '', retry?: string) =>
    mutate('models/ratings?project=' + encodeURIComponent(project), { model, variant, retry });
  const dismiss = () => mutate('models/ratings/dismiss', { id: job.id });
  return { job, error: error || pollError, pending, hidden: hidden === job?.id, start, dismiss,
    clearError: () => { setError(''); setPollError(''); },
    reveal: () => setHidden(''), hide: () => setHidden(job.id),
    stop: () => mutate('models/ratings/stop', { id: job.id }),
    retry: async () => { const previous = job; if (await dismiss()) await start(previous.project, previous.model, previous.variant, previous.id); } };
}

export function ModelRatingDialog({ models, connected, project, onClose, onStart, pending, error }: {
  models: any[]; connected: string[]; project: string; onClose: () => void;
  onStart: (project: string, model: string, variant?: string) => Promise<boolean>; pending: boolean; error: string;
}) {
  const [choice, setChoice] = useState(''), [variant, setVariant] = useState('');
  const available = models.filter(row => connected.includes(row.provider));
  return <Dialog title="Update Model Ratings" size="compact" onClose={onClose} busy={pending} initialFocus="first"
    onSubmit={event => { event.preventDefault(); void onStart(project, choice, variant).then(started => { if (started) onClose(); }); }}
    footer={<><Button type="button" disabled={pending} onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!choice || pending}>{pending ? 'Starting…' : 'Go'}</Button></>}>
      <label className="field"><span>Configuration model</span>
        <ProviderSelect provider={choice} autoFocus required value={choice} onChange={event => { setChoice(event.target.value); setVariant(''); }}>
          <option value="">Select a connected model…</option>
          {available.map(row => <option key={row.id} value={row.id}>{row.name} · {row.provider} ({row.costClass})</option>)}
        </ProviderSelect>
      </label>
      <ModelIntelligence variants={available.find(row => row.id === choice)?.variants ?? []} value={variant} onChange={setVariant} disabled={pending} />
      <p>Research missing model details in the background using this model’s normal provider allowance.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
  </Dialog>;
}

export function ModelRatingProgress({ ratings }: { ratings: ReturnType<typeof useModelRatings> }) {
  const { job, error, pending } = ratings;
  if (!job) return error ? <ProgressStatus className="model-rating-job" label={error} state="error"
    onDismiss={ratings.clearError} dismissLabel="Dismiss model update error" /> : null;
  const running = ['starting', 'running'].includes(job.status);
  const waiting = job.permissions?.length || job.questions?.length;
  return <div className="model-rating-progress">
    {!ratings.hidden && <ProgressStatus className="model-rating-job" label={error || job.error || job.summary}
      state={error ? 'error' : waiting ? 'waiting' : running ? 'running' : job.status === 'completed' ? 'success' : 'warning'}
      disabled={pending} onDismiss={() => { if (running) ratings.hide(); else void ratings.dismiss(); }}
      dismissLabel={running ? 'Hide model update progress' : 'Dismiss model update'}
      action={running ? { label: 'Stop', onClick: () => void ratings.stop() } : job.status === 'completed'
        ? { label: 'OK', onClick: () => void ratings.dismiss() } : { label: 'Retry', onClick: () => void ratings.retry() }} />}
    <Permissions requests={job.permissions ?? []} allowAlways={false} onRespond={async (id, reply) => {
      await api('respond', { project: job.project, type: 'permission', id, response: { reply } });
    }} />
    <Questions requests={job.questions ?? []} onRespond={async (id, response) => {
      await api('respond', { project: job.project, type: 'question', id, response });
    }} />
  </div>;
}
