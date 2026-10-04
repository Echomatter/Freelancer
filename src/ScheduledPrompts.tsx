import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarClock, Check, Pause, Play, Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import { workspaceModels } from "../domain/workspace.mjs";
import { ProviderSelect } from "./ProviderColors";
import { Badge, Button, Field, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";
import "./scheduled-prompts.css";

type Draft = { id?: string; title: string; prompt: string; project: string; agent: string; model: string; frequency: string; firstRunAt: string; enabled: boolean };
const localTime = (value: string | number) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const displayTime = (value: string | number) => value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const message = (error: unknown) => error instanceof Error ? error.message : "Could not update scheduled prompts.";
const runLabel = (status: string) => ({ dispatching: "Starting chat", dispatched: "Sent to chat", skipped_missed: "Missed scheduled time", skipped_overlap: "Skipped — previous chat still active", error: "Could not start", uncertain: "Delivery uncertain — check the chat" }[status] ?? status);

export function ScheduledPrompts({ data, onClose, onOpen }: {
  data: any; onClose: () => void; onOpen: (project: string, session: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [schedulerError, setSchedulerError] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState("");
  const editor = useRef<HTMLInputElement>(null);
  const projects = data.settings.projects ?? [];
  const agents = data.settings.agents ?? [];
  const models = workspaceModels(data.models ?? [], data.providers.connected ?? []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await api("schedules", undefined, "GET", controller.signal);
        if (!controller.signal.aborted) { setRows(value.schedules); setLoadError(""); setSchedulerError(value.error ?? ""); }
      } catch (error) { if (!controller.signal.aborted) setLoadError(message(error)); }
      finally { if (!controller.signal.aborted) timer = setTimeout(load, 5000); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  useEffect(() => { if (draft) editor.current?.focus(); }, [draft?.id, !!draft]);
  const edit = (row?: any) => {
    setError(""); setNotice(""); setDeleting("");
    setDraft(row ? { ...row, firstRunAt: localTime(row.firstRunAt) } : {
      title: "", prompt: "", project: data.project?.id ?? projects[0]?.id ?? "",
      agent: agents.find(a => a.id === "engineer")?.id ?? agents[0]?.id ?? "",
      model: "", frequency: "once", firstRunAt: localTime(Date.now() + 3600000), enabled: true,
    });
  };
  const change = (patch: Partial<Draft>) => { setDraft(d => d ? { ...d, ...patch } : d); setError(""); };
  async function mutate(key: string, body: unknown, method: string, success: string) {
    if (busy) return;
    setBusy(key); setError(""); setNotice("");
    try {
      await api("schedules", body, method);
      if (key === "save") setDraft(null);
      setDeleting(""); setNotice(success);
      try { const result = await api("schedules"); setRows(result.schedules); setLoadError(""); setSchedulerError(result.error ?? ""); }
      catch (error) { setLoadError(message(error)); }
    } catch (error) { setError(message(error)); }
    finally { setBusy(""); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const date = new Date(draft.firstRunAt);
    if (!Number.isFinite(date.getTime())) { setError("Choose a valid first run time."); return; }
    await mutate("save", { ...draft, firstRunAt: date.toISOString() }, draft.id ? "PUT" : "POST", "Schedule saved.");
  }
  const name = (items: any[], id: string) => items.find(item => item.id === id)?.name ?? id;
  return <div className="scheduled-prompts">
    <PageHeading title="Scheduled prompts" icon={CalendarClock} help="schedules" actions={<>
      <Button variant="primary" disabled={!!busy || !!draft || !projects.length} onClick={() => edit()}><Plus size={16} /> New schedule</Button>
      <PageCloseButton onClick={onClose} />
    </>} />
    <div className="schedule-feedback" aria-live="polite">{notice && <span><Check size={15} aria-hidden="true" /> {notice}</span>}</div>
    {loadError && <p className="notice error" role="alert">Schedules could not be refreshed. {loadError} Retrying automatically.</p>}
    {schedulerError && <p className="notice error" role="alert">{schedulerError}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {draft && <Panel className="schedule-editor">
      <h3>{draft.id ? "Edit schedule" : "New schedule"}</h3>
      <form onSubmit={save}>
        <fieldset disabled={!!busy}>
          <Field label="Name"><input ref={editor} required maxLength={120} value={draft.title} placeholder="Morning project review" onChange={e => change({ title: e.target.value })} /></Field>
          <Field label="Prompt"><textarea required rows={5} maxLength={32000} value={draft.prompt} placeholder="Review recent changes, run the relevant checks, and summarize anything that needs attention." onChange={e => change({ prompt: e.target.value })} /></Field>
          <Field label="Project"><select required value={draft.project} onChange={e => change({ project: e.target.value })}><option value="" disabled>Choose a project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}{draft.project && !projects.some(p => p.id === draft.project) && <option value={draft.project}>Project unavailable</option>}</select></Field>
           <div className="schedule-fields">
             <Field label="Agent"><select required value={draft.agent} onChange={e => change({ agent: e.target.value })}>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}{!agents.some(a => a.id === draft.agent) && <option value={draft.agent}>Choose an available agent</option>}</select></Field>
             <Field label="Model" help="schedule-execution"><ProviderSelect required provider={draft.model} value={draft.model} onChange={e => change({ model: e.target.value })}><option value="" disabled>Choose a model</option>{models.map(m => <option key={m.id} value={m.id}>{m.name} · {m.provider}</option>)}{draft.model && !models.some(m => m.id === draft.model) && <option value={draft.model}>{draft.model} · Unavailable</option>}</ProviderSelect></Field>
           </div>
          <div className="schedule-fields">
            <Field label="Repeat" help="schedule-timing"><select value={draft.frequency} onChange={e => change({ frequency: e.target.value })}><option value="once">Once</option><option value="daily">Every day (24 hours)</option><option value="weekly">Every week (7 days)</option></select></Field>
            <Field label="First run (your local time)"><input required type="datetime-local" value={draft.firstRunAt} onChange={e => change({ firstRunAt: e.target.value })} /></Field>
          </div>
          <small className="schedule-timezone">{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
          <label className="check"><input type="checkbox" checked={draft.enabled} onChange={e => change({ enabled: e.target.checked })} /> Schedule enabled</label>
          <div className="schedule-actions"><Button type="submit" variant="primary">{busy === "save" ? "Saving…" : "Save schedule"}</Button><Button type="button" onClick={() => { setDraft(null); setError(""); }}>Cancel</Button></div>
        </fieldset>
      </form>
    </Panel>}
    {!rows && !loadError && <p role="status">Loading scheduled prompts…</p>}
    {rows?.length === 0 && !draft && <Panel className="schedule-empty"><CalendarClock size={32} aria-hidden="true" /><h3>No scheduled prompts</h3>{!projects.length && <p>Open a project to create a schedule.</p>}</Panel>}
    <div className="schedule-list">{rows?.map(row => {
      const last = row.lastStatus ? { status: row.lastStatus, startedAt: row.lastRunAt, error: row.lastError, session: row.lastSession } : null;
      return <Panel key={row.id} className="schedule-card" aria-label={row.title}>
        <div className="schedule-card-heading"><h3>{row.title}</h3><Badge tone={row.enabled ? "success" : "neutral"}>{row.enabled ? "Enabled" : row.frequency === "once" && !row.nextRunAt && last ? "Finished schedule" : "Paused"}</Badge></div>
        <p className="schedule-prompt">{row.prompt}</p>
        <div className="schedule-meta"><span>{name(projects, row.project)}</span><span>{name(agents, row.agent)}</span><span>{name(data.models ?? [], row.model)}</span></div>
        <div className="schedule-timing"><CalendarClock size={16} aria-hidden="true" /><span>{row.frequency === "once" ? "One time" : row.frequency === "daily" ? "Every 24 hours" : "Every 7 days"} · {row.enabled && row.nextRunAt ? `Next ${displayTime(row.nextRunAt)}` : "No upcoming run"}</span></div>
        {last && <div className="schedule-last"><span>Last run: {runLabel(last.status)} {last.startedAt ? `· ${displayTime(last.startedAt)}` : ""}</span>{last.error && <p className="notice error">{last.error}</p>}{last.session && <Button disabled={!!busy} onClick={async () => { setBusy(row.id); setError(""); try { await onOpen(row.project, last.session); } catch (error) { setError(message(error)); } finally { setBusy(""); } }}>Open run <ArrowUpRight size={14} /></Button>}</div>}
        <div className="schedule-actions">
          <Button disabled={!!busy || !!draft} onClick={() => edit(row)}>Edit</Button>
          {!(row.frequency === "once" && !row.nextRunAt && last) && <Button disabled={!!busy || !!draft} onClick={() => void mutate(row.id, { id: row.id, enabled: !row.enabled }, "PUT", row.enabled ? "Schedule paused." : "Schedule resumed.")}>{row.enabled ? <Pause size={14} /> : <Play size={14} />}{row.enabled ? "Pause" : "Resume"}</Button>}
          {deleting === row.id ? <><span>Delete this schedule?</span><Button variant="danger" disabled={!!busy} onClick={() => void mutate(row.id, { id: row.id }, "DELETE", "Schedule deleted. Existing chats are kept.")}>Delete schedule</Button><Button disabled={!!busy} onClick={() => setDeleting("")}>Keep</Button></> : <Button variant="quiet" aria-label={`Delete ${row.title}`} disabled={!!busy || !!draft} onClick={() => setDeleting(row.id)}><Trash2 size={15} /></Button>}
        </div>
      </Panel>;
    })}</div>
  </div>;
}
