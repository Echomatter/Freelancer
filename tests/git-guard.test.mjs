import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gitToolGuard } from "../backend/tools/runtime/git-guard.mjs";
import {
  classifyToolOperation,
  extractToolPaths,
  isInspectAllowed,
  parseApplyPatchPaths,
} from "../backend/tools/runtime/tool-operations.mjs";

async function trackedFixture(t, preset = "review", tracking = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "git-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = path.join(root, ".state/webpage");
  await mkdir(state, { recursive: true });
  const settings = {
    projects: [{ id: "p", directory: root }],
    gitProjects: { p: { tracking, preset } },
  };
  await writeFile(path.join(state, "settings.json"), JSON.stringify(settings));
  const check = (tool, args = {}) =>
    gitToolGuard({
      toolkitRoot: root,
      directory: root,
      input: { sessionID: "ses", callID: "call", tool },
      args,
    });
