import { checkedCatalog } from '../backend/tools/runtime/agent-catalog.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createApplication } from "../server/application.mjs";
import { createStore } from "../server/store.mjs";
import { defaults } from "../shared/strategy.mjs";
import { startServer } from "../server/http.mjs";

import {
  loadPreferences,
  savePreferences,
} from "../backend/tools/runtime/preferences.mjs";

async function fixture(t, realPreferences = false) {
  // Windows TEMP may use an 8.3 alias; native fixtures must use the same
  // canonical paths as addProject(), including preference-store keys.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "freelancer-app-")));
  const directory = path.join(root, "project");
  await mkdir(directory);
  const store = createStore(root),
    calls = [];
  const snapshot = {
    preferences: { scope: "default", revision: 0, preferences: defaults },
    usage: { providers: [] },
  };
  let extraModels = {},
    failSend = false;
  let nativeDefaults = {},
    nativeAgents = [],
    nativeProviders = { providers: [{ id: "opencode", models: { free: {} } }] };
  let authMethods = {},
    status = {};
  let rows = [],
    messageRows = [],
    pendingQuestions = [],
    pendingPermissions = [],
    saved;
  const host = {
    async request(route, options) {
      calls.push({ route, options });
      if (failSend && route.endsWith("prompt_async"))
        throw Error("Native transport failed");
      if (route === "/provider/auth") return authMethods;
      if (route === "/agent") return [
        ...checkedCatalog(await store.read("settings")).agents.filter(a=>!nativeAgents.some(n=>n.name===a.id)).map(a=>({name:a.id,mode:'all',permission:[]})),
        ...nativeAgents.map(a=>({mode:"all",permission:[],...a})),
      ];
      if (route === "/config") return nativeDefaults;
      if (route === "/config/providers") return nativeProviders;
      if (route === "/session/status") return status;
      if (route === "/session" && options?.method === "POST")
        return { id: "ses_new", directory: options.directory };
      if (route === "/provider")
        return {
          connected: ["opencode"],
          all: [
            {
              id: "opencode",
              key: "DO-NOT-LEAK",
              models: {
                free: { cost: { input: 0, output: 0 } },
                ...extraModels,
              },
            },
          ],
        };
      if (route === "/session?limit=1000") return rows;
      if (route === "/question") return pendingQuestions;
      if (route === "/permission") return pendingPermissions;
      if (route === "/session/ses_owned") return { id: "ses_owned", directory };
      if (route === "/session/ses_owned/message") return messageRows;
      if (route === "/session/ses_foreign")
        return { id: "ses_foreign", directory: root };
      return [];
    },
  };
  const app = createApplication({
    backendRoot: root,
    host,
    store,
    backendFactory: (_, projectDirectory) => ({
      snapshot: async (session) =>
        realPreferences
          ? {
              ...snapshot,
              preferences: await loadPreferences(
                root,
                projectDirectory,
                session,
              ),
            }
          : snapshot,
      refreshQuota: async () => {},
      save: async (input) => {
        saved = input;
        if (realPreferences)
          return savePreferences(root, projectDirectory, input);
      },
    }),
  });
  t.after(async () => {
    await app.indexJobs.close();
    app.history.close();
    app.modelRatings.close();
    await app.gitProjects.close();
    app.localData.close();
    await store.flush();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  return {
    root,
    directory,
    app,
    calls,
    store,
    set failSend(value) {
      failSend = value;
    },
    set extraModels(value) {
      extraModels = value;
    },
    set nativeDefaults(value) {
      nativeDefaults = value;
    },
    set nativeAgents(value) {
      nativeAgents = value;
    },
    set nativeProviders(value) {
      nativeProviders = value;
    },
    set authMethods(value) {
      authMethods = value;
    },
    set status(value) {
      status = value;
    },
    get saved() {
      return saved;
    },
    set rows(value) {
      rows = value;
    },
    set messages(value) {
      messageRows = value;
    },
    set questions(value) {
      pendingQuestions = value;
    },
    set permissions(value) {
      pendingPermissions = value;
    },
  };
}

test("opening a folder installs project defaults and preserves project source", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "AGENTS.md"), "User instructions");
  const project = await f.app.addProject(f.directory);
  assert.equal(f.saved.scope, "project");
  const marker = JSON.parse(
    await readFile(path.join(f.directory, ".opencode/freelancer.json"), "utf8"),
  );
  assert.equal(marker.projectID, project.id);
  assert.equal(
    await readFile(path.join(f.directory, "AGENTS.md"), "utf8"),
    "User instructions",
  );
  await f.app.addProject(f.directory);
  assert.equal((await f.store.read("settings")).projects.length, 1);
});
test("project selection persists across bootstrap and project management preserves folders", async (t) => {
  const f = await fixture(t), secondDirectory = path.join(f.root, "second");
  await mkdir(secondDirectory);
  const first = await f.app.addProject(f.directory), second = await f.app.addProject(secondDirectory);
  await f.app.selectProject(first.id);
  assert.equal((await f.app.bootstrap()).project.id, first.id);
  const renamed = await f.app.updateProject(first.id, { name: "Dexfraggler Workspace" });
  assert.equal(renamed.name, "Dexfraggler Workspace");
  await f.app.removeProject(second.id);
  assert.equal((await f.store.read("settings")).projects.some((p) => p.id === second.id), false);
  assert.equal((await realpath(secondDirectory)), secondDirectory);
});
test("project boundaries prevent cross-project reading and execution", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  f.rows = [
    { id: "ses_owned", directory: f.directory },
    { id: "ses_foreign", directory: f.root },
  ];
  const bootstrap = await f.app.bootstrap(p.id);
  assert.deepEqual(
    bootstrap.sessions.map((s) => s.id),
    ["ses_owned"],
  );
  assert.equal(JSON.stringify(bootstrap).includes("DO-NOT-LEAK"), false);
  await assert.rejects(f.app.chat(p.id, "ses_foreign"), /another project/);
  await assert.rejects(
    f.app.send(p.id, "ses_foreign", {
      text: "hello",
      model: { providerID: "opencode", modelID: "free" },
    }),
    /another project/,
  );
  await assert.rejects(f.app.stop(p.id, "ses_foreign"), /another project/);
  assert.equal(
    f.calls.some(
      (c) => c.route.includes("prompt_async") || c.route.includes("/abort"),
    ),
    false,
  );
});
test("model validation rejects unconnected or metered free-provider models", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  await assert.rejects(
    f.app.send(p.id, "ses_owned", {
      text: "hello",
      model: { providerID: "opencode", modelID: "paid" },
    }),
  );
  await f.app.send(p.id, "ses_owned", {
    text: "hello",
    model: { providerID: "opencode", modelID: "free" },
  });
  const call = f.calls.find((c) => c.route.endsWith("prompt_async"));
  assert.equal(call.options.body.model.modelID, "free");
  assert.match(call.options.body.messageID, /^msg_[0-9a-f]{32}$/);
});
test("file previews cannot escape a registered project", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  await writeFile(path.join(f.root, "outside.txt"), "private");
  await assert.rejects(
    f.app.files(p.id, "../outside.txt", true),
    /inside this project/,
  );
});

test("native questions enforce answer shape and project ownership; rejection is explicit", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  f.questions = [
    {
      id: "que_test",
      sessionID: "ses_owned",
      questions: [
        {
          question: "Pick one",
          multiple: false,
          custom: false,
          options: [{ label: "One" }, { label: "Two" }],
        },
        {
          question: "Pick several",
          multiple: true,
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    },
  ];
  for (const answers of [
    [],
    [["One"]],
    [["One", "Two"], ["A"]],
    [["Other"], ["A"]],
    [["One"], [" "]],
  ]) {
    await assert.rejects(
      f.app.respond(p.id, "question", "que_test", { answers }),
      /Answer each question/,
    );
  }
  assert.equal(
    f.calls.some((c) => c.options?.method === "POST"),
    false,
  );
  const answers = [["One"], ["A", "My custom answer"]];
  await f.app.respond(p.id, "question", "que_test", { answers });
  assert.deepEqual(f.calls.at(-1).options.body, { answers });
  assert.equal(f.calls.at(-1).route, "/question/que_test/reply");
  await f.app.respond(p.id, "question", "que_test", { reject: true });
  assert.equal(f.calls.at(-1).route, "/question/que_test/reject");
  f.questions = [{ id: "que_other", sessionID: "ses_foreign", questions: [] }];
  await assert.rejects(
    f.app.respond(p.id, "question", "que_other", { reject: true }),
    /another project/,
  );
  await assert.rejects(
    f.app.respond(p.id, "question", "que_gone", { reject: true }),
    /already been answered/,
  );
});

test("permission decisions reach only a pending request in the chosen project", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  f.permissions = [
    { id: "per_test", sessionID: "ses_owned" },
    { id: "per_other", sessionID: "ses_foreign" },
  ];
  await assert.rejects(
    f.app.respond(p.id, "permission", "per_other", { reply: "once" }),
    /another project/,
  );
  await assert.rejects(
    f.app.respond(p.id, "permission", "per_test", { reply: "invalid" }),
    /permission response/,
  );
  for (const reply of ["once", "always", "reject"]) {
    await f.app.respond(p.id, "permission", "per_test", { reply });
    assert.equal(f.calls.at(-1).route, "/permission/per_test/reply");
    assert.deepEqual(f.calls.at(-1).options.body, { reply });
  }
});

test("stop dismisses stale prompts for its session without affecting other chats", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  f.questions = [
    { id: "que_stop", sessionID: "ses_owned" },
    { id: "que_keep", sessionID: "ses_foreign" },
  ];
  f.permissions = [
    { id: "per_stop", sessionID: "ses_owned" },
    { id: "per_keep", sessionID: "ses_foreign" },
  ];
  await f.app.stop(p.id, "ses_owned");
  const calls = f.calls.filter((c) => c.options?.method === "POST");
  assert.deepEqual(
    calls.map((c) => c.route),
    [
      "/session/ses_owned/abort",
      "/question/que_stop/reject",
      "/permission/per_stop/reply",
    ],
  );
  assert.deepEqual(calls.at(-1).options.body, { reply: "reject" });
});

test("provider connections use native auth and refresh cached instances only when idle", async (t) => {
  const f = await fixture(t);
  await f.app.addProject(f.directory);
  f.authMethods = {
    "github-copilot": [
      {
        type: "oauth",
        prompts: [
          {
            type: "select",
            key: "deploymentType",
            message: "Deployment",
            options: [{ value: "github.com" }, { value: "enterprise" }],
          },
        ],
      },
    ],
  };
  assert.equal((await f.app.authMethods())["opencode-go"][0].type, "api");
  await f.app.auth("github-copilot", "authorize", {
    method: 0,
    inputs: { deploymentType: "github.com", extra: "ignored" },
  });
  assert.deepEqual(f.calls.at(-1).options.body, {
    method: 0,
    inputs: { deploymentType: "github.com" },
  });
  assert.equal(
    f.calls.some((c) => c.route === "/global/dispose"),
    false,
  );
  f.status = { ses_working: { type: "busy" } };
  await assert.rejects(
    f.app.auth("opencode-go", "key", { key: "fake-test-key" }),
    /running chats/,
  );
  assert.equal(
    f.calls.some(
      (c) => c.route === "/auth/opencode-go" || c.route === "/global/dispose",
    ),
    false,
  );
  f.status = {};
  await f.app.auth("opencode-go", "key", { key: "fake-test-key" });
  assert.equal(f.calls.at(-2).route, "/auth/opencode-go");
  assert.deepEqual(f.calls.at(-2).options.body, {
    type: "api",
    key: "fake-test-key",
  });
  assert.equal(f.calls.at(-1).route, "/global/dispose");
  assert.equal(
    JSON.stringify(await f.store.read("settings")).includes("fake-test-key"),
    false,
  );
  await f.app.auth("github-copilot", "callback", {
    method: 0,
    code: "test-code",
  });
  assert.equal(f.calls.at(-2).route, "/provider/github-copilot/oauth/callback");
  assert.deepEqual(f.calls.at(-2).options.body, {
    method: 0,
    code: "test-code",
  });
  assert.equal(f.calls.at(-1).route, "/global/dispose");
});

test("agents and workflows compose native execution, preserve user text, and constrain child routes", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  const agent = await f.app.saveAgent({
    name: "Test engineer",
    model: "opencode/free",
    prompt: "Check edge cases first.",
    response: "concise",
    approach: "thorough",
  });
  const workflow = await f.app.saveWorkflow({
    name: "Inspect changes",
    prompt: "Inspect the current diff.",
    mode: "review",
    agentID: agent.id,
    category: "specific",
    models: ["opencode/free"],
  });
  await f.app.send(p.id, "ses_owned", {
    text: "Please check this.",
    agentID: agent.id,
    workflowID: workflow.id,
    model: { providerID: "opencode", modelID: "free" },
  });
  const body = f.calls.find((c) => c.route.endsWith("prompt_async")).options
    .body;
  assert.equal(body.agent, agent.id);
  assert.deepEqual(body.parts, [{ type: "text", text: "Please check this." }]);
  assert.match(body.system, /Check edge cases first/);
  assert.match(body.system, /Inspect the current diff/);
  assert.deepEqual(f.saved.preferences.allowedModels, ["opencode/free"]);
  assert.equal(f.saved.sessionID, "ses_owned");
  assert.deepEqual((await f.store.read("settings")).chatChoices.ses_owned, {
    agentID: agent.id,
    workflowID: workflow.id,
    model: "opencode/free",
  });
  await f.app.removeAgent(agent.id);
  assert.equal(
    (await f.app.bootstrap(p.id)).settings.workflows.find(
      (w) => w.id === workflow.id,
    ).agentID,
    "engineer",
  );
  await f.app.removeWorkflow(workflow.id);
  await f.app.removeAgent(agent.id);
});

test("advisory workflow categories do not block a valid named parent request", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  const workflow = await f.app.saveWorkflow({
    name: "Subscription work",
    prompt: "",
    mode: "build",
    agentID: "engineer",
    category: "subscriptions",
    models: [],
  });
  await f.app.send(p.id, "ses_owned", {
    text: "Hi", workflowID: workflow.id, agentID: "engineer",
    model: { providerID: "opencode", modelID: "free" },
  });
  assert.equal(f.calls.some((c) => c.route.endsWith("prompt_async")), true);
  assert.deepEqual(f.saved.preferences.allowedModels, ["opencode/free"]);
  await f.app.send(p.id, "ses_owned", {
    text: "Hi",
    agentID: "engineer",
    model: { providerID: "opencode", modelID: "free" },
  });
  assert.match(
    f.calls.find((c) => c.route.endsWith("prompt_async")).options.body.system,
    /Agent: Engineer/,
  );
  await assert.rejects(
    f.app.saveWorkflow({ ...workflow, mode: "engineer" }),
    /workflow mode/,
  );
  await assert.rejects(f.app.removeWorkflow("build"), /cannot be removed/);
});

test("workflow and model inheritance is resolved at send time while explicit choices remain intact", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  const agent = await f.app.saveAgent({
    name: "Inherited researcher",
    prompt: "Check primary evidence.",
    response: "detailed",
    approach: "thorough",
    model: "opencode/free",
  });
  const workflow = await f.app.saveWorkflow({
    name: "Evidence",
    prompt: "Explain the evidence.",
    mode: "explore",
    agentID: agent.id,
    category: "free",
    models: [],
  });
  await f.app.send(p.id, "ses_owned", {
    text: "Keep this text intact.",
    workflowID: workflow.id,
  });
  let body = f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1)
    .options.body;
  assert.deepEqual(body.model, { providerID: "opencode", modelID: "free" });
  assert.match(body.system, /Inherited researcher/);
  assert.match(body.system, /Check primary evidence/);
  assert.match(body.system, /Explain the evidence/);
  assert.match(body.system, /Investigate important dependencies/);
  assert.match(body.system, /Explain the relevant reasoning/);
  assert.deepEqual(body.parts, [
    { type: "text", text: "Keep this text intact." },
  ]);
  assert.deepEqual((await f.store.read("settings")).chatChoices.ses_owned, {
    agentID: "inherit",
    workflowID: workflow.id,
    model: "inherit",
  });
  await f.app.saveAgent({ ...agent, model: "opencode/unavailable" });
  await assert.rejects(
    f.app.send(p.id, "ses_owned", { text: "test", workflowID: workflow.id }),
    /unavailable/,
  );
  await f.app.send(p.id, "ses_owned", {
    text: "test",
    workflowID: workflow.id,
    agentID: "engineer",
    model: "opencode/free",
  });
  body = f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1)
    .options.body;
  assert.doesNotMatch(body.system, /^Agent: Inherited researcher/);
  assert.equal(body.model.modelID, "free");
});

test("Agent controlled uses native defaults and never invokes a separate router", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  f.nativeAgents = [
    { name: "engineer", model: { providerID: "opencode", modelID: "free" } },
  ];
  await f.app.send(p.id, "ses_owned", { text: "Native agent default" });
  assert.equal(
    f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1).options.body
      .model.modelID,
    "free",
  );
  f.nativeAgents = [];
  f.nativeDefaults = { model: "opencode/free" };
  assert.equal(
    (await f.app.bootstrap(p.id)).nativeModels.engineer,
    "opencode/free",
  );
  await f.app.send(p.id, "ses_owned", { text: "Native config default" });
  assert.equal(
    f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1).options.body
      .model.modelID,
    "free",
  );
  f.nativeDefaults = {};
  await f.app.send(p.id, "ses_owned", { text: "Native fallback" });
  assert.equal(
    f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1).options.body
      .model,
    undefined,
  );
  f.nativeProviders = {
    providers: [{ id: "unapproved", models: { paid: {} } }],
  };
  await assert.rejects(
    f.app.send(p.id, "ses_owned", { text: "Do not bypass policy" }),
    /Set a default model/,
  );
});

test("successful usage collection returns parseable JSON through the real HTTP adapter", async (t) => {
  const f = await fixture(t);
  const runtime = await startServer({ application: f.app, assets: f.root });
  t.after(() => {
    runtime.server.closeAllConnections();
    runtime.server.close();
  });
  const response = await fetch(runtime.url + "/api/usage/refresh", {
    method: "POST",
    headers: {
      "X-Freelancer-Client": "webpage",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { refreshed: true });
});

test("a manual model override changes the parent while preserving workflow choices for children", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  f.extraModels = { second: { cost: { input: 0, output: 0 } } };
  const agent = await f.app.saveAgent({
    name: "Alternate model",
    prompt: "Explain your findings.",
    response: "balanced",
    approach: "practical",
    model: "opencode/second",
  });
  const workflow = await f.app.saveWorkflow({
    name: "Restricted defaults",
    prompt: "Check the request.",
    mode: "build",
    agentID: agent.id,
    category: "specific",
    models: ["opencode/free"],
  });
  await f.app.send(p.id, "ses_owned", {
    text: "test",
    workflowID: workflow.id,
  });
  await f.app.send(p.id, "ses_owned", {
    text: "test",
    workflowID: workflow.id,
    model: "opencode/second",
  });
  assert.equal(
    f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1).options.body
      .model.modelID,
    "second",
  );
  assert.deepEqual(f.saved.preferences.allowedModels, ["opencode/free", "opencode/second"]);
});

test("editable instructions cannot replace built-in work modes or the internal execution contract", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  const original = (await f.app.bootstrap(p.id)).settings.workflows.find(
    (w) => w.id === "build",
  );
  await assert.rejects(
    f.app.saveWorkflow({ ...original, name: "Code", mode: "review" }),
    /original mode/,
  );
  const edited = await f.app.saveWorkflow({
    ...original,
    name: "Code",
    prompt: "Focus on useful results.",
  });
  await f.app.send(p.id, "ses_owned", {
    text: "Do the work",
    workflowID: edited.id,
    model: "opencode/free",
  });
  const body = f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1)
    .options.body;
  assert.equal(body.agent, "engineer");
  assert.match(body.system, /Workflow: Code/);
  assert.match(body.system, /Focus on useful results/);
  assert.match(body.system, /application-owned/);
  assert.match(body.system, /installed delegate tool/);
  assert.match(body.system, /backend owns quota refresh/);
  assert.match(body.system, /Request context:/);
  const receipt = (await f.store.read("requests")).records[body.messageID];
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.workflow.mode, "build");
  assert.equal(receipt.agent.id, "engineer");
  assert.deepEqual(receipt.preferences.allowedModels, ["opencode/free"]);
  await assert.rejects(f.app.removeWorkflow("build"), /cannot be removed/);
});

test("a failed dispatch leaves its request receipt without inventing usage or success", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  f.failSend = true;
  await assert.rejects(
    f.app.send(p.id, "ses_owned", { text: "test", model: "opencode/free" }),
    /Native transport failed/,
  );
  const receipts = Object.values((await f.store.read("requests")).records);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].status, "dispatch_error");
  assert.equal(receipts[0].responses, undefined);
  assert.deepEqual((await f.store.read("usage")).records, {});
});

test("intelligence is dispatched separately for the parent and workflow children", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  f.extraModels = {
    parent: { cost: { input: 0, output: 0 }, variants: { high: {}, low: {} } },
    child: { cost: { input: 0, output: 0 }, variants: { low: {} } },
  };
  const agent = await f.app.saveAgent({
    name: "Parent",
    prompt: "Work carefully",
    response: "balanced",
    approach: "practical",
    model: "opencode/parent",
    variant: "high",
  });
  const workflow = await f.app.saveWorkflow({
    name: "Sequential",
    prompt: "",
    mode: "build",
    agentID: agent.id,
    category: "specific",
    models: ["opencode/child"],
    variant: "low",
    parallel: false,
  });
  await f.app.send(p.id, "ses_owned", {
    text: "Check",
    workflowID: workflow.id,
  });
  const body = f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1)
    .options.body;
  assert.equal(body.variant, "high");
  assert.equal(body.model.modelID, "parent");
  assert.equal(f.saved.scope, "execution");
  assert.equal(f.saved.preferences.childVariant, "low");
  assert.equal(f.saved.preferences.maxParallel, defaults.maxParallel);
  assert.deepEqual(f.saved.preferences.allowedModels, ["opencode/parent", "opencode/child"]);
  await f.app.saveWorkflow({ ...workflow, parallel: true });
  await f.app.send(p.id, "ses_owned", {
    text: "Check again",
    workflowID: workflow.id,
  });
  assert.equal(f.saved.preferences.maxParallel, defaults.maxParallel);
  await f.app.send(p.id, "ses_owned", {
    text: "Workspace override",
    workflowID: workflow.id,
    variant: "low",
  });
  assert.equal(
    f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1).options.body
      .variant,
    "low",
  );
  assert.equal(
    (await f.app.bootstrap(p.id, "ses_owned")).settings.chatChoices.ses_owned
      .variant,
    "low",
  );
  assert.equal(f.saved.preferences.childVariant, "low");
  await f.app.send(p.id, "ses_owned", {
    text: "Model default",
    workflowID: workflow.id,
    variant: "",
  });
  assert.equal(
    f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1).options.body
      .variant,
    undefined,
  );
  await f.app.saveAgent({ ...agent, variant: "unsupported" });
  await f.app.send(p.id, "ses_owned", {
    text: "Old unsupported setting",
    workflowID: workflow.id,
  });
  assert.equal(
    f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1).options.body
      .variant,
    undefined,
  );
  await assert.rejects(
    f.app.send(p.id, "ses_owned", {
      text: "Check",
      workflowID: workflow.id,
      variant: "unsupported",
    }),
    /does not support/,
  );
  await f.app.send(p.id, "ses_owned", {
    text: "No intelligence support",
    workflowID: workflow.id,
    model: "opencode/free",
  });
  assert.equal(
    f.calls.filter((c) => c.route.endsWith("prompt_async")).at(-1).options.body
      .variant,
    undefined,
  );
});

test("deleting custom entries repairs saved chat choices and preserves built-ins", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  const agent = await f.app.saveAgent({
    name: "Disposable",
    prompt: "Check",
    response: "balanced",
    approach: "practical",
    model: "opencode/free",
  });
  const workflow = await f.app.saveWorkflow({
    name: "Disposable",
    prompt: "",
    mode: "build",
    agentID: agent.id,
    category: "connected",
    models: [],
  });
  await f.app.send(p.id, "ses_owned", {
    text: "Check",
    workflowID: workflow.id,
    agentID: agent.id,
  });
  await f.app.removeAgent(agent.id);
  let boot = await f.app.bootstrap(p.id);
  assert.equal(boot.settings.chatChoices.ses_owned.agentID, "inherit");
  assert.equal(
    boot.settings.workflows.find((w) => w.id === workflow.id).agentID,
    "engineer",
  );
  await f.app.removeWorkflow(workflow.id);
  boot = await f.app.bootstrap(p.id);
  assert.equal(boot.settings.chatChoices.ses_owned.workflowID, "build");
  assert.equal(
    boot.settings.workflows.some((w) => w.id === "custom"),
    false,
  );
  await assert.rejects(f.app.removeAgent("engineer"), /cannot be removed/);
});

test("workspace model visibility persists independently of theme", async (t) => {
  const f = await fixture(t);
  await f.app.saveAppearance({ theme: "dark" });
  await f.app.saveAppearance({ showDepletedModels: false });
  assert.deepEqual((await f.store.read("settings")).appearance, {
    theme: "dark",
    showDepletedModels: false,
  });
  await assert.rejects(
    f.app.saveAppearance({ showDepletedModels: "false" }),
    /visibility/,
  );
});

test("new-chat defaults are project scoped and leave existing chats and legacy preferences intact", async (t) => {
  const f = await fixture(t, true),
    p = await f.app.addProject(f.directory);
  f.nativeDefaults = { model: "opencode/free" };
  f.extraModels = {
    reasoning: {
      cost: { input: 0, output: 0 },
      variants: { low: {}, high: {} },
    },
  };
  await savePreferences(f.root, f.directory, {
    scope: "project",
    preferences: {
      ...defaults,
      excludedModels: ["opencode/free"],
      excludedProviders: ["openai"],
      strategy: "manual",
      delegation: "manual",
      maxParallel: 1,
      contextPolicy: "large",
    },
  });
  await f.store.update("settings", (s) => ({
    ...s,
    chatChoices: {
      ses_owned: {
        model: "opencode/free",
        workflowID: "review",
        agentID: "engineer",
        variant: "",
      },
    },
  }));
  const before = await loadPreferences(f.root, f.directory, "ses_owned");
  const existing = (await f.store.read("settings")).chatChoices.ses_owned;
  const initial = (await f.app.bootstrap(p.id)).sessionDefaults;
  assert.equal(initial.parentModel, "opencode/free");
  const saved = await f.app.saveSessionDefaults(p.id, {
    ...initial,
    workflowID: "plan",
    agentID: "engineer",
    parentModel: "opencode/reasoning",
    reasoningVariant: "high",
    excludedModels: ["opencode/reasoning"],
    delegation: "manual",
  });
  assert.deepEqual(Object.keys(saved).sort(), [
    "agentID",
    "parentModel",
    "reasoningVariant",
    "revision",
    "workflowID",
  ]);
  assert.deepEqual(
    await loadPreferences(f.root, f.directory, "ses_owned"),
    before,
  );
  assert.deepEqual(
    (await f.store.read("settings")).chatChoices.ses_owned,
    existing,
  );
  const secondDirectory = path.join(f.root, "second");
  await mkdir(secondDirectory);
  const second = await f.app.addProject(secondDirectory);
  assert.equal(
    (await f.app.bootstrap(second.id)).sessionDefaults.workflowID,
    "build",
  );
  assert.equal(
    (await f.app.bootstrap(p.id)).sessionDefaults.workflowID,
    "plan",
  );
  const chat = await f.app.createChat(p.id, "Fresh chat");
  assert.equal(chat.id, "ses_new");
  const boot = await f.app.bootstrap(p.id);
  assert.deepEqual(boot.settings.chatChoices.ses_new, {
    workflowID: "plan",
    agentID: "engineer",
    model: "opencode/reasoning",
    variant: "high",
  });
  const fresh = await loadPreferences(f.root, f.directory, chat.id);
  assert.deepEqual(fresh.defaults, {
    ...before.defaults,
    parentModel: "opencode/reasoning",
  });
  assert.deepEqual(
    (await loadPreferences(f.root, f.directory, "ses_owned")).defaults,
    before.defaults,
  );
  assert.deepEqual(boot.settings.chatChoices.ses_owned, existing);
  await assert.rejects(
    f.app.saveSessionDefaults(p.id, { ...saved, revision: 0 }),
    /changed elsewhere/,
  );
});

test("defaults validate real models and native intelligence through the HTTP endpoint", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  const input = {
    revision: 0,
    workflowID: "build",
    agentID: "engineer",
    parentModel: "opencode/free",
    reasoningVariant: "",
  };
  for (const [change, message] of [
    [{ workflowID: "missing" }, /workflow/],
    [{ agentID: "missing" }, /agent/],
    [{ parentModel: "auto" }, /parent model/],
    [{ parentModel: "" }, /parent model/],
    [{ parentModel: "openai/unavailable" }, /available parent/],
    [{ reasoningVariant: "high" }, /reported/],
  ])
    await assert.rejects(
      f.app.saveSessionDefaults(p.id, { ...input, ...change }),
      message,
    );
  const runtime = await startServer({ application: f.app, assets: f.root });
  t.after(() => {
    runtime.server.closeAllConnections();
    runtime.server.close();
  });
  const response = await fetch(runtime.url + "/api/session-defaults", {
    method: "PUT",
    headers: {
      "X-Freelancer-Client": "webpage",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ project: p.id, ...input }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 1);
  assert.equal((await f.app.bootstrap(p.id)).sessionDefaults.agentID, "engineer");
});

test("new chats follow the starting agent and recover when custom defaults are deleted", async (t) => {
  const f = await fixture(t),
    p = await f.app.addProject(f.directory);
  const agent = await f.app.saveAgent({
    name: "Default parent",
    model: "opencode/free",
    prompt: "Help with the request.",
    response: "balanced",
    approach: "practical",
    variant: "",
  });
  const workflow = await f.app.saveWorkflow({
    name: "Default workflow",
    mode: "build",
    prompt: "",
    agentID: agent.id,
    category: "connected",
    models: [],
  });
  await f.app.saveSessionDefaults(p.id, {
    revision: 0,
    workflowID: workflow.id,
    agentID: "inherit",
    parentModel: "opencode/free",
    reasoningVariant: "",
  });
  await f.app.createChat(p.id);
  assert.deepEqual((await f.store.read("settings")).chatChoices.ses_new, {
    workflowID: workflow.id,
    agentID: "inherit",
    model: "inherit",
    variant: "inherit",
  });
  await f.app.removeAgent(agent.id);
  await f.app.createChat(p.id);
  assert.equal(
    (await f.store.read("settings")).chatChoices.ses_new.model,
    "opencode/free",
  );
  await f.app.removeWorkflow(workflow.id);
  assert.equal(
    (await f.app.bootstrap(p.id)).sessionDefaults.workflowID,
    "build",
  );
});

test("a newly added project reports the current UI contract, session defaults, and native reasoning options", async (t) => {
  const f = await fixture(t, true);
  f.nativeDefaults = { model: "opencode/parent" };
  f.extraModels = {
    parent: {
      cost: { input: 0, output: 0 },
      variants: { low: {}, high: {}, hidden: { disabled: true } },
    },
  };
  const p = await f.app.addProject(f.directory);
  const boot = await f.app.bootstrap(p.id);
  const { compatibleApplication } = await import("../domain/protocol.mjs");
  assert.equal(compatibleApplication(boot), true);
  assert.equal(
    compatibleApplication({ ...boot, uiContract: undefined }),
    false,
  );
  assert.equal(boot.project.id, p.id);
  assert.equal(boot.sessionDefaults.parentModel, "opencode/parent");
  assert.deepEqual(
    boot.models.find((m) => m.id === "opencode/parent").variants,
    ["low", "high"],
  );
  assert.equal(
    boot.snapshot.preferences.defaults.parentModel,
    "opencode/parent",
  );
});


test("state-aware sender queues FIFO, deduplicates IDs, and scopes parent override", async (t) => {
  const { createSender } = await import("../server/sender.mjs");
  const f = await fixture(t), p = await f.app.addProject(f.directory);
  f.rows = [{ id: "ses_owned", title: "Sender", directory: f.directory }];
  f.status = { ses_owned: { type: "busy" } };
  const sender = createSender(f.app, { file: path.join(f.root, "outbox.json") });
  await sender.ready;
  const request = {
    id: "sender_queue_0001", kind: "queue", text: "Second turn",
    model: "opencode/free", variant: "", workflowID: "build", agentID: "inherit",
  };
  const first = await sender.enqueue(p.id, "ses_owned", request);
  const duplicate = await sender.enqueue(p.id, "ses_owned", request);
  assert.equal(first.id, duplicate.id);
  assert.equal((await sender.list(p.id, "ses_owned")).length, 1);
  await sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith("prompt_async")).length, 0);
  f.status = {};
  await sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith("prompt_async")).length, 1);
  const choices = (await f.store.read("settings")).chatChoices?.ses_owned;
  assert.equal(choices, undefined, "one-shot override must not become composer default");
  await sender.close();
});

test("chat display recovers an unanswered turn after native status becomes idle", async (t) => {
  const f = await fixture(t), p = await f.app.addProject(f.directory);
  f.rows = [{ id: "ses_owned", title: "Interrupted", directory: f.directory }];
  f.messages = [{ info: { id: "msg_unanswered", role: "user", time: { created: Date.now() - 61000 } }, parts: [{ type: "text", text: "Original request" }] }];
  f.status = {};
  const chat = await f.app.chat(p.id, "ses_owned");
  assert.equal(chat.status.ses_owned.type, "idle");
  assert.match(chat.status.ses_owned.failure, /appears to have stopped/i);
});

test("state-aware sender blocks Queue on pending approvals and cancels waiting work before stop", async (t) => {
  const { createSender } = await import("../server/sender.mjs");
  const f = await fixture(t), p = await f.app.addProject(f.directory);
  f.rows = [{ id: "ses_owned", title: "Sender", directory: f.directory }];
  f.status = {};
  f.questions = [{ id: "que_wait", sessionID: "ses_owned", questions: [] }];
  const sender = createSender(f.app, { file: path.join(f.root, "outbox.json") });
  await sender.enqueue(p.id, "ses_owned", {
    id: "sender_queue_0002", kind: "queue", text: "Wait for approval",
    model: "opencode/free", variant: "", workflowID: "build", agentID: "inherit",
  });
  await sender.tick();
  assert.equal(f.calls.filter(c => c.route.endsWith("prompt_async")).length, 0);
  f.questions = [];
  f.status = { ses_owned: { type: "busy" } };
  await sender.stop(p.id, "ses_owned");
  assert.equal((await sender.list(p.id, "ses_owned")).length, 0);
  assert.equal(f.calls.filter(c => c.route.endsWith("prompt_async")).length, 0);
  assert.ok(f.calls.some(c => c.route.endsWith("/abort")));
  await sender.close();
});

test("Clarify preserves the parent model and requests a bounded worker with the selected model", async (t) => {
  const { createSender } = await import("../server/sender.mjs");
  const f = await fixture(t), p = await f.app.addProject(f.directory);
  f.extraModels = { worker: { cost: { input: 0, output: 0 } } };
  f.rows = [{ id: "ses_owned", title: "Sender", directory: f.directory }];
  f.status = { ses_owned: { type: "busy" } };
  f.messages = [{
    info: { id: "msg_original", role: "user", model: { providerID: "opencode", modelID: "free" } },
    parts: [{ type: "text", text: "Original work" }],
  }, {
    info: { id: "msg_parent", parentID: "msg_original", role: "assistant", agent: "build",
      providerID: "opencode", modelID: "free" },
    parts: [],
  }];
  await f.store.recordRequest({
    id: "msg_original", sessionID: "ses_owned", projectID: p.id, status: "accepted",
    workflow: { id: "build", mode: "build", name: "Build" },
    agent: { id: "engineer", name: "Engineer" },
    model: { providerID: "opencode", modelID: "free" },
    variant: "", preferences: { allowedModels: ["opencode/free", "opencode/worker"] },
  });
  const sender = createSender(f.app, { file: path.join(f.root, "outbox.json") });
  await sender.enqueue(p.id, "ses_owned", {
    id: "sender_clarify_01", kind: "clarify", text: "Check the edge case",
    model: "opencode/worker", variant: "", workflowID: "build", agentID: "inherit",
  });
  await sender.tick();
  const call = f.calls.findLast(c => c.route.endsWith("prompt_async"));
  assert.equal(call.options.body.model.modelID, "free", "Clarify must stay on the parent model");
  assert.match(call.options.body.parts[0].text, /appropriate agent, task and model/);
  assert.match(call.options.body.parts[0].text, /model="opencode\/worker"/);
  assert.match(call.options.body.parts[0].text, /Do not change the parent model/);
  assert.match(call.options.body.parts[0].text, /User concern:\nCheck the edge case/);
  await sender.close();
});
