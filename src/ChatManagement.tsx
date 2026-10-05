import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, BookOpen, Download, LoaderCircle, MessageSquare, CloudUpload } from "lucide-react";
import { api } from "./api";
import { HelpHint, HelpScope } from "./HelpHint";
import { SessionActivity, useProjectActivity } from "./SessionActivity";
import { Button, Field } from "./echoflex/Controls";
import { ConfirmDialog } from "./echoflex/Dialog";

export async function saveConversationExport(value: { filename: string; content: string; mime: string }) {
  const url = URL.createObjectURL(new Blob([value.content], { type: value.mime }));
  const link = document.createElement("a");
  link.href = url; link.download = value.filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

type Project = { id: string; name: string; organization?: { archivedAt?: number | null } };
export type ConversationResult = {
  project: string; projectName: string; session: string; title: string; excerpt?: string;
  navigationSession?: string; navigationTitle?: string; evidence?: any; imported?: boolean;
  originalSourceRef?: Record<string, unknown>; sourceRevision?: { hash?: string | null };
  cached?: boolean; updatedAt?: number; goal?: any;
  organization?: { revision?: number; archived?: boolean;
    nativeArchived?: boolean; projectArchived?: boolean; archiveScope?: string | null };
};
export type RememberState = { status: "saving" | "saved" | "error"; id?: string; error?: string };
type UndoRow = ConversationResult & { previousArchived: boolean };
const identity = (row: ConversationResult) => `${row.project}:${row.navigationSession ?? row.session}`;
const target = (row: ConversationResult): ConversationResult => ({ ...row,
  session: row.navigationSession ?? row.session, title: row.navigationTitle ?? row.title,
  navigationSession: undefined, navigationTitle: undefined });
const archived = (row: ConversationResult) => !!(row.organization?.archived || row.organization?.nativeArchived ||
  row.organization?.projectArchived || row.organization?.archiveScope === "freelancer");

// Native browsing and retained search share one result collection and the
// existing history API. There is no independent management page or route.
export function ConversationResults({ projects, project, results, searching, loading = false, pages,
  currentProject, activity, initialConversation, revision, selectionScope,
  rememberBusy = false, rememberState, onOpen, onReadEvidence, onRemember, onChange }: {
  projects: Project[]; project?: string; results: ConversationResult[]; searching: boolean;
  loading?: boolean; pages?: ReactNode; currentProject?: string;
  activity?: Record<string, any>; initialConversation?: { project: string; session: string };
  revision: number; selectionScope: string;
  rememberBusy?: boolean; rememberState?: (row: ConversationResult) => RememberState | undefined;
  onOpen: (project: string, session: string) => Promise<void>;
  onReadEvidence: (row: ConversationResult) => Promise<void>; onRemember: (row: ConversationResult) => Promise<void>; onChange: () => Promise<void>;
}) {
  const [scope, setScope] = useState("all");
  const [limit, setLimit] = useState(100), [nativeRows, setNativeRows] = useState<ConversationResult[]>([]);
  const [nativeLoading, setNativeLoading] = useState(false), [nativeMore, setNativeMore] = useState(false);
  const [nativeCoverage, setNativeCoverage] = useState<string[]>([]), [nativeError, setNativeError] = useState("");
  const [nativeArchive, setNativeArchive] = useState<boolean | null>(null), [epoch, setEpoch] = useState(0);
  const [selected, setSelected] = useState(new Map<string, ConversationResult>());
  const [pending, setPending] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<UndoRow[]>([]);
  const [confirmation, setConfirmation] = useState<{ archived: boolean; items: ConversationResult[] } | null>(null);
  const [format, setFormat] = useState("markdown"), [includeWorkers, setIncludeWorkers] = useState(true);
  const activeRead = useRef(0), mutation = useRef(false), alive = useRef(true);
  const initialSelection = useRef("");
  const otherActivity = useProjectActivity(project ?? "", !!project && project !== currentProject);
  const effectiveActivity = project === currentProject ? activity : otherActivity;
  const projectIDs = projects.filter(item => !project || item.id === project).map(item => item.id).join("\n");

  useEffect(() => { alive.current = true; return () => { alive.current = false; activeRead.current++; }; }, []);
  useEffect(() => { setSelected(new Map()); setConfirmation(null); setLimit(100); }, [project, searching]);
  useEffect(() => { setSelected(new Map()); setConfirmation(null); }, [selectionScope]);
  useEffect(() => {
    if (searching) return;
    const controller = new AbortController(), generation = ++activeRead.current;
    const targets = projects.filter(item => !project || item.id === project);
    setNativeLoading(true); setNativeError(""); setNativeRows([]); setNativeMore(false);
    const rows: ConversationResult[] = [], failures: string[] = [], coverage: string[] = [];
    let next = 0, more = false, archiveSupport: boolean | null = null;
    const read = async () => {
      while (!controller.signal.aborted && next < targets.length) {
        const item = targets[next++];
        try {
          const value = await api(`history?${new URLSearchParams({ project: item.id, scope: "all", limit: String(limit) })}`,
            undefined, undefined, controller.signal);
          if (!Array.isArray(value.sessions)) throw Error("Conversation history could not be read.");
          more ||= value.hasMore === true;
          if (typeof value.archive?.native === "boolean") archiveSupport = archiveSupport === false ? false : value.archive.native;
          if (typeof value.coverage === "string" && !coverage.includes(value.coverage)) coverage.push(value.coverage);
          for (const row of value.sessions) rows.push({ ...row, project: row.project ?? item.id,
            projectName: item.name, session: row.id, updatedAt: row.time?.updated ?? row.updatedAt });
        } catch (caught) { if (!controller.signal.aborted) failures.push(`${item.name}: ${(caught as Error).message}`); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, targets.length) }, read)).then(() => {
      if (controller.signal.aborted || generation !== activeRead.current) return;
      rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.title.localeCompare(b.title));
      setNativeRows(rows); setNativeMore(more); setNativeCoverage(coverage); setNativeArchive(archiveSupport);
      setNativeError(failures.join("\n")); setNativeLoading(false);
    });
    return () => { controller.abort(); activeRead.current++; };
  }, [projectIDs, project, searching, limit, epoch, revision]);

  const sourceRows = searching ? results : nativeRows;
  const rows = sourceRows.filter(row => scope === "all" || (scope === "archived") === archived(row));
  const targets = [...new Map(rows.map(row => [identity(row), target(row)])).values()];
  const busy = !!pending || rememberBusy, reading = searching ? loading : nativeLoading;
  const selectedRows = [...selected.values()].map(row => target(sourceRows.find(item => identity(item) === identity(row)) ?? row));
  const projectArchived = (row: ConversationResult) => !!row.organization?.projectArchived ||
    !!projects.find(item => item.id === row.project)?.organization?.archivedAt;
  const archiveBlocked = (row: ConversationResult) => projectArchived(row) || !!row.goal;
  const evidenceAvailable = (row: ConversationResult) => row.evidence?.kind === "opencode-snapshot" &&
    !!row.evidence?.sourceSystemID && !!row.evidence?.snapshotRevisionSha256;

  // A reload can remove a row or change the loaded native window.
  // Keep native Load more selections only while their conversations stay visible.
  useEffect(() => {
    if (reading) return;
    const visible = new Set(rows.map(identity));
    setSelected(current => {
      const next = new Map([...current].filter(([key]) => visible.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [sourceRows, reading, scope]);

  useEffect(() => {
    if (!initialConversation?.session) return;
    const token = `${initialConversation.project}:${initialConversation.session}`;
    if (initialSelection.current === token) return;
    const row = sourceRows.find(item => item.project === initialConversation.project &&
      (item.navigationSession ?? item.session) === initialConversation.session);
    if (row) { initialSelection.current = token; setSelected(new Map([[identity(row), target(row)]])); }
  }, [initialConversation, sourceRows]);

  async function refresh() { setEpoch(value => value + 1); await onChange(); }
  async function perform(key: string, action: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true; setPending(key); setError(""); setNotice("");
    try { await action(); }
    catch (caught) { if (alive.current) setError((caught as Error).message); }
    finally { mutation.current = false; if (alive.current) setPending(""); }
  }
  async function archive(value: boolean, items: ConversationResult[]) {
    await perform("archive", async () => {
      const reversed: UndoRow[] = [], failures: string[] = [];
      for (const row of items) {
        try {
          const saved = await api("history/archive", { project: row.project, session: row.session,
            archived: value, revision: row.organization?.revision ?? 0 }, "PUT");
          reversed.push({ ...row, organization: saved.annotation, previousArchived: archived(row) });
        } catch (caught) { failures.push(`${row.title}: ${(caught as Error).message}`); }
      }
      setUndo(reversed); setConfirmation(null); setSelected(new Map());
      setNotice(`${reversed.length} conversation${reversed.length === 1 ? "" : "s"} ${value ? "archived" : "restored"}.`);
      try { await refresh(); } catch (caught) { failures.push(`Changes saved, but refresh failed: ${(caught as Error).message}`); }
      if (failures.length) setError(failures.join("\n"));
    });
  }
  async function undoArchive() {
    await perform("undo", async () => {
      const failures: string[] = [], remaining: UndoRow[] = [];
      for (const row of undo) try {
        await api("history/archive", { project: row.project, session: row.session,
          archived: row.previousArchived, revision: row.organization?.revision ?? 0 }, "PUT");
      } catch (caught) { remaining.push(row); failures.push(`${row.title}: ${(caught as Error).message}`); }
      setUndo(remaining); setNotice(remaining.length ? "Some changes could not be undone." : "Archive changes undone.");
      try { await refresh(); } catch (caught) { failures.push(`Undo saved, but refresh failed: ${(caught as Error).message}`); }
      if (failures.length) setError(failures.join("\n"));
    });
  }
  async function exportRows(items: ConversationResult[]) {
    await perform("export", async () => {
      const batches = new Map<string, string[]>();
      for (const row of items) batches.set(row.project, [...(batches.get(row.project) ?? []), row.session]);
      let files = 0;
      for (const [projectID, sessions] of batches) {
        for (let offset = 0; offset < sessions.length; offset += 20) try {
          const exported = await api("history/export", { project: projectID, sessions: sessions.slice(offset, offset + 20), format, includeWorkers });
          await saveConversationExport(exported); files++;
          setNotice(`${files} conversation export${files === 1 ? "" : "s"} sent to your browser’s downloads…`);
        } catch (caught) { throw Error(`${files ? `${files} export${files === 1 ? "" : "s"} sent to downloads; ` : ""}${(caught as Error).message}`); }
      }
      setNotice(`${files} conversation export${files === 1 ? "" : "s"} sent to your browser’s downloads.`);
    });
  }

  return <section className="content-search-group conversation-search-group" aria-label="Conversation results" aria-busy={reading || rememberBusy}>
    <HelpScope topic="history-search" details={<>{!searching && nativeCoverage.map(value => <p key={value}>{value}</p>)}
      <p>Remember saves the conversation to memory immediately. The saved reader offers Edit for an optional summary or details. Retained search results preserve their exact source window; native browsing captures the available conversation. Retrying uses the same source and memory ID. Archive controls apply to loaded conversations or the current retained-search page. Load more or continue search pages for older matches. Export all results exports the displayed conversations, deduplicated to their parent. Each download contains up to 20 parents from one project. Older pages are not included until loaded. Goal chats retain their archive controls in Project settings → Goals. Native permission and delivery safeguards remain authoritative.</p></>}>
      <h2><MessageSquare size={17} />Conversations<span>{rows.length}</span></h2>
      <div className="conversation-search-controls">
        <Field label="Conversation status"><select value={scope} disabled={busy} onChange={event => { setScope(event.target.value); setSelected(new Map()); }}>
          <option value="all">Any status</option><option value="active">Active</option><option value="archived">Archived</option>
        </select></Field>
        <Button disabled={busy || reading || !targets.length} onClick={() => void exportRows(targets)}><Download size={16} />Export all results</Button>
      </div>
      {(notice || !!undo.length) && <div className="conversation-search-notice" role="status">{notice}{!!undo.length && <Button disabled={busy} aria-label="Undo last conversation archive change" onClick={() => void undoArchive()}>Undo</Button>}</div>}
      {error && <p className="notice error conversation-search-error" role="alert">{error}</p>}
      {nativeError && !searching && <div className="notice error content-search-error" role="alert"><span>{nativeError}</span><Button disabled={busy || reading} onClick={() => setEpoch(value => value + 1)}>Retry conversations</Button></div>}
      {reading && <span role="status"><LoaderCircle size={16} className="spin" />Loading conversations…</span>}
      {!reading && !rows.length && (!nativeError || searching) && <span className="conversation-search-empty">No conversations in this view.</span>}
      <div className="indexed-search-results">{rows.map(hit => {
        const row = target(hit), key = identity(hit), parent = !!hit.navigationSession && hit.navigationSession !== hit.session;
        const remembered = rememberState?.(hit), rememberLabel = remembered?.status === "saved" ? "Open memory"
          : remembered?.status === "saving" ? "Saving…" : remembered?.status === "error" ? "Retry save" : "Remember";
        const activityRow = row.project === currentProject ? activity?.[row.session] : row.project === project ? effectiveActivity?.[row.session] : undefined;
        const archiveReason = row.goal ? "Manage this goal’s archive in Project settings → Goals." : projectArchived(row) ? "Restore the project before changing its conversation archives." : undefined;
        return <div className="content-search-conversation" key={`${hit.project}:${hit.session}`}>
          <input type="checkbox" className="conversation-search-select" aria-label={`Select ${row.title}`} checked={selected.has(key)} disabled={busy || reading}
            onChange={event => setSelected(current => { const value = new Map(current); if (event.target.checked) value.set(key, row); else value.delete(key); return value; })} />
          <button type="button" className="indexed-search-result" aria-label={`Open conversation ${hit.title} in ${hit.projectName}`} disabled={busy}
            onClick={() => void perform(`open:${key}`, () => onOpen(row.project, row.session))}>
             <span className="indexed-result-heading"><strong>{!hit.imported && <SessionActivity activity={activityRow} goal={row.goal} />}{hit.title}</strong><small>Conversation</small></span>
            <span className="indexed-result-path"><span>{hit.projectName}</span><span>{hit.imported ? "Retained import · read only" : row.organization?.projectArchived ? "Archived project" : row.organization?.archiveScope === "freelancer" ? "Hidden in Freelancer" : row.organization?.nativeArchived ? "Archived in OpenCode" : "OpenCode conversation"}</span>
              {hit.cached && <span>Previously seen</span>}{Number.isFinite(hit.updatedAt) && <time dateTime={new Date(hit.updatedAt!).toISOString()}>{new Date(hit.updatedAt!).toLocaleDateString()}</time>}</span>
            {hit.excerpt && <span className="indexed-result-excerpt">{hit.excerpt}</span>}
            <span className="indexed-result-open"><MessageSquare size={15} />{parent ? `Open parent: ${row.title}` : "Open conversation"}</span>
          </button>
          <div className="conversation-result-actions">
            <Button disabled={busy || reading || archiveBlocked(row)} title={archiveReason} aria-label={`${archived(row) ? "Restore" : "Archive"} conversation ${row.title}`}
              onClick={() => setConfirmation({ archived: !archived(row), items: [row] })}>{archived(row) ? <ArchiveRestore size={16} /> : <Archive size={16} />}{archived(row) ? "Restore" : "Archive"}</Button>
            <Button aria-label={`Export conversation ${row.title}`} disabled={busy || reading} onClick={() => void exportRows([row])}><Download size={16} />Export</Button>
            <Button disabled={busy || reading} aria-label={`${rememberLabel} conversation ${hit.title}`} title={remembered?.status === "saved" ? "Open the saved memory" : "Save this conversation to memory"} onClick={() => void onRemember(hit)}><CloudUpload size={16} />{rememberLabel}</Button>
            {evidenceAvailable(hit) && <Button disabled={busy} aria-label={`Read retained evidence ${hit.title}`} onClick={() => void perform("evidence", () => onReadEvidence(hit))}><BookOpen size={16} />Read evidence</Button>}
            {remembered?.error && <p className="notice error memory-source-error" role="alert">{remembered.error}</p>}
          </div>
        </div>;
      })}</div>
      {!searching && nativeMore && <Button disabled={busy || reading} onClick={() => setLimit(value => Math.min(10000, value * 2))}>Load more conversations</Button>}
      {searching && pages}
      <div className="conversation-export-controls">
        <Field label="Export format"><select aria-label="Export format" value={format} disabled={busy} onChange={event => setFormat(event.target.value)}>
          <option value="markdown">Readable conversation (.md)</option><option value="json">Conversation data (.json)</option>
        </select></Field>
        <label className="content-search-phrase"><input type="checkbox" checked={includeWorkers} disabled={busy} onChange={event => setIncludeWorkers(event.target.checked)} />Include workers</label>
        {!!selectedRows.length && <div className="knowledge-actions" role="group" aria-label="Selected conversation actions"><span>{selectedRows.length} selected</span>
          <Button disabled={busy || reading || selectedRows.some(archiveBlocked)} onClick={() => setConfirmation({ archived: true, items: selectedRows })}><Archive size={16} />Archive selected</Button>
          <Button disabled={busy || reading || selectedRows.some(archiveBlocked)} onClick={() => setConfirmation({ archived: false, items: selectedRows })}><ArchiveRestore size={16} />Restore selected</Button>
          <Button disabled={busy || reading} onClick={() => void exportRows(selectedRows)}><Download size={16} />Export selected</Button>
          <Button disabled={busy} onClick={() => setSelected(new Map())}>Clear selection</Button>
        </div>}
        <HelpHint topic="history-export" />
      </div>
      {confirmation && <ConfirmDialog ariaLabel="Confirm archive change" title={confirmation.archived ? "Archive selected conversations?" : "Restore selected conversations?"}
        onCancel={() => setConfirmation(null)} onConfirm={() => void archive(confirmation.archived, confirmation.items)} busy={busy} confirmLabel={busy ? "Applying…" : "Confirm"} error={error}>
        <p>{nativeArchive === true ? "This uses OpenCode’s archive. Related worker history stays linked." : "Freelancer uses the supported native archive when available, or hides the conversation in Freelancer. Retained imports are hidden locally."}</p>
        <p>No messages, files, drafts, Git history or usage records are deleted. Running, queued or uncertain work must be resolved first.</p>
      </ConfirmDialog>}
    </HelpScope>
  </section>;
}
