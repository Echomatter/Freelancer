import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireLock } from "../server/lock.mjs";
test("only one app may write shared settings, and its lock is released on close", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "freelancer-lock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const release = await acquireLock(dir);
  await assert.rejects(acquireLock(dir), /already running/);
  await release();
  const second = await acquireLock(dir);
  await second();
  await writeFile(path.join(dir, "application.lock"), "{broken");
  await assert.rejects(acquireLock(dir), /unreadable/);
  assert.equal(
    await readFile(path.join(dir, "application.lock"), "utf8"),
    "{broken",
  );
});
