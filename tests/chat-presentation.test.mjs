import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { workspaceCatalog } from "../domain/workspace.mjs";
import { senderAction } from "../domain/sender.mjs";

test("parent chat exposes only the child navigation icon, never handoff arguments or output", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(() => server.close());
  const { Chat } = await server.ssrLoadModule("/src/Chat.tsx");
  const html = renderToStaticMarkup(
    React.createElement(Chat, {
      data: {
        settings: workspaceCatalog({}),
        snapshot: {},
        models: [],
        providers: { all: [], connected: [] },
        costs: { chats: [] },
      },
      messages: [
        {
          info: { id: "msg_test", role: "assistant" },
          parts: [
            {
              id: "prt_test",
              type: "tool",
              tool: "task",
              state: {
                status: "running",
                input: { prompt: "PRIVATE_HANDOFF_ARGUMENT" },
                output: "PRIVATE_CHILD_OUTPUT",
                metadata: { sessionId: "ses_child" },
              },
            },
          ],
        },
      ],
      agentID: "engineer",
      workflowID: "build",
      draft: "",
      model: "",
      busy: false,
    }),
  );
  assert.match(html, /Agent working.*Open conversation/);
  assert.match(html, /class="[^"]*\bspin\b[^"]*"/);
  assert.doesNotMatch(
    html,
    /PRIVATE_HANDOFF_ARGUMENT|PRIVATE_CHILD_OUTPUT|Execution details/,
  );
});

test("delegate requests and child reports render as collapsed Handoff cards", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false }, appType: "custom",
  });
  t.after(() => server.close());
  const { Chat } = await server.ssrLoadModule("/src/Chat.tsx");
  const data = { settings: workspaceCatalog({}), snapshot: {}, models: [],
    providers: { all: [], connected: [] }, project: { id: "project" } };
  const render = (session, messages) => renderToStaticMarkup(React.createElement(Chat, {
    data, session, messages, agentID: "engineer", workflowID: "build", draft: "", model: "", busy: false,
  }));
  const parent = render({ id: "parent" }, [{ info: { id: "user", role: "user" },
    parts: [{ type: "text", text: "[Freelancer Delegate handoff abc123]\nUser concern:\nCheck this" }] }]);
  assert.match(parent, /<details class="handoff-card"><summary>.*Handoff · Delegate request/);
  assert.doesNotMatch(parent, /<blockquote[^>]*>.*Freelancer Delegate handoff/);
  const child = render({ id: "child", parentID: "parent" }, [
    { info: { id: "user", role: "user" }, parts: [{ type: "text", text: "Investigate" }] },
    { info: { id: "report", role: "assistant", parentID: "user", finish: "stop", time: { completed: 1 } },
      parts: [{ type: "text", text: "Report outcome" }] },
  ]);
  assert.match(child, /<details class="handoff-card"><summary>.*Handoff · Agent report/);
});

test("docked todos render above the composer within the sticky composer", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false }, appType: "custom",
  });
  t.after(() => server.close());
  const { Chat } = await server.ssrLoadModule("/src/Chat.tsx");
  const render = (todoLayout, todos) => renderToStaticMarkup(React.createElement(Chat, {
    data: { settings: { ...workspaceCatalog({}), appearance: { todoLayout } }, snapshot: {}, models: [], providers: { all: [], connected: [] } },
    messages: [], todos, agentID: "engineer", workflowID: "build", draft: "", model: "", busy: false,
  }));
  const todos = [{ content: "Docked task", status: "completed" }];
  const html = render("docked", todos);
  assert.match(html, /class="composer-wrap"><div class="composer-cards"><section class="work-card"/);
  assert.match(html, /1\/1 complete/);
  assert.match(html, /Docked task/);
  assert.ok(html.indexOf('class="work-card"') < html.indexOf('class="composer"'));
  assert.doesNotMatch(render("inline", todos), /todo-dock/);
  assert.doesNotMatch(render("docked", []), /todo-dock/);
});

test("workspace Details shows chat title, newest agents first, and activity cards collapsed", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(() => server.close());
  const { Details } = await server.ssrLoadModule("/src/WorkspacePanels.tsx");
  const html = renderToStaticMarkup(
    React.createElement(Details, {
      chat: {
        title: "My chat title",
        summary: {},
        activity: [
          {
            id: "old",
            role: "old-worker",
            phase: "completed",
            subject: "Older agent",
            completedTools: 1,
            validation: "Passed",
            raw: { created_at: "2026-09-20T18:00:00Z" },
          },
          {
            id: "new",
            role: "new-review",
            phase: "working",
            subject: "Newest agent",
            completedTools: 2,
            validation: "Pending",
            raw: { created_at: "2026-09-20T20:00:00Z" },
          },
          {
            id: "middle",
            role: "middle-researcher",
            phase: "completed",
            subject: "Middle agent",
            completedTools: 1,
            validation: "Passed",
            raw: { created_at: "2026-09-20T19:00:00Z" },
          },
        ],
      },
      appearance: { todoLayout: "docked" },
      onChild: () => {},
    }),
  );
  assert.match(html, /<h2 class="details-chat-title">My chat title<\/h2>/);
  const newest = html.indexOf("new-review");
  const middle = html.indexOf("middle-researcher");
  const older = html.indexOf("old-worker");
  assert.ok(newest >= 0 && middle >= 0 && older >= 0);
  assert.ok(newest < middle && middle < older);
  assert.equal((html.match(/activity-summary-button/g) ?? []).length, 3);
  assert.doesNotMatch(html, /aria-expanded=|expanded job card/);
  assert.match(html, /new-review[\s\S]*?Working[\s\S]*?2 actions/);
  assert.match(html, /middle-researcher[\s\S]*?Finished[\s\S]*?1 actions/);
  assert.doesNotMatch(html, /Newest agent|Middle agent|Older agent/);
});

test("questions render native choice constraints and descriptions", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(() => server.close());
  const { Question } = await server.ssrLoadModule("/src/Question.tsx");
  const html = renderToStaticMarkup(
    React.createElement(Question, {
      request: {
        id: "que_fixture",
        questions: [
          {
            question: "Choose one",
            custom: false,
            options: [{ label: "Blue", description: "Cool color" }],
          },
          {
            question: "Choose several",
            multiple: true,
            custom: true,
            options: [{ label: "Tests", description: "Cover edge cases" }],
          },
        ],
      },
      onAnswer: async () => {},
      onReject: async () => {},
    }),
  );
  assert.match(html, /type="radio"/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /Cool color/);
  assert.match(html, /Cover edge cases/);
  assert.doesNotMatch(html, /Custom answer: Choose one/);
  assert.match(html, /Custom answer: Choose several/);
  assert.match(html, /Skip question/);
});

test("model pickers show concrete models, never default strategies as models", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(() => server.close());
  const { Chat } = await server.ssrLoadModule("/src/Chat.tsx");
  const { ParentModelFields } = await server.ssrLoadModule(
    "/src/ModelSetup.tsx",
  );
  const data = {
    settings: workspaceCatalog({}),
    nativeModels: { engineer: "opencode/free" },
    snapshot: {},
    models: [
      {
        id: "opencode/free",
        name: "Real model",
        provider: "opencode",
        costClass: "free",
        variants: ["high"],
      },
    ],
    providers: {
      all: [{ id: "opencode", name: "OpenCode Free" }],
      connected: ["opencode"],
    },
  };
  const chat = renderToStaticMarkup(
    React.createElement(Chat, {
      data,
      messages: [],
      agentID: "inherit",
      workflowID: "build",
      draft: "",
      model: "inherit",
      busy: false,
    }),
  );
  assert.match(chat, /value="opencode\/free"[^>]*selected=""/);
  assert.doesNotMatch(chat, /OpenCode default|Agent default|Session default/);
  const form = renderToStaticMarkup(
    React.createElement(ParentModelFields, {
      data,
      model: "opencode/free",
      variant: "",
      defaults: true,
    }),
  );
  assert.doesNotMatch(form, /OpenCode default|value="auto"|value="inherit"/);
  assert.match(form, /Real model/);
  assert.match(chat, /aria-label="Intelligence"/);
  assert.match(form, /aria-label="Intelligence"/);
  assert.match(form, /value="high"/);
  assert.doesNotMatch(form, /value="low"|value="medium"/);
  data.models[0].variants = [];
  const plainForm = renderToStaticMarkup(
    React.createElement(ParentModelFields, {
      data,
      model: "opencode/free",
      variant: "high",
    }),
  );
  const plainChat = renderToStaticMarkup(
    React.createElement(Chat, {
      data,
      messages: [],
      agentID: "inherit",
      workflowID: "build",
      draft: "",
      model: "inherit",
      variant: "high",
      busy: false,
    }),
  );
  assert.doesNotMatch(plainForm, /Intelligence|value="high"/);
  assert.doesNotMatch(plainChat, /Intelligence|value="high"/);
});

test("session defaults expose starting choices and keep agent-owned models in agent setup", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(() => server.close());
  const { Settings } = await server.ssrLoadModule("/src/Settings.tsx");
  const data = {
    project: { id: "project", name: "Example", directory: "/project" },
    sessionDefaults: {
      revision: 0,
      workflowID: "build",
      agentID: "none",
      parentModel: "opencode/model",
      reasoningVariant: "high",
    },
    settings: { ...workspaceCatalog({}), plans: {} },
    snapshot: {},
    models: [
      {
        id: "opencode/model",
        name: "Parent model name",
        provider: "opencode",
        costClass: "free",
        variants: ["low", "high"],
      },
    ],
    providers: {
      all: [{ id: "opencode", name: "OpenCode Free" }],
      connected: ["opencode"],
    },
  };
  const render = () =>
    renderToStaticMarkup(
      React.createElement(Settings, { data, tab: "sessions" }),
    );
  const withoutAgent = render();
  assert.match(withoutAgent, /Start a new chat/);
  assert.match(withoutAgent, /Existing chats keep their choices/);
  assert.match(withoutAgent, /Intelligence/);
  assert.match(withoutAgent, /value="high" selected=""/);
  assert.doesNotMatch(
    withoutAgent,
    /Excluded models|More preferences|Apply to|Working style|Context warning|time limit|Maximum parallel|Spending preference/,
  );
  data.sessionDefaults.agentID = "engineer";
  Object.assign(data.settings.agents[0], {
    model: "opencode/model",
    variant: "low",
  });
  const withAgent = render();
  assert.match(withAgent, /Set by Engineer/);
  assert.match(withAgent, /Parent model name/);
  assert.doesNotMatch(
    withAgent,
    /value="opencode\/model"|aria-label="Intelligence"/,
  );
  data.sessionDefaults.agentID = "none";
  data.models[0].variants = [];
  assert.doesNotMatch(render(), /aria-label="Intelligence"/);
});


test("state-aware sender renders send, stop, and handoff states without exposing transport details", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("../", import.meta.url)),
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false }, appType: "custom",
  });
  t.after(() => server.close());
  const { SenderControls } = await server.ssrLoadModule("/src/ChatSender.tsx");
  const render = (action, busy = false) => renderToStaticMarkup(React.createElement(SenderControls, {
    sender: { action, pending: false }, busy, onStop() {}, disabled: false,
  }));
  assert.match(render("send"), /aria-label="Send message"/);
  assert.match(render("stop", true), /aria-label="Stop response"/);
  assert.match(render("handoff", true), /aria-label="Choose Delegate, Queue, or Interrupt"/);
  assert.match(render("handoff", true), /aria-haspopup="dialog"/);
  for (const action of ["send", "stop", "handoff"])
    assert.equal((render(action, action !== "send").match(/<button/g) ?? []).length, 1);
  assert.equal(senderAction({ busy: false, draft: "", hasAttachments: true, loading: false, available: true }), "send");
  assert.equal(senderAction({ busy: true, draft: "", hasAttachments: true, loading: false, available: true }), "stop");
  assert.equal(senderAction({ busy: true, draft: "Clarify", hasAttachments: true, loading: false, available: true }), "handoff");
  assert.doesNotMatch(render("handoff", true), /selectedModel|prompt_async|delegate\(/);
});
