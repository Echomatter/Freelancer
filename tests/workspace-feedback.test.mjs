import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate as immediate, setTimeout as delay } from "node:timers/promises";
import { projectActivity, activityLabel, pollActivity } from "../domain/chat-activity.mjs";
import { questionAnswers, pendingQuestions } from "../domain/questions.mjs";
import { createActivityReader } from "../server/activity.mjs";
import { startServer } from "../server/http.mjs";

const sessions = [{ id: "parent" }, { id: "child", parentID: "parent" },
  { id: "grandchild", parentID: "child" }, { id: "other" }];

test("busy and retry work roll up through descendants, not unrelated chats", () => {
  const result = projectActivity(sessions, { grandchild: { type: "retry" } });
  assert.equal(result.parent.active, true);
  assert.equal(result.parent.delegated, true);
  assert.equal(result.child.active, true);
  assert.equal(result.other.active, false);
  assert.equal(activityLabel(result.parent), "Retrying");
  assert.equal(activityLabel(projectActivity(sessions, { child: { type: "busy" } }).parent), "Helper working");
});

test("a fresh idle/completed snapshot clears every spinner", () => {
  assert.equal(projectActivity(sessions, { parent: { type: "busy" } }).parent.active, true);
  for (const status of [{}, { parent: { type: "idle" } }, { parent: { type: "error" } }])
    assert.equal(projectActivity(sessions, status).parent.active, false);
});

test("questions and permissions are waiting, not simulated progress", () => {
  const result = projectActivity(sessions, { child: { type: "busy" } }, [{ sessionID: "child" }]);
  assert.equal(result.parent.active, false);
  assert.equal(activityLabel(result.parent), "Answer needed");
  const permission = projectActivity(sessions, { child: { type: "retry" } }, [], [{ sessionID: "child" }]);
  assert.equal(permission.parent.active, false);
  const mixed = projectActivity(sessions, { parent: { type: "busy" } }, [{ sessionID: "child" }]);
  assert.equal(activityLabel(mixed.parent), "Working; answer needed");
  assert.equal(activityLabel(undefined), "Activity unavailable");
});

test("malformed ancestry is bounded and unknown sessions cannot add indicators", () => {
  const result = projectActivity([{ id: "a", parentID: "b" }, { id: "b", parentID: "a" },
    { id: "orphan", parentID: "outside" }], { a: { type: "busy" }, outside: { type: "busy" } });
  assert.equal(result.a.active, true);
  assert.equal(result.b.active, true);
  assert.equal(result.orphan.active, false);
  assert.equal(result.outside, undefined);
});

test("polling is single-flight and stopping ignores late results", async () => {
  let calls = 0, resolveRead, signal;
  const seen = [];
  const stop = pollActivity((s) => { calls++; signal = s; return new Promise((r) => { resolveRead = r; }); },
    (value) => seen.push(value), { delay: 1 });
  await delay(5);
  assert.equal(calls, 1);
  stop();
  assert.equal(signal.aborted, true);
  resolveRead({ project: "old" });
  await immediate();
  assert.deepEqual(seen, []);
});

test("polling replaces success with unavailable on failure, then recovers", async (t) => {
  const seen = [];
  let calls = 0;
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const stop = pollActivity(async () => {
    calls++;
    if (calls === 2) throw Error("offline");
    return { project: "p", sessions: calls === 1 ? { a: { active: true } } : {} };
  }, (value) => { seen.push(value); if (seen.length === 3) done(); }, { delay: 1 });
  t.after(stop);
  await finished;
  stop();
  assert.equal(seen[0].sessions.a.active, true);
  assert.equal(seen[1], null);
  assert.deepEqual(seen[2].sessions, {});
});

test("poll timeout aborts the read and publishes unavailable", async (t) => {
  let observed;
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const stop = pollActivity((signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
  }), (value) => { observed = value; done(); }, { timeout: 2, delay: 1000 });
  t.after(stop);
  await finished;
  stop();
  assert.equal(observed, null);
});

test("question answers preserve native shape and single/custom exclusivity", () => {
  const questions = [{}, { multiple: true }, { custom: false }, {}];
  const selected = [["A", "B"], ["One", "Two"], ["Native"], []];
  const custom = ["  Custom  ", "Extra", "must be ignored", "   "];
  assert.deepEqual(questionAnswers(questions, selected, custom), [["Custom"], ["One", "Two", "Extra"], ["Native"], []]);
  assert.deepEqual(selected[0], ["A", "B"]);
  assert.deepEqual(questionAnswers([{}], [["A", "B"]], [""]), [["A"]]);
});

test("multiple answers do not duplicate an option also entered as custom text", () => {
  assert.deepEqual(questionAnswers([{ multiple: true }], [["A", "A"]], [" A "]), [["A"]]);
});

test("question queue keeps order, removes acknowledged requests and deduplicates IDs", () => {
  const requests = [{ id: "one" }, { id: "two" }, { id: "one" }, { id: "three" }];
  assert.deepEqual(pendingQuestions(requests, new Set(["one"])), [{ id: "two" }, { id: "three" }]);
  assert.equal(requests.length, 4);
});

function readerFixture() {
  const calls = [];
  const reader = createActivityReader({
    project: async (id) => { assert.equal(id, "p"); return { directory: "/work/project" }; },
    host: { request: async (route, options) => {
      calls.push({ route, options });
      if (route === "/session?limit=1000") return [
        { id: "parent", directory: "/work/project" },
        { id: "child", parentID: "parent", directory: "/work/project" },
        { id: "foreign", parentID: "parent", directory: "/work/other" },
      ];
      if (route === "/session/status") return { child: { type: "busy" }, foreign: { type: "busy" } };
      if (route === "/question") return [{ sessionID: "foreign", secret: "must not leave reader" }];
      if (route === "/permission") return [];
      throw Error("Unexpected request");
    } },
  });
  return { calls, reader };
}

test("activity reader uses only scoped native GETs and publishes no request content", async () => {
  const { reader, calls } = readerFixture();
  const result = await reader("p");
  assert.equal(result.project, "p");
  assert.equal(result.sessions.parent.active, true);
  assert.equal(result.sessions.parent.waiting, false);
  assert.equal(result.sessions.foreign, undefined);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(calls.length, 4);
  for (const { options } of calls) assert.deepEqual(options, { directory: "/work/project" });
});

test("activity reader validates project before native calls and surfaces failures", async () => {
  let called = false;
  const reader = createActivityReader({ project: async () => { throw Error("Choose a project"); },
    host: { request: async () => { called = true; } } });
  await assert.rejects(reader("unknown"), /Choose a project/);
  assert.equal(called, false);
  const broken = createActivityReader({ project: async () => ({ directory: "/work/project" }),
    host: { request: async () => null } });
  await assert.rejects(broken("p"), /Activity unavailable/);
});

test("real HTTP route serves scoped activity and preserves local-only guards", async (t) => {
  const { reader, calls } = readerFixture();
  const runtime = await startServer({ application: {}, assets: ".", readActivity: reader });
  t.after(() => { runtime.server.closeAllConnections(); runtime.server.close(); });
  const url = runtime.url + "/api/activity?project=p";
  assert.equal((await fetch(url)).status, 403);
  const headers = { "X-Freelancer-Client": "webpage" };
  assert.equal((await fetch(url, { headers: { ...headers, Origin: "https://other.example" } })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers })).status, 404);
  assert.equal(calls.length, 0);
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).sessions.parent.active, true);
});

test("source contract: sidebar and history share project activity; answers bypass error swallowing", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const navigation = await readFile(new URL("../src/NavigationMenus.tsx", import.meta.url), "utf8");
  assert.match(app, /activity: sessionActivity\?\.\[s.id\]/);
  assert.equal(navigation.match(/<SessionActivity activity=\{session.activity\}/g)?.length, 1);
  const history = await readFile(new URL("../src/History.tsx", import.meta.url), "utf8");
  assert.equal(history.match(/<SessionActivity activity=\{sessionActivity\?\.\[row.id\]\}/g)?.length, 1);
  assert.match(app, /<HistoryPage[^>]*activity=\{sessionActivity\}/);
  assert.match(history, /useProjectActivity\(\s*selectedProject,\s*selectedProject !== project,?\s*\)/);
  assert.match(app, /useProjectActivity\(project,/);
  const handler = app.slice(app.indexOf("onRespond={async"), app.indexOf("onRespond={async") + 550);
  assert.match(handler, /await api\("respond"/);
  assert.doesNotMatch(handler, /run\(async/);
  assert.match(handler, /void refreshChat\(\)\.catch/);
  const main = await readFile(new URL("../server/main.mjs", import.meta.url), "utf8");
  assert.match(main, /readActivity: createActivityReader\(\{ project: app.project, host \}\)/);
});

test("source contract: shared dialogs retain parent and worker question state, local errors and reduced motion", async () => {
  const question = await readFile(new URL("../src/Question.tsx", import.meta.url), "utf8");
  assert.equal(question.match(/<Question key=/g)?.length, 1);
  assert.match(question, /const request = queue\[0\]/);
  assert.match(question, /queue.find\(row => !row.worker\)/);
  assert.match(question, /queue.find\(row => row.worker\)/);
  assert.match(question, /if \(inFlight.current\) return/);
  assert.match(question, /role="alert"/);
  assert.match(question, /<Dialog/);
  assert.match(question, /if \(!inFlight.current\) onLater\(\)/);
  const css = await readFile(new URL("../src/workspace-feedback.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/);
  const shared = await readFile(new URL('../src/echoflex/dialog.css', import.meta.url), 'utf8');
  assert.match(shared, /\.ef-dialog:not\(\[open\]\)/);
});
