import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRequestGroups,
  summarizeRequestWork,
  purposeForTool,
  requestWorkLabel,
  latestToolParts,
  delegateModel,
} from "../domain/chat-view.mjs";
import { senderState } from "../domain/sender.mjs";

const user = (id, text = "hello") => ({
  info: { id, role: "user" },
  parts: [{ id: `${id}-p`, type: "text", text }],
});
const assistantText = (id, text = "done") => ({
  info: { id, role: "assistant", modelID: "m", providerID: "p" },
  parts: [{ id: `${id}-p`, type: "text", text }],
});
const toolMsg = (id, tool, status = "completed") => ({
  info: { id, role: "assistant" },
  parts: [{ id: `${id}-p`, type: "tool", tool, state: { status, input: {} } }],
});

test("nonzero native command exit is a failure even when the tool finished", () => {
  const message = toolMsg("failed", "bash");
  message.parts[0].state.metadata = { exit: 1 };
  const summary = summarizeRequestWork([message]);
  assert.equal(summary.errors, 1);
  assert.equal(summary.done, 0);
  assert.equal(summary.purposes[0].errors, 1);
  assert.equal(requestWorkLabel(summary), "Response ended · 1 tool failed");
  message.parts[0].state.metadata.exit = 0;
  assert.equal(summarizeRequestWork([message]).errors, 0);
});

test("a terminal assistant error clears a stale native busy status", () => {
  const failed = {
    info: { id: "a1", role: "assistant", parentID: "u1", error: "provider disconnected" },
    parts: [],
  };
  const state = senderState({ messages: [user("u1"), failed], status: { chat: { type: "busy" } },
    permissions: [], questions: [], receipts: [] }, "chat");
  assert.equal(state.failed, true);
  assert.equal(state.ready, true);
  assert.equal(state.failure, "provider disconnected");
});

test("a busy unanswered turn stays busy even when old; native idle permits recovery", () => {
  const fresh = user("u1");
  fresh.info.time = { created: Date.now() };
  assert.equal(senderState({ messages: [fresh], status: { chat: { type: "busy" } },
    permissions: [], questions: [], receipts: [] }, "chat").busy, true);
  fresh.info.time.created -= 61000;
  assert.equal(senderState({ messages: [fresh], status: { chat: { type: "busy" } },
    permissions: [], questions: [], receipts: [] }, "chat").busy, true);
  const state = senderState({ messages: [fresh], status: {},
    permissions: [], questions: [], receipts: [] }, "chat");
  assert.equal(state.interrupted, true);
  assert.equal(state.ready, true);
  assert.equal(state.busy, false);
});

test("stale busy status with an already-answered latest turn is recoverable", () => {
  const answered = { ...assistantText("a1"), info: { id: "a1", role: "assistant", parentID: "u1",
    time: { completed: 100 }, finish: "stop" } };
  const state = senderState({ messages: [user("u1"), answered], status: { chat: { type: "busy" } },
    permissions: [], questions: [], receipts: [] }, "chat");
  assert.equal(state.interrupted, true);
  assert.equal(state.ready, true);
});

test("stale busy status after native conversation compaction is recoverable", () => {
  const state = senderState({ messages: [assistantText("a1")], status: { chat: { type: "busy" } },
    permissions: [], questions: [], receipts: [] }, "chat");
  assert.equal(state.interrupted, true);
  assert.equal(state.ready, true);
});

test("live tools, approvals, and unobserved accepted prompts remain busy", () => {
  const unanswered = user("u1");
  const activeTool = toolMsg("a1", "bash", "running");
  const hasLiveTool = senderState({ messages: [unanswered, activeTool], status: { chat: { type: "busy" } },
    permissions: [], questions: [], receipts: [] }, "chat");
  assert.equal(hasLiveTool.busy, true);
  const hasApproval = senderState({ messages: [unanswered], status: { chat: { type: "busy" } },
    permissions: [{ id: "p1" }], questions: [], receipts: [] }, "chat");
  assert.equal(hasApproval.busy, true);
  const awaitingPrompt = senderState({ messages: [unanswered], status: { chat: { type: "busy" } },
    permissions: [], questions: [], receipts: [{ id: "accepted", status: "accepted" }] }, "chat");
  assert.equal(awaitingPrompt.busy, true);
  const stoppedTool = senderState({ messages: [unanswered, { ...activeTool, info: { ...activeTool.info, parentID: 'u1' } }],
    status: {}, permissions: [], questions: [], receipts: [] }, "chat");
  assert.equal(stoppedTool.interrupted, true, "native idle after abort overrides an old running tool part");
});

test("a detached worker remains working after its parent dispatch tool completes", () => {
  const delegated = toolMsg("worker", "delegate");
  delegated.parts[0].state.metadata = { freelancer_status: "running" };
  const summary = summarizeRequestWork([delegated]);
  assert.equal(summary.running, 1);
  delegated.parts[0].state.metadata.freelancer_status = "completed";
  assert.equal(summarizeRequestWork([delegated]).done, 1);
});

test("ended response is not task success and cancelled tasks are terminal", () => {
  const todos = [{ content: "Review", status: "in_progress" }, { content: "Save", status: "pending" }];
  const before = structuredClone(todos);
  const summary = summarizeRequestWork([toolMsg("read", "read")], todos);
  assert.equal(requestWorkLabel(summary), "Response ended · Tasks unfinished");
  assert.equal(requestWorkLabel(summary, true), "Working on the response");
  assert.deepEqual(todos, before);
  const ended = summarizeRequestWork([], [{ status: "completed" }, { status: "cancelled" }]);
  assert.equal(ended.tasks.unfinished, false);
  assert.equal(requestWorkLabel(ended), "Response ended");
});

test("simple text response is one request with no Working section", () => {
  const groups = buildRequestGroups([user("u1"), assistantText("a1")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].userMessages.length, 1);
  assert.equal(groups[0].responseMessages.length, 1);
  assert.equal(summarizeRequestWork(groups[0].allMessages, []).hasWork, false);
});

test("queued follow-up before a reply stays in the same request", () => {
  const groups = buildRequestGroups([user("u1"), user("u2"), assistantText("a1")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].userMessages.map((m) => m.info.id).join(","), "u1,u2");
});

test("a new request after a reply starts fresh without deleting history", () => {
  const groups = buildRequestGroups([
    user("u1"),
    assistantText("a1"),
    user("u2"),
    assistantText("a2"),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[1].userMessages[0].info.id, "u2");
});

test("tool-heavy request yields one purpose-grouped summary", () => {
  const groups = buildRequestGroups([
    user("u1"),
    toolMsg("a1", "read"),
    toolMsg("a2", "grep"),
    toolMsg("a3", "bash", "running"),
  ]);
  const summary = summarizeRequestWork(groups[0].allMessages, []);
  assert.equal(summary.hasWork, true);
  assert.equal(summary.toolCount, 3);
  assert.equal(summary.running, 1);
  const reading = summary.purposes.find((p) => p.purpose === "Reading project files");
  assert.equal(reading.total, 2);
  assert.equal(purposeForTool("read"), "Reading project files");
  assert.equal(purposeForTool("bash"), "Running checks");
});

test("replayed message IDs do not duplicate work; retries stay distinguishable", () => {
  const failed = toolMsg("a1", "bash", "error");
  const retry = toolMsg("a2", "bash", "completed");
  const groups = buildRequestGroups([user("u1"), failed, failed, retry]);
  const summary = summarizeRequestWork(groups[0].allMessages, []);
  assert.equal(summary.toolCount, 2);
  assert.equal(summary.errors, 1);
  assert.equal(summary.done, 1);
});

test("identical text in distinct messages is retained", () => {
  const groups = buildRequestGroups([
    user("u1"),
    assistantText("a1", "same"),
    assistantText("a2", "same"),
  ]);
  assert.equal(groups[0].responseMessages.length, 2);
});

test("approval response with a runtime request id resumes its request", () => {
  const u1 = { ...user("u1"), info: { id: "u1", role: "user", requestID: "req-1" } };
  const a1 = { ...assistantText("a1"), info: { id: "a1", role: "assistant", requestID: "req-1" } };
  const u2 = { ...user("u2", "approved"), info: { id: "u2", role: "user", requestID: "req-1" } };
  const a2 = { ...assistantText("a2"), info: { id: "a2", role: "assistant", requestID: "req-1" } };
  const groups = buildRequestGroups([u1, a1, u2, a2]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].requestID, "req-1");
  assert.equal(groups[0].userMessages.map((m) => m.info.id).join(","), "u1,u2");
});

test("late assistant message attaches to its owning request, not the newest", () => {
  const groups = buildRequestGroups([
    { ...user("u1"), info: { id: "u1", role: "user", requestID: "req-1" } },
    { ...user("u2"), info: { id: "u2", role: "user", requestID: "req-2" } },
    { ...assistantText("late", "late result"), info: { id: "late", role: "assistant", requestID: "req-1" } },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].responseMessages.map((m) => m.info.id).join(","), "late");
  assert.equal(groups[1].responseMessages.length, 0);
});

test("unknown tool status is reported as waiting, not dropped", () => {
  const groups = buildRequestGroups([user("u1"), toolMsg("a1", "read", "unknown")]);
  const summary = summarizeRequestWork(groups[0].allMessages, []);
  assert.equal(summary.hasWork, true);
  assert.equal(summary.waiting, 1);
  assert.equal(summary.purposes[0].waiting, 1);
});

test("todowrite is tracked via todos, not double-counted as a purpose", () => {
  const groups = buildRequestGroups([user("u1"), toolMsg("a1", "todowrite")]);
  const summary = summarizeRequestWork(groups[0].allMessages, []);
  assert.equal(summary.hasWork, true);
  assert.ok(!summary.purposes.some((p) => p.purpose === "Tracking tasks"));
});

test("replayed part ids are counted once; distinct ids with same text stay", () => {
  const dup = toolMsg("a1", "bash", "completed");
  const sameIdOtherMsg = {
    info: { id: "a2", role: "assistant" },
    parts: [{ id: "a1-p", type: "tool", tool: "bash", state: { status: "completed", input: {} } }],
  };
  const summary = summarizeRequestWork([user("u1"), dup, sameIdOtherMsg], []);
  assert.equal(summary.toolCount, 1);
  assert.equal(summary.done, 1);
});

test("same part id updated from running to completed reflects the latest", () => {
  const running = toolMsg("a1", "bash", "running");
  const completed = {
    info: { id: "a1", role: "assistant" },
    parts: [{ id: "a1-p", type: "tool", tool: "bash", state: { status: "completed", input: {} } }],
  };
  const summary = summarizeRequestWork([user("u1"), running, completed], []);
  assert.equal(summary.toolCount, 1);
  assert.equal(summary.running, 0);
  assert.equal(summary.done, 1);
});

test("delegate callbacks for one child render as one current worker with its recorded model", () => {
  const first = { id: "first", callID: "call-1", type: "tool", tool: "delegate", state: {
    status: "completed", input: { agentID: "researcher" },
    metadata: { sessionId: "child-1", agentName: "Researcher", selected_model: "opencode/free", freelancer_status: "running" },
  } };
  const callback = { id: "callback", callID: "call-2", type: "tool", tool: "delegate", state: {
    status: "completed", input: { worker: "child-1" },
    metadata: { sessionId: "child-1", agentName: "Researcher", freelancer_status: "completed" },
    output: JSON.stringify({ attempts: [{ child_session: "child-1", selected_model: "opencode/free" }] }),
  } };
  const other = { id: "other", callID: "call-3", type: "tool", tool: "delegate", state: {
    status: "completed", input: { agentID: "engineer" },
    metadata: { sessionId: "child-2", selected_model: "provider/other", freelancer_status: "running" },
  } };
  const messages = [{ info: { id: "a1", role: "assistant" }, parts: [first, callback, other] }];
  assert.deepEqual(latestToolParts(messages).map((part) => part.id), ["callback", "other"]);
  assert.equal(delegateModel(callback), "opencode/free");
  const summary = summarizeRequestWork(messages);
  assert.equal(summary.workerCount, 2);
  assert.equal(summary.workers.running, 1);
  assert.equal(summary.workers.finished, 1);
});


test("native recap and synthetic continuation stay with the user's request", () => {
  const recap = { ...assistantText("recap", "Internal recap"), info: {id:"recap", role:"assistant", summary:true} };
  const groups = buildRequestGroups([user("u"), toolMsg("work", "read"),
    {info:{id:"compact",role:"user"},parts:[{type:"compaction"}]}, recap,
    {info:{id:"continue",role:"user"},parts:[{type:"text",synthetic:true,text:"Continue"}]}, assistantText("final")]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].userMessages.map(m => m.info.id), ["u"]);
  assert.ok(groups[0].responseMessages.includes(recap));
});
