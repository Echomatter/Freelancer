import { useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Dialog } from './echoflex/Dialog';
import { Button } from './echoflex/Controls';
import { pendingQuestions } from '../domain/questions.mjs';

type Permission = { id: string; permission: string; patterns?: string[]; worker?: boolean; sessionTitle?: string };
export function Permissions({ requests, suspended = false, allowAlways = true, onRespond }: {
  requests: Permission[]; suspended?: boolean; allowAlways?: boolean;
  onRespond: (id: string, reply: string) => Promise<void>;
}) {
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const queue: Permission[] = pendingQuestions(requests, completed).sort((a, b) => Number(!!b.worker) - Number(!!a.worker));
  const request = queue[0];
  if (!request) return null;
  return <>
    <div className="question-reminder"><span>Permission needed</span>
      <Button onClick={() => setDismissed(previous => { const next = new Set(previous); next.delete(request.id); return next; })}>Review permission</Button></div>
    {[queue.find(row => !row.worker), queue.find(row => row.worker)].filter(Boolean).map(row => <PermissionDialog key={row!.id} request={row!} allowAlways={allowAlways}
      open={!dismissed.has(row!.id) && (!suspended || !!row!.worker)}
      onLater={() => setDismissed(previous => new Set([...previous, row!.id]))}
      onRespond={async reply => { await onRespond(row!.id, reply); setCompleted(previous => new Set([...previous, row!.id])); }} />)}
  </>;
}

function PermissionDialog({ request, open, allowAlways, onLater, onRespond }: {
  request: Permission; open: boolean; allowAlways: boolean; onLater: () => void; onRespond: (reply: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false);
  async function reply(value: string) {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError('');
    try { await onRespond(value); }
    catch (failure) { setError((failure as Error).message); }
    finally { inFlight.current = false; setPending(false); }
  }
  return <Dialog title={request.worker ? 'Subagent permission' : 'Permission needed'} icon={<ShieldCheck />}
    description={request.sessionTitle} open={open} size="compact" priority={request.worker ? 'worker' : 'decision'}
    busy={pending} onClose={onLater} closeLabel="Review permission later"
    footer={<><Button type="button" variant="quiet" disabled={pending} onClick={onLater}>Later</Button>
      <Button type="button" disabled={pending} onClick={() => void reply('reject')}>Deny</Button>
      {allowAlways && <Button type="button" disabled={pending} onClick={() => void reply('always')}>Always allow</Button>}
      <Button type="button" variant="primary" disabled={pending} onClick={() => void reply('once')}>Allow once</Button></>}>
    <strong>{request.permission}</strong>
    {request.patterns?.length ? <ul className="permission-patterns">{request.patterns.map((pattern, index) => <li key={index}>{pattern}</li>)}</ul> : null}
    {error && <p className="notice error" role="alert">{error}</p>}
  </Dialog>;
}
