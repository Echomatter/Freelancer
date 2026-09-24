import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from 'node:crypto';
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
// model-provided agent/workflow/context blob. Historical receipts are not edited.
export async function executionContext(root, directory, session, message) {
  const info = message?.info ?? message;
  if (info?.role !== "assistant") return null;
  const records = await json(path.join(root, ".state/webpage/requests.json"));
  const request = records?.records?.[info.parentID];
  if (
    request?.sessionID === session?.id &&
    same(request.directory, directory) &&
    [3, 4, 5].includes(request.policyVersion)
  ) {
    if (!info.agent || info.agent !== request.agent?.id)
      throw Error("Agent identity differs from the recorded assignment.");
    return {
      ...request,
      readOnly: request.policyVersion < 5 ? request.workflow?.mode !== "build" : false,
      rootSessionID: session.id,
      rootRequestID: request.id ?? info.parentID,
    };
  }
  const binding = await json(workerBindingFile(root, session?.id, info.parentID));
  const taskID = binding?.taskID ?? session?.metadata?.freelancer?.taskID;
  if (!/^[a-f0-9]{64}$/.test(taskID ?? "")) return null;
  const receipt = await json(
    path.join(root, ".state/delegation", `${taskID}.json`),
  );
  const attempt = receipt?.attempts?.find(
    (a) =>
      a.child_session === session.id && a.user_message_id === info.parentID,
  );
  if (
    !attempt ||
    typeof receipt.read_only !== "boolean" ||
    ![3, 4, 5].includes(receipt.policy_version) ||
    receipt.parent_session !== session.parentID ||
    !same(receipt.directory, directory)
  )
    return null;
  if (!info.agent || info.agent !== receipt.agent?.id)
    throw Error("Agent identity differs from the delegated assignment.");
  const capturedRoot = records?.records?.[receipt.root_request_id];
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
