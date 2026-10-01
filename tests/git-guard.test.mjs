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
  return { root, check };
}

test("tracked projects allow normal tools while raw Git remains application-owned", async (t) => {
  const { root, check } = await trackedFixture(t, "review");
  for (const tool of ["git_project", "skill", "delegate", "write", "edit", "content_index", "websearch", "task"])
    await check(tool, tool === "write" || tool === "edit" ? { filePath: "src/example.js" } : {});
  await check("bash", { command: "node --version" });
  await assert.rejects(check("bash", { command: "git status" }), /agreement|git_project/);
  await assert.rejects(check("read", { filePath: ".git/config" }), /Private Git|managed history/);
  await check("read", { filePath: path.join(os.tmpdir(), "reference.md") });
  void root;
});

test("file guards cover edit/write path aliases and protected boundaries", async (t) => {
  const { root, check } = await trackedFixture(t, "review");
  // Normal relative paths pass through both filePath and path aliases.
  await check("edit", { filePath: "src/example.js" });
  await check("edit", { path: "src/example.js" });
  await check("write", { filePath: "src/new.js" });
  await check("write", { path: "src/new.js" });
  // Protected private state is blocked regardless of alias or case.
  await assert.rejects(check("edit", { filePath: ".state/webpage/settings.json" }), /Private Git|managed history/);
  await assert.rejects(check("write", { path: ".GIT/config" }), /Private Git|managed history/);
  await assert.rejects(check("read", { filePath: ".git/HEAD" }), /Private Git|managed history/);
  // External source/reference paths remain subject to native permissions.
  await check("write", { filePath: path.join(os.tmpdir(), "approved-temp.js") });
  await check("edit", { filePath: "../reference/example.js" });
  await assert.rejects(check("edit", { filePath: "../reference/.git/config" }), /Private Git|managed history/);
  void root;
});

test("apply_patch shapes protect private state and preserve native external-directory authority", async (t) => {
  const { root, check } = await trackedFixture(t, "review");
  const add = "*** Begin Patch\n*** Add File: src/added.js\n+hello\n*** End Patch";
  const update = "*** Begin Patch\n*** Update File: src/example.js\n@@\n-old\n+new\n*** End Patch";
  const move =
    "*** Begin Patch\n*** Update File: src/old.js\n*** Move to: src/new.js\n@@\n-old\n+new\n*** End Patch";
  await check("apply_patch", { patchText: add });
  await check("apply_patch", { patchText: update });
  await check("apply_patch", { patchText: move });
  // patch alias carries the same envelope.
  await check("apply_patch", { patch: add });
  // Structured patch entries cover Add/Update/Delete/Move path fields.
  await check("apply_patch", {
    patch: [
      { type: "Add", path: "src/a.js" },
      { type: "Update", path: "src/b.js" },
      { type: "Delete", path: "src/c.js" },
      { type: "Move", path: "src/d.js", newPath: "src/e.js" },
    ],
  });
  // Protected targets are blocked in every shape, including external state.
  const evilState = "*** Begin Patch\n*** Add File: .state/evil.js\n+hi\n*** End Patch";
  const evilGit = "*** Begin Patch\n*** Update File: .git/hooks/x\n@@\n-a\n+b\n*** End Patch";
  const evilMove =
    "*** Begin Patch\n*** Update File: src/ok.js\n*** Move to: .state/moved.js\n@@\n-a\n+b\n*** End Patch";
  await assert.rejects(check("apply_patch", { patchText: evilState }), /Private Git|managed history/);
  await assert.rejects(check("apply_patch", { patchText: evilGit }), /Private Git|managed history/);
  await assert.rejects(check("apply_patch", { patchText: evilMove }), /Private Git|managed history/);
  await assert.rejects(check("apply_patch", { patch: evilState }), /Private Git|managed history/);
  await assert.rejects(
    check("apply_patch", { patch: [{ type: "Add", path: ".state/x.js" }] }),
    /Private Git|managed history/,
  );
  await check("apply_patch", {
    patchText: `*** Begin Patch\n*** Add File: ${path.join(os.tmpdir(), "approved-temp.js")}\n+hi\n*** End Patch`,
  });
  await assert.rejects(check("apply_patch", { patchText: '*** Begin Patch\n*** Delete File: ../other/.state/settings.json\n*** End Patch' }), /Private Git|managed history/);
  void root;
});

test('private state stays protected with project history disabled', async t => {
  const { check } = await trackedFixture(t, 'review', false);
  await check('write', { filePath: 'src/example.js' });
  await assert.rejects(check('write', { filePath: '.state/webpage/settings.json' }), /Private Git/);
  await assert.rejects(check('apply_patch', { patchText: '*** Begin Patch\n*** Delete File: .git/config\n*** End Patch' }), /Private Git/);
  await assert.rejects(check('bash', { command: 'git push' }), /git_project/);
  await check('git_project', { action: 'inspect' });
});

test("parser and classifier integration API behaves for helper consumers", async () => {
  assert.deepEqual(parseApplyPatchPaths("*** Begin Patch\n*** Add File: a.js\n*** End Patch"), ["a.js"]);
  assert.deepEqual(
    parseApplyPatchPaths("*** Begin Patch\n*** Update File: o.js\n*** Move to: n.js\n*** End Patch"),
    ["o.js", "n.js"],
  );
  assert.deepEqual(extractToolPaths("edit", { path: "src/x.js" }), ["src/x.js"]);
  assert.deepEqual(extractToolPaths("apply_patch", { patch: [{ type: "Move", path: "a", newPath: "b" }] }), [
    "a",
    "b",
  ]);
  assert.equal(classifyToolOperation("edit", {}), "write");
  assert.equal(classifyToolOperation("apply_patch", { patchText: "x" }), "write");
  assert.equal(classifyToolOperation("lsp", { operation: "hover" }), "read");
  assert.equal(classifyToolOperation("lsp", { operation: "rename" }), "unknown");
  assert.equal(classifyToolOperation("content_index", { operation: "rebuild" }), "read");
  assert.equal(classifyToolOperation("content_index", { operation: "nuke" }), "unknown");
  assert.equal(classifyToolOperation("git_project", { action: "inspect" }), "read");
  assert.equal(classifyToolOperation("git_project", { action: "execute" }), "unknown");
  assert.equal(classifyToolOperation("unknown_mutator", {}), "unknown");
  assert.equal(isInspectAllowed("lsp", { operation: "hover" }), true);
  assert.equal(isInspectAllowed("unknown_mutator", {}), false);
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
      records: { user: { agent: { id: "engineer" }, mode: "build" } },
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
  await check("git_project", { action: "inspect" });
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
  // Shell is not a filesystem sandbox: the guard does not parse redirects;
  // native permissions and instructions govern shell writes.
  await check("bash", { command: "echo hi > src/note.txt" });
  for (const tool of ["write", "edit"])
    await assert.rejects(check(tool), /inspect only|code writes/);
  // Shell git bypass still blocked via command pattern.
  await assert.rejects(check("bash", { command: "git status" }), /agreement/);
});

test("inspect-only uses operation-aware classification without brittle names", async (t) => {
  const { check } = await trackedFixture(t, "inspect");
  // Known nonmutating native LSP operations are permitted.
  for (const operation of ["goToDefinition", "findReferences", "hover", "documentSymbol", "workspaceSymbol"]) {
    await check("lsp", { operation, file: "src/example.js" });
  }
  await check("lsp", { operation: "goToImplementation", file: "src/example.js" });
  // Unknown LSP operations and unknown tools stay denied.
  await assert.rejects(check("lsp", { operation: "rename" }), /inspect only/);
  await assert.rejects(check("lsp", {}), /inspect only/);
  await assert.rejects(check("unknown_mutator", {}), /inspect only/);
  // Operation-aware content_index and git_project boundaries.
  await check("content_index", { operation: "search" });
  await assert.rejects(check("content_index", { operation: "nuke-everything" }), /inspect only/);
  await check("git_project", { action: "preview" });
  await check("git_project", { action: "request", reason: "Ask to change inspection agreement" });
  await assert.rejects(check("git_project", { action: "request", planID: "approved-plan" }), /inspect only/);
  for (const action of ["execute", "prepare", "merge"]) {
    await assert.rejects(check("git_project", { action }), /inspect only/);
  }
  await assert.rejects(check("git_project", {}), /inspect only/);
  // apply_patch shapes are writes: blocked in inspect even for normal paths.
  await assert.rejects(
    check("apply_patch", { patchText: "*** Begin Patch\n*** Add File: src/x.js\n+hi\n*** End Patch" }),
    /inspect only/,
  );
  await assert.rejects(check("apply_patch", { patch: [{ type: "Add", path: "src/x.js" }] }), /inspect only/);
  // Protected reads stay blocked with the managed-history message.
  await assert.rejects(check("read", { filePath: ".state/webpage/settings.json" }), /Private Git|managed history/);
});
