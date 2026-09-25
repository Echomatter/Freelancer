import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveTodoLayout, applyTodoLayout, persistTodoLayout } from "../domain/appearance.mjs";
import { compatibleApplication, uiContract } from "../domain/protocol.mjs";

// Compare canonical source on both LF and CRLF checkouts; keep the content hash exact.
const read = async (path) => (await readFile(new URL(path, import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const [app, panels, chat, settings, contributions] = await Promise.all([
  read("../src/App.tsx"), read("../src/WorkspacePanels.tsx"), read("../src/Chat.tsx"),
  read("../src/Settings.tsx"), read("../src/Contributions.tsx"),
]);
function section(source, start, end) {
  // Git checkout line endings are not a presentation change.
  source = source.replace(/\r\n/g, "\n");
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}

test("overview uses one availability hero without currency cards", () => {
  const overview = section(app, '{view === "overview" && (', '{view === "files" &&');
  assert.equal((overview.match(/<UsageHero\s/g) ?? []).length, 1);
  assert.match(overview, /view=\{availableUsage.view\}/);
  assert.doesNotMatch(overview, /<Stat\s|money\(|aggregateUsedPercent|monthlyPrice|remainingValue/);
});

test("navigation consumes the same availability view and expands before navigating", () => {
  const bottom = section(app, '<div className="sidebar-bottom usage-dock">', '</aside>');
  assert.match(bottom, /<UsageSidebar view=\{availableUsage.view\}/);
  assert.match(bottom, /onOpen=\{\(\) => setView\("overview"\)\}/);
  assert.doesNotMatch(bottom, /money\(|costs|monthlyPrice|remainingValue/);
});

test("normal activity surfaces expose neither dollar estimates nor raw usage counters", () => {
  assert.doesNotMatch(app, /\.tokens\b|\.estimatedCost\b|money\(p\./);
  const details = section(panels, 'function ActivityCard(', 'export function Files(');
  assert.doesNotMatch(details, /tokens|estimatedCost|currency|formatUsageCount/);
  assert.doesNotMatch(contributions, /\.tokens\b|\.weight\b|estimatedCost|reportedCost|currency/);
  assert.match(contributions, /formatPercent\(row.sharePercent\)/);
  assert.doesNotMatch(panels, /JSON.stringify\(result/);
});

test("activity summaries show model and status and navigate directly to the child", () => {
  const card = section(panels, 'function ActivityCard(', 'function CurrentFile(');
  assert.match(card, /activityLabel\(activity\.phase\)/);
  assert.match(card, /ProviderText provider=\{model\}/);
  assert.match(card, /\{activity\.completedTools \?\? 0\} actions/);
  assert.match(card, /onChild\(activity\.child\)/);
  assert.doesNotMatch(card, /<details>|<summary>|aria-expanded|activity-detail-body/);
  assert.ok(panels.indexOf('<ChatContributions') < panels.indexOf('<nav'));
  assert.match(app, /contributions=\{data.costs.contributions\?\.chats.find/);
  assert.match(app, /\(c\) => c.sessionID === session/);
  assert.doesNotMatch(contributions, /Share of work|Recorded activity|its recorded delegated work|contributions\?\.month/);
});

test("worker cards have no expanded result-validation view", () => {
  const card = section(panels, 'function ActivityCard(', 'function CurrentFile(');
  assert.doesNotMatch(card, /const \[open, setOpen\]/);
  assert.doesNotMatch(card, /<details>|<summary>|activity-detail-body/);
  assert.doesNotMatch(card, /Partial result|Result ready.*Validation|worker_result\.validationStatus/);
});

test("provider availability remains a percentage and plan-price inputs remain editable", () => {
  const providers = section(app, '<Panel title="Your providers">', '</Panel>');
  assert.match(providers, /<UsageProviders view=\{availableUsage.view\}/);
  assert.doesNotMatch(providers, /money\(/);
  assert.match(settings, /value=\{plans.providers\[id\].monthlyPrice \?\? ""\}/);
});

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

test("todo placement is no longer an Appearance control; saved layout behavior remains compatible", () => {
  assert.doesNotMatch(settings, /TodoPlacement|Todo placement|todoLayout|persistTodoLayout/);
  assert.match(chat, /resolveTodoLayout\(data\.settings\.appearance\)/);
  assert.equal(resolveTodoLayout({ todoLayout: "inline" }), "inline");
});

test("todos render in one selected location; dock shares the full-height scroll container", () => {
  assert.match(chat, /resolveTodoLayout\(data.settings.appearance\) === "docked"/);
  const dock = chat.indexOf('<WorkCard title=');
  const form = chat.indexOf('<form', dock);
  assert.ok(dock > chat.indexOf('className="composer-wrap"'));
  assert.ok(form > dock);
  assert.match(chat.slice(form, form + 100), /className=\{dragging \? "composer dragging" : "composer"\}/);
  assert.match(panels, /docked \? \[\] : \["tasks"\]/);
  assert.match(panels, /docked && selectedTab === "tasks" \? "activity"/);
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
