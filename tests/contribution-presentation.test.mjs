import test from "node:test";
import assert from "node:assert/strict";
import { resolveTodoLayout, applyTodoLayout, persistTodoLayout } from "../domain/appearance.mjs";
import { compatibleApplication, uiContract } from "../domain/protocol.mjs";

test("docked is the default while saved inline choices survive", () => {
  for (const value of [undefined, null, {}, { theme: "dark" }, { todoLayout: "invalid" }])
    assert.equal(resolveTodoLayout(value), "docked");
  assert.equal(resolveTodoLayout({ todoLayout: "inline" }), "inline");
  assert.equal(resolveTodoLayout({ todoLayout: "docked" }), "docked");
});

test("saved placement updates the workspace without erasing unrelated settings", () => {
  const before = { selectionKey: "p/s", settings: { plans: { currency: "USD" }, appearance: { theme: "dark", showDepletedModels: false } } };
  const after = applyTodoLayout(before, "inline");
  assert.equal(resolveTodoLayout(after.settings.appearance), "inline");
  assert.equal(after.settings.appearance.theme, "dark");
  assert.equal(after.settings.appearance.showDepletedModels, false);
  assert.equal(after.settings.plans, before.settings.plans);
  assert.equal(before.settings.appearance.todoLayout, undefined);
  assert.equal(resolveTodoLayout(applyTodoLayout(after, "docked").settings.appearance), "docked");
  assert.throws(() => applyTodoLayout(before, "wrong"));
});

test("older runtimes cannot silently ignore the new UI contract", () => {
  assert.equal(compatibleApplication({ uiContract: 1 }), false);
  assert.equal(compatibleApplication({ uiContract }), true);
});

test("placement changes apply only after a successful save response", async () => {
  const calls = [];
  let finish;
  const response = new Promise((resolve) => { finish = resolve; });
  const saving = persistTodoLayout("inline", (patch) => { calls.push(patch); return response; },
    (layout) => { calls.push(layout); });
  assert.deepEqual(calls, [{ todoLayout: "inline" }]);
  finish({ saved: true });
  await saving;
  assert.deepEqual(calls, [{ todoLayout: "inline" }, "inline"]);
});

test("failed requests do not claim to apply a placement", async () => {
  let applied = false;
  await assert.rejects(persistTodoLayout("inline", async () => { throw Error("Offline"); },
    () => { applied = true; }), /Offline/);
  assert.equal(applied, false);
});

test("an unconfirmed save surfaces an error rather than silently reverting", async () => {
  for (const response of [undefined, {}, { saved: false }]) {
    let applied = false;
    await assert.rejects(persistTodoLayout("docked", async () => response,
      () => { applied = true; }), /not saved/);
    assert.equal(applied, false);
  }
});

test("invalid placement never reaches the save endpoint", async () => {
  let wrote = false;
  await assert.rejects(persistTodoLayout("wrong", async () => { wrote = true; }, () => {}), /Choose todo placement/);
  assert.equal(wrote, false);
});
