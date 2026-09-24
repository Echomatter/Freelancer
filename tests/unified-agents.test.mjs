import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import {
  checkedCatalog,
  configureAgentProfiles,
  retiredAgents,
} from "../backend/tools/runtime/agent-catalog.mjs";
import { normalizePreferences } from "../shared/strategy.mjs";
import { normalizeAgent } from "../domain/workspace.mjs";
import { ensureAgentProfiles } from "../server/agent-profiles.mjs";
import { unifiedFixture } from "./fixtures/unified-agents.mjs";
import {
  completionMetadata,
  taskCard,
} from "../backend/tools/runtime/presentation.mjs";
const custom = {
  name: "Accessibility specialist",
  prompt: "UNIQUE_PERSONA_SENTINEL. Inspect keyboard behavior.",
  model: "auto",
  response: "concise",
  approach: "thorough",
  variant: "inherit",
};
const job = {
  agentID: "engineer",
  workflowID: "build",
  task: "Check a bounded part of the project.",
  selectedModel: "opencode/free-b",
};

test("one authored catalog generates named profiles without a second prompt or native model pin", () => {
  const c = checkedCatalog({ agents: [{ ...custom, id: "accessibility" }] });
  const config = configureAgentProfiles({}, c);
  assert.deepEqual(
    c.agents.map((a) => a.id),
    ["engineer", "researcher", "designer", "git", "accessibility"],
  );
  for (const agent of c.agents) {
    assert.equal(config.agent[agent.id].mode, "all");
    assert.equal(config.agent[agent.id].prompt, "");
    assert.equal(config.agent[agent.id].model, undefined);
  }
  for (const name of retiredAgents)
    assert.equal(config.agent[name].disable, true, name);
  assert.equal(config.default_agent, "engineer");
  assert.throws(
    () => normalizeAgent({ ...custom, model: "auto" }, "worker"),
    /named agent ID/,
  );
});
test("generated profiles preserve whole-agent and global native permission decisions", () => {
  for (const permission of ["deny", "ask"]) {
    const c = configureAgentProfiles({ permission }, checkedCatalog());
    for (const a of checkedCatalog().agents)
      assert.equal(c.agent[a.id].permission, permission);
  }
  const c = configureAgentProfiles(
    {
      agent: {
        build: { permission: { edit: "deny", bash: "ask" } },
        designer: { permission: { "*": "deny", todowrite: "ask" } },
      },
    },
    checkedCatalog(),
  );
  assert.equal(c.agent.engineer.permission.edit, "deny");
  assert.equal(c.agent.engineer.permission.bash, "ask");
  assert.equal(c.agent.designer.permission["*"], "deny");
  assert.equal(c.agent.designer.permission.todowrite, "ask");
});
test("legacy restricted role preferences migrate conservatively without creating executable aliases", () => {
  const p = normalizePreferences({
    schemaVersion: 1,
    allowedRoles: ["review"],
  });
  assert.deepEqual(p.agentAccess, { engineer: ["review"] });
  assert.equal(p.allowedRoles, undefined);
  assert.equal(p.schemaVersion, 2);
  assert.deepEqual(
    normalizePreferences({ schemaVersion: 1, allowedRoles: [] }).agentAccess,
    {},
  );
  assert.equal(
    normalizePreferences({
      schemaVersion: 1,
      allowedRoles: ["worker", "architect", "researcher", "review"],
    }).agentAccess,
    null,
  );
  assert.throws(
    () => normalizePreferences({ schemaVersion: 2, allowedRoles: ["worker"] }),
    /retired/,
  );
});
test("main and delegated custom agents use the same captured definition and chosen model", async (t) => {
  const f = await unifiedFixture(t),
    agent = await f.app.saveAgent(custom);
  const ctx = await f.send({ agentID: agent.id });
  const main = f.prompts.at(-1).body;
  assert.equal(main.agent, agent.id);
  assert.equal(main.system.split("UNIQUE_PERSONA_SENTINEL").length - 1, 1);
  const catalog = await f.delegator.execute({}, ctx);
  assert.ok(catalog.agents.some((a) => a.id === agent.id));
  assert.ok(!catalog.agents.some((a) => a.id === "worker"));
  const receipt = await f.delegator.execute(
    { ...job, agentID: agent.id, workflowID: "review" },
    ctx,
  );
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.agent.name, agent.name);
  assert.equal(receipt.workflow.mode, "review");
  const child = f.prompts.at(-1).body;
  assert.equal(child.agent, agent.id);
  assert.equal(child.system.split("UNIQUE_PERSONA_SENTINEL").length - 1, 1);
  assert.match(child.system, /Work mode: review/);
  assert.equal(child.model.modelID, "free-b");
  assert.equal(main.model.modelID, "free-a");
  assert.equal(receipt.role, undefined);
  await f.delegator.checkTool(
    { sessionID: receipt.attempts[0].child_session, tool: "edit" },
    { args: {} },
  );
});
test("agent edits and deletion affect future roots, not captured assignments or recorded names", async (t) => {
  const f = await unifiedFixture(t),
    agent = await f.app.saveAgent(custom),
    ctx = await f.send();
  await f.app.saveAgent({
    ...agent,
    name: "Renamed expert",
    prompt: "NEW_PROMPT_SENTINEL",
  });
  await f.app.removeAgent(agent.id);
  const receipt = await f.delegator.execute({ ...job, agentID: agent.id }, ctx);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.agent.name, custom.name);
  assert.match(f.prompts.at(-1).body.system, /UNIQUE_PERSONA_SENTINEL/);
  assert.doesNotMatch(f.prompts.at(-1).body.system, /NEW_PROMPT_SENTINEL/);
  const child = receipt.attempts[0].child_session;
  await f.app.chat(f.project.id, child);
  const rows = Object.values((await f.store.read("usage")).records).filter(
    (r) => r.sessionID === child,
  );
  assert.equal(rows[0].agentName, custom.name);
  assert.equal(rows[0].agentID, agent.id);
  const next = await f.send();
  await assert.rejects(
    f.delegator.execute({ ...job, agentID: agent.id }, next),
    /Choose a named/,
  );
  assert.equal(
    (await f.store.read("requests")).records[
      receipt.parent_message_id
    ].catalog.agents.find((a) => a.id === agent.id).name,
    custom.name,
  );
});
test("saved default child model is used without changing the selected parent; explicit override wins", async (t) => {
  const f = await unifiedFixture(t),
    agent = await f.app.saveAgent({ ...custom, model: "opencode/free-b" }),
    ctx = await f.send();
  const { selectedModel, ...request } = job;
  const receipt = await f.delegator.execute(
    { ...request, agentID: agent.id },
    ctx,
  );
  assert.equal(receipt.attempts[0].observed_model, "opencode/free-b");
  assert.equal(receipt.model_selection.source, "agent_default");
  const override = await f.delegator.execute(
    {
      ...job,
      agentID: agent.id,
      task: "A different bounded task",
      selectedModel: "opencode/free-a",
    },
    ctx,
  );
  assert.equal(override.attempts[0].observed_model, "opencode/free-a");
  assert.equal(override.parent_model, "opencode/free-a");
});
test("paid agent defaults still require native paid permission exactly once", async (t) => {
  const f = await unifiedFixture(t),
    agent = await f.app.saveAgent({ ...custom, model: "opencode-go/paid" }),
    ctx = await f.send();
  const receipt = await f.delegator.execute(
    { agentID: agent.id, workflowID: "build", task: "Inspect the code" },
    ctx,
  );
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.model_selection.source, "agent_default");
  assert.equal(f.prompts.length, 2);
  assert.equal(
    f.permissions.filter((p) => p.permission === "paid_delegate").length,
    1,
  );
});

test("review behavior guides routing without becoming a write or nesting gate", async (t) => {
  const f = await unifiedFixture(t),
    ctx = await f.send({ agentID: "designer", workflowID: "review" });
  const receipt = await f.delegator.execute(
    { ...job, agentID: "designer", workflowID: "review" },
    ctx,
  );
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.read_only, false);
  assert.equal(f.selections.at(-1).needsModelDiversity, true);
  const nested = await f.delegator.execute(
    { ...job, agentID: "researcher", workflowID: "explore", task: "Inspect a nested bounded concern." },
    f.context(receipt.attempts[0].child_session),
  );
  assert.equal(nested.status, "completed");
});
test("unknown agents, role-based calls, forged native identity and missing context never dispatch", async (t) => {
  const f = await unifiedFixture(t),
    ctx = await f.send();
  await assert.rejects(
    f.delegator.execute({ ...job, agentID: "missing" }, ctx),
    /named/,
  );
  await assert.rejects(
    f.delegator.execute({ role: "worker", task: "Edit" }, ctx),
    /retired/,
  );
  f.rows.get(f.parent.id).at(-1).info.agent = "researcher";
  await assert.rejects(f.delegator.execute(job, ctx), /identity differs/);
  assert.equal(f.prompts.length, 1);
});
test("a new native profile refresh is idle-only and cannot interrupt a running main request", async (t) => {
  const f = await unifiedFixture(t);
  await f.send();
  await f.app.saveAgent(custom);
  await assert.rejects(
    f.app.send(f.project.id, f.parent.id, {
      text: "next",
      model: "opencode/free-a",
    }),
    /Let running chats/,
  );
  assert.equal(
    f.calls.filter((c) => c.route === "/instance/dispose").length,
    0,
  );
  assert.equal(f.prompts.length, 1);
  await f.send();
  assert.equal(
    f.calls.filter((c) => c.route === "/instance/dispose").length,
    1,
  );
});
test("refresh claims are released on errors and require exact named profiles on readback", async () => {
  const claims = [],
    calls = [];
  let reading = 0;
  const host = {
    request: async (route) => {
      calls.push(route);
      if (route === "/agent")
        return reading++ ? [{ name: "custom", mode: "subagent" }] : [];
      if (route === "/session/status") return {};
      return [];
    },
  };
  await assert.rejects(
    ensureAgentProfiles(
      host,
      "/test",
      [{ id: "custom" }],
      () => true,
      (x) => claims.push(x),
    ),
    /could not be refreshed/,
  );
  assert.deepEqual(claims, [true, false]);
  assert.equal(calls.filter((c) => c === "/instance/dispose").length, 1);
});
test("new delegate metadata has a named agent and keeps the real tool rather than a Desktop disguise", () => {
  const receipt = {
    agent: { id: "designer", name: "Designer" },
    workflow: { id: "review" },
    status: "completed",
    parent_session: "ses_parent",
    task_id: "id",
    attempts: [{ child_session: "ses_child", selected_model: "opencode/free" }],
  };
  const metadata = completionMetadata(receipt, {
    agentID: "designer",
    workflowID: "review",
  });
  assert.equal(metadata.agentName, "Designer");
  assert.equal(metadata.sessionId, "ses_child");
  assert.equal(metadata.freelancer_delegate_display, undefined);
  assert.equal(
    taskCard({
      type: "tool",
      tool: "delegate",
      state: { input: { agentID: "designer", workflowID: "review" } },
    }),
    null,
  );
});
test("web runtime no longer imports or packages Tauri", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.ok(
    !Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }).some((k) => k.startsWith("@tauri-apps/")),
  );
  assert.ok(!Object.keys(manifest.scripts).some((k) => k.startsWith("tauri:")));
  await assert.rejects(access(new URL("../src-tauri/", import.meta.url)));
  for (const f of ["src/App.tsx", "src/History.tsx", "server/main.mjs"])
    assert.doesNotMatch(
      await readFile(new URL("../" + f, import.meta.url), "utf8"),
      /isTauri|@tauri-apps|syncNativeTheme/,
    );
});

test("wildcard native denials and asks are not widened by generated task or paid defaults", () => {
  for (const action of ["deny", "ask"])
    for (const config of [
      { permission: { "*": action } },
      { agent: { engineer: { permission: { "*": action } } } },
    ]) {
      const result = configureAgentProfiles(config, checkedCatalog());
      assert.equal(result.agent.engineer.permission.task, action);
      assert.equal(result.agent.engineer.permission.paid_delegate, action);
    }
});
test("an old execution overlay cannot replace the captured model pool; current user exclusions still tighten it", async (t) => {
  const { savePreferences, loadPreferences } =
    await import("../backend/tools/runtime/preferences.mjs");
  const f = await unifiedFixture(t),
    ctx = await f.send();
  const p = (await loadPreferences(f.root, f.directory, f.parent.id)).defaults;
  await savePreferences(f.root, f.directory, {
    scope: "execution",
    sessionID: f.parent.id,
    preferences: { ...p, allowedModels: ["opencode/free-a"] },
  });
  const receipt = await f.delegator.execute(job, ctx);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.attempts[0].observed_model, "opencode/free-b");
  await savePreferences(f.root, f.directory, {
    scope: "session",
    sessionID: f.parent.id,
    preferences: { ...p, excludedModels: ["opencode/free-b"] },
  });
  await assert.rejects(
    f.delegator.execute(
      { ...job, task: "A separate prohibited assignment" },
      ctx,
    ),
    /excluded|not allowed|preferences|eligible|policy/i,
  );
});

test("historical agent-access settings migrate without gating new v5 assignments", async (t) => {
  const { savePreferences } =
    await import("../backend/tools/runtime/preferences.mjs");
  const f = await unifiedFixture(t),
    agent = await f.app.saveAgent(custom);
  await savePreferences(f.root, f.directory, {
    scope: "session",
    sessionID: f.parent.id,
    preferences: { schemaVersion: 1, allowedRoles: ["review"] },
  });
  const ctx = await f.send();
  const engineer = await f.delegator.execute({ ...job, needsWrites: true }, ctx);
  assert.equal(engineer.status, "completed");
  const customReceipt = await f.delegator.execute(
    { ...job, agentID: agent.id, workflowID: "review", task: "Review the bounded accessibility behavior." },
    ctx,
  );
  assert.equal(customReceipt.status, "completed");
  assert.equal(customReceipt.read_only, false);
});
test("a concurrent send cannot pass a native catalog refresh reservation", async (t) => {
  const f = await unifiedFixture(t);
  await f.send();
  delete f.status[f.parent.id];
  await f.app.saveAgent(custom);
  let release, started;
  const held = new Promise((r) => (release = r)),
    enter = new Promise((r) => (started = r));
  const original = f.host.request.bind(f.host);
  f.host.request = async (route, options) => {
    if (route === "/instance/dispose") {
      started();
      await held;
    }
    return original(route, options);
  };
  const first = f.app.send(f.project.id, f.parent.id, {
    text: "First",
    model: "opencode/free-a",
  });
  await enter;
  await assert.rejects(
    f.app.send(f.project.id, f.parent.id, {
      text: "Second",
      model: "opencode/free-a",
    }),
    /catalog before sending/,
  );
  release();
  await first;
  assert.equal(f.prompts.length, 2);
});
test("delegated Git coordination verifies the exact native parent call, not an ignore-busy flag", async (t) => {
  const { delegatedGitGroup } = await import("../server/git-delegation.mjs");
  const f = await unifiedFixture(t),
    ctx = await f.send();
  const receipt = await f.delegator.execute(
    {
      ...job,
      agentID: "researcher",
      workflowID: "explore",
      task: "Inspect local project history",
      needsWrites: true,
    },
    ctx,
  );
  assert.equal(receipt.status, "completed");
  const child = receipt.attempts[0].child_session,
    actor = {
      sessionID: child,
      messageID: f.context(child).messageID,
      delegated: true,
    };
  const parentMessage = f.rows.get(f.parent.id).at(-1);
  parentMessage.parts = [
    {
      type: "tool",
      tool: "delegate",
      callID: ctx.callID,
      state: {
        status: "running",
        input: { agentID: "researcher", workflowID: "explore" },
      },
    },
  ];
  const group = () =>
    delegatedGitGroup({
      host: f.host,
      backendRoot: f.root,
      directory: f.directory,
      actor,
    });
  assert.deepEqual([...(await group())].sort(), [child, f.parent.id].sort());
  parentMessage.parts.push({
    type: "tool",
    tool: "bash",
    callID: "unrelated",
    state: { status: "running" },
  });
  await assert.rejects(group(), /waiting only/);
  parentMessage.parts.pop();
  parentMessage.parts[0].callID = "forged";
  await assert.rejects(group(), /waiting only/);
  parentMessage.parts[0].callID = ctx.callID;
  const message = f.rows.get(child).at(-1);
  message.info.agent = "designer";
  await assert.rejects(group(), /identity differs/);
  message.info.agent = "researcher";
  f.rows
    .get(f.parent.id)
    .push({ info: { id: "new_user", role: "user" }, parts: [] });
  await assert.rejects(group(), /waiting only/);
});

test("managed Git authority comes from execution identity and the saved agreement, not workflow labels", async (t) => {
  const f = await unifiedFixture(t),
    ctx = await f.send({ agentID: "designer", workflowID: "review" });
  await assert.rejects(
    f.app.gitAgentAction({
      directory: f.directory,
      sessionID: f.parent.id,
      messageID: ctx.messageID,
      agentID: "git",
      workflowID: "sync",
      action: "preview",
    }),
    error => { assert.doesNotMatch(error.message, /Choose the Sync workflow/); return true; },
  );
  const receipt = await f.delegator.execute(
    { ...job, agentID: "git", workflowID: "review" },
    ctx,
  );
  await assert.rejects(
    f.app.gitAgentAction({
      directory: f.directory,
      sessionID: receipt.attempts[0].child_session,
      messageID: f.context(receipt.attempts[0].child_session).messageID,
      action: "preview",
    }),
    error => { assert.doesNotMatch(error.message, /Choose the Sync workflow/); return true; },
  );
});
test("new chats preserve restrictive project policy rather than resetting it during catalog migration", async (t) => {
  const { savePreferences, loadPreferences } =
    await import("../backend/tools/runtime/preferences.mjs");
  const f = await unifiedFixture(t);
  await savePreferences(f.root, f.directory, {
    scope: "project",
    preferences: {
      schemaVersion: 1,
      allowedRoles: ["review"],
      costPreference: "free-only",
      maxParallel: 1,
    },
  });
  const chat = await f.app.createChat(f.project.id, "Restricted new chat");
  const policy = (await loadPreferences(f.root, f.directory, chat.id)).defaults;
  assert.deepEqual(policy.agentAccess, { engineer: ["review"] });
  assert.equal(policy.costPreference, "free-only");
  assert.equal(policy.maxParallel, 1);
  const boot = await f.app.bootstrap(f.project.id);
  assert.deepEqual(boot.snapshot.preferences.preferences.agentAccess, {
    engineer: ["review"],
  });
});
