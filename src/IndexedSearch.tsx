import { useEffect, useState, type ReactNode } from "react";
import { Database, FileSearch, FolderOpen, MessageSquare, Pin } from "lucide-react";
import { api } from "./api";
import { Button, Field, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";
import "./indexed-search.css";

type FileHit = {
  project: string;
  projectName: string;
  projectArchived: boolean;
  path: string;
  role: string;
  unit: number;
  locator: string;
  heading: string;
  excerpt: string;
};

type ConversationHit = {
  project: string;
  projectName: string;
  session: string;
  title: string;
  excerpt: string;
  imported?: boolean;
  organization?: {
    pinnedAt?: number | null;
    revision?: number;
    archiveScope?: string;
    nativeArchived?: boolean;
    projectArchived?: boolean;
  };
};

type SearchState<T> = {
  results: T[];
  error: string;
  loading: boolean;
  complete: boolean;
};

const empty = <T,>(): SearchState<T> => ({ results: [], error: "", loading: false, complete: false });

export function ContentSearch({ project, onOpenFile, onOpenConversation, onIndex, onClose, onChange, managing, onManage, management }: {
  project?: { id: string; name: string };
  onOpenFile: (project: string, path: string) => Promise<void>;
  onOpenConversation: (project: string, session: string) => Promise<void>;
  onIndex: () => void;
  onClose: () => void;
  onChange: () => Promise<void>;
  managing: boolean;
  onManage: () => void;
  management: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<SearchState<FileHit>>(empty);
  const [conversations, setConversations] = useState<SearchState<ConversationHit>>(empty);
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState("");
  const [pinning, setPinning] = useState("");
  const [revision, setRevision] = useState(0);
  const trimmed = query.trim();
  const scoped = !!project?.id;
  const params = () => new URLSearchParams({ q: trimmed, ...(project?.id ? { project: project.id } : {}) });

  useEffect(() => {
    setOpenError("");
    if (!trimmed) {
      setFiles(empty());
      setConversations(empty());
      return;
    }
    const controller = new AbortController();
    setFiles({ results: [], error: "", loading: true, complete: false });
    setConversations({ results: [], error: "", loading: true, complete: false });
    const timer = setTimeout(() => {
      void api(`index/search?${params()}`, undefined, undefined, controller.signal)
        .then((value) => { if (!controller.signal.aborted) setFiles({ results: value.results, error: "", loading: false, complete: true }); })
        .catch((failure) => {
          if (!controller.signal.aborted) setFiles({ results: [], error: (failure as Error).message, loading: false, complete: true });
        });
      void api(`history/search?${params()}`, undefined, undefined, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return;
          const unique = new Map<string, ConversationHit>();
          for (const hit of value.results) {
            const key = `${hit.project}:${hit.session}`;
            if (!unique.has(key)) unique.set(key, hit);
          }
          setConversations({ results: [...unique.values()], error: "", loading: false, complete: true });
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setConversations({ results: [], error: (failure as Error).message, loading: false, complete: true });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, project?.id, revision, managing]);

  async function open(key: string, action: () => Promise<void>) {
    setOpening(key);
    setOpenError("");
    try { await action(); }
    catch (failure) { setOpenError((failure as Error).message); setOpening(""); }
  }

  async function pin(hit: ConversationHit) {
    setPinning(hit.project + ":" + hit.session);
    setOpenError("");
    let saved = false;
    try {
      const organization = await api("history/pin", { project: hit.project, session: hit.session,
        pinned: !hit.organization?.pinnedAt, revision: hit.organization?.revision ?? 0 }, "PUT");
      saved = true;
      setConversations(current => ({ ...current, results: current.results.map(row =>
        row.project === hit.project && row.session === hit.session ? { ...row, organization: { ...row.organization, ...organization } } : row) }));
      await onChange();
    } catch (failure) { setOpenError(saved ? "Pin saved, but the workspace could not refresh. Reopen Search content to refresh." : (failure as Error).message); }
    finally { setPinning(""); }
  }

  const loading = files.loading || conversations.loading;
  const complete = files.complete && conversations.complete;
  const total = files.results.length + conversations.results.length;
  const searchLabel = scoped ? "Search project content" : "Search all content";

  if (managing) return <>{management}</>;
  return <div className="page indexed-search-page">
    <PageHeading title={searchLabel} icon={FileSearch} help="file-search" actions={<><Button type="button" onClick={onIndex}><Database size={16} />Content &amp; Storage</Button><Button onClick={onManage}>Manage chats</Button><PageCloseButton onClick={onClose} /></>} />
    <section className="indexed-search-controls" aria-label={searchLabel}>
      <div className="indexed-search-query"><Field label={searchLabel}>
        <input autoFocus type="search" maxLength={200} value={query}
          placeholder={scoped ? `Search files and conversations in ${project.name}…` : "Search files and conversations across every project…"}
          onChange={(event) => setQuery(event.target.value)} />
      </Field></div>
      <div className="content-search-scope"><span>Scope</span><strong>{scoped ? project.name : "All registered projects"}</strong></div>
    </section>

    {openError && <p className="notice error" role="alert">{openError}</p>}
    {files.error && <div className="notice error content-search-error" role="alert"><span>Files: {files.error}</span><Button onClick={() => setRevision((value) => value + 1)}>Retry search</Button></div>}
    {conversations.error && <div className="notice error content-search-error" role="alert"><span>Conversations: {conversations.error}</span><Button onClick={() => setRevision((value) => value + 1)}>Retry search</Button></div>}

    <div className="indexed-search-status" aria-live="polite">
      {loading ? <span role="status">Searching indexed content…</span>
        : complete ? <span>{total ? `${total} matching ${total === 1 ? "result" : "results"} · ${conversations.results.length} conversations · ${files.results.length} files` : "No indexed content matched."}</span>
          : null}
    </div>

    {!!conversations.results.length && <section className="content-search-group" aria-label="Conversation results">
      <h2><MessageSquare size={17} />Conversations <span>{conversations.results.length}</span></h2>
      <div className="indexed-search-results">{conversations.results.map((hit) => {
        const key = `conversation:${hit.project}:${hit.session}`;
        const archived = hit.organization?.archiveScope === "freelancer" || hit.organization?.nativeArchived || hit.organization?.projectArchived;
        return <div className="content-search-conversation" key={key}><button type="button" className="indexed-search-result"
          aria-label={`Open conversation ${hit.title} in ${hit.projectName}`} disabled={!!opening}
          onClick={() => void open(key, () => onOpenConversation(hit.project, hit.session))}>
          <span className="indexed-result-heading"><strong>{hit.title}</strong><small>{opening === key ? "Opening conversation…" : "Conversation"}</small></span>
          <span className="indexed-result-path"><span>{hit.projectName}</span><span>{hit.imported ? "Imported snapshot" : archived ? "Archived" : "OpenCode conversation"}</span></span>
          <span className="indexed-result-excerpt">{hit.excerpt || "Title match"}</span>
          <span className="indexed-result-open"><MessageSquare size={15} />Open conversation</span>
        </button><Button aria-label={`${hit.organization?.pinnedAt ? "Unpin" : "Pin"} ${hit.title}`} aria-pressed={!!hit.organization?.pinnedAt} disabled={!!pinning} onClick={() => void pin(hit)}><Pin size={16} />{hit.organization?.pinnedAt ? "Unpin" : "Pin"}</Button></div>;
      })}</div>
    </section>}

    {!!files.results.length && <section className="content-search-group" aria-label="File results">
      <h2><FolderOpen size={17} />Files <span>{files.results.length}</span></h2>
      <div className="indexed-search-results">{files.results.map((hit) => {
        const key = `file:${hit.project}:${hit.path}`;
        return <button type="button" className="indexed-search-result" key={`${key}:${hit.unit}:${hit.locator}`}
          aria-label={`Open file ${hit.projectName}/${hit.path}`} disabled={!!opening}
          onClick={() => void open(key, () => onOpenFile(hit.project, hit.path))}>
          <span className="indexed-result-heading"><strong>{hit.heading || hit.path.split(/[\\/]/).at(-1)}</strong><small>{opening === key ? "Opening project file…" : hit.role}</small></span>
          <span className="indexed-result-path"><span>{hit.projectName}{hit.projectArchived ? " · archived" : ""}</span><span>{hit.path}</span></span>
          <span className="indexed-result-excerpt">{hit.excerpt}</span>
          <span className="indexed-result-open"><FolderOpen size={15} />Open in project Files</span>
        </button>;
      })}</div>
    </section>}

    {complete && !total && !files.error && !conversations.error && <Panel className="indexed-search-empty">
      <FileSearch size={22} aria-hidden="true" />
      <strong>No indexed content found</strong>
      <p>Try different words, or refresh file and conversation indexes.</p>
      <Button type="button" onClick={onIndex}><Database size={16} />Open Content &amp; Storage</Button>
    </Panel>}
  </div>;
}
