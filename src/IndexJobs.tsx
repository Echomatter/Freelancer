import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { ProgressStatus } from './echoflex/ProgressStatus';

export function useIndexJobs() {
  const [job, setJob] = useState<any>(null), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const [hidden, setHidden] = useState('');
  const [pollError, setPollError] = useState('');
  const revision = useRef(0), terminal = useRef('');
  useEffect(() => {
    let alive = true, reading = false;
    const poll = async () => {
      if (reading) return;
      reading = true;
      const version = revision.current;
      try {
        const result = await api('index/jobs');
        if (!alive || version !== revision.current) return;
        setJob(result.job);
        setPollError('');
        if (result.job && result.job.status !== 'running' && terminal.current !== result.job.id) {
          terminal.current = result.job.id;
          setHidden('');
        }
      } catch (e) { if (alive) setPollError((e as Error).message); }
      finally { reading = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  async function mutate(route: string, body: any) {
    revision.current++; setPending(true); setError('');
    try { const result = await api(route, body); setJob(result.job); setHidden(''); return result.job; }
    catch (e) { setError((e as Error).message); throw e; }
    finally { revision.current++; setPending(false); }
  }
  const start = (kind: string, project = '', retry = '') => mutate('index/jobs', { kind, project, retry });
  const prepare = async (project: string, progress: (job: any) => void) => {
    let current = await start('prepare', project);
    if (!current) return;
    const id = current.id;
    while (current?.id === id && current.status === 'running') {
      progress(current);
      await new Promise(resolve => setTimeout(resolve, 600));
      current = (await api('index/jobs')).job;
      setJob(current);
    }
    if (!current || current.id !== id) throw Error('Index preparation status changed. Check Content index.');
    if (current.status === 'completed') { await mutate('index/jobs/dismiss', { id }); }
    // Partial/failed preparation stays visible in the shared bar, with Retry.
  };
  return { job, error: error || pollError, pending, prepare, start,
    hidden: hidden === job?.id, reveal: () => setHidden(''),
    dismiss: async () => { if (job?.status === 'running') setHidden(job.id); else await mutate('index/jobs/dismiss', { id: job?.id }); },
    stop: () => mutate('index/jobs/stop', { id: job.id }),
    retry: () => start(job.kind, job.project, job.id) };
}
export const IndexJobsContext = createContext<ReturnType<typeof useIndexJobs> | null>(null);
export const useIndexJobContext = () => useContext(IndexJobsContext)!;

export function IndexJobProgress({ jobs }: { jobs: ReturnType<typeof useIndexJobs> }) {
  const { job, error, pending } = jobs;
  if (!job || jobs.hidden) return null;
  const running = job.status === 'running';
  const safe = (action: () => Promise<any>) => () => { void action().catch(() => {}); };
  return <ProgressStatus className="index-job-progress" label={error || job.label}
    state={error || job.status === 'failed' ? 'error' : running ? 'running' : job.status === 'completed' ? 'success' : 'warning'}
    disabled={pending} onDismiss={safe(jobs.dismiss)} dismissLabel={running ? 'Hide index progress' : 'Dismiss index status'}
    action={running ? job.stoppable ? { label: 'Stop', onClick: safe(jobs.stop) } : undefined
      : job.status === 'completed' && job.kind === 'compact' ? undefined
      : { label: job.status === 'completed' ? ['check', 'optimize'].includes(job.kind) ? 'Run again' : 'Refresh again' : 'Retry', onClick: safe(jobs.retry) }} />;
}
