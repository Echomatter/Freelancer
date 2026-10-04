import { useEffect, useRef, useState } from 'react';
import { Archive, MessageSquare, Pencil, Play, Plus, RotateCcw, Square, Target, X } from 'lucide-react';
import { api, query } from './api';
import { clientID } from './browser-capabilities.mjs';
import { delegationOptions } from '../shared/strategy.mjs';
import { Button, PageHeading, PageCloseButton, Panel, Field } from './echoflex/Controls';
import { Dialog } from './echoflex/Dialog';
import { HelpHint } from './HelpHint';
import './goals.css';

export function useGoals(project: string) {
  const [state, setState] = useState<{ project: string; rows: any[] }>({ project: '', rows: [] });
  const [error, setError] = useState('');
  const refresh = async () => { if (project) { const rows = await api('goals?' + query(project)); setState({ project, rows }); setError(''); } };
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const rows = await api('goals?' + query(project)); if (!stopped) { setState({ project, rows }); setError(''); } }
      catch (e) { if (!stopped) setError((e as Error).message); }
      finally { if (!stopped) timer = setTimeout(poll, 2000); }
    };
    if (project) void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [project]);
  return { rows: state.project === project ? state.rows : [], refresh, error };
}
const label = (g: any) => g.transition === 'starting' ? 'Starting…' : g.transition === 'stopping' ? 'Stopping…' : ({ ready: 'Ready', running: 'Running', paused: 'Paused', complete: 'Complete' }[g.status] ?? g.status);

export function GoalHeader({ goal, onManage, onChange }: { goal: any; onManage: () => void; onChange: () => Promise<void> }) {
  const [failure, setFailure] = useState({ id: '', message: '' });
  const [pending, setPending] = useState('');
  const flight = useRef(new Set<string>());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  if (!goal) return null;
  const identity = `${goal.project}:${goal.id}:${goal.revision}`;
  async function action(action: string) {
    if (flight.current.has(goal.id)) return;
    flight.current.add(goal.id); setPending(goal.id); setFailure({ id: goal.id, message: '' });
    try { await api('goals/action', { project: goal.project, id: goal.id, action }); await onChange(); }
    catch (e) { setFailure({ id: goal.id, message: (e as Error).message }); }
    finally { flight.current.delete(goal.id); setPending(current => current === goal.id ? '' : current); }
  }
  if (dismissed.has(identity)) return <div className="goal-header-hidden"><button type="button" className="restore-work" onClick={() => setDismissed(previous => { const next = new Set(previous); next.delete(identity); return next; })}><Target size={13} aria-hidden="true" /> Show goal</button></div>;
  return <section className="goal-header" data-status={goal.status} aria-label="Current goal">
    <div className="goal-header-identity"><Target size={19} aria-label="Goal" /><strong className="goal-header-title" title={goal.title}>{goal.title}</strong><span className="goal-status" role="status">{label(goal)}</span></div>
    <div className="goal-header-actions">
      {goal.status !== 'running' && <Button variant="primary" disabled={pending === goal.id || !!goal.transition || goal.archived} onClick={() => void action(goal.status === 'ready' ? 'start' : 'resume')}><Play size={14} />{pending === goal.id ? 'Confirming…' : goal.status === 'ready' ? 'Start goal' : 'Resume goal'}</Button>}
      {(goal.status === 'running' || goal.unsettled || goal.transition === 'stopping') && <Button variant="danger" disabled={pending === goal.id || !!goal.transition} onClick={() => void action('stop')}><Square size={14} />{pending === goal.id ? 'Stopping…' : goal.status === 'running' ? 'Stop goal' : 'Stop remaining work'}</Button>}
      <Button onClick={onManage}><Pencil size={14} />Manage goal</Button>
      <button type="button" className="icon-button work-card-dismiss" aria-label="Hide goal" title="Hide goal" onClick={() => setDismissed(previous => new Set([...previous, identity]))}><X size={14} /></button>
    </div>
    {failure.id === goal.id && failure.message && <p role="alert">{failure.message}</p>}
  </section>;
}

export function Goals({ data, goals, refresh, error: loadError, onOpen, onClose }: { data: any; goals: any[]; refresh: () => Promise<void>; error?: string; onOpen: (project: string, session: string) => Promise<void>; onClose: () => void }) {
  const project = data.project.id;
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const flight = useRef(false);
  const [archived, setArchived] = useState(false);
  const begin = (goal?: any) => { setError(''); setDraft(goal ? { ...goal, settings: { ...goal.settings, model: goal.model, agentID: goal.agentID, variant: goal.variant } } : {
    id: clientID(), title: '', objective: '', settings: { agentID: data.sessionDefaults?.agentID ?? 'engineer', model: data.sessionDefaults?.parentModel || '', variant: data.sessionDefaults?.reasoningVariant ?? '', preferences: data.projectPreferences?.defaults ?? data.snapshot?.preferences?.defaults ?? {}, freeRotation: false, autoApprove: false },
  }); };
  async function action(goal: any, action: string) {
    if (flight.current) return; flight.current = true; setPending(goal.id); setError('');
    try { await api('goals/action', { project, id: goal.id, action }); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { flight.current = false; setPending(''); }
  }
  const settings = (patch: any) => setDraft(d => ({ ...d, settings: { ...d.settings, ...patch } }));
  const preferences = (patch: any) => settings({ preferences: { ...draft.settings.preferences, ...patch } });
  const executionLocked = draft?.status === 'running' || !!draft?.transition;
  return <>
    <PageHeading title="Goals" icon={Target} help="goals" actions={<><Button variant="primary" onClick={() => begin()}><Plus size={16} aria-hidden="true" />New goal</Button><PageCloseButton onClick={onClose} /></>} />
    {(error || loadError) && <p role="alert">{error || loadError}</p>}
    <label className="goal-archive-toggle"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Show archived goals</label>
    <div className="goal-list">
      {goals.filter(g => archived || !g.archived).map(g => <Panel key={g.id} className="goal-row" data-status={g.archived ? 'archived' : g.status} aria-label={`Goal: ${g.title}`}>
        <div className="goal-row-heading"><Target size={19} aria-hidden="true" /><strong title={g.title}>{g.title}</strong><span className="goal-status" role="status">{label(g)}{g.archived ? ' · Archived' : ''}</span></div>
        <p className="goal-reason">{g.reason}</p>
        {g.events?.findLast((event: any) => event.kind === 'model') && <p className="goal-model-event">Free model switched: {g.events.findLast((event: any) => event.kind === 'model').detail}</p>}
        <div className="goal-actions">
          <Button variant={g.status === 'running' || g.archived ? 'primary' : 'secondary'} disabled={!g.session} onClick={() => onOpen(project, g.session)}><MessageSquare size={15} aria-hidden="true" />Open chat</Button>
          {!g.archived && <Button variant={g.status === 'running' ? 'danger' : 'primary'} disabled={!!pending || !!g.transition} onClick={() => void action(g, g.status === 'running' ? 'stop' : g.status === 'ready' ? 'start' : 'resume')}>{g.status === 'running' ? <Square size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{pending === g.id ? 'Confirming…' : g.status === 'running' ? 'Stop' : g.status === 'ready' ? 'Start' : 'Resume'}</Button>}
          {g.status !== 'running' && g.unsettled && <Button variant="danger" disabled={!!pending} onClick={() => void action(g, 'stop')}><Square size={15} aria-hidden="true" />Stop remaining work</Button>}
          <Button disabled={!!pending || !!g.transition} onClick={() => begin(g)}><Pencil size={15} aria-hidden="true" />Edit goal</Button>
          <Button variant="quiet" disabled={!!pending || g.status === 'running' || !!g.transition} onClick={() => void action(g, g.archived ? 'restore' : 'archive')}>{g.archived ? <RotateCcw size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}{g.archived ? 'Restore' : 'Archive'}</Button>
        </div>
        {!!g.checkpoint && <details className="goal-history"><summary>Latest checkpoint and evidence</summary><div className="goal-long-text" tabIndex={0} role="region" aria-label="Checkpoint and evidence"><p>{g.checkpoint.interpretation}</p><p>{g.checkpoint.checkpoint}</p><pre>{g.checkpoint.evidence}</pre></div></details>}
      </Panel>)}
      {!goals.length && <p>No saved goals in this project.</p>}
    </div>
    {draft && <Dialog className="goal-dialog" size="wide" icon={<Target />} title={draft.revision ? 'Edit goal' : 'New goal'} onClose={() => setDraft(null)} busy={!!pending} footer={<><Button disabled={!!pending} onClick={() => setDraft(null)}>Cancel</Button><Button variant="primary" disabled={!!pending || !draft.objective.trim() || (!!draft.revision && !draft.title.trim())} onClick={async () => {
      if (flight.current) return; flight.current = true; setPending(draft.id); setError('');
      try {
        await api('goals', { project, id: draft.id, objective: draft.objective, ...(draft.title.trim() ? { title: draft.title } : {}), ...(draft.revision ? { revision: draft.revision } : {}), ...(executionLocked ? {} : { settings: draft.settings }) }, draft.revision ? 'PUT' : 'POST');
        setDraft(null); await refresh();
      } catch (e) { setError((e as Error).message); }
      finally { flight.current = false; setPending(''); }
    }}>{pending ? 'Saving…' : 'Save goal'}</Button></>}>
      {error && <p role="alert">{error}</p>}
      <Field label="Goal title"><input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} maxLength={120} placeholder={draft.revision ? 'A short, recognizable name' : 'Optional — use a short, recognizable name'} /></Field>
      <Field label="Objective"><textarea className="goal-objective" rows={5} value={draft.objective} onChange={e => setDraft({ ...draft, objective: e.target.value })} placeholder="What should this project accomplish?" /></Field>
      {executionLocked && <p className="goal-edit-notice">Objective changes steer the existing chat. Stop the goal to change execution settings.</p>}
      <fieldset className="goal-settings" disabled={executionLocked || !!pending}><legend>Execution</legend><div className="goal-fields">
        <Field label="Agent"><select value={draft.settings.agentID} onChange={e => settings({ agentID: e.target.value })}>{data.settings.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Parent model"><select value={draft.settings.model} onChange={e => settings({ model: e.target.value, variant: '' })}><option value="">Project / agent default</option>{data.models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}</select></Field>
        <Field label="Reasoning"><select value={draft.settings.variant} onChange={e => settings({ variant: e.target.value })}><option value="">Default</option>{(data.models.find(m => m.id === draft.settings.model)?.variants ?? []).map(v => <option key={v} value={v}>{v}</option>)}</select></Field>
      </div></fieldset>
      <fieldset className="goal-settings" disabled={executionLocked || !!pending}><legend>Delegation</legend><div className="goal-fields">
        <Field label="Delegation"><select value={draft.settings.preferences.delegation === 'ask' ? 'automatic' : draft.settings.preferences.delegation ?? 'automatic'} onChange={e => preferences({ delegation: e.target.value })}>{delegationOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
        <Field label="Worker models"><select value={draft.settings.preferences.costPreference ?? 'prefer-free'} onChange={e => preferences({ costPreference: e.target.value })}><option value="free-only">Free only</option><option value="prefer-free">Prefer free</option><option value="any">All eligible models</option><option value="paid-only">Paid subscription models</option></select></Field>
        <Field label="Maximum workers"><input type="number" min={1} max={6} value={draft.settings.preferences.maxParallel ?? 3} onChange={e => preferences({ maxParallel: Number(e.target.value) })} /></Field>
      </div></fieldset>
      <fieldset className="goal-settings" disabled={executionLocked || !!pending}><legend>While running</legend><div className="goal-options">
        <label className="goal-option"><input type="checkbox" checked={draft.settings.freeRotation} onChange={e => settings({ freeRotation: e.target.checked })} /><span><strong>Switch free models if unavailable</strong></span></label>
        <label className="goal-option"><input type="checkbox" checked={draft.settings.autoApprove} onChange={e => settings({ autoApprove: e.target.checked })} /><span><strong>Approve ordinary tool requests</strong><small>Only while this goal runs. Explicit denials, paid-model consent and your Git agreement still apply.</small></span></label>
      </div></fieldset>
      <div className="card-help"><HelpHint topic="goals" /></div>
      {!!draft.revisions?.length && <details className="goal-history"><summary>Previous objective revisions</summary><div className="goal-long-text" tabIndex={0} role="region" aria-label="Previous objective revisions">{draft.revisions.map(r => <p key={r.revision}>Revision {r.revision}: {r.objective}</p>)}</div></details>}
      {error && <p role="alert">{error}</p>}
    </Dialog>}
  </>;
}
