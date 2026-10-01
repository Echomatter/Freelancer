import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Terminal,
} from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  delegateChildSession,
  delegateModel,
  isHandoffPart,
  latestToolParts,
  responseErrorLabel,
  summarizeRequestWork,
  toolOutcomeStatus,
} from "../domain/chat-view.mjs";
import { isInternalMessage, userInitiatedRequest } from "../domain/sender.mjs";
import { clientID, copyText } from "./browser-capabilities.mjs";
import { Badge } from "./echoflex/Controls";
import { ProviderText } from "./ProviderColors";
import { ChatActivityMarks } from "./ChatActivityMarks";

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
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};
const markdownPlugins = [remarkGfm];
const EMPTY_TODOS: any[] = [];
export type PendingAttachment = {
  id: string;
  filename: string;
  mime: string;
  url: string;
  size: number;
};
export function readAttachment(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const mime = file.type || "application/octet-stream";
      resolve({
        id: clientID(),
        filename: file.name,
        mime,
        url: `data:${mime};base64,${String(reader.result).split(",", 2)[1] ?? ""}`,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}
export const Markdown = memo(function Markdown({ text }: { text: string }) {
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
function Tool({
  part,
  onChild,
  modelFallback,
  agentFallback,
}: {
  part: any;
  onChild: (id: string) => void;
  modelFallback?: string;
  agentFallback?: string;
}) {
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
    const delivery = meta.freelancer_status === "worker_handoff";
    const running =
      !delivery && (outcome === "running" || outcome === "pending");
    const failed = outcome === "error";
    let result: any = null;
    try {
      result =
        typeof state.output === "string"
          ? JSON.parse(state.output)
          : state.output && typeof state.output === "object"
            ? state.output
            : null;
    } catch {
      /* Native host may truncate a long receipt. */
    }
    const agentName = String(
      meta.agentName ??
        meta.freelancer_activity?.agentName ??
        result?.agent?.name ??
        saved?.agent?.name ??
        input.agentID ??
        input.agent ??
        input.role ??
        agentFallback ??
        "Agent",
    );
    const modelName = delegateModel(part) ?? modelFallback;
    const routeUnavailable = [
      "no_qualified_route",
      "delegation_unavailable",
    ].includes(meta.freelancer_status ?? result?.status);
    const statusLabel = delivery
      ? failed
        ? "Worker handoff needs inspection"
        : meta.delivery_included
          ? "Worker input included"
          : ["submitted", "delivered"].includes(meta.delivery_status)
            ? "Worker input admitted"
            : "Worker handoff saved"
      : routeUnavailable
        ? "Route unavailable"
        : running
          ? "Agent working"
          : failed
            ? "Agent stopped"
            : "Agent finished";
    const reasons = Array.isArray(result?.routing_diagnostics?.reasons)
      ? result.routing_diagnostics.reasons.slice(0, 3).join(", ")
      : "";
    const routeExplanation =
      result?.result ||
      (reasons
        ? `Routing reasons: ${reasons}.`
        : "No model qualified under the current delegation budget and provider rules.");
    const label = `${statusLabel}: ${agentName}${modelName ? ` · ${modelName}` : ""}${child ? " · Open conversation" : " · No worker started"}${reasons ? ` · ${reasons}` : ""}`;
    if (routeUnavailable && !child)
      return (
        <span
          className="agent-activity agent-card agent-route-unavailable"
          role="status"
          aria-label={label}
          title={label}
        >
          <CircleAlert size={16} aria-hidden="true" />
          <span>
            <strong>{agentName} was not started</strong>
            <small>{routeExplanation}</small>
          </span>
        </span>
      );
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
          {running ? (
            <LoaderCircle size={20} className="spin" />
          ) : failed || routeUnavailable ? (
            <CircleAlert size={20} />
          ) : (
            <Bot size={20} />
          )}
          {!running && !failed && !routeUnavailable && !delivery && (
            <Check size={10} className="agent-check" />
          )}
        </span>
        <span className="agent-card-copy">
          <strong>{agentName}</strong>
          <small>{statusLabel}</small>
          <small>
            {routeUnavailable ? (
              "Route unavailable"
            ) : modelName ? (
              <ProviderText provider={modelName} mark>
                {modelName}
              </ProviderText>
            ) : (
              statusLabel
            )}
          </small>
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
    <details
      className={`tool-card ${toolOutcomeStatus(part) === "error" ? "error" : ""}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{heading}</summary>
      {open && (
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
          {Array.isArray(state.attachments) && state.attachments.length > 0 && (
            <div className="chat-attachments">
              {state.attachments.map((file: any, index: number) => (
                <Attachment key={file.id ?? index} file={file} />
              ))}
            </div>
          )}
        </>
      )}
    </details>
  );
}
function toolTitle(part: any): string {
  const state = part.state ?? {};
  const input = state.input ?? {};
  const toolName = String(part.tool ?? "")
    .toLowerCase()
    .replace(/[.-]/g, "_");
  const fileName = String(input.filePath ?? input.path ?? "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);
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
    return state.metadata?.freelancer_status === "catalog"
      ? "Inspect agent catalog"
      : state.metadata?.freelancer_status === "workers"
        ? "Inspect workers"
        : ["blocked", "conflict", "unavailable"].includes(
              state.metadata?.freelancer_status,
            )
          ? state.title || "Worker unavailable"
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
export function Attachment({ file }: { file: any }) {
  const name = String(
    file.filename || file.source?.path?.split(/[\\/]/).at(-1) || "Attachment",
  );
  const mime = String(file.mime ?? "");
  const url = String(file.url ?? "");
  const embedded = /^data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/.test(url);
  const external = /^https?:\/\//.test(url);
  const href = embedded || external ? url : undefined;
  return (
    <div className="chat-attachment">
      {embedded && /^image\/(?:png|jpeg|webp|gif)$/.test(mime) ? (
        <img src={url} alt={name} loading="lazy" />
      ) : (
        <span className="chat-attachment-icon">
          {mime.startsWith("image/") ? (
            <ImageIcon size={18} />
          ) : (
            <FileText size={18} />
          )}
        </span>
      )}
      <span className="chat-attachment-name">
        {href ? (
          <a
            href={href}
            download={embedded ? name : undefined}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer noopener" : undefined}
          >
            {name}
          </a>
        ) : (
          name
        )}
        <small>{mime || "OpenCode file"}</small>
      </span>
    </div>
  );
}
function CopyResponse({ messages }: { messages: any[] }) {
  const [copied, setCopied] = useState(false);
  const text = messages
    .flatMap((message) =>
      (message.parts ?? [])
        .filter(
          (part: any) =>
            (part.type === "text" || part.type === "reasoning") &&
            !message.info?.summary,
        )
        .map((part: any) => String(part.text ?? "").trim()),
    )
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;
  return (
    <button
      type="button"
      className="copy-response"
      aria-label={copied ? "Response copied" : "Copy response"}
      title={copied ? "Copied" : "Copy response"}
      onClick={async () => {
        try {
          await copyText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
function messageRole(m: any) {
  return m?.info?.role ?? "assistant";
}

function messageModelLabel(m: any): { provider?: string; model?: string } {
  const nativeModel = m?.info?.model;
  let model =
    m?.info?.modelID ??
    (typeof nativeModel === "object" ? nativeModel?.modelID : nativeModel) ??
    "";
  let provider =
    m?.info?.providerID ??
    (typeof nativeModel === "object" ? nativeModel?.providerID : "") ??
    "";
  if (!provider && typeof model === "string" && model.includes("/")) {
    [provider, model] = [
      model.slice(0, model.indexOf("/")),
      model.slice(model.indexOf("/") + 1),
    ];
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
    else
      groups.push({
        key: String(m?.info?.id ?? `msg-${groups.length}`),
        role,
        messages: [m],
      });
  }
  return groups;
}

function distinctGroupModels(group: { messages: any[] }, catalog: any[] = []) {
  const seen = new Map<string, { provider?: string; model: string }>();
  for (const m of group.messages) {
    const { provider, model } = messageModelLabel(m);
    if (!model) continue;
    const key = `${provider ?? ""}/${model}`;
    if (!seen.has(key))
      seen.set(key, {
        provider,
        model: catalog.find((row) => row.id === key)?.name ?? model,
      });
  }
  return [...seen.values()].slice(0, 3);
}

function GroupLabel({
  role,
  models,
}: {
  role: string;
  models: { provider?: string; model: string }[];
}) {
  if (role === "user") return <>You</>;
  if (role !== "assistant")
    return <>{role.charAt(0).toUpperCase() + role.slice(1)}</>;
  if (!models.length) return <>Assistant</>;
  const [first, ...rest] = models;
  return (
    <>
      <span
        className="message-models"
        title={models.map((m) => m.model).join(", ")}
      >
        <ProviderText provider={first.provider} mark>
          {first.model}
        </ProviderText>
        {rest.length > 0 && <span> +{rest.length}</span>}
      </span>
    </>
  );
}

export function GroupBody({
  group,
  onChild,
  mode = "all",
  childReport = false,
}: {
  group: { messages: any[] };
  onChild: (id: string) => void;
  mode?: "all" | "work" | "prose";
  childReport?: boolean;
}) {
  const flat: { msg: any; part: any }[] = [];
  for (const msg of group.messages)
    for (const part of msg.parts ?? []) flat.push({ msg, part });
  const visibleTools = new Set(latestToolParts(group.messages));
  const modelByChild = new Map<string, string>();
  const agentByChild = new Map<string, string>();
  for (const { part } of flat) {
    if (!isHandoffPart(part)) continue;
    const child = delegateChildSession(part),
      model = delegateModel(part);
    const meta = part.state?.metadata ?? {},
      input = part.state?.input ?? {};
    const agent =
      meta.agentName ??
      meta.freelancer_activity?.agentName ??
      input.agentID ??
      input.agent ??
      input.role;
    if (child && model) modelByChild.set(child, model);
    if (child && agent) agentByChild.set(child, String(agent));
  }
  const nodes: any[] = [];
  let textBuffer: { key: string; text: string }[] = [];
  const flushTexts = () => {
    if (!textBuffer.length) return;
    const joined = textBuffer
      .map((t) => t.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (joined)
      nodes.push(
        <Markdown key={textBuffer[0].key + "-joined"} text={joined} />,
      );
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
    if ((mode === "work" && !isWork) || (mode === "prose" && isWork)) return;
    const key = `${msg?.info?.id ?? index}/${part.id ?? index}`;
    if (part.type === "text" && msg.info?.summary === true) {
      flush();
      nodes.push(
        <details key={key} className="reasoning">
          <summary>Conversation recap</summary>
          <Markdown text={part.text ?? ""} />
        </details>,
      );
    } else if (part.type === "text") {
      const text = typeof part.text === "string" ? part.text : "";
      if (!text.trim()) return;
      const internal = text.match(
        /^\[Freelancer (Delegate|Queue|Steer|Goal|Delivery) (?:handoff|activity) [\w-]+\]\n/,
      );
      if (msg.info?.role === "user" && internal) {
        flush();
        const kind = internal[1];
        const request = userInitiatedRequest(text);
        const visibleText = request?.text ?? text.replace(internal[0], "").trim();
        nodes.push(
          <details key={key} className="handoff-card">
            <summary>
              <Bot size={16} aria-hidden="true" />
              {kind === "Goal"
                ? "Goal activity"
                : kind === "Steer" ? "Steer request"
                  : kind === "Queue" ? "Queued request"
                    : kind === "Delegate" ? "Delegate request"
                      : "Delivery activity"}
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            {request ? <div className="handoff-content"><Markdown text={visibleText} /></div> : <pre>{text}</pre>}
          </details>,
        );
        return;
      }
      if (childReport && msg.info?.role === "user") {
        flush();
        nodes.push(
          <details key={key} className="handoff-card assignment-card">
            <summary>
              <Bot size={16} />
              Assignment
              <ChevronDown size={14} />
            </summary>
            <div className="handoff-content">
              <Markdown text={text} />
            </div>
          </details>,
        );
        return;
      }
      if (
        childReport &&
        msg.info?.role === "assistant" &&
        msg.info?.time?.completed &&
        msg.info?.finish &&
        msg.info.finish !== "tool-calls"
      ) {
        flush();
        nodes.push(
          <details key={key} className="handoff-card">
            <summary>
              <Bot size={16} />
              Handoff · Agent report
              <ChevronDown size={14} />
            </summary>
            <div className="handoff-content">
              <Markdown text={text} />
            </div>
          </details>,
        );
        return;
      }
      textBuffer.push({ key, text });
    } else if (part.type === "reasoning") {
      const text = typeof part.text === "string" ? part.text : "";
      if (!text.trim()) return;
      textBuffer.push({ key, text });
    } else if (part.type === "tool") {
      flush();
      nodes.push(
        <Tool
          key={key}
          part={part}
          onChild={onChild}
          modelFallback={modelByChild.get(delegateChildSession(part) ?? "")}
          agentFallback={agentByChild.get(delegateChildSession(part) ?? "")}
        />,
      );
    } else if (part.type === "file") {
      flush();
      nodes.push(<Attachment key={key} file={part} />);
    }
  });
  flush();
  return <>{nodes}</>;
}

export const RequestTurn = memo(function RequestTurn({
  request,
  requestIndex,
  isLast,
  requestTodos,
  busy,
  changeCount,
  pendingDecisions,
  models,
  childReport,
  expanded,
  selectWork,
  openChild,
  reviewDecisions,
  railID,
  events = [],
  hasGoal = false,
}: any) {
  const summary = summarizeRequestWork(request.allMessages, requestTodos);
  const userGroups = groupMessages(
    request.userMessages.filter((message) => childReport || !isInternalMessage(message)),
  );
  const responseGroups = groupMessages(
    request.responseMessages.filter((message) => childReport || !isInternalMessage(message) ||
      message.parts?.some((part: any) => part.type === "text" && userInitiatedRequest(part.text ?? ""))),
  );
  return (
    <section
      key={request.key}
      id={`${railID}-${request.key}`}
      className="request-group"
      aria-label={`Request ${requestIndex + 1}`}
    >
      {userGroups.map((group) => (
        <article
          key={group.key}
          className={`message ${group.messages.every(isInternalMessage) ? "internal" : group.role}`}
        >
          {!group.messages.every(isInternalMessage) && (
            <div className="message-label">
              <GroupLabel role={group.role} models={[]} />
            </div>
          )}
          <div className="message-body">
            <GroupBody
              group={group}
              onChild={openChild}
              childReport={!!childReport}
            />
          </div>
        </article>
      ))}
      <ChatActivityMarks
        request={request}
        index={requestIndex}
        summary={summary}
        busy={isLast && (busy || changeCount > 0)}
        events={events}
        hasGoal={hasGoal}
        selectWork={selectWork}
      />
      {isLast && pendingDecisions > 0 && (
        <div className="decision-banner" role="status">
          <span>
            Needs your decision · {pendingDecisions} pending — review to
            continue.
          </span>
          <button type="button" onClick={reviewDecisions}>
            Review decision
          </button>
        </div>
      )}
      {responseGroups
        .filter((group) =>
          group.messages.some(
            (m) =>
              m.info?.summary !== true &&
              (m.info?.error ||
                m.parts?.some(
                  (p) =>
                    ((p.type === "text" || p.type === "reasoning") &&
                      p.text?.trim()) ||
                    p.type === "file",
                )),
          ),
        )
        .map((group) => (
          <article
            key={group.key}
            className={`message ${group.messages.every(isInternalMessage) ? "internal" : group.role}`}
          >
            {!group.messages.every(isInternalMessage) && (
              <div className="message-label">
                <GroupLabel
                  role={group.role}
                  models={
                    group.role === "assistant"
                      ? distinctGroupModels(group, models)
                      : []
                  }
                />
                {group.role === "assistant" && (
                  <CopyResponse messages={group.messages} />
                )}
              </div>
            )}
            <div className="message-body">
              <GroupBody
                group={group}
                onChild={openChild}
                mode="prose"
                childReport={!!childReport}
              />
              {group.messages.some((m) => m.info?.error) && (
                <p className="notice error">
                  {responseErrorLabel(
                    group.messages.find((m) => m.info?.error)?.info.error,
                  )}
                </p>
              )}
            </div>
          </article>
        ))}
    </section>
  );
});
