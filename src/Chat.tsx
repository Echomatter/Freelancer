import {
  Check,
  FileText,
  LoaderCircle,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolveTodoLayout } from "../domain/appearance.mjs";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "../domain/attachments.mjs";
import {
  buildRequestGroups,
  summarizeRequestWork,
} from "../domain/chat-view.mjs";
import {
  reportedContext,
  turnStatistics,
} from "../domain/conversation-rail.mjs";
import { hasUnfinishedTodos, todoStatusLabel } from "../domain/todos.mjs";
import {
  modelVariant,
  resolvedVariant,
  workspaceModels,
} from "../domain/workspace.mjs";
import { SenderControls, useChatSender } from "./ChatSender";
import { ChatToolViews } from "./ChatToolViews";
import { ComposerMenu } from "./ComposerMenu";
import { Empty } from "./echoflex/Controls";
import { ConversationRail } from "./echoflex/ConversationRail";
import { goalEventsByTurn } from "../domain/chat-tools.mjs";
import { ModelIntelligence } from "./ModelSetup";
import { ProviderSelect } from "./ProviderColors";
import { shareSnapshot } from "./snapshot-sharing.mjs";
import { WorkCard } from "./WorkCard";

import {
  Attachment,
  Markdown,
  RequestTurn,
  readAttachment,
  type PendingAttachment,
} from "./ChatMessages";
const EMPTY_TODOS: any[] = [];

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
  toolbarData = {},
}: {
  data: any;
  toolbarData?: any;
  messages: any[];
  pendingSend?: {
    text: string;
    attachments: { filename: string; mime: string; url: string }[];
    state: "sending" | "accepted" | "unconfirmed";
  } | null;
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
  onSend: (
    variant: string,
    attachments?: { filename: string; mime: string; url: string }[],
  ) => Promise<{ accepted: boolean; sessionID: string }> | void;
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
}) {
  const end = useRef<HTMLDivElement>(null),
    area = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null),
    railID = useId();
  const stick = useRef(true);
  const [showNewActivity, setShowNewActivity] = useState(false);
  const [toolSelection, setToolSelection] = useState(0);
  const [toolSection, setToolSection] = useState("commands");
  const [inspectedWork, setInspectedWork] = useState<string | null>(null);
  const [expandedWork, setExpandedWork] = useState<string | null>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const attachmentCache = useRef(
    attachmentStore ?? new Map<string, PendingAttachment[]>(),
  );
  const [, updateAttachments] = useState(0);
  const [attachmentError, setAttachmentError] = useState("");
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [dragging, setDragging] = useState(false);
  const attachmentContext = `${data.project?.id ?? ""}/${session?.id ?? ""}`;
  const attachments = attachmentCache.current.get(attachmentContext) ?? [];
  const saveAttachments = (context: string, items: PendingAttachment[]) => {
    attachmentCache.current.delete(context);
    if (items.length) attachmentCache.current.set(context, items);
    while (attachmentCache.current.size > 4)
      attachmentCache.current.delete(
        attachmentCache.current.keys().next().value!,
      );
    updateAttachments((value) => value + 1);
  };
  const addAttachments = async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    const context = attachmentContext;
    const previous = attachmentCache.current.get(context) ?? [];
    const total = [
      ...previous.map((file) => file.size),
      ...selected.map((file) => file.size),
    ].reduce((sum, size) => sum + size, 0);
    if (
      previous.length + selected.length > MAX_ATTACHMENTS ||
      selected.some(
        (file) =>
          !file.size ||
          file.size > MAX_ATTACHMENT_BYTES ||
          !file.name ||
          file.name.length > 160 ||
          /[\\/\x00-\x1f]/.test(file.name),
      ) ||
      total > MAX_TOTAL_ATTACHMENT_BYTES
    ) {
      setAttachmentError("Add up to 4 files, 4 MB each and 6 MB total.");
      return;
    }
    try {
      setReadingAttachments(true);
      const loaded = await Promise.all(selected.map(readAttachment));
      const current = attachmentCache.current.get(context) ?? [];
      if (
        current.length + loaded.length > MAX_ATTACHMENTS ||
        current.reduce((sum, file) => sum + file.size, 0) +
          loaded.reduce((sum, file) => sum + file.size, 0) >
          MAX_TOTAL_ATTACHMENT_BYTES
      )
        throw Error("Too many attachments were added at once.");
      saveAttachments(context, [...current, ...loaded]);
      setAttachmentError("");
    } catch (error) {
      setAttachmentError((error as Error).message);
    } finally {
      setReadingAttachments(false);
    }
  };
  // Presentation-only memory of each request's task list as last seen while
  // it was the active request. No second store: the frozen rows are the same
  // visible todos already supplied for that request, kept so a new request
  // starts fresh without erasing prior history. Lost on reload by design.
  const taskHistory = useRef(new Map<string, any[]>());
  const [dismissedTasks, setDismissedTasks] = useState("");
  const taskRevision = `${session?.id ?? ""}/${JSON.stringify(todos)}`;
  const taskSession = useRef(session?.id);
  if (taskSession.current !== session?.id) {
    taskSession.current = session?.id;
    taskHistory.current.clear();
  }
  const toggleWork = useCallback((key: string) => {
    setInspectedWork(key);
    setExpandedWork((previous) => (previous === key ? null : key));
  }, []);
  useLayoutEffect(() => {
    const input = messageInput.current;
    if (input) {
      const maximum = Math.min(240, Math.max(120, window.innerHeight * 0.32));
      input.style.height = "0px";
      input.style.height =
        Math.min(maximum, Math.max(44, input.scrollHeight)) + "px";
    }
  }, [draft, sending, session?.id]);
  const followLatest = () => {
    const scroll = area.current;
    if (
      scroll &&
      stick.current &&
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 2
    ) {
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
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          followLatest();
        });
    });
    observer.observe(scroll);
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  const jumpToLatest = () => {
    stick.current = true;
    setShowNewActivity(false);
    followLatest();
  };
  const models = useMemo(
    () =>
      workspaceModels(
        data.models ?? [],
        data.providers.connected,
        data.settings.appearance?.showDepletedModels !== false,
      ),
    [
      data.models,
      data.providers.connected,
      data.settings.appearance?.showDepletedModels,
    ],
  );
  const modelProviders = useMemo(
    () =>
      data.providers.all.filter((provider) =>
        models.some((m) => m.provider === provider.id),
      ),
    [data.providers.all, models],
  );
  const modelsByProvider = useMemo(() => {
    const grouped = new Map<string, any[]>();
    for (const item of models)
      grouped.set(item.provider, [...(grouped.get(item.provider) ?? []), item]);
    return grouped;
  }, [models]);
  const selectedAgent =
    data.settings.agents.find((a) => a.id === agentID) ??
    data.settings.agents.find((a) => a.id === "engineer");
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
      : (data.nativeModels?.[selectedAgent?.id ?? "engineer"] ??
        data.nativeModels?.default ??
        "");
  const selectableCurrentModels = useMemo(
    () => workspaceModels(data.models ?? [], data.providers.connected),
    [data.models, data.providers.connected],
  );
  const currentModel = selectableCurrentModels.find((m) => m.id === parentID);
  const selectedModel = currentModel ? parentID : "";
  const intelligence = modelVariant(
    currentModel?.variants,
    variant,
    resolvedVariant(selectedAgent?.variant, preferences ?? {}),
  );
  const readOnly = !!(
    session?.imported ||
    session?.organization?.archived ||
    data?.project?.organization?.archivedAt
  );
  const sender = useChatSender({
    data,
    session,
    busy,
    loading: syncing,
    draft: sending ? "" : draft,
    setDraft,
    parentModel: selectedModel,
    intelligence,
    agentID: selectedAgent?.id ?? "engineer",
    models,
    visibleMessageIDs: messages.map((message: any) => message.info?.id).filter(Boolean),
    onStop,
    onSend: (selectedVariant) => {
      const captured = attachments.map(({ filename, mime, url }) => ({
        filename,
        mime,
        url,
      }));
      const capturedIDs = new Set(attachments.map((file) => file.id));
      const context = attachmentContext;
      void Promise.resolve(onSend(selectedVariant, captured)).then((result) => {
        if (result?.accepted)
          saveAttachments(
            context,
            (attachmentCache.current.get(context) ?? []).filter(
              (file) => !capturedIDs.has(file.id),
            ),
          );
        else if (
          result?.sessionID &&
          `${data.project.id}/${result.sessionID}` !== context
        ) {
          const target = `${data.project.id}/${result.sessionID}`;
          saveAttachments(target, [
            ...(attachmentCache.current.get(target) ?? []),
            ...(attachmentCache.current.get(context) ?? []).filter((file) =>
              capturedIDs.has(file.id),
            ),
          ]);
          saveAttachments(
            context,
            (attachmentCache.current.get(context) ?? []).filter(
              (file) => !capturedIDs.has(file.id),
            ),
          );
        }
      });
    },
    hasAttachments: attachments.length > 0,
    disabled:
      readOnly || syncing || draftLoading || readingAttachments || sending,
    captureDraft,
    acceptDraft,
  });
  const actions = useRef({ onChild, onReviewDecisions });
  actions.current = { onChild, onReviewDecisions };
  const openChild = useCallback(
    (id: string) => actions.current.onChild(id),
    [],
  );
  const reviewDecisions = useCallback(
    () => actions.current.onReviewDecisions?.(),
    [],
  );
  const previousGroups = useRef<ReturnType<typeof buildRequestGroups>>([]);
  const requestGroups = useMemo(() => {
    const next = shareSnapshot(
      previousGroups.current,
      buildRequestGroups(messages),
    );
    previousGroups.current = next;
    return next;
  }, [messages]);
  const selectWork = useCallback((key: string, section = "commands") => {
    setInspectedWork(key);
    setExpandedWork(key);
    setToolSelection((value) => value + 1);
    setToolSection(section);
  }, []);
  const turnEvents = useMemo(
    () => goalEventsByTurn(requestGroups, toolbarData.goal?.events),
    [requestGroups, toolbarData.goal?.events],
  );
  const requestContent = requestGroups.map((request, requestIndex, all) => {
    const isLast = requestIndex === all.length - 1;
    if (isLast) taskHistory.current.set(request.key, todos);
    return (
      <RequestTurn
        key={request.key}
        request={request}
        requestIndex={requestIndex}
        events={turnEvents[requestIndex]}
        hasGoal={!!toolbarData.goal}
        isLast={isLast}
        requestTodos={
          isLast ? todos : (taskHistory.current.get(request.key) ?? EMPTY_TODOS)
        }
        busy={isLast && busy}
        changeCount={isLast ? changeCount : 0}
        pendingDecisions={isLast ? pendingDecisions : 0}
        models={data.models}
        childReport={!!session?.parentID}
        expanded={expandedWork === request.key}
        selectWork={selectWork}
        openChild={openChild}
        reviewDecisions={reviewDecisions}
        railID={railID}
      />
    );
  });
  const currentRequest = requestGroups.at(-1);
  const dockKey =
    inspectedWork &&
    requestGroups.some((request) => request.key === inspectedWork)
      ? inspectedWork
      : currentRequest?.key;
  const dockIndex = requestGroups.findIndex(
    (request) => request.key === dockKey,
  );
  const dockRequest = requestGroups[dockIndex];
  const isCurrentDock = dockKey === currentRequest?.key;
  const dockTodos = isCurrentDock
    ? todos
    : (taskHistory.current.get(dockKey ?? "") ?? EMPTY_TODOS);
  const railTurns = useMemo(
    () =>
      requestGroups.map((request, index) => ({
        key: request.key,
        target: `${railID}-${request.key}`,
        label: `Turn ${index + 1}`,
        ...turnStatistics(
          request,
          data.models,
          busy && index === requestGroups.length - 1,
        ),
      })),
    [requestGroups, data.models, busy, railID],
  );
  const context = useMemo(
    () => reportedContext(messages, data.models),
    [messages, data.models],
  );
  const dockSummary = dockRequest
    ? summarizeRequestWork(dockRequest.allMessages, dockTodos)
    : null;
  useLayoutEffect(() => {
    setInspectedWork(null);
    setExpandedWork(null);
  }, [currentRequest?.key]);
  return (
    <div className="chat-view has-conversation-rail" aria-busy={syncing}>
      <ConversationRail
        scroll={area}
        content={transcript}
        turns={railTurns}
        selected={dockKey}
        onSelect={(key) => {
          stick.current = false;
          setInspectedWork(key);
          setExpandedWork(key);
        }}
        onScrollIntent={() => {
          stick.current = false;
        }}
        context={context}
        identity={attachmentContext}
      />
      <ChatToolViews
        attachmentContext={attachmentContext}
        expandedWork={expandedWork}
        toolSelection={toolSelection}
        toolSection={toolSection}
        turnEvents={turnEvents[dockIndex] ?? []}
        dockSummary={dockSummary}
        toolbarData={toolbarData}
        messages={messages}
        busy={busy}
        dockRequest={dockRequest}
        isCurrentDock={isCurrentDock}
        dockIndex={dockIndex}
        setInspectedWork={setInspectedWork}
        setExpandedWork={setExpandedWork}
        data={data}
        todos={todos}
        session={session}
        openChild={openChild}
      />
      <div
        className="chat-scroll"
        id={`conversation-${railID}`}
        ref={area}
        onScroll={() => {
          const x = area.current!;
          stick.current = x.scrollHeight - x.scrollTop - x.clientHeight < 120;
          setShowNewActivity((visible) =>
            visible === stick.current ? !stick.current : visible,
          );
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
          ) : (
            requestContent
          )}
          {pendingSend && (
            <div
              className="message user pending-message"
              aria-label="Submitted message"
            >
              <div className="message-label">You</div>
              <div className="message-body">
                {pendingSend.text && <Markdown text={pendingSend.text} />}
                {pendingSend.attachments.map((file, index) => (
                  <Attachment key={index} file={file} />
                ))}
                <small role="status">
                  {pendingSend.state === "sending"
                    ? "Sending…"
                    : pendingSend.state === "accepted"
                      ? "Sent · Waiting for conversation…"
                      : "Delivery unconfirmed · Check the conversation before sending again."}
                </small>
              </div>
            </div>
          )}
          {busy && !messages.length && !pendingSend && (
            <div className="working" aria-live="polite">
              <LoaderCircle size={16} className="spin" /> Working on it
            </div>
          )}
          <div ref={end} />
        </div>
        {showNewActivity && messages.length > 0 && (
          <div className="new-activity-row">
            <button
              type="button"
              className="new-activity"
              onClick={jumpToLatest}
            >
              Jump to latest
            </button>
          </div>
        )}
        <div className="composer-wrap">
          <div className="composer-cards">
            {resolveTodoLayout(data.settings.appearance) === "docked" &&
              todos.length > 0 &&
              dismissedTasks === taskRevision && (
                <button
                  type="button"
                  className="restore-work"
                  onClick={() => setDismissedTasks("")}
                >
                  Show tasks
                </button>
              )}
            {resolveTodoLayout(data.settings.appearance) === "docked" &&
              todos.length > 0 &&
              dismissedTasks !== taskRevision && (
                <WorkCard
                  title={`Tasks · ${todos.filter((todo) => todo.status === "completed").length}/${todos.length} complete`}
                  icon={<Check size={16} />}
                  onDismiss={() => setDismissedTasks(taskRevision)}
                  dismissLabel="Dismiss task list until it changes"
                  defaultOpen={false}
                  preview={
                    !busy && hasUnfinishedTodos(todos)
                      ? "Unfinished tasks · send a follow-up to continue"
                      : (todos.find((todo) => todo.status === "in_progress")
                          ?.content ?? "View task list")
                  }
                >
                  {!busy && hasUnfinishedTodos(todos) && (
                    <p role="status">
                      Response ended with unfinished tasks. Send a follow-up to
                      continue.
                    </p>
                  )}
                  <div className="todo-dock-list">
                    {todos.map((todo, i) => (
                      <div className="todo" key={todo.id ?? i}>
                        {todo.status === "completed" ? (
                          <Check size={16} />
                        ) : todo.status === "in_progress" && busy ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Square size={16} />
                        )}
                        <span>{todo.content}</span>
                        <small>{todoStatusLabel(todo, busy)}</small>
                      </div>
                    ))}
                  </div>
                </WorkCard>
              )}
            {attachments.length > 0 && (
              <WorkCard
                title={`Attachments · ${attachments.length}`}
                icon={<Paperclip size={16} />}
                defaultOpen
                attention={!!attachmentError}
                preview={attachments.map((file) => file.filename).join(", ")}
              >
                {attachments.length > 0 && (
                  <div
                    className="composer-attachments"
                    aria-label="Attachments ready to send"
                  >
                    {attachments.map((file) => (
                      <span className="composer-attachment" key={file.id}>
                        <FileText size={14} />
                        <span title={file.filename}>{file.filename}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.filename}`}
                          onClick={() =>
                            saveAttachments(
                              attachmentContext,
                              attachments.filter((item) => item.id !== file.id),
                            )
                          }
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {readingAttachments && (
                  <p className="composer-attachment-note" role="status">
                    <LoaderCircle size={13} className="spin" /> Adding files…
                  </p>
                )}
                {attachmentError && (
                  <p className="composer-attachment-error" role="alert">
                    {attachmentError}
                  </p>
                )}
                {busy && attachments.length > 0 && (
                  <p className="composer-attachment-note" role="status">
                    Queue, Delegate, and Steer send text only; these files stay
                    attached for your next send.
                  </p>
                )}
              </WorkCard>
            )}
            {!attachments.length && readingAttachments && (
              <p role="status">Adding files…</p>
            )}
            {!attachments.length && attachmentError && (
              <p className="composer-attachment-error" role="alert">
                {attachmentError}
              </p>
            )}
            {sender.ui}
          </div>
          <form
            className={dragging ? "composer dragging" : "composer"}
            onDragOver={(event) => {
              if (
                !syncing &&
                !readOnly &&
                !draftLoading &&
                Array.from(event.dataTransfer.types).includes("Files")
              ) {
                event.preventDefault();
                setDragging(true);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDragging(false);
            }}
            onDrop={(event) => {
              if (event.dataTransfer.files.length) {
                event.preventDefault();
                setDragging(false);
                if (!syncing && !readOnly && !draftLoading)
                  void addAttachments(event.dataTransfer.files);
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              sender.submit();
            }}
          >
            <div className="composer-entry">
              <ComposerMenu
                context={attachmentContext}
                disabled={syncing || readOnly || draftLoading}
                onAttach={() => attachmentInput.current?.click()}
                summary={[
                  selectedAgent?.name ?? "Engineer",
                  currentModel?.name ?? "Choose a model",
                  intelligence,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
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
                        .filter((a) => a.id !== selectedAgent?.id)
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
                          {models.length
                            ? "Choose a model"
                            : "No available models"}
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
                            {(modelsByProvider.get(provider.id) ?? []).map(
                              (m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                  {m.costClass === "free" ? " · Free" : ""}
                                </option>
                              ),
                            )}
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
              <textarea
                ref={messageInput}
                aria-label="Message"
                autoCapitalize="sentences"
                autoComplete="off"
                enterKeyHint="send"
                value={sending ? "" : draft}
                disabled={!data?.project || syncing || draftLoading || sending}
                placeholder={sending ? "Sending…" : undefined}
                readOnly={readOnly}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={(event) => {
                  if (
                    event.clipboardData.files.length &&
                    !syncing &&
                    !readOnly &&
                    !draftLoading &&
                    !sending
                  ) {
                    event.preventDefault();
                    void addAttachments(event.clipboardData.files);
                  }
                }}
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
                disabled={
                  !selectedModel ||
                  !data?.project ||
                  syncing ||
                  readOnly ||
                  draftLoading ||
                  sending
                }
              />
            </div>
            <input
              ref={attachmentInput}
              hidden
              type="file"
              multiple
              aria-label="Choose attachments"
              tabIndex={-1}
              onChange={(event) => {
                if (event.target.files) void addAttachments(event.target.files);
                event.target.value = "";
              }}
            />
          </form>
        </div>
      </div>
    </div>
  );
}
