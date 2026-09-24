import test from "node:test";
import assert from "node:assert/strict";
import {
  workspaceCatalog,
  workspaceModels,
  resolveChoices,
  commonVariants,
  normalizeAgent,
} from "../domain/workspace.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  savePreferences,
  loadPreferences,
} from "../backend/tools/runtime/preferences.mjs";

test("agent defaults override project defaults and legacy none resolves to the workflow agent", () => {
  const workspace = workspaceCatalog({
    agents: [{ id: "engineer", model: "opencode/parent" }],
  });
  assert.equal(
    resolveChoices(
      workspace,
      { agentID: "none" },
      { parentModel: "opencode/default" },
    ).model,
    "opencode/parent",
  );
  assert.equal(
    resolveChoices(workspace, {}, { parentModel: "opencode/default" }).model,
    "opencode/parent",
  );
  assert.deepEqual(
    workspace.workflows.map((w) => w.id),
    ["build", "plan", "explore", "review", "sync"],
  );
  assert.equal(
    workspaceCatalog({
      workflows: [{ id: "custom", name: "User edited legacy workflow" }],
    }).workflows.at(-1).name,
    "User edited legacy workflow",
  );
});

test("only confirmed depleted models are hidden, while unknown and free models remain", () => {
  const rows = [0, null, 30].map((quota, i) => ({
    id: `openai/${i}`,
    provider: "openai",
    quota,
  }));
  assert.equal(workspaceModels(rows, ["openai"], true).length, 3);
  assert.deepEqual(
    workspaceModels(rows, ["openai"], false).map((m) => m.quota),
    [null, 30],
  );
  assert.deepEqual(
    commonVariants([{ variants: ["low", "high"] }, { variants: ["high"] }]),
    ["high"],
  );
});

test("workflow execution policy never overwrites saved defaults or leaks to another chat", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-policy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await savePreferences(root, root, {
    scope: "project",
    preferences: {
      maxParallel: 4,
      parentModel: "opencode/parent",
      reasoningVariant: "high",
    },
  });
  const initial = await loadPreferences(root, root, "ses_one");
  await savePreferences(root, root, {
    scope: "execution",
    sessionID: "ses_one",
    preferences: {
      ...initial.defaults,
      maxParallel: 1,
      childVariant: "low",
      allowedModels: ["opencode/child"],
    },
  });
  const next = await loadPreferences(root, root, "ses_one");
  assert.equal(next.preferences.maxParallel, 1);
  assert.equal(next.defaults.maxParallel, 4);
  assert.equal(next.defaults.reasoningVariant, "high");
  assert.deepEqual(next.defaults.allowedModels, []);
  assert.equal(
    (await loadPreferences(root, root, "ses_two")).preferences.maxParallel,
    4,
  );
  await savePreferences(root, root, {
    scope: "execution",
    sessionID: "ses_one",
    preferences: { ...next.defaults, allowedModels: ["opencode/other"] },
  });
  assert.equal(
    (await loadPreferences(root, root, "ses_one")).preferences.maxParallel,
    4,
  );
});

test("agent parent selections must be actual provider-qualified models", () => {
  const agent = {
    name: "Engineer",
    prompt: "Build",
    response: "balanced",
    approach: "practical",
  };
  for (const model of [undefined, "", "inherit"])
    assert.throws(
      () => normalizeAgent({ ...agent, model }, "test"),
      /Choose a default model/,
    );
  assert.equal(normalizeAgent({ ...agent, model: "auto" }, "test").model, "auto");
  assert.equal(
    normalizeAgent({ ...agent, model: "opencode/free" }, "test").model,
    "opencode/free",
  );
});
