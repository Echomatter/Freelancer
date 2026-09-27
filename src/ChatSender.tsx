import { ProviderText, ProviderSelect } from "./ProviderColors";
import { WorkCard } from './WorkCard';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './echoflex/Dialog';
import { Button } from './echoflex/Controls';
import { ArrowUp, CircleStop, Hand, LoaderCircle, ListPlus, Bot, X } from 'lucide-react';
import { api, query } from './api';
import { clientID } from './browser-capabilities.mjs';
import { senderAction } from '../domain/sender.mjs';
import './chat-sender.css';

type Intent = { id: string; project: string; session: string; text: string; model: string; variant: string; workflowID: string; agentID: string; draftToken?: any };
type Delivery = { id: string; kind: 'queue' | 'clarify' | 'interrupt'; status: string; model: string; text?: string; error?: string; notice?: string };
type Options = { data: any; session: any; busy: boolean; loading: boolean; draft: string; setDraft: (text: string) => void;
  parentModel: string; intelligence: string; agentID: string; workflowID: string; models: any[]; onSend: (variant: string) => void; onStop: () => void | Promise<unknown>; disabled?: boolean; hasAttachments?: boolean; captureDraft?: () => any; acceptDraft?: (token: any) => void };

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
  const optimistic = useRef(new Map<string, Delivery[]>());
  const revision = useRef(0);
  const activeDelivery = useRef(false);
  const [connectionError, setConnectionError] = useState('');
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const dismissalKey = (row: Delivery) => `${context}/${row.id}/${row.status}/${row.error ?? ''}`;
  const rows = deliveries.context === context ? deliveries.rows : [];
  const mergeRows = (origin: string, serverRows: Delivery[]) => {
    const confirmed = new Set(serverRows.map(row => row.id));
    const localRows = (optimistic.current.get(origin) ?? []).filter(row => !confirmed.has(row.id));
    if (localRows.length) optimistic.current.set(origin, localRows);
    else optimistic.current.delete(origin);
    return [...serverRows, ...localRows];
  };
  activeDelivery.current = rows.some(row => ['waiting', 'sending', 'submitted'].includes(row.status));
  const action = pending ? 'loading' : senderAction({ busy: busy || rows.some(r => ['waiting', 'sending', 'submitted'].includes(r.status)), draft, loading, available: !!parentModel && !!project && !options.disabled, hasAttachments: options.hasAttachments });
  useEffect(() => {
    setIntent(null); setOverride(''); setPending(flight.current.has(context) || flight.current.has(`stop:${context}`)); setError(''); setConnectionError('');
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
          if (version === revision.current) setDeliveries({ context, rows: mergeRows(context, next) });
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
      setIntent({ id: clientID(), project, session, text: draft, model: parentModel, variant: intelligence, workflowID, agentID, draftToken: options.captureDraft?.() });
    } else options.onSend(intelligence);
  }
  async function choose(kind: 'queue' | 'clarify' | 'interrupt') {
    if (!intent || flight.current.has(context)) return;
    const captured = intent, origin = query(captured.project, captured.session);
    const model = override || (kind !== 'clarify' ? captured.model : 'auto');
    const local: Delivery = { id: captured.id, kind, status: 'sending', model, text: captured.text };
    optimistic.current.set(origin, [...(optimistic.current.get(origin) ?? []).filter(row => row.id !== local.id), local]);
    revision.current++;
    flight.current.add(origin); setPending(true); setError('');
    setIntent(null);
    setDeliveries(current => ({ context: origin, rows: mergeRows(origin, current.context === origin ? current.rows.filter(row => row.id !== local.id) : []) }));
    try {
      const { draftToken, ...payload } = captured;
      const row = await api('sender', { ...payload, kind,
        model,
        variant: model && model !== captured.model ? '' : captured.variant });
      const remaining = (optimistic.current.get(origin) ?? []).filter(localRow => localRow.id !== row.id);
      if (remaining.length) optimistic.current.set(origin, remaining);
      else optimistic.current.delete(origin);
      if (draftToken && !['uncertain', 'failed'].includes(row.status)) options.acceptDraft?.(draftToken);
      if (latest.current.context === origin) {
        revision.current++;
        setDeliveries(current => ({ context: origin, rows: [
          ...(current.context === origin ? current.rows.filter(r => r.id !== row.id) : []), row,
        ] }));
        if (!draftToken && !['uncertain', 'failed'].includes(row.status) && latest.current.draft === captured.text) latest.current.setDraft('');
      }
    } catch (e) {
      // Keep the same delivery ID for a retry after a lost HTTP response.
      const message = `Delivery unconfirmed: ${(e as Error).message}`;
      optimistic.current.set(origin, (optimistic.current.get(origin) ?? []).map(row =>
        row.id === captured.id ? { ...row, status: 'uncertain', error: message } : row));
      if (latest.current.context === origin) {
        revision.current++;
        setError(message);
        // Retry the same captured delivery ID after uncertain transport, rather
        // than letting a new submit silently duplicate an accepted message.
        setIntent(captured);
        setDeliveries(current => ({ context: origin, rows: mergeRows(origin, current.context === origin ? current.rows.filter(row => row.id !== captured.id) : []) }));
      }
    } finally {
      flight.current.delete(origin);
      if (latest.current.context === origin) setPending(false);
    }
  }
  async function interrupt() {
    const origin = context;
    if (flight.current.has(`stop:${origin}`)) return;
    flight.current.add(`stop:${origin}`); setPending(true); setError(''); setIntent(null);
    try { await options.onStop(); }
    catch (e) { if (latest.current.context === origin) setError(`Could not stop the response: ${(e as Error).message}`); }
    finally {
      flight.current.delete(`stop:${origin}`);
      if (latest.current.context === origin) setPending(false);
    }
  }
  async function cancel(row: Delivery) {
    const origin = context;
    try {
      await api('sender', { project, session, id: row.id }, 'DELETE');
      const remaining = (optimistic.current.get(origin) ?? []).filter(local => local.id !== row.id);
      if (remaining.length) optimistic.current.set(origin, remaining);
      else optimistic.current.delete(origin);
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
          title={`${row.kind === 'queue' ? 'Queue' : row.kind === 'interrupt' ? 'Interrupt' : 'Delegate'} · ${row.status === 'waiting' ? 'Waiting' : row.status === 'submitted' ? 'Handed to OpenCode' : row.status === 'sending' ? 'Submitting…' : row.status === 'interrupting' ? 'Stopping response…' : row.status === 'delivered' ? 'Delivered' : row.status === 'cancelled' || row.status === 'dismissed' ? 'Cancelled' : 'Check delivery'}`}
          defaultOpen={false} preview={row.error || row.notice || row.text}
          attention={['uncertain', 'failed'].includes(row.status)}
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
        <p className="sender-scope">Queue and Interrupt use this model for the next parent turn. Delegate uses it for the worker only. Attached files stay in the composer.</p>
        <div className="sender-options">
          <button type="button" disabled={pending} onClick={() => void choose('clarify')}><Bot size={22} aria-hidden="true" /><strong>Delegate</strong><span>Ask a worker to handle this concern at the parent’s next safe boundary.</span></button>
          <button type="button" disabled={pending} onClick={() => void choose('queue')}><ListPlus size={22} aria-hidden="true" /><strong>Queue</strong><span>Send automatically after the current turn finishes.</span></button>
          <button type="button" disabled={pending} onClick={() => void choose('interrupt')}><CircleStop size={22} aria-hidden="true" /><strong>Interrupt</strong><span>Stop the current response, cancel waiting messages, and continue with this message.</span></button>
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
      </Dialog>}
    </>
  );
  return { action, submit, stop: interrupt, pending, stopping: flight.current.has(`stop:${context}`), ui };
}

export function SenderControls({ sender, busy, disabled }: { sender: ReturnType<typeof useChatSender>; busy: boolean; onStop: () => void; disabled: boolean }) {
  const stop = sender.action === 'stop';
  const hand = sender.action === 'handoff';
  return <div className="sender-controls">
    <button type="button" className={`sender-main ${hand ? 'handoff' : ''} ${stop ? 'stop' : ''}`}
      aria-label={sender.stopping ? 'Stopping response' : stop ? 'Stop response' : hand ? 'Choose Delegate, Queue, or Interrupt' : sender.pending ? 'Submitting message' : 'Send message'}
      aria-haspopup={hand ? 'dialog' : undefined}
      title={stop ? 'Stop the response and cancel pending messages' : hand ? 'Choose Delegate, Queue, or Interrupt — attached files stay in the composer' : 'Send message'}
      disabled={!stop && (disabled || sender.pending || sender.action === 'disabled' || sender.action === 'loading')}
      onClick={stop ? sender.stop : sender.submit}>
      {sender.action === 'loading' ? <LoaderCircle size={21} className="spin" /> : stop ? <CircleStop size={21} /> : <ArrowUp size={22} />}
    </button>
  </div>;
}
