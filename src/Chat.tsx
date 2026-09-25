import { ProviderText, ProviderSelect } from "./ProviderColors";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  Square,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  Terminal,
  MessageSquare,
  LoaderCircle,
  Copy,
  Paperclip,
  X,
  Image as ImageIcon,
  Bot,
  CircleAlert,
} from "lucide-react";
import { Button, Badge, Empty } from "./echoflex/Controls";
import { Diff } from "./WorkspacePanels";
import {
  workspaceModels,
  modelVariant,
  resolvedVariant,
} from "../domain/workspace.mjs";
import { ModelIntelligence } from "./ModelSetup";
import { resolveTodoLayout } from "../domain/appearance.mjs";
import { hasUnfinishedTodos, todoStatusLabel } from "../domain/todos.mjs";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES } from "../domain/attachments.mjs";
import { useChatSender, SenderControls } from "./ChatSender";
import { WorkCard } from "./WorkCard";
import {
  buildRequestGroups,
  summarizeRequestWork,
  toolOutcomeStatus,
  requestWorkLabel,
  delegateChildSession,
  delegateModel,
  isHandoffPart,
  latestToolParts,
} from "../domain/chat-view.mjs";

function Code({ children, className }: { children?: any; className?: string }) {
  const [copied, setCopied] = useState(false),
    text = String(children ?? "");
  if (!className && !text.includes("\n")) return <code>{children}</code>;
  return (
    <div className="code-block">
      <div>
        <small>{className?.replace("language-", "") ?? "Text"}</small>
        <button
          aria-label="Copy code"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

const markdownComponents = {
  pre: ({ children }: { children?: any }) => <>{children}</>,
  code: Code,
  a: ({ href, children }: { href?: string; children?: any }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
  ),
};
const markdownPlugins = [remarkGfm];
const EMPTY_TODOS: any[] = [];
type PendingAttachment = { id: string; filename: string; mime: string; url: string; size: number };
function readAttachment(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const mime = file.type || "application/octet-stream";
      resolve({ id: crypto.randomUUID(), filename: file.name, mime, url: `data:${mime};base64,${String(reader.result).split(",", 2)[1] ?? ""}`, size: file.size });
    };
    reader.readAsDataURL(file);
  });
}
const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={markdownPlugins}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
function Tool({ part, onChild, modelFallback }: { part: any; onChild: (id: string) => void; modelFallback?: string }) {
  const state = part.state ?? {},
    meta = state.metadata ?? {},
    saved =
      meta.freelancer_delegate_display ?? meta.ai_toolkit_delegate_display;
  const input = saved?.original_input ?? state.input ?? {};
  const selection = meta.freelancer_status === "selection_required";
  const handoff =
    !selection && (!!saved || part.tool === "delegate" || part.tool === "task");
  const title = toolTitle(part);
  const child = delegateChildSession(part);
  if (selection)
    return state.status === "running" || state.status === "pending" ? (
      <span
        className="agent-activity"
        role="status"
        aria-label="Preparing agent"
      >
        <LoaderCircle size={20} className="spin" />
      </span>
    ) : null;
  if (handoff) {
    const outcome = toolOutcomeStatus(part);
    const running = outcome === "running" || outcome === "pending";
    const failed = outcome === "error";
    let result: any = null;
    try { result = typeof state.output === "string" ? JSON.parse(state.output) : state.output && typeof state.output === "object" ? state.output : null; } catch { /* Native host may truncate a long receipt. */ }
    const agentName = String(meta.agentName ?? meta.freelancer_activity?.agentName ?? result?.agent?.name ?? saved?.agent?.name ?? input.agentID ?? input.role ?? "Agent");
    const modelName = delegateModel(part) ?? modelFallback;
    const routeUnavailable = ["no_qualified_route", "delegation_unavailable"].includes(meta.freelancer_status ?? result?.status);
    const statusLabel = routeUnavailable ? "Route unavailable" : running ? "Agent working" : failed ? "Agent stopped" : "Agent finished";
    const reasons = Array.isArray(result?.routing_diagnostics?.reasons) ? result.routing_diagnostics.reasons.slice(0, 3).join(", ") : "";
    const routeExplanation = result?.result || (reasons ? `Routing reasons: ${reasons}.` : "No model qualified under the current delegation budget and provider rules.");
    const label = `${statusLabel}: ${agentName}${modelName ? ` · ${modelName}` : ""}${child ? " · Open conversation" : " · No worker started"}${reasons ? ` · ${reasons}` : ""}`;
    if (routeUnavailable && !child) return <span className="agent-activity agent-route-unavailable" role="status" aria-label={label} title={label}><CircleAlert size={16} aria-hidden="true" /><span><strong>{agentName} was not started</strong><small>{routeExplanation}</small></span></span>;
    return (
      <button
        type="button"
        className={`agent-activity agent-card ${running ? "running" : ""}`}
        aria-label={label}
        title={label}
        disabled={!child}
        onClick={() => child && onChild(child)}
      >
        <span className="agent-card-icon">
          {running ? <LoaderCircle size={20} className="spin" /> : failed || routeUnavailable ? <CircleAlert size={20} /> : <Bot size={20} />}
          {!running && !failed && !routeUnavailable && <Check size={10} className="agent-check" />}
        </span>
        <span className="agent-card-copy">
          <strong>{agentName}</strong>
          <small>{routeUnavailable ? "Route unavailable" : modelName ? <ProviderText provider={modelName} mark>{modelName}</ProviderText> : statusLabel}</small>
        </span>
      </button>
    );
  }
  const heading = (
    <>
      <span className="tool-symbol">
        <Terminal size={16} />
      </span>
      <span>{title}</span>
      <Badge>
        {toolOutcomeStatus(part) === "error"
          ? "Failed"
          : state.status === "completed"
          ? "Done"
          : state.status === "running"
            ? "Working"
            : state.status}
      </Badge>
      <ChevronDown size={14} />
    </>
  );
  const detail = (
    <>
      {input.filePath && (
        <p>
          <FileText size={14} /> {input.filePath}
        </p>
      )}
      <pre>
        {state.error ??
          (typeof state.output === "string"
            ? state.output
            : JSON.stringify(state.output ?? input, null, 2))}
      </pre>
      {meta.diff && typeof meta.diff === "string" && <Diff text={meta.diff} />}
      {Array.isArray(state.attachments) && state.attachments.length > 0 && (
        <div className="chat-attachments">{state.attachments.map((file: any, index: number) => <Attachment key={file.id ?? index} file={file} />)}</div>
      )}
    </>
  );
  return (
    <details className={`tool-card ${toolOutcomeStatus(part) === "error" ? "error" : ""}`}>
      <summary>{heading}</summary>
      {detail}
    </details>
  );
}
function toolTitle(part: any): string {
  const state = part.state ?? {};
  const input = state.input ?? {};
  const toolName = String(part.tool ?? "").toLowerCase().replace(/[.-]/g, "_");
  const fileName = String(input.filePath ?? input.path ?? "").split(/[\\/]/).filter(Boolean).at(-1);
  const title = {
    read: fileName ? `Read ${fileName}` : "Read a file",
    write: fileName ? `Write ${fileName}` : "Write a file",
    edit: fileName ? `Edit ${fileName}` : "Edit a file",
    glob: "Find files",
    grep: "Search the project",
    bash: input.description ?? "Run a command",
    skill: state.title ?? "Load a skill",
    content_index: contentIndexTitle(input),
    contentIndex: contentIndexTitle(input),
  }[toolName];
  if (title) return String(title);
  if (toolName.includes("content_index")) return contentIndexTitle(input);
  if (part.tool === "delegate" || part.tool === "task")
    return `Delegating to ${state.metadata?.agentName ?? input.agentID ?? input.role ?? "an agent"}`;
  return String(state.title || part.tool || "Using a tool");
}
function contentIndexTitle(input: any): string {
  const operation = String(input.operation ?? "search");
  const subject = input.query ? `: ${String(input.query)}` : "";
  return `Content index ${operation}${subject}`;
}
function Attachment({ file }: { file: any }) {
  const name = String(file.filename || file.source?.path?.split(/[\\/]/).at(-1) || "Attachment");
  const mime = String(file.mime ?? "");
  const url = String(file.url ?? "");
  const embedded = /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/.test(url);
  const external = /^https?:\/\//.test(url);
  const href = embedded || external ? url : undefined;
  return <div className="chat-attachment">
    {embedded && /^image\/(?:png|jpeg|webp|gif)$/.test(mime) ? <img src={url} alt={name} loading="lazy" /> : <span className="chat-attachment-icon">{mime.startsWith("image/") ? <ImageIcon size={18} /> : <FileText size={18} />}</span>}
    <span className="chat-attachment-name">{href ? <a href={href} download={embedded ? name : undefined} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined}>{name}</a> : name}<small>{mime || "OpenCode file"}</small></span>
  </div>;
}
function CopyResponse({ messages }: { messages: any[] }) {
  const [copied, setCopied] = useState(false);
  const text = messages.flatMap((message) => (message.parts ?? []).filter((part: any) => (part.type === "text" || part.type === "reasoning") && !message.info?.summary).map((part: any) => String(part.text ?? "").trim())).filter(Boolean).join("\n\n");
  if (!text) return null;
  return <button type="button" className="copy-response" aria-label={copied ? "Response copied" : "Copy response"} title={copied ? "Copied" : "Copy response"} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  }}>{copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? "Copied" : "Copy"}</span></button>;
}
function messageRole(m: any) {
  return m?.info?.role ?? "assistant";
}

function messageModelLabel(m: any): { provider?: string; model?: string } {
  const nativeModel = m?.info?.model;
  let model = m?.info?.modelID ?? (typeof nativeModel === "object" ? nativeModel?.modelID : nativeModel) ?? "";
  let provider = m?.info?.providerID ?? (typeof nativeModel === "object" ? nativeModel?.providerID : "") ?? "";
  if (!provider && typeof model === "string" && model.includes("/")) {
    [provider, model] = [model.slice(0, model.indexOf("/")), model.slice(model.indexOf("/") + 1)];
  }
  return {
    provider: provider || undefined,
    model: typeof model === "string" && model.trim() ? model.trim() : "",
  };
}

function groupMessages(messages: any[]) {
  const groups: { key: string; role: string; messages: any[] }[] = [];
  for (const m of messages ?? []) {
    const role = messageRole(m);
    const last = groups.at(-1);
    if (last && last.role === role) last.messages.push(m);
    else groups.push({ key: String(m?.info?.id ?? `msg-${groups.length}`), role, messages: [m] });
  }
  return groups;
}

function distinctGroupModels(group: { messages: any[] }, catalog: any[] = []) {
  const seen = new Map<string, { provider?: string; model: string }>();
  for (const m of group.messages) {
    const { provider, model } = messageModelLabel(m);
    if (!model) continue;
    const key = `${provider ?? ""}/${model}`;
    if (!seen.has(key)) seen.set(key, { provider, model: catalog.find((row) => row.id === key)?.name ?? model });
  }
  return [...seen.values()].slice(0, 3);
}

function GroupLabel({ role, models }: { role: string; models: { provider?: string; model: string }[] }) {
  if (role === "user") return <>You</>;
  if (role !== "assistant") return <>{role.charAt(0).toUpperCase() + role.slice(1)}</>;
  if (!models.length) return <>Assistant</>;
  const [first, ...rest] = models;
  return (
    <>
      <span className="message-models" title={models.map((m) => m.model).join(", ")}>
        <ProviderText provider={first.provider} mark>{first.model}</ProviderText>
        {rest.length > 0 && <span> +{rest.length}</span>}
      </span>
    </>
  );
}

function RequestWorking({ summary, messages, onChild, live, changeCount = 0, onOpenDetails, requestKey, docked = false, expanded = false, onToggle }: {
  summary: ReturnType<typeof summarizeRequestWork>;
  messages: any[];
  onChild: (id: string) => void;
  live?: boolean;
  changeCount?: number;
  onOpenDetails?: (tab: string) => void;
  requestKey: string;
  docked?: boolean;
  expanded?: boolean;
  onToggle: (key: string) => void;
}) {
  const recorded = messages.length > 0 && messages.every(message => message.info?.imported);
  live = live && !recorded;
  if (!summary.hasWork && !changeCount && !live && !messages.some(m => m.info?.summary === true)) return null;
  const recentTools = latestToolParts(messages).reverse();
  const active = recentTools.find((part) => part.state?.status === "running") ?? recentTools.find((part) => part.state?.status === "pending");
  const latest = recentTools[0];
  const status = recorded ? 'Imported activity' : live && active ? toolTitle(active) : `${requestWorkLabel(summary, live)}${latest ? ` · ${toolTitle(latest)}` : ""}`;
  return (
    <details className={`request-working ${docked ? "is-docked" : ""}`} data-request-work-key={docked ? undefined : requestKey} open={expanded} aria-label="Work summary">
      <summary className="request-working-head" onClick={(event) => { event.preventDefault(); onToggle(requestKey); }}>
        {live ? <LoaderCircle size={16} className="spin" /> : summary.errors ? <CircleAlert size={16} /> : <Terminal size={16} />}
        <span className="request-working-title" title={status}>{status}</span>
        <span className="request-working-meta">
          {summary.toolCount + summary.workerCount > 0 && <span>{summary.toolCount + summary.workerCount} action{summary.toolCount + summary.workerCount === 1 ? "" : "s"}</span>}
          {summary.workers.total > 0 && <span>{summary.workers.total} helper{summary.workers.total === 1 ? "" : "s"}</span>}
          {summary.tasks.total > 0 && <span>{summary.tasks.completed}/{summary.tasks.total} tasks</span>}
          {summary.errors > 0 && <span className="request-working-error">{summary.errors} failed</span>}
        </span>
        <ChevronDown size={15} className="work-chevron" />
      </summary>
      <div className="request-working-body">
        {summary.tasks.total > 0 && <p className="request-working-tasks">Tasks · {summary.tasks.completed}/{summary.tasks.total}{summary.tasks.active ? ` · ${summary.tasks.active}` : ""}</p>}
        <GroupBody group={{ messages }} onChild={onChild} mode="work" />
        {changeCount > 0 && onOpenDetails && <button className="work-changes-link" type="button" onClick={() => onOpenDetails("changes")}>{changeCount} changed file{changeCount === 1 ? "" : "s"} <ArrowUpRight size={13} /></button>}
      </div>
    </details>
  );
}

function GroupBody({ group, onChild, mode = "all", childReport = false }: { group: { messages: any[] }; onChild: (id: string) => void; mode?: "all" | "work" | "prose"; childReport?: boolean }) {
  const flat: { msg: any; part: any }[] = [];
  for (const msg of group.messages)
    for (const part of msg.parts ?? []) flat.push({ msg, part });
  const visibleTools = new Set(latestToolParts(group.messages));
  const modelByChild = new Map<string, string>();
  for (const { part } of flat) {
    if (!isHandoffPart(part)) continue;
    const child = delegateChildSession(part), model = delegateModel(part);
    if (child && model) modelByChild.set(child, model);
  }
  const nodes: any[] = [];
  let textBuffer: { key: string; text: string }[] = [];
  const flushTexts = () => {
    if (!textBuffer.length) return;
    const joined = textBuffer.map((t) => t.text.trim()).filter(Boolean).join("\n\n");
    if (joined) nodes.push(<Markdown key={textBuffer[0].key + "-joined"} text={joined} />);
    textBuffer = [];
  };
  const flush = flushTexts;
  // Same part id means the same item updated or replayed: render its latest
  // snapshot once so completed work never flips back to running and replays
  // never duplicate. Distinct ids with identical text are retained.
  const lastIndexByPartID = new Map<string, number>();
  flat.forEach(({ part }, index) => {
    if (part?.id) lastIndexByPartID.set(part.id, index);
  });
  flat.forEach(({ msg, part }, index) => {
    if (part?.id && lastIndexByPartID.get(part.id) !== index) return;
    if (part.type === "tool" && !visibleTools.has(part)) return;
    const isWork = part.type === "tool" || msg.info?.summary === true;
    if (mode === "work" && !isWork || mode === "prose" && isWork) return;
    const key = `${msg?.info?.id ?? index}/${part.id ?? index}`;
    if (part.type === "text" && msg.info?.summary === true) {
      flush();
      nodes.push(<details key={key} className="reasoning"><summary>Conversation recap</summary><Markdown text={part.text ?? ""} /></details>);
    } else if (part.type === "text") {
      const text = typeof part.text === "string" ? part.text : "";
      if (!text.trim()) return;
      if (msg.info?.role === "user" && /^\[Freelancer Delegate handoff [\w-]+\]\n/.test(text)) {
        flush();
        nodes.push(<details key={key} className="handoff-card"><summary><Bot size={16} />Handoff · Delegate request<ChevronDown size={14} /></summary><pre>{text}</pre></details>);
        return;
      }
      if (childReport && msg.info?.role === "assistant" && msg.info?.time?.completed && msg.info?.finish && msg.info.finish !== "tool-calls") {
        flush();
        nodes.push(<details key={key} className="handoff-card"><summary><Bot size={16} />Handoff · Agent report<ChevronDown size={14} /></summary><div className="handoff-content"><Markdown text={text} /></div></details>);
        return;
      }
      textBuffer.push({ key, text });
    } else if (part.type === "reasoning") {
      const text = typeof part.text === "string" ? part.text : "";
      if (!text.trim()) return;
      textBuffer.push({ key, text });
    } else if (part.type === "tool") {
      flush();
      nodes.push(<Tool key={key} part={part} onChild={onChild} modelFallback={modelByChild.get(delegateChildSession(part) ?? "")} />);
    } else if (part.type === "file") {
      flush();
      nodes.push(<Attachment key={key} file={part} />);
    }
  });
  flush();
  return <>{nodes}</>;
}

export function Chat({
  data,
  messages,
  todos = EMPTY_TODOS,
  session,
  busy,
  draft,
  setDraft,
  model,
  setModel,
  variant = "inherit",
  setVariant,
  onSend,
  attachmentStore,
  onStop,
  onChild,
  onWorkflow,
  agentID,
  setAgentID,
  workflowID,
  syncing = false,
  draftLoading = false,
  captureDraft,
  acceptDraft,
  changeCount = 0,
  pendingDecisions = 0,
  onReviewDecisions,
  onOpenDetails,
}: {
  data: any;
  messages: any[];
  todos?: any[];
  session: any;
  busy: boolean;
  draft: string;
  setDraft: (s: string) => void;
  model: string;
  setModel: (s: string) => void;
  variant?: string;
  setVariant?: (value: string) => void;
  onSend: (variant: string, attachments?: { filename: string; mime: string; url: string }[]) => Promise<{ accepted: boolean; sessionID: string }> | void;
  attachmentStore?: Map<string, PendingAttachment[]>;
  onStop: () => void;
  onChild: (s: string) => void;
  onWorkflow: (w: any) => void;
  agentID: string;
  setAgentID: (id: string) => void;
  workflowID: string;
  syncing?: boolean;
  draftLoading?: boolean;
  captureDraft?: () => any;
  acceptDraft?: (token: any) => void;
  changeCount?: number;
  pendingDecisions?: number;
  onReviewDecisions?: () => void;
  onOpenDetails?: (tab: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null),
    area = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showNewActivity, setShowNewActivity] = useState(false);
  const [dock, setDock] = useState<{ key: string; push: number; height: number } | null>(null);
  const [expandedWork, setExpandedWork] = useState<string | null>(null);
  const [rollingWork, setRollingWork] = useState(false);
  const lastScrollTop = useRef(0);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const attachmentCache = useRef(attachmentStore ?? new Map<string, PendingAttachment[]>());
  const [, updateAttachments] = useState(0);
  const [attachmentError, setAttachmentError] = useState("");
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [dragging, setDragging] = useState(false);
  const attachmentContext = `${data.project?.id ?? ""}/${session?.id ?? ""}`;
  const attachments = attachmentCache.current.get(attachmentContext) ?? [];
  const saveAttachments = (context: string, items: PendingAttachment[]) => {
    attachmentCache.current.delete(context);
    if (items.length) attachmentCache.current.set(context, items);
    while (attachmentCache.current.size > 4) attachmentCache.current.delete(attachmentCache.current.keys().next().value!);
    updateAttachments((value) => value + 1);
  };
  const addAttachments = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    const context = attachmentContext;
    const previous = attachmentCache.current.get(context) ?? [];
    const total = [...previous.map((file) => file.size), ...selected.map((file) => file.size)].reduce((sum, size) => sum + size, 0);
    if (previous.length + selected.length > MAX_ATTACHMENTS || selected.some((file) => !file.size || file.size > MAX_ATTACHMENT_BYTES || !file.name || file.name.length > 160 || /[\\/\x00-\x1f]/.test(file.name)) || total > MAX_TOTAL_ATTACHMENT_BYTES) {
      setAttachmentError("Add up to 4 files, 4 MB each and 6 MB total.");
      return;
    }
    try {
      setReadingAttachments(true);
      const loaded = await Promise.all(selected.map(readAttachment));
      const current = attachmentCache.current.get(context) ?? [];
      if (current.length + loaded.length > MAX_ATTACHMENTS || current.reduce((sum, file) => sum + file.size, 0) + loaded.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES)
        throw Error("Too many attachments were added at once.");
      saveAttachments(context, [...current, ...loaded]);
      setAttachmentError("");
    } catch (error) { setAttachmentError((error as Error).message); }
    finally { setReadingAttachments(false); }
  };
  // Presentation-only memory of each request's task list as last seen while
  // it was the active request. No second store: the frozen rows are the same
  // visible todos already supplied for that request, kept so a new request
  // starts fresh without erasing prior history. Lost on reload by design.
  const taskHistory = useRef(new Map<string, any[]>());
  const [dismissedTasks, setDismissedTasks] = useState('');
  const taskRevision = `${session?.id ?? ''}/${JSON.stringify(todos)}`;
  const taskSession = useRef(session?.id);
  if (taskSession.current !== session?.id) {
    taskSession.current = session?.id;
    taskHistory.current.clear();
  }
  const updateDock = useCallback(() => {
    const scroll = area.current;
    if (!scroll) return;
    const top = scroll.getBoundingClientRect().top;
    const cards = [...scroll.querySelectorAll<HTMLElement>('.request-working[data-request-work-key]')];
    let current: HTMLElement | undefined;
    let next: HTMLElement | undefined;
    for (const card of cards) {
      if (card.getBoundingClientRect().top <= top + 1) current = card;
      else { next = card; break; }
    }
    const key = current?.dataset.requestWorkKey;
    const height = current?.querySelector('summary')?.getBoundingClientRect().height ?? 0;
    const push = next && height ? Math.min(0, next.getBoundingClientRect().top - top - height) : 0;
    const viewportHeight = scroll.clientHeight;
    setDock((previous) => key ? previous?.key === key && Math.abs(previous.push - push) < 0.5 && previous.height === viewportHeight ? previous : { key, push, height: viewportHeight } : null);
  }, []);
  const toggleWork = useCallback((key: string) => {
    if (rollTimer.current) clearTimeout(rollTimer.current);
    setRollingWork(false);
    if (dock?.key === key) {
      setExpandedWork((previous) => previous === key ? null : key);
      return;
    }
    const scroll = area.current;
    const card = [...(scroll?.querySelectorAll<HTMLElement>('.request-working[data-request-work-key]') ?? [])].find((item) => item.dataset.requestWorkKey === key);
    if (scroll && card) {
      const delta = card.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      scroll.scrollTop += delta;
      lastScrollTop.current = scroll.scrollTop;
      updateDock();
    }
    setExpandedWork(key);
  }, [dock?.key, updateDock]);
  const followLatest = () => {
    const scroll = area.current;
    if (scroll && stick.current && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 2) {
      scroll.scrollTop = scroll.scrollHeight;
      // A streamed tool can grow the transcript. This automatic follow is not
      // a user scroll and must not roll an open work panel shut.
      lastScrollTop.current = scroll.scrollTop;
    }
  };
  useLayoutEffect(() => {
    stick.current = true;
    setShowNewActivity(false);
    setDock(null);
    setExpandedWork(null);
    if (rollTimer.current) clearTimeout(rollTimer.current);
    setRollingWork(false);
    followLatest();
  }, [session?.id]);
  useLayoutEffect(() => {
    followLatest();
    updateDock();
  }, [messages, busy]);
  useEffect(() => () => { if (rollTimer.current) clearTimeout(rollTimer.current); }, []);
  useEffect(() => {
    const scroll = area.current;
    const content = scroll?.firstElementChild;
    if (!scroll || !content) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        followLatest();
        updateDock();
      });
    });
    observer.observe(scroll);
    observer.observe(content);
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);
  const jumpToLatest = () => {
    stick.current = true;
    setShowNewActivity(false);
    followLatest();
  };
  const workflow =
    data.settings.workflows.find((w) => w.id === workflowID) ??
    data.settings.workflows[0];
  const models = workspaceModels(
    data.models ?? [],
    data.providers.connected,
    data.settings.appearance?.showDepletedModels !== false,
  );
  const inheritedAgent = data.settings.agents.find(
    (a) => a.id === workflow.agentID,
  );
  const selectedAgent =
    agentID === "inherit"
      ? inheritedAgent
      : data.settings.agents.find((a) => a.id === agentID);
  const preferences =
    data.snapshot.preferences?.defaults ??
    data.snapshot.preferences?.preferences;
  const inheritedModel =
    selectedAgent?.model && selectedAgent.model !== "auto"
      ? selectedAgent.model
      : preferences?.parentModel;
  const parentID = !["inherit", "auto", ""].includes(model)
    ? model
    : inheritedModel && inheritedModel !== "auto"
      ? inheritedModel
      : (data.nativeModels?.[selectedAgent?.id ?? "engineer"] ?? data.nativeModels?.default ?? "");
  const currentModel = workspaceModels(
    data.models ?? [],
    data.providers.connected,
  ).find((m) => m.id === parentID);
  const selectedModel = currentModel ? parentID : "";
  const intelligence = modelVariant(
    currentModel?.variants,
    variant,
    resolvedVariant(selectedAgent?.variant, preferences ?? {}),
  );
  const readOnly = !!(session?.imported || session?.organization?.archived || data?.project?.organization?.archivedAt);
  const sender = useChatSender({
    data,
    session,
    busy,
    loading: syncing,
    draft,
    setDraft,
    parentModel: selectedModel,
    intelligence,
    agentID,
    workflowID,
    models,
    onStop,
    onSend: (selectedVariant) => {
      const captured = attachments.map(({ filename, mime, url }) => ({ filename, mime, url }));
      const capturedIDs = new Set(attachments.map((file) => file.id));
      const context = attachmentContext;
      void Promise.resolve(onSend(selectedVariant, captured)).then((result) => {
        if (result?.accepted) saveAttachments(context, (attachmentCache.current.get(context) ?? []).filter((file) => !capturedIDs.has(file.id)));
        else if (result?.sessionID && `${data.project.id}/${result.sessionID}` !== context) {
          const target = `${data.project.id}/${result.sessionID}`;
          saveAttachments(target, [...(attachmentCache.current.get(target) ?? []), ...(attachmentCache.current.get(context) ?? []).filter((file) => capturedIDs.has(file.id))]);
          saveAttachments(context, (attachmentCache.current.get(context) ?? []).filter((file) => !capturedIDs.has(file.id)));
        }
      });
    },
    hasAttachments: attachments.length > 0,
    disabled: readOnly || syncing || draftLoading || readingAttachments,
    captureDraft,
    acceptDraft,
  });
  const actions = useRef({ onChild, onOpenDetails, onReviewDecisions });
  actions.current = { onChild, onOpenDetails, onReviewDecisions };
  const openChild = useCallback((id: string) => actions.current.onChild(id), []);
  const openDetails = useCallback((tab: string) => actions.current.onOpenDetails?.(tab), []);
  const reviewDecisions = useCallback(() => actions.current.onReviewDecisions?.(), []);
  const requestGroups = useMemo(() => buildRequestGroups(messages), [messages]);
  const requestContent = useMemo(() => requestGroups.map((request, requestIndex, all) => {
    const isLast = requestIndex === all.length - 1;
    if (isLast) taskHistory.current.set(request.key, todos);
    const requestTodos = isLast ? todos : (taskHistory.current.get(request.key) ?? EMPTY_TODOS);
    const summary = summarizeRequestWork(request.allMessages, requestTodos);
    const userGroups = groupMessages(request.userMessages);
    const responseGroups = groupMessages(request.responseMessages);
    return (
      <section key={request.key} className="request-group" aria-label={`Request ${requestIndex + 1}`}>
        {userGroups.map((group) => (
          <article key={group.key} className={`message ${group.role}`}>
            <div className="message-label"><GroupLabel role={group.role} models={[]} /></div>
            <div className="message-body"><GroupBody group={group} onChild={openChild} /></div>
          </article>
        ))}
        <RequestWorking summary={summary} changeCount={isLast ? changeCount : 0}
          live={isLast && busy} messages={request.responseMessages}
          requestKey={request.key} expanded={expandedWork === request.key && dock?.key !== request.key}
          onToggle={toggleWork} onChild={openChild} onOpenDetails={openDetails} />
        {isLast && pendingDecisions > 0 && (
          <div className="decision-banner" role="status">
            <span>Needs your decision · {pendingDecisions} pending — review to continue.</span>
            <button type="button" onClick={reviewDecisions}>Review decision</button>
          </div>
        )}
        {responseGroups.filter((group) => group.messages.some((m) => m.info?.summary !== true && (m.info?.error || m.parts?.some((p) => (p.type === "text" || p.type === "reasoning") && p.text?.trim() || p.type === "file")))).map((group) => (
          <article key={group.key} className={`message ${group.role}`}>
            <div className="message-label"><GroupLabel role={group.role} models={group.role === "assistant" ? distinctGroupModels(group, data.models) : []} />{group.role === "assistant" && <CopyResponse messages={group.messages} />}</div>
            <div className="message-body">
              <GroupBody group={group} onChild={openChild} mode="prose" childReport={!!session?.parentID} />
              {group.messages.some((m) => m.info?.error) && (
                <p className="notice error">{group.messages.find((m) => m.info?.error)?.info.error.data?.message ?? "This response stopped. You can try again."}</p>
              )}
            </div>
          </article>
        ))}
      </section>
    );
  }), [requestGroups, todos, busy, changeCount, pendingDecisions, data.models, expandedWork, dock?.key, toggleWork, openChild, openDetails, reviewDecisions]);
  const dockIndex = requestGroups.findIndex((request) => request.key === dock?.key);
  const dockRequest = dockIndex < 0 ? null : requestGroups[dockIndex];
  const dockTodos = dockIndex === requestGroups.length - 1 ? todos : (taskHistory.current.get(dockRequest?.key ?? "") ?? EMPTY_TODOS);
  useLayoutEffect(() => { updateDock(); }, [requestContent, updateDock]);
  return (
    <div className="chat-view" aria-busy={syncing}>
      <div
        className="chat-scroll"
        ref={area}
        onScroll={() => {
          const x = area.current!;
          const movement = x.scrollTop - lastScrollTop.current;
          lastScrollTop.current = x.scrollTop;
          if (movement > 2 && expandedWork && !rollingWork) {
            setRollingWork(true);
            if (rollTimer.current) clearTimeout(rollTimer.current);
            rollTimer.current = setTimeout(() => { setExpandedWork(null); setRollingWork(false); }, 650);
          }
          updateDock();
          stick.current = x.scrollHeight - x.scrollTop - x.clientHeight < 120;
          setShowNewActivity((visible) => (visible === stick.current ? !stick.current : visible));
        }}
      >
        <div className="chat-transcript">
        {!messages.length && busy ? (
          <Empty icon={LoaderCircle} title="Starting your conversation…" />
        ) : !messages.length ? (
          <div className="chat-welcome">
            <h1>What shall we make?</h1>
            <div className="suggestions">
              {(data?.settings.workflows ?? []).slice(0, 3).map((w) => (
                <button key={w.id} onClick={() => onWorkflow(w)}>
                  <ArrowUpRight size={18} />
                  {w.name}
                </button>
              ))}
            </div>
          </div>
        ) : requestContent}
        {busy && !messages.length && (
          <div className="working" aria-live="polite">
            <LoaderCircle size={16} className="spin" /> Working on it
          </div>
        )}
        <div ref={end} />
        </div>
      {dockRequest && <div className={`request-dock ${rollingWork ? "is-rolling" : ""}`} style={{ transform: `translateY(${dock?.push ?? 0}px)`, "--chat-scroll-height": `${dock?.height ?? 0}px` } as React.CSSProperties}>
        <RequestWorking summary={summarizeRequestWork(dockRequest.allMessages, dockTodos)}
          messages={dockRequest.responseMessages} requestKey={dockRequest.key} docked
          expanded={expandedWork === dockRequest.key} live={dockIndex === requestGroups.length - 1 && busy}
          changeCount={dockIndex === requestGroups.length - 1 ? changeCount : 0}
          onToggle={toggleWork} onChild={openChild} onOpenDetails={openDetails} />
      </div>}
      {showNewActivity && messages.length > 0 && (
        <div className="new-activity-row">
          <button type="button" className="new-activity" onClick={jumpToLatest}>
            Jump to latest
          </button>
        </div>
      )}
      <div className="composer-wrap">
        <div className="composer-cards">
        {resolveTodoLayout(data.settings.appearance) === 'docked' && todos.length > 0 && dismissedTasks === taskRevision && <button type="button" className="restore-work" onClick={() => setDismissedTasks('')}>Show tasks</button>}
        {resolveTodoLayout(data.settings.appearance) === "docked" && todos.length > 0 && dismissedTasks !== taskRevision && (
          <WorkCard title={`Tasks · ${todos.filter((todo) => todo.status === "completed").length}/${todos.length} complete`} icon={<Check size={16} />} onDismiss={() => setDismissedTasks(taskRevision)} dismissLabel="Dismiss task list until it changes" defaultOpen={todos.length <= 6}>
            {!busy && hasUnfinishedTodos(todos) && <p role="status">Response ended with unfinished tasks. Send a follow-up to continue.</p>}
            <div className="todo-dock-list">
              {todos.map((todo, i) => (
                <div className="todo" key={todo.id ?? i}>
                  {todo.status === "completed" ? <Check size={16} /> : todo.status === "in_progress" && busy ? <LoaderCircle size={16} className="spin" /> : <Square size={16} />}
                  <span>{todo.content}</span>
                  <small>{todoStatusLabel(todo, busy)}</small>
                </div>
              ))}
            </div>
          </WorkCard>
        )}
        {sender.ui}
        </div>
        <form
          className={dragging ? "composer dragging" : "composer"}
          onDragOver={(event) => { if (!syncing && !readOnly && !draftLoading && Array.from(event.dataTransfer.types).includes("Files")) { event.preventDefault(); setDragging(true); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
          onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); setDragging(false); if (!syncing && !readOnly && !draftLoading) void addAttachments(event.dataTransfer.files); } }}
          onSubmit={(e) => {
            e.preventDefault();
            sender.submit();
          }}
        >
          <textarea
            aria-label="Message"
            placeholder={
              session?.imported ? 'Continue in Freelancer to send a new message…' : data?.project
                ? "Describe what you want to make…"
                : "Open a project to get started…"
            }
            value={draft}
            disabled={!data?.project || syncing || draftLoading}
            readOnly={readOnly}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(event) => { if (event.clipboardData.files.length && !syncing && !readOnly && !draftLoading) { event.preventDefault(); void addAttachments(event.clipboardData.files); } }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                sender.submit();
              }
            }}
          />
          <input ref={attachmentInput} hidden type="file" multiple aria-label="Choose attachments" tabIndex={-1} onChange={(event) => { if (event.target.files) void addAttachments(event.target.files); event.target.value = ""; }} />
          {attachments.length > 0 && <div className="composer-attachments" aria-label="Attachments ready to send">{attachments.map((file) => <span className="composer-attachment" key={file.id}><FileText size={14} /><span title={file.filename}>{file.filename}</span><button type="button" aria-label={`Remove ${file.filename}`} onClick={() => saveAttachments(attachmentContext, attachments.filter((item) => item.id !== file.id))}><X size={13} /></button></span>)}</div>}
          {readingAttachments && <p className="composer-attachment-note" role="status"><LoaderCircle size={13} className="spin" /> Adding files…</p>}
          {attachments.length > 0 && <p className="composer-attachment-note">Attachments are temporary until sent; saved text drafts do not include file bytes.</p>}
          {attachmentError && <p className="composer-attachment-error" role="alert">{attachmentError}</p>}
          {busy && attachments.length > 0 && <p className="composer-attachment-note" role="status">Queue and Delegate send text only; these files stay attached for your next send.</p>}
          <div className="composer-actions">
            <button type="button" className="composer-attach" aria-label="Attach files" title="Attach files from this computer" disabled={syncing || readOnly || draftLoading} onClick={() => attachmentInput.current?.click()}><Paperclip size={17} /><span>Attach</span></button>
            <div className="composer-selects">
              <label className="composer-choice">
                <span>Workflow</span>
                <select
                  aria-label="Workflow"
                  disabled={syncing}
                  value={workflow.id}
                  onChange={(e) =>
                    onWorkflow(
                      data.settings.workflows.find(
                        (w) => w.id === e.target.value,
                      ),
                    )
                  }
                >
                  {data.settings.workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="composer-choice">
                <span>Agent</span>
                <select
                  aria-label="Agent"
                  disabled={syncing}
                  value={agentID}
                  onChange={(e) => {
                    setAgentID(e.target.value);
                    setModel("inherit");
                    setVariant?.("inherit");
                  }}
                >
                  <option value="inherit">
                    {agentID === "inherit"
                      ? (inheritedAgent?.name ?? "None")
                      : "Default"}
                  </option>
                  {data.settings.agents
                    .filter(
                      (a) =>
                        agentID !== "inherit" || a.id !== inheritedAgent?.id,
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="composer-model-pair">
                <label className="composer-choice">
                  <span>Model</span>
                  <ProviderSelect
                    provider={selectedModel}
                    aria-label="Parent model"
                    disabled={syncing}
                    value={selectedModel}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setVariant?.("inherit");
                    }}
                  >
                    <option value="" disabled>
                      {models.length ? "Choose a model" : "No available models"}
                    </option>
                    {parentID && !models.some((m) => m.id === parentID) && (
                      <option
                        value={currentModel ? parentID : ""}
                        disabled={!currentModel}
                      >
                        {data.models.find((m) => m.id === parentID)?.name ??
                          parentID}{" "}
                        {currentModel ? "(Depleted)" : "(Unavailable)"}
                      </option>
                    )}
                    {data.providers.all
                      .filter((provider) =>
                        models.some((m) => m.provider === provider.id),
                      )
                      .map((provider) => (
                        <optgroup key={provider.id} label={provider.name}>
                          {models
                            .filter((m) => m.provider === provider.id)
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                                {m.costClass === "free" ? " · Free" : ""}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                  </ProviderSelect>
                </label>
                <ModelIntelligence
                  compact
                  disabled={syncing}
                  variants={currentModel?.variants}
                  value={intelligence}
                  onChange={(v) => setVariant?.(v)}
                />
              </div>
            </div>
            <SenderControls
              sender={sender}
              busy={busy}
              onStop={onStop}
              disabled={!selectedModel || !data?.project || syncing || readOnly || draftLoading}
            />
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}
