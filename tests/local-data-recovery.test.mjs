import test from "node:test";
import assert from "node:assert/strict";
import { createDraftCache } from "../domain/draft-cache.mjs";
import { createSender } from "../server/sender.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("explicit draft reload preserves typing entered while the read is in flight", async (t) => {
  const gate = deferred(), started = deferred();
  let hold = false, stored = { revision: 0, text: "" };
  const cache = createDraftCache(async (route, body) => {
    if (!body) {
      const snapshot = { ...stored };
      if (hold) { started.resolve(); await gate.promise; }
      return snapshot;
    }
    assert.equal(body.revision, stored.revision);
    stored = { revision: stored.revision + 1, text: body.text };
    return { ...stored };
  }, { delay: 60000 });
  t.after(() => { gate.resolve(); cache.dispose(); });
  await cache.load("project", "ses_owned");
  cache.set("project", "ses_owned", "Saved before reload");
  await cache.flush("project", "ses_owned");
  hold = true;
  const reloading = cache.reload("project", "ses_owned");
  const rejected = assert.rejects(reloading, /changed while loading/);
  await started.promise;
  cache.set("project", "ses_owned", "New typing during reload");
  gate.resolve();
  await rejected;
  assert.equal(cache.get("project", "ses_owned").text, "New typing during reload");
  assert.equal(stored.text, "Saved before reload");
  assert.equal(cache.hasUnsaved(), true);
  await cache.flush("project", "ses_owned");
  assert.equal(stored.text, "New typing during reload");
});

test("sender close drains active history organization and rejects newly arriving writes", async (t) => {
  const gate = deferred(), started = deferred();
  const sender = createSender({}, { file: null });
  t.after(async () => { gate.resolve(); await sender.close(); });
  const organizing = sender.organize("project", async (pending) => {
    assert.deepEqual(pending, []);
    started.resolve();
    await gate.promise;
    return "archived";
  });
  await started.promise;
  let closed = false;
  const closing = sender.close().then(() => { closed = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(closed, false);
  await assert.rejects(sender.organize("project", async () => {}), /closing/);
  await assert.rejects(sender.send("project", "ses_owned", {}), /closing/);
  gate.resolve();
  assert.equal(await organizing, "archived");
  await closing;
  assert.equal(closed, true);
});
