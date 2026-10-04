import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Database,
  FolderOpen,
  HardDrive,
  HardDriveDownload,
  MessagesSquare,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import { Badge, Button, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";
import { ConfirmDialog } from "./echoflex/Dialog";
import { HelpHint } from "./HelpHint";
import { useIndexJobContext } from "./IndexJobs";
import type { HelpTopic } from "./documentation-help";
import "./content-storage.css";

type ProjectStats = {
  id: string;
  name: string;
  files: null | { sources: number; units: number; builtAt: string };
  chats: null | { conversations: number; indexedAt: number };
};
type IndexStats = {
  projects: ProjectStats[];
  chatMessages: { messages: number; models: number };
  databaseBytes: number;
  reclaimableBytes: number;
  walBytes: number;
};
type StorageProject = {
  id: string;
  name: string;
  directory: string;
  organization?: { revision?: number; archivedAt?: string };
};
type StorageLocation = {
  id: string;
  name: string;
  path: string | null;
  bytes: number | null;
  owner: string;
  note?: string;
};
type StorageData = {
  locations: StorageLocation[];
  projects: StorageProject[];
  nativeWarning?: string;
  notice?: string;
  recovery?: { automaticWorkBlocked: boolean; restore: null | { id: string; restoredAt: number } };
};

const locationHelp: Record<string, HelpTopic> = {
  local: "storage-freelancer",
  legacy: "storage-runtime",
  native: "storage-opencode",
};
const count = (value: number) => Number(value || 0).toLocaleString();
const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B`
    : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const date = (value?: string | number) => value ? new Date(value).toLocaleString() : "Not indexed";

export function ContentStorage({
  onClose,
  onChange,
}: {
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const jobs = useIndexJobContext();
  const [stats, setStats] = useState<IndexStats | null>(null);
  const [storage, setStorage] = useState<StorageData | null>(null);
  const [indexError, setIndexError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [starting, setStarting] = useState("");
  const [storagePending, setStoragePending] = useState(false);
  const [confirmCompact, setConfirmCompact] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRecovery, setConfirmRecovery] = useState<string | null>(null);
  const [confirmProject, setConfirmProject] = useState<StorageProject | null>(null);
  const indexPending = starting || (jobs?.job?.status === "running" ? jobs.job.kind : "");

  async function refreshIndex() {
    setIndexError("");
    try { setStats(await api("index/stats")); }
    catch (failure) { setIndexError((failure as Error).message); }
  }
  async function refreshStorage() {
    setStorageError("");
    try { setStorage(await api("storage")); }
    catch (failure) { setStorageError((failure as Error).message); }
  }
  async function resumeRestoredWork() {
    const restoreID=confirmRecovery;
    if(!restoreID||storagePending) return;
    setStoragePending(true);setStorageError('');
    try {
      await api('data/recovery',{restoreID,confirm:true});
      setConfirmRecovery(null);await refreshStorage();await onChange();
    } catch(failure) { setStorageError((failure as Error).message); }
    finally {setStoragePending(false);}
  }
  useEffect(() => {
    let live = true;
    void api("index/stats")
      .then((value) => { if (live) setStats(value); })
      .catch((failure) => { if (live) setIndexError(failure.message); });
    void api("storage")
      .then((value) => { if (live) setStorage(value); })
      .catch((failure) => { if (live) setStorageError(failure.message); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (jobs?.job && jobs.job.status !== "running") void refreshIndex();
  }, [jobs?.job?.id, jobs?.job?.status]);

  async function runIndex(action: string) {
    if (indexPending) return;
    setStarting(action);
    setIndexError("");
    try {
      await jobs.start(action);
      if (action === "compact") setConfirmCompact(false);
      if (action === "reset") setConfirmReset(false);
    } catch (failure) {
      setIndexError((failure as Error).message);
    } finally {
      setStarting("");
    }
  }
  async function runStorage(action: () => Promise<void>) {
    if (storagePending) return;
    setStoragePending(true);
    setStorageError("");
    try { await action(); }
    catch (failure) { setStorageError((failure as Error).message); }
    finally { setStoragePending(false); }
  }
  function archiveProject() {
    if (!confirmProject) return;
    void runStorage(async () => {
      await api("history/project", {
        project: confirmProject.id,
        archived: !confirmProject.organization?.archivedAt,
        revision: confirmProject.organization?.revision ?? 0,
      }, "PUT");
      setConfirmProject(null);
      await refreshStorage();
      await onChange();
    });
  }

  const indexedProjects = new Map(stats?.projects.map((project) => [project.id, project]) ?? []);
  const storedProjects = new Map(storage?.projects.map((project) => [project.id, project]) ?? []);
  const projectIDs = [...new Set([
    ...(storage?.projects.map((project) => project.id) ?? []),
    ...(stats?.projects.map((project) => project.id) ?? []),
  ])];
  const files = stats?.projects.reduce((total, item) => total + (item.files?.sources ?? 0), 0) ?? 0;
  const chats = stats?.projects.reduce((total, item) => total + (item.chats?.conversations ?? 0), 0) ?? 0;

  return <div className="content-storage-page">
    <PageHeading compact title="Content & Storage" icon={HardDrive} help="local-data" actions={<>
      <PageCloseButton onClick={onClose} />
    </>} />

    <nav className="content-storage-jumps" aria-label="Content and storage sections">
      <a href="#content-storage-projects">Projects</a>
      <a href="#content-storage-locations">Data locations</a>
      <a href="#content-storage-maintenance">Maintenance</a>
    </nav>

    {indexError && <div className="notice error content-storage-notice" role="alert">
      <span>Index data: {indexError}</span><Button disabled={!!indexPending} onClick={() => void refreshIndex()}>Retry index data</Button>
    </div>}
    {storage?.recovery?.automaticWorkBlocked && <Panel title="Restored work is paused">
      <p>Review restored chats, queued messages, goals, schedules, retained research sessions, and Git activity before allowing automatic work.</p>
      <Button disabled={storagePending} onClick={()=>setConfirmRecovery(storage.recovery?.restore?.id ?? null)}>Review automatic work</Button>
    </Panel>}
    {storageError && <div className="notice error content-storage-notice" role="alert">
      <span>Storage data: {storageError}</span><Button disabled={storagePending} onClick={() => void refreshStorage()}>Retry storage data</Button>
    </div>}

    {stats ? <div className="index-metrics" aria-label="Content index overview">
      <div><strong>{count(files)}</strong><span>Indexed file sources</span></div>
      <div><strong>{count(chats)}</strong><span>Conversations</span></div>
      <div><strong>{count(stats.chatMessages.messages)}</strong><span>Indexed text messages</span></div>
      <div><strong>{count(stats.chatMessages.models)}</strong><span>Models seen</span></div>
    </div> : !indexError && <p role="status">Loading index stats…</p>}

    <Panel id="content-storage-projects" title="Projects" help="index-coverage">
      {!projectIDs.length && (!stats || !storage)
        ? <p role="status">Loading projects…</p>
        : !projectIDs.length
          ? <p>No registered projects.</p>
          : <div className="content-storage-projects">{projectIDs.map((id) => {
            const indexed = indexedProjects.get(id), stored = storedProjects.get(id);
            const archived = !!stored?.organization?.archivedAt;
            return <div className="content-storage-project" key={id}>
              <div className="content-storage-project-name">
                <span><strong>{stored?.name ?? indexed?.name ?? id}</strong><Badge tone={archived ? "neutral" : "success"}>{archived ? "Archived" : "Active"}</Badge></span>
                {stored?.directory && <small>{stored.directory}</small>}
              </div>
              <div>
                {indexed ? <><strong>{count(indexed.files?.sources ?? 0)} file sources</strong><small>{count(indexed.files?.units ?? 0)} sections · {date(indexed.files?.builtAt)}</small></>
                  : stats ? <small>Index coverage unavailable</small> : indexError ? <small>Index coverage unavailable · retry above</small> : <small>Loading file coverage…</small>}
              </div>
              <div>
                {indexed ? <><strong>{count(indexed.chats?.conversations ?? 0)} {indexed.chats?.conversations === 1 ? "chat" : "chats"}</strong><small>{date(indexed.chats?.indexedAt)}</small></>
                  : stats ? <small>Conversation coverage unavailable</small> : indexError ? <small>Conversation coverage unavailable · retry above</small> : <small>Loading conversation coverage…</small>}
              </div>
              <div className="content-storage-project-action">
                {stored ? <Button disabled={storagePending} onClick={() => setConfirmProject(stored)}>
                  {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{archived ? "Restore project" : "Put project away"}
                </Button> : storageError ? <small>Archive controls unavailable</small> : <small>Loading archive status…</small>}
              </div>
            </div>;
          })}</div>}
      <div className="content-storage-panel-actions">
        <span className="content-storage-help-label">Project archiving <HelpHint topic="project-archive" /></span>
        <Button type="button" disabled={!!indexPending || !stats?.projects.length} onClick={() => void runIndex("files")}>
          <Database size={16} />{indexPending === "files" ? "Refreshing file indexes…" : "Refresh File Index"}
        </Button>
        <Button type="button" disabled={!!indexPending || !stats?.projects.length} onClick={() => void runIndex("chats")}>
          <SearchCheck size={16} />{indexPending === "chats" ? "Refreshing conversations…" : "Refresh Conversation Index"}
        </Button>
      </div>
    </Panel>

    <Panel id="content-storage-locations" title="Local data" className="storage-story" help="local-data" helpDetails={storage?.notice}>
      <div className="storage-flow" aria-label="Project and application data ownership">
        <div className="storage-flow-step"><FolderOpen size={19} /><strong>Project folders</strong></div>
        <ArrowRight className="storage-flow-arrow" size={17} aria-hidden="true" />
        <div className="storage-flow-step"><Database size={19} /><strong>Freelancer data</strong></div>
        <ArrowRight className="storage-flow-arrow" size={17} aria-hidden="true" />
        <div className="storage-flow-step"><MessagesSquare size={19} /><strong>OpenCode</strong></div>
      </div>
      {!storage && !storageError && <p role="status">Loading local data locations…</p>}
      {storage && <div className="storage-locations">{storage.locations.map((location) => <Panel key={location.id} title={location.name} help={locationHelp[location.id] ?? "local-data"} helpDetails={location.note}>
        <strong>{location.owner}</strong>
        <p className="data-location">{location.path ?? "Location unavailable"}</p>
        {location.bytes != null && <p>{(location.bytes / 1024 / 1024).toFixed(2)} MB · main file only</p>}
        <div className="action-row"><Button disabled={storagePending || !location.path}
          onClick={() => void runStorage(async () => { await api("storage/open", { location: location.id }); })}>
          <FolderOpen size={16} />Open folder
        </Button></div>
      </Panel>)}</div>}
      {storage?.nativeWarning && <p role="status">{storage.nativeWarning}</p>}
    </Panel>

    <Panel id="content-storage-maintenance" title="SQLite maintenance" help="index-maintenance">
      {stats ? <div className="index-database-stats">
        <span>Database <strong>{size(stats.databaseBytes)}</strong></span>
        <span>Free pages <strong>{size(stats.reclaimableBytes)}</strong></span>
        <span>Write-ahead log <strong>{size(stats.walBytes)}</strong></span>
        <Button type="button" disabled={!!indexPending} onClick={() => void refreshIndex()}><RefreshCw size={16} />Refresh stats</Button>
      </div> : !indexError && <p role="status">Loading database stats…</p>}
      <div className="index-maintenance">
        <div><span><strong>Start search indexes clean</strong><HelpHint topic="index-reset" /></span><Button type="button" disabled={!!indexPending} onClick={() => setConfirmReset(true)}><Database size={16} />Start clean</Button></div>
        <div><span><strong>Optimize search</strong><HelpHint topic="index-optimize" /></span><Button type="button" disabled={!!indexPending} onClick={() => void runIndex("optimize")}><RefreshCw size={16} />Optimize</Button></div>
        <div><span><strong>Check database</strong><HelpHint topic="index-check" /></span><Button type="button" disabled={!!indexPending} onClick={() => void runIndex("check")}><ShieldCheck size={16} />Check</Button></div>
        <div><span><strong>Compact database</strong><HelpHint topic="index-compact" /></span><Button type="button" disabled={!!indexPending} onClick={() => setConfirmCompact(true)}><HardDriveDownload size={16} />Compact</Button></div>
      </div>
    </Panel>

    {confirmCompact && <ConfirmDialog title="Compact database?" ariaLabel="Confirm database compaction"
      onCancel={() => setConfirmCompact(false)} onConfirm={() => void runIndex("compact")} busy={!!indexPending}
      confirmLabel={indexPending === "compact" ? "Compacting…" : "Compact now"} error={indexError}>
      <p>Compact Freelancer’s local SQLite database now? This needs temporary disk space.</p>
    </ConfirmDialog>}
    {confirmRecovery && <ConfirmDialog title="Allow automatic work?" ariaLabel="Confirm restored work recovery"
      onCancel={()=>setConfirmRecovery(null)} onConfirm={()=>void resumeRestoredWork()} busy={storagePending}
      confirmLabel="Allow automatic work" error={storageError}>
      <p>Confirm that you have reviewed restored chats and delivery state. Queued messages, active goals, and enabled schedules can continue. Uncertain deliveries and Git actions still require their normal review.</p>
    </ConfirmDialog>}
    {confirmReset && <ConfirmDialog title="Start search indexes clean?" ariaLabel="Confirm clean search indexes"
      onCancel={() => setConfirmReset(false)} onConfirm={() => void runIndex("reset")} busy={!!indexPending}
      confirmLabel={indexPending === "reset" ? "Resetting…" : "Clear local indexes"} error={indexError}>
      <p>Clear Freelancer’s local file and conversation search copies now? Project files, OpenCode conversations, settings, and drafts are not changed.</p>
    </ConfirmDialog>}
    {confirmProject && <ConfirmDialog ariaLabel="Confirm project archive"
      title={`${confirmProject.organization?.archivedAt ? "Restore" : "Put away"} ${confirmProject.name}?`}
      onCancel={() => setConfirmProject(null)} onConfirm={archiveProject} busy={storagePending}
      confirmLabel={storagePending
        ? confirmProject.organization?.archivedAt ? "Restoring…"
          : jobs?.job?.kind === "archive" && jobs.job.status === "completed" ? "Putting away…" : "Indexing project…"
        : "Confirm project change"} error={storageError}>
      {confirmProject.organization?.archivedAt
        ? <p>This returns the project to active navigation. Future index refreshes will include it again.</p>
        : <p>Freelancer refreshes this project’s file and conversation indexes before putting it away. Once archived, automatic index refreshes skip it until restored. This does not delete or move files, change GitHub, stop work, or change individual chat archives.</p>}
    </ConfirmDialog>}
  </div>;
}
