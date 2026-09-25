import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createLocalDataService, createLocalDataStore, isLocalDataUnavailable } from "../server/data/store.mjs";
import {
  organizedSessions,
  nativeArchiveSupported,
  draftInput,
} from "../domain/history.mjs";
import { nativeDataTools } from "../server/native-data.mjs";
import { resolveDataRoot } from "../server/runtime-config.mjs";
import { localDataFixture } from "./fixtures/local-data-app.mjs";

async function localStore(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-sqlite-"));
  const store = createLocalDataStore(root);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, store };
}
test("closed local data service cannot reopen SQLite during shutdown", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-service-close-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = createLocalDataService(root);
  service.get();
  service.close();
  assert.throws(() => service.get(), /closed/);
  assert.throws(() => service.beginMaintenance(), /closed/);
});
test("new data store is real SQLite with a versioned application-owned schema", async (t) => {
  const { store } = await localStore(t);
  assert.equal(
    (await readFile(store.filename)).subarray(0, 15).toString(),
    "SQLite format 3",
  );
  assert.equal(store.info().schemaVersion, 6);
  const reader = new DatabaseSync(store.filename, { readOnly: true });
  assert.equal(reader.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  assert.equal(
    reader.prepare("SELECT count(*) n FROM schema_migrations").get().n,
    6,
  );
  reader.close();
});
test("transient SQLite locks are not reported as unavailable local data", () => {
  assert.equal(
    isLocalDataUnavailable({ code: "ERR_SQLITE_ERROR", errcode: 5, message: "database is locked" }),
    false,
  );
  assert.equal(
    isLocalDataUnavailable({ code: "ERR_SQLITE_ERROR", errcode: 6, message: "database table is locked" }),
    false,
  );
  assert.equal(
    isLocalDataUnavailable({ code: "ERR_SQLITE_ERROR", errcode: 11, message: "database disk image is malformed" }),
    true,
  );
});
test("legacy library.sqlite is renamed and migrated in place without losing drafts", async (t) => {
  const { root, store } = await localStore(t);
  store.saveDraft("legacy", "new", "preserve me", 0);
  const current = store.filename;
  store.close();
  const db = new DatabaseSync(current);
  db.exec('DROP TABLE chatgpt_continuations; DROP TABLE chatgpt_messages; DROP TABLE chatgpt_chats; DROP TABLE project_onboarding;');
  for (const table of ["content_meta", "content_sources", "content_units", "content_facts", "content_fact_stats"])
    db.exec(`DROP TABLE ${table}`);
  db.exec("DROP TABLE content_units_fts; DROP TABLE chat_search; DROP TABLE chat_search_state; DROP TABLE model_catalog; DROP TABLE model_rating_jobs; DROP TABLE project_index_state; DELETE FROM schema_migrations WHERE version>=2; PRAGMA user_version=1");
  db.close();
  const legacy = path.join(root, "library.sqlite");
  const { rename } = await import("node:fs/promises");
  await rename(current, legacy);
  const migrated = createLocalDataStore(root);
  try {
    assert.equal(path.basename(migrated.filename), "freelancer.sqlite");
    assert.equal(migrated.info().schemaVersion, 6);
    assert.equal(migrated.draft("legacy", "new").text, "preserve me");
    const reader = new DatabaseSync(migrated.filename, { readOnly: true });
    assert.equal(reader.prepare("SELECT count(*) n FROM schema_migrations").get().n, 6);
    assert.equal(reader.prepare("SELECT count(*) n FROM sqlite_master WHERE name='content_sources'").get().n, 1);
    reader.close();
  } finally {
    migrated.close();
  }
});

test("draft survives database reopen; stale revisions never replace newer text", async (t) => {
  const { root, store } = await localStore(t);
  assert.equal(store.saveDraft("project", "new", "Keep me", 0).revision, 1);
  const other = createLocalDataStore(root);
  try {
    assert.equal(other.draft("project", "new").text, "Keep me");
    assert.throws(
      () => other.saveDraft("project", "new", "Stale", 0),
      /another window/,
    );
    assert.equal(store.draft("project", "new").text, "Keep me");
  } finally {
    other.close();
  }
});
test("draft rebind is atomic and refuses a nonempty destination", async (t) => {
  const { store } = await localStore(t);
  store.saveDraft("p", "new", "Source", 0);
  store.saveDraft("p", "ses_a", "Destination", 0);
  assert.throws(
    () => store.rebindDraft("p", "new", "ses_a", 1),
    /Nothing was moved/,
  );
  assert.equal(store.draft("p", "new").text, "Source");
  const result = store.rebindDraft("p", "new", "ses_b", 1);
  assert.equal(result.origin.text, "");
  assert.equal(result.destination.text, "Source");
});
test("newer schema and corrupt databases fail closed without resetting data", async (t) => {
  const { root, store } = await localStore(t);
  store.close();
  const db = new DatabaseSync(store.filename);
  db.exec("PRAGMA user_version=99");
  db.close();
  const before = await readFile(store.filename);
  assert.throws(() => createLocalDataStore(root), /Unsupported/);
  assert.deepEqual(await readFile(store.filename), before);
  await writeFile(store.filename, "malformed private data");
  assert.throws(() => createLocalDataStore(root));
  assert.equal(
    await readFile(store.filename, "utf8"),
    "malformed private data",
  );
});
test("draft validation rejects oversized content and missing revisions", () => {
  assert.throws(
    () => draftInput({ text: "a".repeat(200001), revision: 0 }),
    /200,000/,
  );
  assert.throws(() => draftInput({ text: "x" }), /Reload/);
  assert.throws(() => draftInput({ text: {}, revision: 0 }));
});
test("archive inheritance preserves independent child state and pin ordering", () => {
  const rows = organizedSessions(
    [
      { id: "ses_parent", time: { updated: 1 } },
      { id: "ses_child", parentID: "ses_parent" },
      { id: "ses_later", time: { updated: 3 } },
    ],
    { ses_parent: { hiddenAt: 1, pinnedAt: 2 } },
  );
  assert.equal(rows[0].id, "ses_parent");
  assert.equal(
    rows.find((s) => s.id === "ses_child").organization.hiddenByParent,
    true,
  );
  assert.equal(
    rows.find((s) => s.id === "ses_later").organization.archived,
    false,
  );
});
test("numeric archive support alone does not authorize an irreversible native mutation", () => {
  assert.equal(nativeArchiveSupported({}), false);
  assert.equal(
    nativeArchiveSupported({
      paths: {
        "/session/{sessionID}": {
          patch: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    properties: {
                      time: { properties: { archived: { type: "number" } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    false,
  );
});
async function fixture(t) {
  const f = await localDataFixture();
  t.after(() => f.close());
  return f;
}
const historyQuery = (scope) =>
  `history?project=history_project&scope=${scope ?? "all"}`;
test("indexed worker hits resolve to selectable parent with current pin and archive state", async (t) => {
  const f = await fixture(t);
  await f.api(historyQuery());
  await f.app.history.indexCurrent(f.project.id, "ses_worker", [
    { info: { id: "msg_worker", role: "user", time: { created: 300 } }, parts: [{ type: "text", text: "unique worker phrase" }] },
  ]);
  const search = () => f.api("history/search?q=unique%20worker%20phrase");
  const first = (await search()).results[0];
  assert.equal(first.session, "ses_history");
  assert.equal(first.title, "Important conversation");
  assert.equal(first.organization.revision, 0);
  const pinned = await f.api("history/pin", { project: f.project.id, session: first.session, pinned: true, revision: 0 }, "PUT");
  assert.equal((await search()).results[0].organization.pinnedAt, pinned.pinnedAt);
  await f.api("history/archive", { project: f.project.id, session: first.session, archived: true, revision: pinned.revision }, "PUT");
  assert.equal((await search()).results[0].organization.archived, true);
});
test("archive and restore keep native history, workers, usage, source and Git settings intact", async (t) => {
  const f = await fixture(t);
  const settings = await f.store.read("settings"),
    native = await readFile(f.nativeFile),
    sessions = structuredClone(f.state.sessions);
  await f.api(historyQuery());
  await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: true,
      revision: 0,
    },
    "PUT",
  );
  assert.deepEqual(
    (await f.api(historyQuery("active"))).sessions.map((s) => s.id),
    ["ses_other"],
  );
  const archive = await f.api(historyQuery("archived"));
  assert.equal(archive.sessions[0].organization.archiveScope, "freelancer");
  await assert.rejects(
    f.app.history.ensureWritable(f.project.id, "ses_worker"),
    /archived/,
  );
  await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: false,
      revision: 1,
    },
    "PUT",
  );
  assert.equal((await f.api(historyQuery("active"))).sessions.length, 2);
  assert.deepEqual(f.state.sessions, sessions);
  assert.deepEqual(await f.store.read("settings"), settings);
  assert.deepEqual(await readFile(f.nativeFile), native);
  assert.equal(
    await readFile(path.join(f.directory, "source.txt"), "utf8"),
    "DO NOT MODIFY PROJECT FILES",
  );
  assert.equal(Object.keys((await f.store.read("usage")).records).length, 0);
});
test("active worker, unknown status and approvals block archive without aborting anything", async (t) => {
  const f = await fixture(t);
  const archive = () =>
    f.api(
      "history/archive",
      {
        project: f.project.id,
        session: "ses_history",
        archived: true,
        revision: 0,
      },
      "PUT",
    );
  f.state.status.ses_worker = { type: "busy" };
  await assert.rejects(archive(), /Finish or stop/);
  f.state.status = {};
  f.state.questions = [{ sessionID: "ses_worker" }];
  await assert.rejects(archive(), /pending/);
  f.state.questions = [];
  f.state.status = [];
  await assert.rejects(archive(), /unavailable/);
  assert.equal(
    f.calls.some((c) => c.route.endsWith("/abort")),
    false,
  );
});
test("queued delivery blocks archive and cannot be silently cancelled", async (t) => {
  const f = await fixture(t);
  f.state.status.ses_history = { type: "busy" };
  await f.sender.enqueue(f.project.id, "ses_history", {
    id: "history_queue_0001",
    kind: "queue",
    text: "Next turn",
    model: "opencode/free",
    workflowID: "build",
    agentID: "inherit",
    variant: "",
  });
  // Keep native execution busy so the real sender timer cannot drain this queue
  // while the archive request waits under a heavily loaded test run.
  await assert.rejects(
    f.api(
      "history/archive",
      {
        project: f.project.id,
        session: "ses_history",
        archived: true,
        revision: 0,
      },
      "PUT",
    ),
    /queued or uncertain/,
  );
  assert.equal(
    (await f.sender.list(f.project.id, "ses_history"))[0].text,
    "Next turn",
  );
});
test("project archive is reversible without changing the project registration or individual chat archives", async (t) => {
  const f = await fixture(t);
  await f.api(historyQuery());
  await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: true,
      revision: 0,
    },
    "PUT",
  );
  const before = await f.store.read("settings");
  await f.api(
    "history/project",
    { project: f.project.id, archived: true, revision: 0 },
    "PUT",
  );
  await assert.rejects(
    f.api("chats", { project: f.project.id }),
    /Restore this project/,
  );
  assert.equal(
    (await f.api("bootstrap?project=" + f.project.id)).project.organization
      .archivedAt > 0,
    true,
  );
  await f.api(
    "history/project",
    { project: f.project.id, archived: false, revision: 1 },
    "PUT",
  );
  assert.equal(
    (await f.api(historyQuery("archived"))).sessions[0].id,
    "ses_history",
  );
  assert.deepEqual(await f.store.read("settings"), before);
});
test("pin is revision checked and survives reopening the data service", async (t) => {
  const f = await fixture(t);
  await f.api(historyQuery());
  await f.api(
    "history/pin",
    {
      project: f.project.id,
      session: "ses_history",
      pinned: true,
      revision: 0,
    },
    "PUT",
  );
  f.app.history.close();
  assert.equal((await f.api(historyQuery())).sessions[0].id, "ses_history");
  await assert.rejects(
    f.api(
      "history/pin",
      {
        project: f.project.id,
        session: "ses_history",
        pinned: false,
        revision: 0,
      },
      "PUT",
    ),
    /changed/,
  );
});
test("native archive is used only with explicit clear support and is verified afterward", async (t) => {
  const f = await fixture(t);
  f.state.nativeArchive = true;
  const result = await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: true,
      revision: 0,
    },
    "PUT",
  );
  assert.equal(result.scope, "opencode");
  assert.ok(f.state.sessions[0].time.archived);
  await f.api(
    "history/archive",
    {
      project: f.project.id,
      session: "ses_history",
      archived: false,
      revision: 1,
    },
    "PUT",
  );
  assert.equal(f.state.sessions[0].time.archived, null);
});
test("cross-project session ownership is checked for organization, drafts and exports", async (t) => {
  const f = await fixture(t);
  f.state.sessions.push({
    id: "ses_foreign",
    directory: f.root,
    title: "Foreign",
  });
  assert.equal(
    (await f.api(historyQuery())).sessions.some((s) => s.id === "ses_foreign"),
    false,
  );
  for (const route of ["history/pin", "history/archive", "drafts"])
    await assert.rejects(
      f.api(
        route,
        {
          project: f.project.id,
          session: "ses_foreign",
          pinned: true,
          archived: true,
          revision: 0,
          text: "private",
        },
        "PUT",
      ),
      /another project/,
    );
  await assert.rejects(
    f.api("history/export", {
      project: f.project.id,
      sessions: ["ses_foreign"],
      format: "json",
      includeWorkers: false,
    }),
    /another project/,
  );
});
test("history can load beyond the old 1000-item window and exposes its coverage", async (t) => {
  const f = await fixture(t);
  f.state.sessions = Array.from({ length: 1100 }, (_, i) => ({
    id: "ses_" + i,
    directory: f.directory,
    title: "History " + i,
    time: { updated: i },
  }));
  const first = await f.api(historyQuery() + "&limit=1000");
  assert.equal(first.hasMore, true);
  assert.equal(first.sessions.length, 1000);
  const second = await f.api(historyQuery() + "&limit=2000");
  assert.equal(second.sessions.length, 1100);
  assert.match(second.coverage, /not a complete backup/);
  f.state.unavailable = true;
  await assert.rejects(f.api(historyQuery()), /unavailable/);
});
test("native JSON and Markdown exports include chosen workers without importing auth, files or drafts", async (t) => {
  const f = await fixture(t);
  await f.api(
    "drafts",
    {
      project: f.project.id,
      session: "ses_history",
      text: "UNSENT PRIVATE DRAFT",
      revision: 0,
    },
    "PUT",
  );
  const json = await f.api("history/export", {
    project: f.project.id,
    sessions: ["ses_history"],
    format: "json",
    includeWorkers: true,
  });
  const bundle = JSON.parse(json.content);
  assert.deepEqual(
    bundle.sessions.map((s) => s.info.id),
    ["ses_history", "ses_worker"],
  );
  assert.equal(
    bundle.sessions[0].messages[0].parts[0].text,
    "Original conversation text",
  );
  assert.match(bundle.notice, /not a full backup/);
  assert.doesNotMatch(json.content, /UNSENT PRIVATE DRAFT|DO NOT MODIFY/);
  const md = await f.api("history/export", {
    project: f.project.id,
    sessions: ["ses_history"],
    format: "markdown",
    includeWorkers: false,
  });
  assert.match(md.content, /Original conversation text/);
  assert.doesNotMatch(md.content, /Linked worker/);
});
test("data paths are resolved without guessing native location and Open folder is a fixed allowlist", async (t) => {
  const f = await fixture(t);
  const info = await f.api("storage");
  assert.equal(
    info.locations.find((l) => l.id === "native").path,
    f.nativeFile,
  );
  assert.match(info.locations[0].path, /user-data/);
  await assert.rejects(
    f.api("storage/open", { location: "../../anything" }),
    /Choose an available/,
  );
});
test("draft HTTP revisions preserve text after reload and reject stale tabs", async (t) => {
  const f = await fixture(t);
  await f.api(
    "drafts",
    {
      project: f.project.id,
      session: "",
      text: "New conversation draft",
      revision: 0,
    },
    "PUT",
  );
  f.app.history.close();
  const read = await f.api("drafts?project=" + f.project.id);
  assert.equal(read.text, "New conversation draft");
  await assert.rejects(
    f.api(
      "drafts",
      { project: f.project.id, session: "", text: "Stale tab", revision: 0 },
      "PUT",
    ),
    (e) => e.status === 409,
  );
});
test("history writes retain existing HTTP cross-origin protection", async (t) => {
  const f = await fixture(t);
  const response = await fetch(f.url + "/api/history/project", {
    method: "PUT",
    headers: {
      Origin: "https://foreign.example",
      "X-Freelancer-Client": "webpage",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project: f.project.id,
      archived: true,
      revision: 0,
    }),
  });
  assert.equal(response.status, 403);
});
test("native data commands are read-only fixed argv in the same environment", async () => {
  const calls = [],
    env = { XDG_DATA_HOME: "/native-home" };
  const tools = nativeDataTools({
    executable: "/native/opencode",
    env,
    execute: async (...args) => {
      calls.push(args);
      return {
        stdout:
          args[1][0] === "db"
            ? path.resolve("/native/opencode.db")
            : JSON.stringify({ info: { id: "ses_safe" }, messages: [] }),
      };
    },
  });
  await tools.exportSession("ses_safe", path.resolve("/project"));
  await tools.databasePath();
  assert.deepEqual(
    calls.map((c) => c[1]),
    [
      ["export", "ses_safe"],
      ["db", "path"],
    ],
  );
  assert.equal(calls[0][2].env, env);
  await assert.rejects(
    tools.exportSession("ses_safe; rm -rf /", "/project"),
    /Choose/,
  );
});
test("explicit per-user data location must be absolute", () => {
  assert.throws(
    () => resolveDataRoot({ FREELANCER_DATA_HOME: "relative" }),
    /absolute/,
  );
  assert.equal(
    resolveDataRoot({ FREELANCER_DATA_HOME: path.resolve("/test-local") }),
    path.resolve("/test-local"),
  );
});

test("archive fences the prompt acknowledgement gap and never cancels native work", async (t) => {
  const f = await fixture(t);
  let release;
  f.state.holdPrompt = new Promise((resolve) => {
    release = resolve;
  });
  try {
    const sending = f.api("send", {
      project: f.project.id,
      session: "ses_history",
      text: "Request",
      model: "opencode/free",
      variant: "",
      workflowID: "build",
      agentID: "inherit",
    });
    while (!f.calls.some((c) => c.route.endsWith("/prompt_async")))
      await new Promise((resolve) => setTimeout(resolve, 2));
    const archiving = f.api(
      "history/archive",
      {
        project: f.project.id,
        session: "ses_history",
        archived: true,
        revision: 0,
      },
      "PUT",
    );
    // Attach rejection handling immediately so a fail-closed response cannot
    // become an unhandled rejection while the sender acknowledgement is held.
    const rejected = assert.rejects(archiving, /running chats|queued/);
    release();
    await sending;
    await rejected;
    assert.ok(!f.calls.some((c) => c.route.endsWith("/abort")));
    assert.equal(
      (await f.api(historyQuery())).sessions.find((s) => s.id === "ses_history")
        .organization.archived,
      false,
    );
  } finally {
    release();
  }
});

test("native archive acknowledgement without actual state change is not reported successful", async (t) => {
  const f = await fixture(t);
  f.state.nativeArchive = true;
  const original = f.host.request;
  f.host.request = async (route, options) =>
    options?.method === "PATCH"
      ? f.state.sessions[0]
      : original(route, options);
  await assert.rejects(
    f.api(
      "history/archive",
      {
        project: f.project.id,
        session: "ses_history",
        archived: true,
        revision: 0,
      },
      "PUT",
    ),
    /did not confirm/,
  );
  assert.equal(
    (await f.api(historyQuery())).sessions.find((s) => s.id === "ses_history")
      .organization.archived,
    false,
  );
});

test("native export and database discovery fail without invented results", async (t) => {
  const f = await fixture(t);
  f.host.exportSession = undefined;
  f.host.databasePath = undefined;
  await assert.rejects(
    f.api("history/export", {
      project: f.project.id,
      sessions: ["ses_history"],
      format: "json",
      includeWorkers: false,
    }),
    /export is unavailable/,
  );
  const result = await f.api("storage");
  assert.equal(result.locations.find((l) => l.id === "native").path, null);
  assert.match(result.nativeWarning, /No location was guessed/);
});

test("export failure on a worker never returns a falsely complete conversation bundle", async (t) => {
  const f = await fixture(t);
  const exported = f.host.exportSession;
  f.host.exportSession = async (id, dir) => {
    if (id === "ses_worker") throw Error("Worker export unavailable");
    return exported(id, dir);
  };
  await assert.rejects(
    f.api("history/export", {
      project: f.project.id,
      sessions: ["ses_history"],
      format: "json",
      includeWorkers: true,
    }),
    /Worker export unavailable/,
  );
});

test("SQLite foreign-key failures roll back annotations and preserve existing drafts", async (t) => {
  const { store, root } = await localStore(t);
  store.saveDraft("p", "new", "Safe text", 0);
  assert.throws(
    () => store.annotate("p", "ses_missing", { pinnedAt: 1 }, 0),
    /FOREIGN KEY/,
  );
  assert.deepEqual(store.annotation("p", "ses_missing"), {
    pinnedAt: null,
    hiddenAt: null,
    revision: 0,
  });
  store.close();
  const reopened = createLocalDataStore(root);
  try {
    assert.equal(reopened.draft("p", "new").text, "Safe text");
  } finally {
    reopened.close();
  }
});

test("a foreign SQLite application ID is rejected even with an empty version-zero schema", async (t) => {
  const { root, store } = await localStore(t);
  const filename = store.filename;
  store.close();
  await rm(filename);
  const foreign = new DatabaseSync(filename);
  foreign.exec("PRAGMA application_id=1234");
  foreign.close();
  const before = await readFile(filename);
  assert.throws(() => createLocalDataStore(root), /Unsupported/);
  assert.deepEqual(await readFile(filename), before);
});
