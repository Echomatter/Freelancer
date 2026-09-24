import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rename, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { replaceFile } from "../server/replace-file.mjs";
import { createStore } from "../server/store.mjs";

const locked = code => Object.assign(new Error("Target is locked"), { code });
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "freelancer-replace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("Windows replacement retries only the same immutable file until the lock clears", async t => {
  const root = await fixture(t), target = path.join(root, "settings.json"), source = target + ".tmp";
  await writeFile(target, "original"); await writeFile(source, "replacement");
  const sleeps = [], attempts = [];
  await replaceFile(source, target, {
    platform: "win32", sleep: async ms => sleeps.push(ms),
    move: async (from, to) => {
      attempts.push([from, to]);
      assert.equal(await readFile(to, "utf8"), "original");
      assert.equal(await readFile(from, "utf8"), "replacement");
      if (attempts.length <= 3) throw locked(["EPERM", "EBUSY", "EACCES"][attempts.length - 1]);
      await rename(from, to);
    },
  });
  assert.deepEqual(sleeps, [20, 40, 80]);
  assert.deepEqual(attempts, Array.from({ length: 4 }, () => [source, target]));
  assert.equal(await readFile(target, "utf8"), "replacement");
  await assert.rejects(readFile(source), { code: "ENOENT" });
});

test("permanent Windows lock is bounded and leaves the original and temporary files intact", async t => {
  const root = await fixture(t), target = path.join(root, "settings.json"), source = target + ".tmp";
  await writeFile(target, "original"); await writeFile(source, "replacement");
  const error = locked("EPERM"), sleeps = []; let attempts = 0;
  await assert.rejects(replaceFile(source, target, {
    platform: "win32", sleep: async ms => sleeps.push(ms), move: async () => { attempts++; throw error; },
  }), e => e === error);
  assert.equal(attempts, 6);
  assert.deepEqual(sleeps, [20, 40, 80, 160, 320]);
  assert.equal(await readFile(target, "utf8"), "original");
  assert.equal(await readFile(source, "utf8"), "replacement");
});

test("unrelated rename errors and non-Windows permissions fail without retries", async () => {
  for (const [platform, code] of [["win32", "ENOENT"], ["win32", "EXDEV"], ["win32", "ENOSPC"], ["linux", "EPERM"]]) {
    const error = locked(code); let attempts = 0, sleeps = 0;
    await assert.rejects(replaceFile("temp", "target", {
      platform, sleep: async () => sleeps++, move: async () => { attempts++; throw error; },
    }), e => e === error);
    assert.equal(attempts, 1); assert.equal(sleeps, 0);
  }
});

test("failed settings replacement preserves saved appearance, cleans only its temp, and allows recovery", async t => {
  const root = await fixture(t); let fail = false, mutations = 0;
  const store = createStore(root, { replace: (source, target) => replaceFile(source, target, {
    platform: "win32", sleep: async () => {}, move: async (...args) => { if (fail) throw locked("EPERM"); await rename(...args); },
  }) });
  await store.update("settings", s => ({ ...s, appearance: { theme: "midnight", providerColors: { opencode: "#26834a" } } }));
  const original = await store.read("settings"); fail = true;
  await assert.rejects(store.update("settings", s => { mutations++; s.appearance.theme = "sandstone"; return s; }), { code: "EPERM" });
  assert.equal(mutations, 1, "retry rename, not the state mutation");
  assert.deepEqual(await store.read("settings"), original);
  assert.deepEqual(await readdir(store.directory), ["settings.json"]);
  fail = false;
  await store.update("settings", s => ({ ...s, appearance: { ...s.appearance, theme: "sandstone" } }));
  assert.equal((await store.read("settings")).appearance.theme, "sandstone");
  assert.deepEqual((await store.read("settings")).appearance.providerColors, original.appearance.providerColors);
});

test("queued settings writes stay serialized through a file-lock retry", async t => {
  const root = await fixture(t); let block = false, retryEntered, release, secondStarted = false;
  const entered = new Promise(resolve => { retryEntered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const store = createStore(root, { replace: (source, target) => replaceFile(source, target, {
    platform: "win32", sleep: async () => { retryEntered(); await gate; },
    move: async (...args) => { if (block) { block = false; throw locked("EPERM"); } await rename(...args); },
  }) });
  await store.update("settings", s => ({ ...s, appearance: { theme: "light" } }));
  block = true;
  const first = store.update("settings", s => ({ ...s, appearance: { ...s.appearance, theme: "sandstone" } }));
  await entered;
  const second = store.update("settings", s => { secondStarted = true; s.appearance.providerColors = { opencode: "#26834a" }; return s; });
  try {
    assert.equal((await store.read("settings")).appearance.theme, "light");
    assert.equal(secondStarted, false);
  } finally { release(); }
  await Promise.all([first, second]); await store.flush();
  assert.deepEqual((await store.read("settings")).appearance, { theme: "sandstone", providerColors: { opencode: "#26834a" } });
});
