import { ProviderText } from "./ProviderColors";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  File,
  Folder,
  Search,
  Check,
  Clock,
  Activity,
  ChevronRight,
} from "lucide-react";
import { api, query } from "./api";
import { Button, Panel, Field, Badge, Empty } from "./echoflex/Controls";
import { visibleActivity, activityLabel } from "../domain/activity.mjs";
import { ChatContributions } from "./Contributions";
import { resolveTodoLayout } from "../domain/appearance.mjs";
import { hasUnfinishedTodos, todoStatusLabel } from "../domain/todos.mjs";

export function Diff({ text }: { text: string }) {
  return (
    <pre className="diff">
      {text.split("\n").map((line, i) => (
        <span
          key={i}
          className={
            line.startsWith("+")
              ? "added"
              : line.startsWith("-")
                ? "removed"
                : line.startsWith("@@")
                  ? "hunk"
                  : ""
          }
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

function ActivityCard({ activity, onChild }: { activity: any; onChild: (id: string) => void }) {
  const completed = activity.phase === "completed";
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (completed) setOpen(false);
  }, [completed]);

  return (
    <Panel className="activity-detail-card">
      <button
        type="button"
        className="activity-detail-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="activity-detail-title">
          <ChevronRight
            size={15}
            className={open ? "activity-detail-chevron open" : "activity-detail-chevron"}
          />
          <strong>{activity.agentName ?? activity.agentID ?? activity.role ?? "Unknown agent"}</strong>
        </span>
        <Badge tone={completed ? "success" : "neutral"}>
          {activityLabel(activity.phase)}
        </Badge>
      </button>
      {open && (
        <div className="activity-detail-body">
          {activity.raw?.activity?.assignment && <p>{activity.raw.activity.assignment}</p>}
          <p>
            {activity.subject ??
              (completed
                ? "Finished the assigned work."
                : activity.phase === "failed"
                  ? "Open the agent to see what happened."
                  : "Preparing the next step")}
          </p>
          {Number.isFinite(activity.elapsedMs) && <small>{Math.round(activity.elapsedMs / 1000)}s elapsed{activity.raw?.activity?.last_meaningful_at ? ` · Last activity ${new Date(activity.raw.activity.last_meaningful_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</small>}
          {activity.raw?.worker_result && <p>{activity.raw.worker_result.summary}</p>}
          {activity.observed && (
            <small><ProviderText provider={activity.observed} mark>{activity.observed.split("/").slice(1).join("/")}</ProviderText></small>
          )}
          <div className="balance-row">
            <small>{activity.completedTools} steps completed</small>
            {activity.child && (
              <Button variant="quiet" onClick={() => onChild(activity.child)}>
                Open
                <ArrowUpRight size={14} />
              </Button>
            )}
          </div>
          <details>
            <summary>Details</summary>
            <dl>
              <dt>Selected</dt>
              <dd><ProviderText provider={activity.selected}>{activity.selected ?? "Pending"}</ProviderText></dd>
              <dt>Dispatched</dt>
              <dd><ProviderText provider={activity.dispatched}>{activity.dispatched ?? "Pending"}</ProviderText></dd>
              <dt>Observed</dt>
              <dd><ProviderText provider={activity.observed}>{activity.observed ?? "Pending"}</ProviderText></dd>
              <dt>Validation</dt>
              <dd>{activity.validation}</dd>
            </dl>
          </details>
        </div>
      )}
    </Panel>
  );
}

function CurrentFile({ project, file }: { project?: string; file: any }) {
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    if (!project || loading) return;
    setLoading(true); setError("");
    try {
      setPreview(await api("files?" + query(project) + "&content=true&path=" + encodeURIComponent(file.file)));
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  if (file.status === "Deleted") return <p className="changes-scope">Deleted from the working tree.</p>;
  return <div>
    <button className="work-changes-link" type="button" disabled={!project || loading} onClick={load}>{loading ? "Loading…" : preview ? "Refresh preview" : "Preview current file"}</button>
    {error && <p className="notice error" role="alert">{error}</p>}
    {preview && (preview.type === "binary" || preview.encoding === "base64"
      ? <p className="changes-scope">This file does not have a text preview.</p>
      : typeof preview.diff === "string" && preview.diff
        ? <Diff text={preview.diff} />
        : <><p className="changes-scope">Current file contents</p><pre className="file-preview">{preview.content}</pre></>)}
  </div>;
}

export function Details({
  chat,
  project,
  contributions,
  appearance,
  busy = false,
  requestTab,
  onChild,
}: {
  chat: any;
  project?: string;
  contributions?: any;
  appearance?: any;
  busy?: boolean;
  requestTab?: string | { tab: string; n: number };
  onChild: (id: string) => void;
}) {
  const [selectedTab, setTab] = useState("activity");
  useEffect(() => {
    const tab = typeof requestTab === "string" ? requestTab : requestTab?.tab;
    if (tab) setTab(tab);
  }, [typeof requestTab === "string" ? requestTab : `${requestTab?.tab}:${requestTab?.n}`]);
  const docked = resolveTodoLayout(appearance) === "docked";
  const tab = docked && selectedTab === "tasks" ? "activity" : selectedTab;
  const activityTime = (row: any) =>
    Date.parse(row.raw?.created_at) || Date.parse(row.updatedAt) || 0;
  const activity = [...visibleActivity(chat.activity ?? [])].sort(
    (a, b) => activityTime(b) - activityTime(a),
  );
  return (
    <aside className="work-details" id="workspace-details">
      <h2 className="details-chat-title">{chat.title || "New chat"}</h2>
      <ChatContributions contributions={contributions} />
      <nav className="tab-row">
        {["activity", "changes", ...(docked ? [] : ["tasks"])].map((id) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {id}{id === "changes" && chat.diff?.length > 0 ? ` · ${new Set(chat.diff.map(file => file.file ?? file.path)).size}` : ""}
          </button>
        ))}
      </nav>
      {tab === "activity" && (
        <>
          <div className="detail-summary">
            <span>Context</span>
            <strong>
              {chat.summary?.contextPercent == null
                ? "—"
                : `${chat.summary.contextPercent}%`}
            </strong>
          </div>
          {activity.map((a) => (
            <ActivityCard key={a.id} activity={a} onChild={onChild} />
          ))}
          {!chat.activity?.length && (
            <Empty
              icon={Activity}
              title="All in this chat"
              children="Agents will appear here when they join the work."
            />
          )}
        </>
      )}
      {tab === "tasks" && (
        <>
          {!busy && hasUnfinishedTodos(chat.todos ?? []) && <p role="status">Response ended with unfinished tasks. Send a follow-up to continue.</p>}
          {(chat.todos ?? []).map((todo, i) => (
            <div className="todo" key={todo.id ?? i}>
              {todo.status === "completed" ? (
                <Check size={16} />
              ) : (
                <Clock size={16} />
              )}
              <span>{todo.content}</span>
              <small>{todoStatusLabel(todo, busy)}</small>
            </div>
          ))}
          {!chat.todos?.length && <Empty icon={Check} title="No tasks yet" />}
        </>
      )}
      {tab === "changes" && (
        <>
          {chat.changesUnavailable && <p className="notice">Current project changes could not be loaded. Refresh to retry.</p>}
          {["session", "workspace"].map(scope => {
            const files = (chat.diff ?? []).filter(file => (file.scope ?? "session") === scope);
            if (!files.length) return null;
            return <section key={scope} aria-label={scope === "session" ? "Chat changes" : "Project changes"}>
              <p className="changes-scope">{scope === "session" ? "Recorded in this chat" : "Current project changes · includes work outside this chat"}</p>
              {files.map((file, i) => <details className="file-diff" key={file.file ?? file.path ?? i}>
                <summary><File size={15} /><span>{file.file ?? file.path}</span>
                  <small>{Number.isFinite(file.additions) ? `+${file.additions} −${file.deletions ?? 0}` : file.status ?? "Changed"}</small>
                </summary>
                {file.patch || file.before !== undefined || file.after !== undefined
                  ? <Diff text={file.patch ?? `--- Before\n${file.before ?? ""}\n+++ After\n${file.after ?? ""}`} />
                  : <CurrentFile key={`${project}/${file.file}`} project={project} file={file} />}
              </details>)}
            </section>;
          })}
          {!chat.diff?.length && !chat.changesUnavailable && <Empty icon={File} title="No changes yet" />}
        </>
      )}
    </aside>
  );
}

export function Files({ project, run }: { project: string; run: any }) {
  const [folder, setFolder] = useState(""),
    [loading, setLoading] = useState(true),
    [nodes, setNodes] = useState<any[]>([]),
    [file, setFile] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setLoading(true);
    void run(async () => {
      try {
        const rows = await api(
          "files?" + query(project) + "&path=" + encodeURIComponent(folder),
        );
        if (!cancelled) setNodes(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project, folder]);
  async function open(node) {
    if (node.type === "directory") {
      setFolder(node.path);
      return;
    }
    const value = await api(
      "files?" +
        query(project) +
        "&content=true&path=" +
        encodeURIComponent(node.path),
    );
    setFile({ ...value, path: node.path });
  }
  return (
    <div className="page files-page">
      <div className="page-title">
        <div>
          <h1>Project files</h1>
          <p>{file?.path || folder || "Your project"}</p>
        </div>
        {(folder || file) && (
          <Button
            onClick={() =>
              file
                ? setFile(null)
                : setFolder(folder.replace(/\/?[^/]+\/?$/, ""))
            }
          >
            <ArrowLeft size={15} />
            Back
          </Button>
        )}
      </div>
      {file ? (
        <Panel>
          {file.type === "binary" || file.encoding === "base64" ? (
            <p>This file does not have a text preview.</p>
          ) : (
            <pre className="file-preview">{file.content}</pre>
          )}
          {file.diff && <Diff text={file.diff} />}
        </Panel>
      ) : (
        <Panel>
          {loading ? (
            <p>Loading files…</p>
          ) : (
            nodes.map((node) => (
              <button
                className="file-row"
                key={node.path}
                onClick={() => run(() => open(node))}
              >
                {node.type === "directory" ? (
                  <Folder size={17} />
                ) : (
                  <File size={17} />
                )}
                <span>{node.name}</span>
                <ArrowUpRight size={14} />
              </button>
            ))
          )}
          {!loading && !nodes.length && <p>This folder is empty.</p>}
        </Panel>
      )}
    </div>
  );
}
