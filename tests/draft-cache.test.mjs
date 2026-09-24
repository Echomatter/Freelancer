import test from "node:test";
import assert from "node:assert/strict";
import { createDraftCache } from "../domain/draft-cache.mjs";
import { setImmediate as nextTick } from "node:timers/promises";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function fixture(t, intercept = () => {}) {
  const saved = new Map(),
    calls = [];
  const read = (p, s = "") =>
    saved.get(JSON.stringify([p, s])) ?? { revision: 0, text: "" };
  const request = async (route, body, method) => {
    const q = new URL("http://local/" + route);
    const p = body?.project ?? q.searchParams.get("project"),
      s = body?.session ?? q.searchParams.get("session") ?? "";
    calls.push({ route, body, method });
    await intercept(route, body, method);
    const old = read(p, s);
    if (q.pathname === "/drafts/rebind") {
      const source = read(p, ""),
        target = read(p, body.to);
      if (source.revision !== body.revision || target.text)
        throw Object.assign(Error("Draft conflict"), { status: 409 });
      const origin = { text: "", revision: source.revision + 1 },
        destination = { text: source.text, revision: target.revision + 1 };
      saved.set(JSON.stringify([p, ""]), origin);
      saved.set(JSON.stringify([p, body.to]), destination);
      return { origin, destination };
    }
    if (!body) return { ...old };
    if (old.revision !== body.revision)
      throw Object.assign(Error("Draft changed in another window"), {
        status: 409,
      });
    const value = { revision: old.revision + 1, text: body.text };
    saved.set(JSON.stringify([p, s]), value);
    return value;
  };
  const cache = createDraftCache(request, { delay: 60000 });
  t.after(() => cache.dispose());
  return { cache, saved, read, request, calls };
}

test("saved drafts restore in a fresh controller without sending a message", async (t) => {
  const f = fixture(t);
  await f.cache.load("p", "ses_a");
  f.cache.set("p", "ses_a", "Remember this");
  await f.cache.flush("p", "ses_a");
  const other = createDraftCache(f.request);
  t.after(() => other.dispose());
  await other.load("p", "ses_a");
  assert.equal(other.get("p", "ses_a").text, "Remember this");
  assert.equal(other.hasUnsaved(), false);
  assert.ok(f.calls.every((c) => c.route.startsWith("drafts")));
});

test("in-flight save drains newer edits serially and never reports them saved early", async (t) => {
  const gate = deferred();
  let held = false;
  const f = fixture(t, async (_, body) => {
    if (body && !held) {
      held = true;
      await gate.promise;
    }
  });
  await f.cache.load("p", "ses_a");
  f.cache.set("p", "ses_a", "First");
  const flushing = f.cache.flush("p", "ses_a");
  await nextTick();
  f.cache.set("p", "ses_a", "Second");
  assert.equal(f.cache.hasUnsaved(), true);
  gate.resolve();
  await flushing;
  assert.deepEqual(f.read("p", "ses_a"), { revision: 2, text: "Second" });
  assert.equal(f.cache.hasUnsaved(), false);
});

test("send acknowledgement only clears the exact captured edit generation", async (t) => {
  const { cache } = fixture(t);
  await cache.load("p", "ses_a");
  cache.set("p", "ses_a", "Original");
  const token = cache.capture("p", "ses_a");
  cache.set("p", "ses_a", "New concern");
  cache.accept(token);
  assert.equal(cache.get("p", "ses_a").text, "New concern");
  cache.set("p", "ses_a", "Original");
  cache.accept(token);
  assert.equal(
    cache.get("p", "ses_a").text,
    "Original",
    "retyping the same text is a new draft",
  );
  cache.accept(cache.capture("p", "ses_a"));
  await cache.flush("p", "ses_a");
  assert.equal(cache.get("p", "ses_a").text, "");
});

test("acceptance after navigation clears the origin and does not affect another conversation", async (t) => {
  const { cache, read } = fixture(t);
  await cache.load("p", "ses_a");
  await cache.load("q", "ses_b");
  cache.set("p", "ses_a", "Submitted");
  const token = cache.capture("p", "ses_a");
  cache.set("q", "ses_b", "Other project draft");
  cache.accept(token);
  await cache.flushAll();
  assert.equal(read("p", "ses_a").text, "");
  assert.equal(read("q", "ses_b").text, "Other project draft");
});

test("two windows cannot overwrite each other; explicit reload resolves the revision conflict", async (t) => {
  const f = fixture(t);
  const other = createDraftCache(f.request, { delay: 60000 });
  t.after(() => other.dispose());
  await f.cache.load("p", "ses_a");
  await other.load("p", "ses_a");
  f.cache.set("p", "ses_a", "Window one");
  await f.cache.flush("p", "ses_a");
  other.set("p", "ses_a", "Window two");
  await assert.rejects(other.flush("p", "ses_a"), /another window/);
  assert.equal(other.get("p", "ses_a").text, "Window two");
  assert.equal(f.read("p", "ses_a").text, "Window one");
  await other.reload("p", "ses_a");
  assert.equal(other.get("p", "ses_a").text, "Window one");
  other.set("p", "ses_a", "Combined work");
  await other.flush("p", "ses_a");
  assert.equal(f.read("p", "ses_a").text, "Combined work");
});

test("load does not clobber text entered before an existing saved draft returns", async (t) => {
  const gate = deferred();
  const f = fixture(t, async (_, body) => {
    if (!body) await gate.promise;
  });
  f.saved.set(JSON.stringify(["p", "ses_a"]), {
    revision: 1,
    text: "Saved earlier",
  });
  const loading = f.cache.load("p", "ses_a");
  f.cache.set("p", "ses_a", "Typing now");
  gate.resolve();
  await assert.rejects(loading, /saved draft exists/);
  assert.equal(f.cache.get("p", "ses_a").text, "Typing now");
  assert.equal(f.read("p", "ses_a").text, "Saved earlier");
});

test("failed save preserves unsent text and a retry writes it exactly once", async (t) => {
  let fail = true;
  const f = fixture(t, (_, body) => {
    if (body && fail) throw Error("Disk unavailable");
  });
  await f.cache.load("p", "ses_a");
  f.cache.set("p", "ses_a", "Keep me");
  await assert.rejects(f.cache.flush("p", "ses_a"), /Disk/);
  assert.equal(f.cache.get("p", "ses_a").text, "Keep me");
  assert.equal(f.cache.hasUnsaved(), true);
  fail = false;
  await f.cache.flush("p", "ses_a");
  assert.equal(f.read("p", "ses_a").text, "Keep me");
});

test("a lost save acknowledgement does not overwrite a newer server revision", async (t) => {
  const f = fixture(t);
  let lose = true;
  const cache = createDraftCache(
    async (...args) => {
      const result = await f.request(...args);
      if (args[1] && lose) {
        lose = false;
        throw Error("Connection lost");
      }
      return result;
    },
    { delay: 60000 },
  );
  t.after(() => cache.dispose());
  await cache.load("p", "ses_a");
  cache.set("p", "ses_a", "Already saved");
  await assert.rejects(cache.flush("p", "ses_a"), /Connection/);
  cache.set("p", "ses_a", "Newer local");
  await assert.rejects(cache.flush("p", "ses_a"), /another window/);
  assert.equal(cache.get("p", "ses_a").text, "Newer local");
  assert.equal(f.read("p", "ses_a").text, "Already saved");
});

test("new-chat rebinding moves saved text and newer typing follows the created conversation", async (t) => {
  const gate = deferred();
  const f = fixture(t, async (route) => {
    if (route === "drafts/rebind") await gate.promise;
  });
  await f.cache.load("p", "");
  f.cache.set("p", "", "Original");
  const token = f.cache.capture("p", "");
  const moving = f.cache.rebind(token, "ses_new");
  await nextTick();
  f.cache.set("p", "", "New typing");
  gate.resolve();
  const moved = await moving;
  f.cache.accept(moved);
  await f.cache.flushAll();
  assert.equal(f.cache.get("p", "").text, "");
  assert.equal(f.read("p", "").text, "");
  assert.equal(f.read("p", "ses_new").text, "New typing");
});

test("new-chat rebind rejects a nonempty destination and retains both drafts", async (t) => {
  const f = fixture(t);
  f.saved.set(JSON.stringify(["p", "ses_new"]), {
    revision: 1,
    text: "Existing destination",
  });
  await f.cache.load("p", "");
  f.cache.set("p", "", "Unsent source");
  const token = f.cache.capture("p", "");
  await assert.rejects(f.cache.rebind(token, "ses_new"), /conflict/);
  assert.equal(f.cache.get("p", "").text, "Unsent source");
  assert.equal(f.read("p", "ses_new").text, "Existing destination");
});
