import { ProviderText, ProviderSelect } from "./ProviderColors";
import { WorkCard } from './WorkCard';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './echoflex/Dialog';
import { Button } from './echoflex/Controls';
import { ArrowUp, CircleStop, Hand, LoaderCircle, ListPlus, Bot, X } from 'lucide-react';
import { api, query } from './api';
import { senderAction } from '../domain/sender.mjs';
import './chat-sender.css';

type Intent = { id: string; project: string; session: string; text: string; model: string; variant: string; workflowID: string; agentID: string; draftToken?: any };
type Delivery = { id: string; kind: 'queue' | 'clarify'; status: string; model: string; text?: string; error?: string; notice?: string };
type Options = { data: any; session: any; busy: boolean; loading: boolean; draft: string; setDraft: (text: string) => void;
  parentModel: string; intelligence: string; agentID: string; workflowID: string; models: any[]; onSend: (variant: string) => void; onStop: () => void; disabled?: boolean; hasAttachments?: boolean; captureDraft?: () => any; acceptDraft?: (token: any) => void };

export function useChatSender(options: Options) {
  const { data, busy, loading, draft, parentModel, intelligence, agentID, workflowID } = options;
  const project = data?.project?.id ?? '';
  const session = typeof options.session === 'string' ? options.session : options.session?.id ?? '';
  const context = query(project, session);
  const latest = useRef({ ...options, project, session, context });
  latest.current = { ...options, project, session, context };
  const [intent, setIntent] = useState<Intent | null>(null);
  const [override, setOverride] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [deliveries, setDeliveries] = useState<{ context: string; rows: Delivery[] }>({ context: '', rows: [] });
  const flight = useRef(new Set<string>());
  const revision = useRef(0);
  const activeDelivery = useRef(false);
  const [connectionError, setConnectionError] = useState('');
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const dismissalKey = (row: Delivery) => `${context}/${row.id}/${row.status}/${row.error ?? ''}`;
  const rows = deliveries.context === context ? deliveries.rows : [];
  activeDelivery.current = rows.some(row => ['waiting', 'sending', 'submitted'].includes(row.status));
  const action = pending ? 'loading' : senderAction({ busy: busy || rows.some(r => ['waiting', 'sending', 'submitted'].includes(r.status)), draft, loading, available: !!parentModel && !!project && !options.disabled, hasAttachments: options.hasAttachments });
  useEffect(() => {
    setIntent(null); setOverride(''); setPending(flight.current.has(context)); setError(''); setConnectionError('');
  }, [context]);
  useEffect(() => {
    if (!project || !session || loading) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const version = revision.current;
      try {
        const next = await api('sender?' + context, undefined, 'GET', controller.signal);
        if (!controller.signal.aborted) {
          if (version === revision.current) setDeliveries({ context, rows: next });
          setConnectionError('');
        }
      } catch (e) {
        if (!controller.signal.aborted) setConnectionError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh,
          document.hidden ? 8000 : activeDelivery.current ? 1200 : 3000);
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [context, project, session, loading]);
  function submit() {
    if (options.disabled || action === 'stop' || flight.current.has(context) || loading || !project || (!draft.trim() && !options.hasAttachments) || !parentModel) return;
    if (busy || rows.some(r => ['waiting', 'sending', 'submitted'].includes(r.status))) {
      if (!session) return;
      setOverride(''); setError('');
      setIntent({ id: crypto.randomUUID(), project, session, text: draft, model: parentModel, variant: intelligence, workflowID, agentID, draftToken: options.captureDraft?.() });
    } else options.onSend(intelligence);
  }
  async function choose(kind: 'queue' | 'clarify') {
    if (!intent || flight.current.has(context)) return;
    const captured = intent, origin = query(captured.project, captured.session);
    flight.current.add(origin); setPending(true); setError('');
    try {
      const { draftToken, ...payload } = captured;
      const row = await api('sender', { ...payload, kind,
        model: override || (kind === 'queue' ? captured.model : 'auto'),
        variant: override && override !== captured.model ? '' : captured.variant });
      if (draftToken) options.acceptDraft?.(draftToken);
      if (latest.current.context === origin) {
        revision.current++;
        setDeliveries(current => ({ context: origin, rows: [
          ...(current.context === origin ? current.rows.filter(r => r.id !== row.id) : []), row,
        ] }));
        if (!draftToken && latest.current.draft === captured.text) latest.current.setDraft('');
        setIntent(null);
      }
    } catch (e) {
      // Keep the same delivery ID for a retry after a lost HTTP response.
      if (latest.current.context === origin) setError((e as Error).message);
    } finally {
      flight.current.delete(origin);
      if (latest.current.context === origin) setPending(false);
    }
  }
  async function cancel(row: Delivery) {
    const origin = context;
    try {
      await api('sender', { project, session, id: row.id }, 'DELETE');
      if (latest.current.context === origin) { revision.current++; setDeliveries(current => ({ context: origin, rows: current.rows.filter(r => r.id !== row.id) })); }
    } catch (e) { if (latest.current.context === origin) setError((e as Error).message); }
  }
  const ui = (
    <>
      {connectionError && <p className="notice error sender-error" role="status">Sender connection: {connectionError}. Pending messages remain on the server.</p>}
      {error && !intent && <p className="notice error sender-error" role="alert">{error}<button type="button" aria-label="Dismiss sender error" onClick={() => setError('')}><X size={15} /></button></p>}
      {rows.some(row => dismissed.has(dismissalKey(row))) && <button type="button" className="restore-work" onClick={() => setDismissed(new Set())}>Show hidden delivery cards</button>}
      {rows.filter(row => !dismissed.has(dismissalKey(row))).map(row => <WorkCard key={row.id}
          icon={row.kind === 'queue' ? <ListPlus size={16} /> : <Bot size={16} />}
          title={`${row.kind === 'queue' ? 'Queue' : 'Delegate'} · ${row.status === 'waiting' ? 'Waiting' : row.status === 'submitted' ? 'Handed to OpenCode' : row.status === 'sending' ? 'Submitting…' : 'Needs attention'}`}
          defaultOpen={false}
          onDismiss={() => setDismissed(previous => new Set([...previous, dismissalKey(row)]))} dismissLabel="Dismiss delivery card"
          action={['waiting', 'uncertain', 'failed'].includes(row.status) ? <button type="button" className="work-card-cancel" onClick={() => void cancel(row)}>{row.status === 'waiting' ? 'Cancel message' : 'Acknowledge notice'}</button> : undefined}>
            <small><ProviderText provider={row.model === 'auto' ? 'opencode' : row.model} mark>{row.model === 'auto' ? 'Agent default / automatic' : (options.models.find(m => m.id === row.model)?.name ?? row.model)}</ProviderText></small>
            {row.text && <p>{row.text}</p>}
            {row.kind === 'clarify' && row.status === 'submitted' && <small>Actual worker progress appears in Details.</small>}
            {(row.error || row.notice) && <p role="status">{row.error || row.notice}</p>}
      </WorkCard>)}
      {intent && <Dialog title="While this response runs" description="Choose what happens to the current response and your message."
        icon={<Hand />} onClose={() => setIntent(null)} busy={pending} initialFocus="first"
        footer={<>{pending && <span role="status"><LoaderCircle className="spin" size={16} /> Saving message…</span>}
          <Button type="button" disabled={pending} onClick={() => setIntent(null)}>Cancel</Button></>}>
        <blockquote className="sender-preview">{intent.text}</blockquote>
        <label className="sender-model">Model override<ProviderSelect provider={override} aria-label="Message model override" value={override} disabled={pending} onChange={e => setOverride(e.target.value)} autoFocus>
          <option value="">No override · use assignment defaults</option>
          {options.models.map(m => <option key={m.id} value={m.id}>{m.name}{m.costClass === 'free' ? ' · Free' : ''} · {m.provider}</option>)}
        </ProviderSelect></label>
        <p className="sender-scope">Queue uses this model for the next parent turn. Delegate uses it for the worker only. Saved defaults stay unchanged.</p>
        <div className="sender-options">
          <button type="button" disabled={pending} onClick={() => void choose('clarify')}><Bot size={22} aria-hidden="true" /><strong>Delegate</strong><span>Ask a worker to handle this concern at the parent’s next safe boundary.</span></button>
          <button type="button" disabled={pending} onClick={() => void choose('queue')}><ListPlus size={22} aria-hidden="true" /><strong>Queue</strong><span>Send automatically after the current turn finishes.</span></button>
          <button type="button" disabled={pending} onClick={() => { setIntent(null); options.onStop(); }}><CircleStop size={22} aria-hidden="true" /><strong>Interrupt</strong><span>Stop the current response and cancel waiting messages. Keep this draft to revise or send next.</span></button>
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
      </Dialog>}
    </>
  );
  return { action, submit, pending, ui };
}

export function SenderControls({ sender, busy, onStop, disabled }: { sender: ReturnType<typeof useChatSender>; busy: boolean; onStop: () => void; disabled: boolean }) {
  const stop = sender.action === 'stop';
  const hand = sender.action === 'handoff';
  return <div className="sender-controls">
    <button type="button" className={`sender-main ${hand ? 'handoff' : ''} ${stop ? 'stop' : ''}`}
      aria-label={stop ? 'Stop response' : hand ? 'Choose Delegate, Queue, or Interrupt' : sender.pending ? 'Submitting message' : 'Send message'}
      aria-haspopup={hand ? 'dialog' : undefined}
      title={stop ? 'Stop the response and cancel pending messages' : hand ? 'Choose Delegate, Queue, or Interrupt — attached files stay in the composer' : 'Send message'}
      disabled={!stop && (disabled || sender.pending || sender.action === 'disabled' || sender.action === 'loading')}
      onClick={stop ? onStop : sender.submit}>
      {sender.action === 'loading' ? <LoaderCircle size={21} className="spin" /> : stop ? <CircleStop size={21} /> : hand ? <Hand size={22} /> : <ArrowUp size={22} />}
    </button>
  </div>;
}
