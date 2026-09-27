import { useEffect, useState } from "react";
import { Database, HardDrive, HardDriveDownload, RefreshCw, Search, SearchCheck, ShieldCheck } from "lucide-react";
import { api } from "./api";
import { Button, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";
import "./content-index.css";
import { useIndexJobContext } from './IndexJobs';
import { ConfirmDialog } from './echoflex/Dialog';
import { HelpHint } from './HelpHint';

type ProjectStats = { id: string; name: string; files: null | { sources: number; units: number; builtAt: string }; chats: null | { conversations: number; indexedAt: number } };
type Stats = { projects: ProjectStats[]; chatMessages: { messages: number; models: number }; databaseBytes: number; reclaimableBytes: number; walBytes: number };
const count = (value: number) => Number(value || 0).toLocaleString();
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const date = (value?: string | number) => value ? new Date(value).toLocaleString() : "Not indexed";

export function ContentIndex({ onClose, onSearch, onStorage }: { onClose: () => void; onSearch: () => void; onStorage: () => void }) {
  const jobs = useIndexJobContext();
  const [stats, setStats] = useState<Stats | null>(null);
  const [starting, setPending] = useState("");
  const pending = starting || (jobs?.job?.status === 'running' ? jobs.job.kind : '');
  const [error, setError] = useState("");
  const [confirmCompact, setConfirmCompact] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  async function refresh() { setStats(await api("index/stats")); }
  useEffect(() => { let live = true; void api("index/stats")
    .then((value) => { if (live) setStats(value); })
    .catch((failure) => { if (live) setError(failure.message); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (jobs?.job && jobs.job.status !== 'running') void refresh().catch(failure => setError(failure.message));
  }, [jobs?.job?.id, jobs?.job?.status]);
  async function run(action: string) {
    if (pending) return;
    setPending(action); setError("");
    try {
      await jobs.start(action);
      if (action === 'compact') setConfirmCompact(false);
      if (action === 'reset') setConfirmReset(false);
    } catch (failure) { setError((failure as Error).message); }
    finally { setPending(""); }
  }
  const files = stats?.projects.reduce((total, item) => total + (item.files?.sources ?? 0), 0) ?? 0;
  const chats = stats?.projects.reduce((total, item) => total + (item.chats?.conversations ?? 0), 0) ?? 0;
  return <div className="content-index-page">
    <PageHeading title="Content index"
      actions={<><Button type="button" disabled={!!pending} onClick={() => void refresh().catch((failure) => setError(failure.message))}><RefreshCw size={16} />Refresh stats</Button><PageCloseButton onClick={onClose} /></>} />
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="context-actions"><Button type="button" onClick={onSearch}><Search size={16} />Search project files</Button><Button type="button" onClick={onStorage}><HardDrive size={16} />Data &amp; Storage</Button></div>
    {!stats ? <p>Loading index stats…</p> : <>
      <div className="index-metrics">
        <div><strong>{count(files)}</strong><span>Indexed file sources</span></div>
        <div><strong>{count(chats)}</strong><span>Conversations</span></div>
        <div><strong>{count(stats.chatMessages.messages)}</strong><span>Indexed text messages</span></div>
        <div><strong>{count(stats.chatMessages.models)}</strong><span>Models seen</span></div>
      </div>
      <Panel title="Index coverage" help="index-coverage">
        <div className="index-projects">{stats.projects.map((item) => <div className="index-project" key={item.id}>
          <div><strong>{item.name}</strong><small>Files: {count(item.files?.sources ?? 0)} sources · {count(item.files?.units ?? 0)} sections</small><small>File refresh: {date(item.files?.builtAt)}</small></div>
          <div><strong>{count(item.chats?.conversations ?? 0)} {(item.chats?.conversations ?? 0) === 1 ? "chat" : "chats"}</strong><small>Chat refresh: {date(item.chats?.indexedAt)}</small></div>
        </div>)}</div>
        <div className="index-actions">
          <Button type="button" disabled={!!pending || !stats.projects.length} onClick={() => void run("files")}><Database size={16} />{pending === "files" ? "Refreshing file indexes…" : "Refresh File Index"}</Button>
          <Button type="button" disabled={!!pending || !stats.projects.length} onClick={() => void run("chats")}><SearchCheck size={16} />{pending === "chats" ? "Refreshing conversations…" : "Refresh Conversation Index"}</Button>
        </div>
      </Panel>
      <Panel title="SQLite maintenance" help="index-maintenance">
        <div className="index-database-stats"><span>Database <strong>{size(stats.databaseBytes)}</strong></span><span>Free pages <strong>{size(stats.reclaimableBytes)}</strong></span><span>Write-ahead log <strong>{size(stats.walBytes)}</strong></span></div>
        <div className="index-maintenance">
          <div><span><strong>Start search indexes clean</strong><HelpHint topic="index-reset" /></span><Button type="button" disabled={!!pending} onClick={() => setConfirmReset(true)}><Database size={16} />Start clean</Button></div>
          <div><span><strong>Optimize search</strong><HelpHint topic="index-optimize" /></span><Button type="button" disabled={!!pending} onClick={() => void run("optimize")}><RefreshCw size={16} />Optimize</Button></div>
          <div><span><strong>Check database</strong><HelpHint topic="index-check" /></span><Button type="button" disabled={!!pending} onClick={() => void run("check")}><ShieldCheck size={16} />Check</Button></div>
          <div><span><strong>Compact database</strong><HelpHint topic="index-compact" /></span><Button type="button" disabled={!!pending} onClick={() => setConfirmCompact(true)}><HardDriveDownload size={16} />Compact</Button></div>
        </div>
        {confirmCompact && <ConfirmDialog title="Compact database?" ariaLabel="Confirm database compaction"
          onCancel={() => setConfirmCompact(false)} onConfirm={() => void run('compact')} busy={!!pending}
          confirmLabel={pending === 'compact' ? 'Compacting…' : 'Compact now'} error={error}>
          <p>Compact Freelancer’s local SQLite database now? This needs temporary disk space.</p>
        </ConfirmDialog>}
        {confirmReset && <ConfirmDialog title="Start search indexes clean?" ariaLabel="Confirm clean search indexes"
          onCancel={() => setConfirmReset(false)} onConfirm={() => void run('reset')} busy={!!pending}
          confirmLabel={pending === 'reset' ? 'Resetting…' : 'Clear local indexes'} error={error}>
          <p>Clear Freelancer’s local file and conversation search copies now? Project files, OpenCode conversations, settings, and drafts are not changed.</p>
        </ConfirmDialog>}
      </Panel>
    </>}
  </div>;
}
