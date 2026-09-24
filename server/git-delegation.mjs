import path from "node:path";
import { executionContext } from "../backend/tools/runtime/execution-context.mjs";

const sameDirectory = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  (process.platform === "win32"
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b));

// A delegated Git assignment may coordinate history while its parent is waiting
// on that exact native delegate call. No general "ignore busy sessions" flag is
// accepted. Re-derive the group from native identity and durable receipts each
// time a preview or execution checks idleness.
export async function delegatedGitGroup({
  host,
  backendRoot,
  directory,
  actor,
}) {
  const own = actor.sessionID;
  const single = new Set(own ? [own] : []);
  if (!actor.delegated) return single;
  const request = (route) => host.request(route, { directory });
  const child = await request(`/session/${encodeURIComponent(own)}`);
  const childMessage = await request(
    `/session/${encodeURIComponent(own)}/message/${encodeURIComponent(actor.messageID)}`,
  );
  const assignment = await executionContext(
    backendRoot,
    directory,
    child,
    childMessage,
  );
  const legacyWorkflowGate =
    assignment?.policyVersion < 5 &&
    (assignment.readOnly ||
      assignment.workflow?.mode !== "build" ||
      assignment.workflow?.id !== "sync");
  if (
    !assignment?.taskID ||
    legacyWorkflowGate ||
    !assignment.delegateCallID ||
    !assignment.parentAssistantID
  )
    throw Error(
      "The delegated Git assignment could not be verified. Nothing was changed.",
    );
  const parent = await request(
    `/session/${encodeURIComponent(assignment.rootSessionID)}`,
  );
  if (
    parent.parentID ||
    child.parentID !== parent.id ||
    !sameDirectory(parent.directory, child.directory)
  )
    throw Error("The delegated Git parent does not match this project.");
  const messages = await request(
    `/session/${encodeURIComponent(parent.id)}/message`,
  );
  if (!Array.isArray(messages))
    throw Error("Parent activity is unavailable. Nothing was changed.");
  const active = messages.flatMap((message) =>
    (message.parts ?? [])
      .filter(
        (part) =>
          part.type === "tool" &&
          ["pending", "running"].includes(part.state?.status),
      )
      .map((part) => ({ message, part })),
  );
  const waiting =
    active.length === 1 &&
    active[0].message.info?.id === assignment.parentAssistantID &&
    active[0].message.info?.parentID === assignment.parentMessageID &&
    active[0].part.tool === "delegate" &&
    active[0].part.callID === assignment.delegateCallID &&
    active[0].part.state?.input?.agentID === assignment.agent.id &&
    active[0].part.state?.input?.workflowID === assignment.workflow.id;
  const latestUser = messages.findLast(
    (message) => message.info?.role === "user",
  );
  if (!waiting || latestUser?.info?.id !== assignment.parentMessageID)
    throw Error(
      "The parent must be waiting only on this Git assignment. Finish other tools or requests before changing history.",
    );
  return new Set([own, parent.id]);
}
