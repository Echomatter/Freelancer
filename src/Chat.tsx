import { ProviderText, ProviderSelect } from "./ProviderColors";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConversationRail } from './echoflex/ConversationRail';
import { reportedContext, turnStatistics } from '../domain/conversation-rail.mjs';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clientID, copyText } from "./browser-capabilities.mjs";
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
import { shareSnapshot } from './snapshot-sharing.mjs';
import { ComposerMenu } from "./ComposerMenu";
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
  responseErrorLabel,
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
              await copyText(text);
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
      resolve({ id: clientID(), filename: file.name, mime, url: `data:${mime};base64,${String(reader.result).split(",", 2)[1] ?? ""}`, size: file.size });
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
function Tool({ part, onChild, modelFallback, agentFallback }: { part: any; onChild: (id: string) => void; modelFallback?: string; agentFallback?: string }) {
  const [open, setOpen] = useState(false);
  const state = part.state ?? {},
    meta = state.metadata ?? {},
    saved =
      meta.freelancer_delegate_display ?? meta.ai_toolkit_delegate_display;
  const input = saved?.original_input ?? state.input ?? {};
  const selection = meta.freelancer_status === "selection_required";
  const handoff = isHandoffPart(part);
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
    const agentName = String(meta.agentName ?? meta.freelancer_activity?.agentName ?? result?.agent?.name ?? saved?.agent?.name ?? input.agentID ?? input.agent ?? input.role ?? agentFallback ?? "Agent");
    const modelName = delegateModel(part) ?? modelFallback;
    const routeUnavailable = ["no_qualified_route", "delegation_unavailable"].includes(meta.freelancer_status ?? result?.status);
    const statusLabel = routeUnavailable ? "Route unavailable" : running ? "Agent working" : failed ? "Agent stopped" : "Agent finished";
    const reasons = Array.isArray(result?.routing_diagnostics?.reasons) ? result.routing_diagnostics.reasons.slice(0, 3).join(", ") : "";
    const routeExplanation = result?.result || (reasons ? `Routing reasons: ${reasons}.` : "No model qualified under the current delegation budget and provider rules.");
    const label = `${statusLabel}: ${agentName}${modelName ? ` · ${modelName}` : ""}${child ? " · Open conversation" : " · No worker started"}${reasons ? ` · ${reasons}` : ""}`;
    if (routeUnavailable && !child) return <span className="agent-activity agent-card agent-route-unavailable" role="status" aria-label={label} title={label}><CircleAlert size={16} aria-hidden="true" /><span><strong>{agentName} was not started</strong><small>{routeExplanation}</small></span></span>;
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
  return (
    <details className={`tool-card ${toolOutcomeStatus(part) === "error" ? "error" : ""}`} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{heading}</summary>
      {open && <>
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
      </>}
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
    return state.metadata?.freelancer_status === "catalog" ? "Inspect agent catalog"
      : state.metadata?.freelancer_status === "workers" ? "Inspect workers"
      : ["blocked", "conflict", "unavailable"].includes(state.metadata?.freelancer_status) ? state.title || "Worker unavailable"
      : input.worker && !state.metadata?.agentName
      ? "Continuing agent"
      : `Delegating to ${state.metadata?.agentName ?? input.agentID ?? input.agent ?? input.role ?? "an agent"}`;
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
    try { await copyText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
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
        <span className="work-icon">{live ? <LoaderCircle size={16} className="spin" /> : summary.errors ? <CircleAlert size={16} /> : <Terminal size={16} />}</span>
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
  const agentByChild = new Map<string, string>();
  for (const { part } of flat) {
    if (!isHandoffPart(part)) continue;
    const child = delegateChildSession(part), model = delegateModel(part);
    const meta = part.state?.metadata ?? {}, input = part.state?.input ?? {};
    const agent = meta.agentName ?? meta.freelancer_activity?.agentName ?? input.agentID ?? input.agent ?? input.role;
    if (child && model) modelByChild.set(child, model);
    if (child && agent) agentByChild.set(child, String(agent));
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
      if (childReport && msg.info?.role === 'user') {
        flush();
        nodes.push(<details key={key} className="handoff-card assignment-card"><summary><Bot size={16} />Assignment<ChevronDown size={14} /></summary><div className="handoff-content"><Markdown text={text} /></div></details>);
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
      nodes.push(<Tool key={key} part={part} onChild={onChild} modelFallback={modelByChild.get(delegateChildSession(part) ?? "")} agentFallback={agentByChild.get(delegateChildSession(part) ?? "")} />);
    } else if (part.type === "file") {
      flush();
      nodes.push(<Attachment key={key} file={part} />);
    }
  });
  flush();
  return <>{nodes}</>;
}

const RequestTurn = memo(function RequestTurn({ request, requestIndex, isLast, requestTodos, busy, changeCount, pendingDecisions, models, childReport, expanded, selectWork, openChild, reviewDecisions, railID }: any) {
    const summary = summarizeRequestWork(request.allMessages, requestTodos);
    const userGroups = groupMessages(request.userMessages);
    const responseGroups = groupMessages(request.responseMessages);
    return (
      <section key={request.key} id={`${railID}-${request.key}`} className="request-group" aria-label={`Request ${requestIndex + 1}`}>
        {userGroups.map((group) => (
          <article key={group.key} className={`message ${group.role}`}>
            <div className="message-label"><GroupLabel role={group.role} models={[]} /></div>
            <div className="message-body"><GroupBody group={group} onChild={openChild} childReport={!!childReport} /></div>
          </article>
        ))}
        {(summary.hasWork || (isLast && (busy || changeCount > 0))) && <button type="button"
          className="request-marker" data-request-work-key={request.key}
          aria-label={`Open tools for turn ${requestIndex + 1}`}
          aria-expanded={expanded} aria-controls="chat-tool-dock"
          onClick={() => { selectWork(request.key); }}>
          <span className="work-icon"><Terminal size={15} /></span>
          <span>Turn {requestIndex + 1} tools</span><small>{summary.toolCount + summary.workerCount} action{summary.toolCount + summary.workerCount === 1 ? '' : 's'}{summary.errors ? ` · ${summary.errors} failed` : ''}</small><ArrowUpRight size={14} />
        </button>}
        {isLast && pendingDecisions > 0 && (
          <div className="decision-banner" role="status">
            <span>Needs your decision · {pendingDecisions} pending — review to continue.</span>
            <button type="button" onClick={reviewDecisions}>Review decision</button>
          </div>
        )}
        {responseGroups.filter((group) => group.messages.some((m) => m.info?.summary !== true && (m.info?.error || m.parts?.some((p) => (p.type === "text" || p.type === "reasoning") && p.text?.trim() || p.type === "file")))).map((group) => (
          <article key={group.key} className={`message ${group.role}`}>
            <div className="message-label"><GroupLabel role={group.role} models={group.role === "assistant" ? distinctGroupModels(group, models) : []} />{group.role === "assistant" && <CopyResponse messages={group.messages} />}</div>
            <div className="message-body">
              <GroupBody group={group} onChild={openChild} mode="prose" childReport={!!childReport} />
              {group.messages.some((m) => m.info?.error) && (
                <p className="notice error">{responseErrorLabel(group.messages.find((m) => m.info?.error)?.info.error)}</p>
              )}
            </div>
          </article>
        ))}
      </section>
    );
});

export function Chat({
  data,
  messages,
  pendingSend,
  sending = false,
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
  agentID,
  setAgentID,
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
  pendingSend?: { text: string; attachments: { filename: string; mime: string; url: string }[]; state: 'sending' | 'accepted' | 'unconfirmed' } | null;
  sending?: boolean;
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
  agentID: string;
  setAgentID: (id: string) => void;
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
  const transcript = useRef<HTMLDivElement>(null), railID = useId();
  const stick = useRef(true);
  const [showNewActivity, setShowNewActivity] = useState(false);
  const [inspectedWork, setInspectedWork] = useState<string | null>(null);
  const [expandedWork, setExpandedWork] = useState<string | null>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
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
  const toggleWork = useCallback((key: string) => {
    setInspectedWork(key);
    setExpandedWork(previous => previous === key ? null : key);
  }, []);
  useLayoutEffect(() => {
    const input = messageInput.current;
    if (input) {
      const maximum = Math.min(240, Math.max(120, window.innerHeight * .32));
      input.style.height = '0px';
      input.style.height = Math.min(maximum, Math.max(44, input.scrollHeight)) + 'px';
    }
  }, [draft, sending, session?.id]);
  const followLatest = () => {
    const scroll = area.current;
    if (scroll && stick.current && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 2) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  };
  useLayoutEffect(() => {
    stick.current = true;
    setShowNewActivity(false);
    setInspectedWork(null);
    setExpandedWork(null);
    followLatest();
  }, [session?.id]);
  useLayoutEffect(() => {
    followLatest();
  }, [messages, busy, pendingSend]);
  useEffect(() => {
    const scroll = area.current;
    const content = scroll?.firstElementChild;
    if (!scroll || !content) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        followLatest();
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
  const models = useMemo(() => workspaceModels(
    data.models ?? [],
    data.providers.connected,
    data.settings.appearance?.showDepletedModels !== false,
  ), [data.models, data.providers.connected, data.settings.appearance?.showDepletedModels]);
  const modelProviders = useMemo(() => data.providers.all.filter((provider) =>
    models.some((m) => m.provider === provider.id),
  ), [data.providers.all, models]);
  const modelsByProvider = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const item of models) grouped.set(item.provider, [...(grouped.get(item.provider) ?? []), item]);
    return grouped;
  }, [models]);
  const selectedAgent = data.settings.agents.find((a) => a.id === agentID)
    ?? data.settings.agents.find((a) => a.id === "engineer");
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
  const selectableCurrentModels = useMemo(() => workspaceModels(
    data.models ?? [],
    data.providers.connected,
  ), [data.models, data.providers.connected]);
  const currentModel = selectableCurrentModels.find((m) => m.id === parentID);
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
    draft: sending ? '' : draft,
    setDraft,
    parentModel: selectedModel,
    intelligence,
    agentID: selectedAgent?.id ?? "engineer",
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
    disabled: readOnly || syncing || draftLoading || readingAttachments || sending,
    captureDraft,
    acceptDraft,
  });
  const actions = useRef({ onChild, onOpenDetails, onReviewDecisions });
  actions.current = { onChild, onOpenDetails, onReviewDecisions };
  const openChild = useCallback((id: string) => actions.current.onChild(id), []);
  const openDetails = useCallback((tab: string) => actions.current.onOpenDetails?.(tab), []);
  const reviewDecisions = useCallback(() => actions.current.onReviewDecisions?.(), []);
  const previousGroups = useRef<ReturnType<typeof buildRequestGroups>>([]);
  const requestGroups = useMemo(() => {
    const next = shareSnapshot(previousGroups.current, buildRequestGroups(messages));
    previousGroups.current = next;
    return next;
  }, [messages]);
  const selectWork = useCallback((key: string) => { setInspectedWork(key); setExpandedWork(key); }, []);
  const requestContent = requestGroups.map((request, requestIndex, all) => {
    const isLast = requestIndex === all.length - 1;
    if (isLast) taskHistory.current.set(request.key, todos);
    return <RequestTurn key={request.key} request={request} requestIndex={requestIndex} isLast={isLast}
      requestTodos={isLast ? todos : (taskHistory.current.get(request.key) ?? EMPTY_TODOS)}
      busy={isLast && busy} changeCount={isLast ? changeCount : 0} pendingDecisions={isLast ? pendingDecisions : 0}
      models={data.models} childReport={!!session?.parentID} expanded={expandedWork === request.key}
      selectWork={selectWork} openChild={openChild} reviewDecisions={reviewDecisions} railID={railID} />;
  });
  const currentRequest = requestGroups.at(-1);
  const dockKey = inspectedWork && requestGroups.some(request => request.key === inspectedWork) ? inspectedWork : currentRequest?.key;
  const dockIndex = requestGroups.findIndex(request => request.key === dockKey);
  const dockRequest = requestGroups[dockIndex];
  const isCurrentDock = dockKey === currentRequest?.key;
  const dockTodos = isCurrentDock ? todos : (taskHistory.current.get(dockKey ?? '') ?? EMPTY_TODOS);
  const railTurns = useMemo(() => requestGroups.map((request, index) => ({ key: request.key,
    target: `${railID}-${request.key}`, label: `Turn ${index + 1}`,
    ...turnStatistics(request, data.models, busy && index === requestGroups.length - 1),
  })), [requestGroups, data.models, busy, railID]);
  const context = useMemo(() => reportedContext(messages, data.models), [messages, data.models]);
  const dockSummary = dockRequest ? summarizeRequestWork(dockRequest.allMessages, dockTodos) : null;
  const dockHasContent = dockSummary && (dockSummary.hasWork || dockRequest.responseMessages.some(m => m.info?.summary) || (isCurrentDock && (busy || changeCount > 0)));
  useLayoutEffect(() => { setInspectedWork(null); setExpandedWork(null); }, [currentRequest?.key]);
  return (
    <div className="chat-view has-conversation-rail" aria-busy={syncing}>
      <ConversationRail scroll={area} content={transcript} turns={railTurns} selected={dockKey}
        onSelect={key => { stick.current = false; setInspectedWork(key); setExpandedWork(key); }}
        onScrollIntent={() => { stick.current = false; }} context={context} identity={attachmentContext} />
      {dockRequest && (dockHasContent || inspectedWork === dockKey) && <div className="request-dock" id="chat-tool-dock">
        <div className="request-dock-context"><span>{isCurrentDock ? 'Current turn' : `Reviewing turn ${dockIndex + 1}`}</span>
          {!isCurrentDock && <button type="button" onClick={() => { setInspectedWork(null); setExpandedWork(null); }}>Back to current turn <ArrowUpRight size={12} /></button>}</div>
        {dockHasContent ? <RequestWorking summary={dockSummary!}
          messages={dockRequest.responseMessages} requestKey={dockRequest.key} docked
          expanded={expandedWork === dockRequest.key} live={isCurrentDock && busy}
          changeCount={isCurrentDock ? changeCount : 0}
          onToggle={toggleWork} onChild={openChild} onOpenDetails={openDetails} /> : <div className="request-dock-empty">No tools recorded for this turn</div>}
      </div>}
      <div
        className="chat-scroll"
        id={`conversation-${railID}`}
        ref={area}
        onScroll={() => {
          const x = area.current!;
          stick.current = x.scrollHeight - x.scrollTop - x.clientHeight < 120;
          setShowNewActivity((visible) => (visible === stick.current ? !stick.current : visible));
        }}
      >
        <div className="chat-transcript" ref={transcript}>
        {!messages.length && !pendingSend && busy ? (
          <Empty icon={LoaderCircle} title="Starting your conversation…" />
        ) : !messages.length && !pendingSend ? (
          <div className="chat-welcome">
            <h1>What shall we make?</h1>
            <div className="suggestions">
              <p>Describe a task, question, or plan to get started.</p>
            </div>
          </div>
        ) : requestContent}
        {pendingSend && <div className="message user pending-message" aria-label="Submitted message">
          <div className="message-label">You</div>
          <div className="message-body">
            {pendingSend.text && <Markdown text={pendingSend.text} />}
            {pendingSend.attachments.map((file, index) => <Attachment key={index} file={file} />)}
            <small role="status">{pendingSend.state === 'sending' ? 'Sending…' : pendingSend.state === 'accepted' ? 'Sent · Waiting for conversation…' : 'Delivery unconfirmed · Check the conversation before sending again.'}</small>
          </div>
        </div>}
        {busy && !messages.length && !pendingSend && (
          <div className="working" aria-live="polite">
            <LoaderCircle size={16} className="spin" /> Working on it
          </div>
        )}
        <div ref={end} />
        </div>
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
          <WorkCard title={`Tasks · ${todos.filter((todo) => todo.status === "completed").length}/${todos.length} complete`} icon={<Check size={16} />} onDismiss={() => setDismissedTasks(taskRevision)} dismissLabel="Dismiss task list until it changes" defaultOpen={false} preview={!busy && hasUnfinishedTodos(todos) ? 'Unfinished tasks · send a follow-up to continue' : (todos.find(todo => todo.status === 'in_progress')?.content ?? 'View task list')}>
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
        {attachments.length > 0 && <WorkCard title={`Attachments · ${attachments.length}`} icon={<Paperclip size={16} />} defaultOpen attention={!!attachmentError} preview={attachments.map(file => file.filename).join(', ')}>
          {attachments.length > 0 && <div className="composer-attachments" aria-label="Attachments ready to send">{attachments.map((file) => <span className="composer-attachment" key={file.id}><FileText size={14} /><span title={file.filename}>{file.filename}</span><button type="button" aria-label={`Remove ${file.filename}`} onClick={() => saveAttachments(attachmentContext, attachments.filter((item) => item.id !== file.id))}><X size={13} /></button></span>)}</div>}
          {readingAttachments && <p className="composer-attachment-note" role="status"><LoaderCircle size={13} className="spin" /> Adding files…</p>}
          {attachmentError && <p className="composer-attachment-error" role="alert">{attachmentError}</p>}
          {busy && attachments.length > 0 && <p className="composer-attachment-note" role="status">Queue, Delegate, and Interrupt send text only; these files stay attached for your next send.</p>}

        </WorkCard>}
        {!attachments.length && readingAttachments && <p role="status">Adding files…</p>}
        {!attachments.length && attachmentError && <p className="composer-attachment-error" role="alert">{attachmentError}</p>}
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
          <div className="composer-entry">
          <ComposerMenu context={attachmentContext} disabled={syncing || readOnly || draftLoading} onAttach={() => attachmentInput.current?.click()}
            summary={[selectedAgent?.name ?? 'Engineer', currentModel?.name ?? 'Choose a model', intelligence].filter(Boolean).join(' · ')}>
            <div className="composer-selects">
              <label className="composer-choice">
                <span>Agent</span>
                <select
                  aria-label="Agent"
                  disabled={syncing}
                  value={selectedAgent?.id ?? "engineer"}
                  onChange={(e) => {
                    setAgentID(e.target.value);
                    setModel("inherit");
                    setVariant?.("inherit");
                  }}
                >
                  <option value={selectedAgent?.id ?? "engineer"}>
                    {selectedAgent?.name ?? "Engineer"}
                  </option>
                  {data.settings.agents
                    .filter(
                      (a) => a.id !== selectedAgent?.id,
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
                    {modelProviders.map((provider) => (
                        <optgroup key={provider.id} label={provider.name}>
                          {(modelsByProvider.get(provider.id) ?? [])
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
          </ComposerMenu>
          <textarea ref={messageInput}
            aria-label="Message"
            autoCapitalize="sentences"
            autoComplete="off"
            enterKeyHint="send"
            value={sending ? '' : draft}
            disabled={!data?.project || syncing || draftLoading || sending}
            placeholder={sending ? 'Sending…' : undefined}
            readOnly={readOnly}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(event) => { if (event.clipboardData.files.length && !syncing && !readOnly && !draftLoading && !sending) { event.preventDefault(); void addAttachments(event.clipboardData.files); } }}
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
            <SenderControls
              sender={sender}
              busy={busy}
              onStop={onStop}
              disabled={!selectedModel || !data?.project || syncing || readOnly || draftLoading || sending}
            />
          </div>
          <input ref={attachmentInput} hidden type="file" multiple aria-label="Choose attachments" tabIndex={-1} onChange={(event) => { if (event.target.files) void addAttachments(event.target.files); event.target.value = ""; }} />

        </form>
      </div>
      </div>
    </div>
  );
}
