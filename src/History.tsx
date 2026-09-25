import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Download,
  Pin,
  LoaderCircle,
  Search,
} from "lucide-react";
import { api } from "./api";
import { SessionActivity, useProjectActivity } from "./SessionActivity";
import { Button, PageCloseButton, PageHeading } from "./echoflex/Controls";
import { ConfirmDialog } from './echoflex/Dialog';
import "./history.css";

export async function saveConversationExport(value: {
  filename: string;
  content: string;
  mime: string;
}) {
  const url = URL.createObjectURL(
    new Blob([value.content], { type: value.mime }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = value.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}
export function HistoryPage({
  data,
  project,
  initialSession,
  activity,
  onClose,
  onOpen,
  onChange,
}: {
  data: any;
  project: string;
  initialSession?: string;
  activity?: any;
  onClose: () => void;
  onOpen: (project: string, session: string) => void;
  onChange: () => Promise<void>;
}) {
  const [selectedProject, setProject] = useState(project);
  const otherActivity = useProjectActivity(
    selectedProject,
    selectedProject !== project,
  );
  const sessionActivity =
    selectedProject === project ? activity : otherActivity;
  const [scope, setScope] = useState(initialSession ? "all" : "active"),
    [limit, setLimit] = useState(1000);
  const [result, setResult] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(
    new Set(initialSession ? [initialSession] : []),
  );
  const [confirmation, setConfirmation] = useState<boolean | null>(null),
    [pending, setPending] = useState(false);
  const [pinning, setPinning] = useState("");
  const [format, setFormat] = useState("markdown"),
    [includeWorkers, setWorkers] = useState(true);
  const [notice, setNotice] = useState(""),
    [undo, setUndo] = useState<any[]>([]);
  const [chatQuery, setChatQuery] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [chatResults, setChatResults] = useState<any[]>([]);
  const [chatCoverage, setChatCoverage] = useState("");
  const [chatSearchError, setChatSearchError] = useState("");
  const [chatSearching, setChatSearching] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const chatSearchVersion = useRef(0);
  const version = useRef(0),
    alive = useRef(true);
  const reload = async () => {
    if (!selectedProject) { setResult(null); setLoading(false); return; }
    const current = ++version.current;
    setLoading(true);
    try {
      const next = await api(
        "history?" +
          new URLSearchParams({
            project: selectedProject,
            scope,
            limit: String(limit),
          }),
      );
      if (alive.current && current === version.current) {
        setResult(next);
        setError("");
      }
    } catch (e) {
      if (alive.current && current === version.current)
        setError((e as Error).message);
    } finally {
      if (alive.current && current === version.current) setLoading(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      version.current++;
    };
  }, []);
  useEffect(() => {
    void reload();
    return () => {
      version.current++;
    };
  }, [selectedProject, scope, limit]);
  useEffect(() => {
    const current = ++chatSearchVersion.current;
    if (!chatQuery.trim()) { setChatResults([]); setChatSearchError(""); setChatSearching(false); return; }
    setChatSearching(true);
    setChatResults([]);
    const timer = setTimeout(() => {
      void api("history/search?" + new URLSearchParams({ q: chatQuery, project: selectedProject, model: chatModel }))
        .then((result) => {
          if (current !== chatSearchVersion.current) return;
          setChatResults(result.results); setChatCoverage(result.coverage); setChatSearchError("");
        })
        .catch((error) => { if (current === chatSearchVersion.current) setChatSearchError(error.message); })
        .finally(() => { if (current === chatSearchVersion.current) setChatSearching(false); });
    }, 180);
    return () => { clearTimeout(timer); chatSearchVersion.current++; };
  }, [chatQuery, selectedProject, chatModel, searchRevision]);
  const searching = !!chatQuery.trim();
  const matches = new Map<string, any>();
  for (const hit of chatResults) {
    const key = `${hit.project}:${hit.session}`;
    if (!matches.has(key)) matches.set(key, { ...hit, id: hit.session });
  }
  const rows = searching
    ? [...matches.values()].filter((row) => scope === "all" || (scope === "archived") === !!row.organization?.archived)
        .sort((a, b) => Number(!!b.organization?.pinnedAt) - Number(!!a.organization?.pinnedAt) || (b.updatedAt || 0) - (a.updatedAt || 0))
    : result?.sessions ?? [];
  const selectedRow = rows.find((row) => selected.has(row.id));
  const actionProject = selectedRow?.project ?? selectedProject;
  const projectArchived = !!data.settings.projects.find(
    (p) => p.id === actionProject,
  )?.organization?.archivedAt;
  async function archive(
    value: boolean,
    items = rows.filter((s) => selected.has(s.id)),
  ) {
    setPending(true);
    setError("");
    const reversed: any[] = [],
      failures: string[] = [];
    try {
      for (const row of items) {
        try {
          const saved = await api(
            "history/archive",
            {
              project: actionProject,
              session: row.id,
              archived: value,
              revision: row.organization?.revision ?? 0,
            },
            "PUT",
          );
          reversed.push({
            ...row,
            organization: saved.annotation,
            previous: !!row.organization?.archived,
          });
        } catch (e) {
          failures.push(`${row.title}: ${(e as Error).message}`);
        }
      }
      setUndo(reversed);
      setNotice(
        `${reversed.length} conversation${reversed.length === 1 ? "" : "s"} ${value ? "put away" : "restored"}.`,
      );
      setConfirmation(null);
      setSelected(new Set());
      await reload();
      setSearchRevision((value) => value + 1);
      await onChange();
      if (failures.length) setError(failures.join("\n"));
    } catch (e) {
      setError(`History changed, but refresh failed: ${(e as Error).message}`);
    } finally {
      setPending(false);
    }
  }
  async function undoArchive() {
    setPending(true);
    setError("");
    try {
      const failures: string[] = [];
      for (const row of undo)
        try {
          await api(
            "history/archive",
            {
              project: row.project ?? selectedProject,
              session: row.id,
              archived: row.previous,
              revision: row.organization.revision,
            },
            "PUT",
          );
        } catch (e) {
          failures.push(`${row.title}: ${(e as Error).message}`);
        }
      setUndo([]);
      setNotice("Undo finished.");
      await reload();
      setSearchRevision((value) => value + 1);
      await onChange();
      if (failures.length) setError(failures.join("\n"));
    } catch (e) {
      setError(`Undo finished, but refresh failed: ${(e as Error).message}`);
    } finally {
      setPending(false);
    }
  }
  async function pin(row) {
    const pinned = !row.organization?.pinnedAt;
    const previous = row.organization;
    const targetProject = row.project ?? selectedProject;
    setPending(true);
    setPinning(row.id);
    setError("");
    setResult((current) => current ? ({ ...current, sessions: current.sessions.map((item) => item.id === row.id ? { ...item, organization: { ...item.organization, pinnedAt: pinned ? Date.now() : null } } : item) }) : current);
    setChatResults((current) => current.map((item) => item.project === targetProject && item.session === row.id ? { ...item, organization: { ...item.organization, pinnedAt: pinned ? Date.now() : null } } : item));
    let saved = false;
    try {
      const annotation = await api(
        "history/pin",
        {
          project: targetProject,
          session: row.id,
          pinned,
          revision: row.organization?.revision ?? 0,
        },
        "PUT",
      );
      saved = true;
      setResult((current) => current ? ({ ...current, sessions: current.sessions.map((item) => item.id === row.id ? { ...item, organization: { ...item.organization, ...annotation } } : item) }) : current);
      setChatResults((current) => current.map((item) => item.project === targetProject && item.session === row.id ? { ...item, organization: { ...item.organization, ...annotation } } : item));
      await Promise.all([reload(), onChange()]);
    } catch (e) {
      if (!saved) {
        setResult((current) => current ? ({ ...current, sessions: current.sessions.map((item) => item.id === row.id ? { ...item, organization: previous } : item) }) : current);
        setChatResults((current) => current.map((item) => item.project === targetProject && item.session === row.id ? { ...item, organization: previous } : item));
      }
      setError(saved ? `Pin changed, but refresh failed: ${(e as Error).message}` : (e as Error).message);
    } finally {
      setPinning("");
      setPending(false);
    }
  }
  async function exportSelected() {
    setPending(true);
    setError("");
    try {
      const saved = await api("history/export", {
        project: actionProject,
        sessions: [...selected],
        format,
        includeWorkers,
      });
      const accepted = await saveConversationExport(saved);
      setNotice(
        accepted
          ? "Conversation export sent to your browser’s downloads."
          : "Export cancelled.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  const reset = () => {
    setSelected(new Set());
    setUndo([]);
    setConfirmation(null);
    setNotice("");
    setResult(null);
  };
  const busy = searching ? chatSearching : loading;
  return (
    <div
      className="page history-page"
    >
      <PageHeading title="History" actions={<PageCloseButton label="Close history" disabled={pending} onClick={onClose} />} />
      <section className="chat-search-panel" aria-label="Search conversations">
        <div className="chat-search-filters">
          <label><span><Search size={16} /> Search conversations</span><input autoFocus aria-label="Search conversation content" value={chatQuery} maxLength={200}
            placeholder="Search messages and titles…" onChange={(e) => { setSelected(new Set()); setChatQuery(e.target.value); }} /></label>
          <label>Project<select aria-label="History project" value={selectedProject} disabled={pending} onChange={(e) => {
            reset(); setProject(e.target.value); setLimit(1000);
          }}>
            <option value="">All projects</option>
            {data.settings.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
          <label>Model ID (optional)<input aria-label="Search model" value={chatModel} maxLength={200} placeholder="provider/model" onChange={(e) => { setSelected(new Set()); setChatModel(e.target.value); }} /></label>
        </div>
        <small>Search uses the local conversation index. Refresh older chats in Application settings → Content index.</small>
        {chatSearchError && <p className="notice error" role="alert">{chatSearchError}</p>}
      </section>
      <div className="history-tabs" role="group" aria-label="History filter">
        {["active", "archived", "all"].map((value) => (
          <Button
            key={value}
            disabled={pending}
            aria-pressed={scope === value}
            onClick={() => {
              reset();
              setScope(value);
            }}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </div>
      {notice && (
        <p role="status">
          {notice}{" "}
          {!!undo.length && (
            <Button disabled={pending} onClick={() => void undoArchive()}>
              Undo
            </Button>
          )}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <section
        className="history-results"
        aria-label="Conversations"
        aria-busy={busy}
      >
        {busy && (
          <p role="status">
            <LoaderCircle size={16} className="spin" /> {searching ? "Searching…" : "Loading history…"}
          </p>
        )}
        {!busy && !rows.length && <p>{searching ? "No indexed conversations matched in this view." : selectedProject ? "No conversations in this view." : "Choose a project or search across projects."}</p>}
        {!busy && rows.map((row) => (
          <div className="history-row" key={`${row.project ?? selectedProject}:${row.id}`}>
            <input
              type="checkbox"
              aria-label={`Select ${row.title}`}
              disabled={pending || busy}
              checked={selected.has(row.id)}
              onChange={(e) =>
                setSelected((old) => {
                  const next = new Set(old);
                  if (e.target.checked) {
                    if (selectedRow && selectedRow.project !== row.project) next.clear();
                    next.add(row.id);
                  } else next.delete(row.id);
                  return next;
                })
              }
            />
            <button
              className="history-open"
              disabled={pending}
              onClick={() => onOpen(row.project ?? selectedProject, row.id)}
            >
              <strong>
                {!row.imported && <SessionActivity activity={sessionActivity?.[row.id]} />}
                {row.title}
              </strong>
              <small>
                {row.imported ? 'Imported from ChatGPT / Codex · ' : ''}
                {row.organization?.archiveScope === "freelancer"
                  ? "Hidden in Freelancer · "
                  : row.organization?.nativeArchived
                    ? "Archived in OpenCode · "
                    : row.organization?.projectArchived
                      ? "Archived project · "
                      : ""}
                {searching ? `${row.projectName} · ${row.excerpt || "Title match"} · ` : row.cached ? "Previously seen · " : ""}
                {(row.time?.updated || row.updatedAt)
                  ? new Date(row.time?.updated || row.updatedAt).toLocaleDateString()
                  : "Date unavailable"}
              </small>
            </button>
            <Button
              disabled={pending || busy}
              aria-label={`${row.organization?.pinnedAt ? "Unpin" : "Pin"} ${row.title}`}
              aria-pressed={!!row.organization?.pinnedAt}
              onClick={() => void pin(row)}
            >
              {pinning === row.id ? <LoaderCircle size={16} className="spin" /> : <Pin size={16} />}
            </Button>
          </div>
        ))}
      </section>
      <small>{searching ? chatCoverage : result?.coverage}</small>
      {!searching && result?.hasMore && (
        <Button
          disabled={pending || loading}
          onClick={() => setLimit(Math.min(10000, limit * 2))}
        >
          Load more history
        </Button>
      )}
      {projectArchived && (
        <p>
          Restore this project in Application settings → Data &amp; Storage before changing
          its conversation archives.
        </p>
      )}
      {confirmation !== null ? (
        <ConfirmDialog ariaLabel="Confirm archive change"
          title={confirmation ? 'Put selected conversations away?' : 'Restore selected conversations?'}
          onCancel={() => setConfirmation(null)} onConfirm={() => void archive(confirmation)}
          busy={pending} confirmLabel={pending ? 'Applying…' : 'Confirm'} error={error}>
          <p>
            {result?.archive.native
              ? "This uses OpenCode’s archive. Related worker history stays linked."
              : "Hidden in Freelancer only. This engine does not expose a verified archive/restore contract. Other OpenCode clients are unchanged."}
          </p>
          <p>
            No files, messages, drafts, Git history or usage records are
            deleted. Running or queued work must be resolved first.
          </p>
        </ConfirmDialog>
      ) : (
        <footer>
          <div className="history-actions">
            <span>{selected.size} selected</span>
            <Button
              disabled={!selected.size || pending || busy || projectArchived}
              onClick={() => setConfirmation(true)}
            >
              <Archive size={16} />
              Archive
            </Button>
            <Button
              disabled={!selected.size || pending || busy || projectArchived}
              onClick={() => setConfirmation(false)}
            >
              <ArchiveRestore size={16} />
              Restore
            </Button>
          </div>
          <div className="history-export">
            <label>
              Export format
              <select
                aria-label="Export format"
                value={format}
                disabled={pending}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="markdown">Readable conversation (.md)</option>
                <option value="json">Conversation data (.json)</option>
              </select>
            </label>
            <label className="history-workers">
              <input
                type="checkbox"
                checked={includeWorkers}
                disabled={pending}
                onChange={(e) => setWorkers(e.target.checked)}
              />{" "}
              Include workers
            </label>
            <Button
              disabled={
                !selected.size || selected.size > 20 || pending || busy
              }
              onClick={() => void exportSelected()}
            >
              <Download size={16} />
              Export selected
            </Button>
          </div>
          <small>
            Exports can contain sensitive text and tool output. They are not
            complete backups; project files and external attachment bytes are
            not included.
          </small>
        </footer>
      )}
    </div>
  );
}
