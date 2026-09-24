// Presentation-only chat grouping. These helpers never affect execution,
// routing, permissions, or storage. They derive request groups and compact
// work summaries from already-loaded message arrays.
import { hasUnfinishedTodos } from "./todos.mjs";

// OpenCode can finish a shell tool successfully while the command exits with
// an error. Use its structured exit status, never guess from output prose.
export function toolOutcomeStatus(part) {
  const state = part?.state ?? {};
  if (part?.tool === "bash" && state.status === "completed" &&
      Number.isInteger(state.metadata?.exit) && state.metadata.exit !== 0) return "error";
  // A detached named worker has a completed *dispatch* tool part while the
  // child itself is still running. Its durable presentation metadata is the
  // authoritative state for the handoff card, not the parent tool's exit.
  const delegated = state.metadata?.freelancer_status;
  if (delegated === "running" || delegated === "starting") return "running";
  if (["failed", "stop_unverified", "cancelled", "timeout"].includes(delegated)) return "error";
  if (delegated === "completed") return "completed";
  return state.status ?? "unknown";
}

export function requestWorkLabel(summary, live = false) {
  if (live) return "Working on the response";
  // A completed command can still report a non-zero exit status. That is
  // useful history, but it is not necessarily a user decision or an action
  // the user can take, so do not present it as a vague request for attention.
  if (summary.errors) return `Response ended · ${summary.errors} tool ${summary.errors === 1 ? "failed" : "failures"}`;
  if (summary.running || summary.waiting) return "Work · Paused";
  if (summary.tasks.unfinished) return "Response ended · Tasks unfinished";
  return "Response ended";
}

export function isHandoffPart(part) {
  const meta = part?.state?.metadata ?? {};
  return Boolean(
    meta.freelancer_delegate_display ??
      meta.ai_toolkit_delegate_display ??
      (part?.tool === "delegate" || part?.tool === "task"
        ? true
        : false),
  ) && meta.freelancer_status !== "selection_required";
}

// Honest fallback purpose groups. No model calls, no inferred dependencies.
// Note: delegate/task handoffs are routed to the workers rollup in
// summarizeRequestWork, never to purposes, so they intentionally have no
// purpose mapping here. todowrite is tracked via the todo list, not purposes.
export function purposeForTool(tool) {
  if (tool === "read" || tool === "glob" || tool === "grep")
    return "Reading project files";
  if (tool === "bash") return "Running checks";
  if (tool === "write" || tool === "edit") return "Updating files";
  if (tool === "skill") return "Loading skills";
  return "Other actions";
}

// Group a chronological message list by top-level user request. A user
// message starts a new request, except when the previous request has not yet
// received an assistant reply (queued follow-up / steering while busy), in
// which case it extends the pending request. Exact duplicate message IDs
// (replayed snapshots) collapse to their first occurrence; distinct messages
// with identical text are always retained.
//
// options.resolveRequestID(message) may return a stable runtime request id
// (e.g. message.info.requestID, an activity requestID, or a user_task_id
// derived id). When present, user messages carrying an already-seen id resume
// that request (approval/clarification), and assistant messages carrying an
// id attach to their owning request even if they arrive after a newer request
// started (late/parallel child streams). Messages without an id use the
// chronological fallback above. defaultRequestID covers the known info fields.
export function defaultRequestID(message) {
  const id =
    message?.info?.requestID ??
    message?.requestID ??
    message?.info?.requestId ??
    null;
  return typeof id === "string" && id.trim() ? id : null;
}

export function buildRequestGroups(messages = [], options = {}) {
  const resolve = options?.resolveRequestID ?? defaultRequestID;
  const seen = new Set();
  const groups = [];
  const byRequestID = new Map();
  const ensureGroup = (key, requestID = null) => {
    const group = {
      key: key ?? "",
      index: groups.length,
      requestID,
      userMessages: [],
      responseMessages: [],
      allMessages: [],
    };
    groups.push(group);
    if (requestID) byRequestID.set(requestID, group);
    return group;
  };
  let lastGroup = null;
  for (const m of messages ?? []) {
    const id = m?.info?.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    // Native compaction and auto-continue messages are runtime housekeeping,
    // not new user requests. The recap remains available inside the work card.
    const housekeeping = m?.info?.role === "user" && (m.parts ?? []).length > 0 && (m.parts ?? []).every(p => p.type === "compaction" || p.synthetic === true);
    if (housekeeping) continue;
    const role = m?.info?.role ?? "assistant";
    let rid = null;
    try {
      rid = resolve?.(m) ?? null;
    } catch {
      rid = null;
    }
    if (typeof rid !== "string" || !rid.trim()) rid = null;
    if (role === "user") {
      const owned = rid ? byRequestID.get(rid) : undefined;
      if (owned) {
        owned.userMessages.push(m);
        owned.allMessages.push(m);
        lastGroup = owned;
        continue;
      }
      // Queued follow-ups join the pending request only when they carry no
      // runtime id or the same id; a different runtime id starts/resumes its
      // own request instead of merging two distinct requests.
      const pendingSame =
        lastGroup &&
        lastGroup.responseMessages.length === 0 &&
        (!rid || !lastGroup.requestID || lastGroup.requestID === rid);
      if (pendingSame) {
        lastGroup.userMessages.push(m);
        lastGroup.allMessages.push(m);
        if (!lastGroup.key) lastGroup.key = String(id ?? `req-${lastGroup.index}`);
        if (rid && !lastGroup.requestID) {
          lastGroup.requestID = rid;
          byRequestID.set(rid, lastGroup);
        }
      } else {
        lastGroup = ensureGroup(String(id ?? `req-${groups.length}`), rid);
        lastGroup.userMessages.push(m);
        lastGroup.allMessages.push(m);
      }
    } else {
      const owned = rid ? byRequestID.get(rid) : undefined;
      if (owned) {
        owned.responseMessages.push(m);
        owned.allMessages.push(m);
        continue;
      }
      if (!lastGroup) {
        lastGroup = ensureGroup(String(id ?? `req-${groups.length}`), rid);
      }
      lastGroup.responseMessages.push(m);
      lastGroup.allMessages.push(m);
    }
  }
  return groups.filter((g) => g.allMessages.length > 0);
}

// Compact observable work summary for one request group. Counts come only
// from the supplied parts/todos; unknown progress is left unknown.
export function summarizeRequestWork(allMessages = [], todos = []) {
  const tools = [];
  const workers = [];
  // Same part id means the same item updated (arguments → output →
  // completion) or a replayed snapshot: the latest snapshot supersedes
  // earlier ones, so a running tool that completes does not stick at
  // running, and a replayed event is never double-counted. Distinct ids
  // with identical text are always retained. Parts carry no reliable
  // cross-stream timestamps, so array order is the ordering source; this is
  // the documented adapter limit, not perfect reconstruction.
  const latestByPartID = new Map();
  for (const m of allMessages) {
    for (const part of m?.parts ?? []) {
      if (part?.id) latestByPartID.set(part.id, part);
      else latestByPartID.set(Symbol(), part);
    }
  }
  for (const part of latestByPartID.values()) {
    if (part?.type !== "tool") continue;
    const status = toolOutcomeStatus(part);
    if (isHandoffPart(part)) {
      const meta = part?.state?.metadata ?? {};
      workers.push({
        id: part.id,
        status,
        agent:
          meta.agentName ??
          meta.freelancer_activity?.agentName ??
          part?.state?.input?.agentID ??
          part?.state?.input?.role ??
          "Helper",
      });
    } else {
      if (metaIsSelectionPending(part)) continue;
      tools.push({ id: part.id, tool: part.tool, status });
    }
  }
  const isActive = (s) => s === "running" || s === "pending";
  const isDone = (s) => s === "completed";
  const isError = (s) => s === "error";
  const purposes = new Map();
  for (const t of tools) {
    // todowrite output is represented by the todo list itself; counting it
    // here too would double-count one piece of work.
    if (t.tool === "todowrite") continue;
    const purpose = purposeForTool(t.tool);
    const row = purposes.get(purpose) ?? {
      purpose,
      total: 0,
      running: 0,
      done: 0,
      errors: 0,
      waiting: 0,
    };
    row.total += 1;
    if (isActive(t.status)) row.running += 1;
    else if (isError(t.status)) row.errors += 1;
    else if (isDone(t.status)) row.done += 1;
    else row.waiting += 1;
    purposes.set(purpose, row);
  }
  const runningTools = tools.filter((t) => isActive(t.status)).length;
  const runningWorkers = workers.filter((w) => isActive(w.status)).length;
  const errorCount =
    tools.filter((t) => isError(t.status)).length +
    workers.filter((w) => isError(w.status)).length;
  const doneCount =
    tools.filter((t) => isDone(t.status)).length +
    workers.filter((w) => isDone(w.status)).length;
  const waitingCount =
    tools.filter((t) => !isActive(t.status) && !isError(t.status) && !isDone(t.status)).length +
    workers.filter((w) => !isActive(w.status) && !isError(w.status) && !isDone(w.status)).length;
  const completedTodos = (todos ?? []).filter(
    (t) => t?.status === "completed",
  ).length;
  const activeTodo = (todos ?? []).find((t) => t?.status === "in_progress");
  const hasWork =
    tools.length > 0 || workers.length > 0 || (todos ?? []).length > 0;
  return {
    hasWork,
    toolCount: tools.length,
    workerCount: workers.length,
    running: runningTools + runningWorkers,
    errors: errorCount,
    done: doneCount,
    waiting: waitingCount,
    purposes: [...purposes.values()],
    workers: {
      total: workers.length,
      running: runningWorkers,
      finished: workers.filter((w) => w.status === "completed").length,
      stopped: workers.filter((w) => w.status === "error").length,
    },
    tasks: {
      total: (todos ?? []).length,
      completed: completedTodos,
      unfinished: hasUnfinishedTodos(todos ?? []),
      active: activeTodo?.content ?? null,
    },
  };
}

function metaIsSelectionPending(part) {
  return part?.state?.metadata?.freelancer_status === "selection_required";
}
