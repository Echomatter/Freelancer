import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApplication } from "../server/application.mjs";
import { createStore } from "../server/store.mjs";
import { resolveTodoLayout, persistTodoLayout } from "../domain/appearance.mjs";

test("appearance API persists both placements across a store reopen", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "freelancer-todo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createStore(root);
  const app = createApplication({ backendRoot: root, store, host: {} });
  assert.equal(resolveTodoLayout((await store.read("settings")).appearance), "docked");
  await app.saveAppearance({ theme: "dark", showDepletedModels: false });
  for (const layout of ["inline", "docked", "inline"]) {
    let applied;
    await persistTodoLayout(layout, (patch) => app.saveAppearance(patch), (next) => { applied = next; });
    assert.equal(applied, layout);
    const settings = await createStore(root).read("settings");
    assert.equal(resolveTodoLayout(settings.appearance), layout);
    assert.equal(settings.appearance.theme, "dark");
    assert.equal(settings.appearance.showDepletedModels, false);
  }
});

test("appearance API rejects invalid placement without changing a saved preference", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "freelancer-todo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createStore(root);
  const app = createApplication({ backendRoot: root, store, host: {} });
  await app.saveAppearance({ todoLayout: "inline" });
  await assert.rejects(app.saveAppearance({ todoLayout: "wrong" }), /Choose todo placement/);
  assert.equal(resolveTodoLayout((await createStore(root).read("settings")).appearance), "inline");
});
