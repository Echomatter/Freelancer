import { readRuntimeRequest } from './record-database.mjs';
import { readRuntimeText as readFile } from './state-database.mjs';

import { createHash } from 'node:crypto';
import path from "node:path";
export const workerBindingFile = (root, sessionID, messageID) => path.join(root, '.state/delegation/bindings', createHash('sha256').update(JSON.stringify([sessionID, messageID])).digest('hex') + '.json');

const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  (process.platform === "win32"
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b));
async function json(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw Error(
      "Execution context cannot be read. No operation was authorized.",
    );
  }
}

// Resolve from native identity and durable application records, never from a
// model-provided agent/context blob. Historical receipts are not edited.
export function createExecutionContextReader(readRequests) {
  return async (root, directory, session, message, nativeMessages) => resolveExecutionContext(
    root, directory, session, message, readRequests, nativeMessages,
  );
}

// OpenCode 1.18.31 marks automatic followups with compaction_continue. Follow
// only that native marker and a completed, adjacent compaction pair. Summary
// prose, matching task text and unmarked user messages cannot grant authority.
export function compactionRequestParent(session, parentID, messages) {
  if (!Array.isArray(messages)) return null;
  const seen = new Set();
  let id = parentID;
  for (let depth = 0; depth < 64; depth++) {
    if (seen.has(id)) return null;
    seen.add(id);
    const index = messages.findIndex(row => row.info?.id === id);
    const user = messages[index];
    if (user?.info?.role !== 'user' || user.info.sessionID !== session?.id) return null;
    const continuation = user.parts?.length > 0 && user.parts.every(part =>
      part.type === 'text' && part.synthetic === true && part.metadata?.compaction_continue === true);
    if (!continuation) return id === parentID ? null : id;
    const summary = messages[index - 1], compact = messages[index - 2];
    if (summary?.info?.role !== 'assistant' || summary.info.sessionID !== session.id ||
      summary.info.summary !== true || summary.info.agent !== 'compaction' ||
      !summary.info.finish || summary.info.finish === 'error' || summary.info.error ||
      compact?.info?.role !== 'user' || compact.info.sessionID !== session.id ||
      summary.info.parentID !== compact.info.id || compact.info.agent !== user.info.agent ||
      !compact.parts?.some(part => part.type === 'compaction' && part.auto === true)) return null;
    const original = messages.slice(0, index - 2).findLast(row => row.info?.role === 'user');
    if (!original || original.info.sessionID !== session.id || original.info.agent !== user.info.agent ||
      original.parts?.some(part => part.type === 'compaction')) return null;
    id = original.info.id;
  }
  return null;
}

async function resolveExecutionContext(root, directory, session, message, readRequests, nativeMessages) {
  const info = message?.info ?? message;
  if (info?.role !== "assistant") return null;
  if (info.sessionID && info.sessionID !== session?.id) return null;
  const records = readRequests ? await readRequests(root) : null;
  const lookup = id => readRequests ? records?.records?.[id] : readRuntimeRequest(root, id);
  let parentID = info.parentID;
  let request = await lookup(parentID);
  let binding = request ? null : await json(workerBindingFile(root, session?.id, parentID));
  if (!request && !binding && nativeMessages) {
    const rows = typeof nativeMessages === 'function' ? await nativeMessages() : nativeMessages;
    const inheritedParent = compactionRequestParent(session, parentID, rows);
    if (inheritedParent) {
      parentID = inheritedParent;
      request = await lookup(parentID);
      binding = request ? null : await json(workerBindingFile(root, session?.id, parentID));
    }
  }
  if (
    request?.sessionID === session?.id &&
    same(request.directory, directory) &&
    [3, 4, 5, 6].includes(request.policyVersion)
  ) {
    if (!info.agent || info.agent !== request.agent?.id)
      throw Error("Agent identity differs from the recorded assignment.");
    return {
      ...request,
      // Old captured requests inferred safety from their recorded mode. New
      // requests carry explicit readOnly state and no workflow descriptor.
      readOnly: request.policyVersion < 5
        ? request.workflow?.mode !== "build"
        : request.readOnly === true,
      rootSessionID: request.rootSessionID ?? session.id,
      rootRequestID: request.rootRequestID ?? request.id ?? parentID,
    };
  }
  const taskID = binding?.taskID ?? session?.metadata?.freelancer?.taskID;
  if (!/^[a-f0-9]{64}$/.test(taskID ?? "")) return null;
  const receipt = await json(
    path.join(root, ".state/delegation", `${taskID}.json`),
  );
  const attempt = receipt?.attempts?.find(
    (a) =>
      a.child_session === session.id && a.user_message_id === parentID,
  );
  if (
    !attempt ||
    typeof receipt.read_only !== "boolean" ||
    ![3, 4, 5, 6].includes(receipt.policy_version) ||
    receipt.parent_session !== session.parentID ||
    !same(receipt.directory, directory)
  )
    return null;
  if (!info.agent || info.agent !== receipt.agent?.id)
    throw Error("Agent identity differs from the delegated assignment.");
  const capturedRoot = await lookup(receipt.root_request_id);
  const captured = capturedRoot && capturedRoot.sessionID === receipt.root_session &&
    same(capturedRoot.directory, directory) && capturedRoot.policyVersion === receipt.policy_version
    ? capturedRoot : {};
  return {
    ...captured,
    id: attempt.user_message_id,
    sessionID: session.id,
    rootSessionID: receipt.root_session ?? receipt.parent_session,
    rootRequestID: receipt.root_request_id,
    projectID: receipt.project_id,
    directory: receipt.directory,
    policyVersion: receipt.policy_version,
    agent: receipt.agent,
    workflow: receipt.workflow,
    readOnly: receipt.read_only,
    taskID,
    parentMessageID: receipt.parent_message_id,
    delegateCallID: receipt.delegate_call_id,
    parentAssistantID: receipt.parent_assistant_id,
  };
}

export const executionContext = createExecutionContextReader();
