import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { workspaceCatalog } from "../domain/workspace.mjs";

const baseData = () => ({
  settings: workspaceCatalog({}),
  snapshot: {},
  models: [],
  providers: { all: [], connected: [] },
  costs: { chats: [] },
});
const baseProps = (extra = {}) => ({
  data: baseData(),
  messages: [
    {
      info: { id: "u1", role: "user" },
      parts: [{ id: "u1-p", type: "text", text: "hello" }],
    },
  ],
  agentID: "engineer",
  workflowID: "build",
  draft: "",
  model: "",
  busy: false,
  ...extra,
});

test("latest request shows a decision banner only when decisions are pending", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(() => server.close());
  const { Chat } = await server.ssrLoadModule("/src/Chat.tsx");
  const withPending = renderToStaticMarkup(
    React.createElement(Chat, baseProps({ pendingDecisions: 2 })),
  );
  assert.match(withPending, /Needs your decision/);
  assert.match(withPending, /Review decision/);
  const withoutPending = renderToStaticMarkup(
    React.createElement(Chat, baseProps({ pendingDecisions: 0 })),
  );
  assert.doesNotMatch(withoutPending, /Needs your decision/);
});


test("work details remain grouped by turn while prose stays outside the work block", async (t) => {
  const server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), optimizeDeps: { noDiscovery: true, entries: [], include: [] }, server: { middlewareMode: true, hmr: false }, appType: "custom" });
  t.after(() => server.close());
  const { Chat } = await server.ssrLoadModule("/src/Chat.tsx");
  const html = renderToStaticMarkup(React.createElement(Chat, baseProps({ messages: [
    ...baseProps().messages,
    { info: { id: "a1", role: "assistant" }, parts: [
      { id: "r1", type: "reasoning", text: "Inspect the worker output first." },
      { id: "r2", type: "reasoning", text: "Then read the file." },
      { id: "t1", type: "tool", tool: "read", state: { status: "completed", input: { filePath: "sample.ts" }, output: "unique tool output" } },
      { id: "p1", type: "text", text: "Helpful explanation." },
    ] },
  ] })));
  const workStart = html.indexOf('class="request-working ');
  const proseStart = html.indexOf('class="message assistant"');
  assert.ok(workStart >= 0 && proseStart > workStart);
  assert.ok(html.indexOf('unique tool output') < proseStart);
  assert.ok(html.indexOf('Inspect the worker output first.') > proseStart);
  assert.doesNotMatch(html, /class="reasoning reasoning-text"/);
  assert.doesNotMatch(html, /Thought:|Thought process|<details class="reasoning"/);
  assert.ok(html.indexOf('Helpful explanation.') > proseStart);
  assert.equal(html.split('unique tool output').length - 1, 1);
  assert.doesNotMatch(html, /View activity/);
});
