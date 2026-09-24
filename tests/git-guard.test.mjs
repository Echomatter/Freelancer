import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gitToolGuard } from "../backend/tools/runtime/git-guard.mjs";


test("tracked projects allow normal tools while raw Git remains application-owned", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "git-guard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = path.join(root, ".state/webpage");
  await mkdir(state, { recursive: true });
  const settings = {
    projects: [{ id: "p", directory: root }],
    gitProjects: { p: { tracking: true, preset: "review" } },
  };
  await writeFile(path.join(state, "settings.json"), JSON.stringify(settings));
  const check = (tool, args = {}) =>
    gitToolGuard({
      toolkitRoot: root,
      directory: root,
      input: { sessionID: "ses", callID: "call", tool },
      args,
    });
  for (const tool of ["git_project", "skill", "delegate", "write", "edit", "content_index", "websearch", "task"])
    await check(tool, tool === "write" || tool === "edit" ? { filePath: "src/example.js" } : {});
  await check("bash", { command: "node --version" });
  await assert.rejects(check("bash", { command: "git status" }), /agreement|git_project/);
  await assert.rejects(check("read", { filePath: ".git/config" }), /Private Git|managed history/);
  await assert.rejects(check("read", { filePath: path.join(os.tmpdir(), "outside-secret") }), /Private Git|managed history/);
});
test("inspect-only project restricts regular agents but allows read-only skills", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "git-guard-inspect-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = path.join(root, ".state/webpage");
  await mkdir(state, { recursive: true });
  const settings = {
    projects: [{ id: "p", directory: root }],
    gitProjects: { p: { tracking: true, preset: "inspect" } },
  };
  await writeFile(path.join(state, "settings.json"), JSON.stringify(settings));
  await writeFile(
    path.join(state, "requests.json"),
    JSON.stringify({
      records: { user: { agent: { id: "engineer" }, workflow: { id: "build" } } },
    }),
  );
  const client = {
    session: {
      async messages() {
        return {
          data: [
            {
              info: { role: "assistant", parentID: "user" },
              parts: [{ type: "tool", callID: "call" }],
            },
          ],
        };
      },
    },
  };
  const check = (tool, args = {}) =>
    gitToolGuard({
      toolkitRoot: root,
      directory: root,
      input: { sessionID: "ses", callID: "call", tool },
      args,
      client,
    });
  await check("git_project");
  await check("read", { filePath: "README.md" });
  await check("skill", { name: "sync" });
  await check("content_index", { operation: "status" });
  await check("content_index", { operation: "rebuild" });
  await check("websearch", { query: "test" });
  await check("webfetch", { url: "https://example.com" });
  await check("task", { description: "x", prompt: "y" });
  // Inspect-only leeway: bounded helpers + shell inspection allowed;
  // code writes stay blocked.
  await check("delegate", { agentID: "researcher" });
  await check("bash", { command: "ls" });
  for (const tool of ["write", "edit"])
    await assert.rejects(check(tool), /inspect only|code writes/);
  // Shell git bypass still blocked via command pattern.
  await assert.rejects(check("bash", { command: "git status" }), /agreement/);
});
