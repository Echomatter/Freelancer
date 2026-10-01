import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { gitToolGuard } from "../backend/tools/runtime/git-guard.mjs";
import {
  isPathAllowedByScope,
  isWithinDirectory,
  resolveFileAccessScope,
} from "../backend/tools/runtime/tool-operations.mjs";
import {
  fileAccessScopeText,
  normalizeFileAccessScope,
} from "../domain/workspace.mjs";

// Fixture: toolkit root holds .state/webpage/settings.json; projA is the
// current project directory, projB a second registered project, external an
// unrelated temp directory outside both.
async function scopeFixture(t, { scope, preset = "review", tracking = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "file-scope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projA = path.join(root, "projA");
  const projB = path.join(root, "projB");
  const external = await mkdtemp(path.join(os.tmpdir(), "file-scope-ext-"));
  t.after(() => rm(external, { recursive: true, force: true }));
  await mkdir(path.join(projA, "src"), { recursive: true });
  await mkdir(path.join(projB, "src"), { recursive: true });
  await mkdir(path.join(root, ".state", "webpage"), { recursive: true });
  const settings = {
    projects: [
      { id: "a", directory: projA },
      { id: "b", directory: projB },
    ],
    gitProjects: { a: { tracking, preset }, b: { tracking, preset } },
    ...(scope === undefined ? {} : { fileAccessScope: scope }),
  };
  await writeFile(
    path.join(root, ".state", "webpage", "settings.json"),
    JSON.stringify(settings),
  );
  const check = (tool, args = {}, directory = projA) =>
    gitToolGuard({
      toolkitRoot: root,
      directory,
      input: { sessionID: "ses", callID: "call", tool },
      args,
    });
  return { root, projA, projB, external, check };
}

test("fileAccessScope normalization defaults to computer and rejects unknown", () => {
  assert.equal(normalizeFileAccessScope(undefined), "computer");
  assert.equal(normalizeFileAccessScope(null), "computer");
  assert.equal(normalizeFileAccessScope(""), "computer");
  assert.equal(normalizeFileAccessScope("project"), "project");
  assert.equal(normalizeFileAccessScope("projects"), "projects");
  assert.equal(normalizeFileAccessScope("computer"), "computer");
  assert.throws(() => normalizeFileAccessScope("sandbox"), /which files/);
  assert.equal(fileAccessScopeText("project"), "Files in this project");
  assert.equal(fileAccessScopeText("projects"), "Files in all projects");
  assert.equal(fileAccessScopeText("computer"), "Files on my computer");
  assert.equal(resolveFileAccessScope({}), "computer");
  assert.equal(resolveFileAccessScope({ fileAccessScope: "project" }), "project");
  // Unknown persisted values fail open to current behavior; the save-time
  // normalization above is what rejects them.
  assert.equal(resolveFileAccessScope({ fileAccessScope: "sandbox" }), "computer");
});

test("computer scope (and missing scope) keeps capability-first behavior", async (t) => {
  for (const scope of ["computer", undefined]) {
    const { external, check } = await scopeFixture(t, { scope });
    await check("read", { filePath: "src/in.js" });
    await check("write", { filePath: "src/new.js" });
    await check("edit", { path: "src/in.js" });
    await check("read", { filePath: path.join(external, "reference.md") });
    await check("write", { filePath: path.join(external, "note.js") });
    await assert.rejects(
      check("read", { filePath: ".git/config" }),
      /Private Git|managed history/,
    );
    await assert.rejects(
      check("write", { filePath: ".state/evil.js" }),
      /Private Git|managed history/,
    );
  }
});

test("project scope contains to the current project directory", async (t) => {
  const { projA, projB, external, check } = await scopeFixture(t, { scope: "project" });
  await check("read", { filePath: "src/in.js" });
  await check("write", { filePath: "src/new.js" });
  await check("edit", { path: "src/in.js" });
  await check("glob", { path: "src" });
  await check("grep", { path: "src" });
  await check("read", { filePath: path.join(projA, "src", "abs.js") });
  // Path aliases share the same containment.
  await check("edit", { file: "src/alias.js" });
  await check("read", { filename: "src/alias.js" });
  // Normalized `.`/`..` staying inside is still inside.
  await check("read", { filePath: "src/../src/in.js" });
  // Sibling project, external directory and `..` escapes are outside.
  await assert.rejects(
    check("read", { filePath: path.join(projB, "src", "other.js") }),
    /limited to this project folder \(Files in this project\)/,
  );
  await assert.rejects(check("glob", { path: projB }), /limited to this project folder/);
  await assert.rejects(check("grep", { path: external }), /limited to this project folder/);
  await assert.rejects(
    check("write", { filePath: path.join(external, "note.js") }),
    /limited to this project folder/,
  );
  await assert.rejects(check("edit", { filePath: "../escape.js" }), /limited to/);
  await assert.rejects(
    check("write", { filePath: path.join(projA, "..", "projB", "src", "x.js") }),
    /limited to/,
  );
});

test("projects scope allows every registered project but nothing else", async (t) => {
  const { projA, projB, external, check } = await scopeFixture(t, { scope: "projects" });
  await check("write", { filePath: "src/new.js" });
  await check("read", { filePath: path.join(projA, "src", "a.js") });
  await check("edit", { filePath: path.join(projB, "src", "b.js") });
  await check("glob", { path: projB });
  await check("grep", { path: path.join(projB, "src") });
  await assert.rejects(
    check("read", { filePath: path.join(external, "reference.md") }),
    /limited to a registered project folder \(Files in all projects\)/,
  );
  await assert.rejects(check("write", { filePath: "../escape.js" }), /limited to/);
});

test("scope covers apply_patch shapes, moves and structured aliases", async (t) => {
  const { projB, external, check } = await scopeFixture(t, { scope: "project" });
  const inside = "*** Begin Patch\n*** Add File: src/added.js\n+hi\n*** End Patch";
  await check("apply_patch", { patchText: inside });
  // `patch` alias carries the same envelope.
  await check("apply_patch", { patch: inside });
  await check("apply_patch", {
    patch: [{ type: "Add", path: "src/a.js" }],
  });
  // Move destination outside is blocked even when the source is inside.
  const moveOut =
    "*** Begin Patch\n*** Update File: src/ok.js\n*** Move to: ../outside.js\n@@\n-a\n+b\n*** End Patch";
  await assert.rejects(check("apply_patch", { patchText: moveOut }), /limited to/);
  // Structured move aliases are covered on both ends.
  await assert.rejects(
    check("apply_patch", {
      patch: [{ type: "Move", path: "src/d.js", newPath: path.join(projB, "e.js") }],
    }),
    /limited to/,
  );
  await assert.rejects(
    check("apply_patch", {
      patchText: `*** Begin Patch\n*** Add File: ${path.join(external, "x.js")}\n+hi\n*** End Patch`,
    }),
    /limited to/,
  );
  // LSP file targets are scoped like the other file tools.
  await check("lsp", { operation: "hover", file: "src/in.js" });
  await assert.rejects(
    check("lsp", { operation: "hover", file: path.join(external, "x.js") }),
    /limited to/,
  );
});

test("private Git/application state stays blocked in every scope", async (t) => {
  for (const scope of ["project", "projects", "computer", undefined]) {
    const { check } = await scopeFixture(t, { scope });
    await assert.rejects(
      check("read", { filePath: ".git/config" }),
      /Private Git|managed history/,
    );
    await assert.rejects(check("glob", { path: ".git" }), /Private Git|managed history/);
    await assert.rejects(check("grep", { path: "../other/.state" }), /Private Git|managed history/);
    await assert.rejects(
      check("write", { filePath: ".state/evil.js" }),
      /Private Git|managed history/,
    );
    await assert.rejects(
      check("edit", { filePath: "../other/.state/settings.json" }),
      /Private Git|managed history/,
    );
    // Private state wins over the scope message even for outside paths.
    await assert.rejects(
      check("apply_patch", {
        patchText: "*** Begin Patch\n*** Add File: .state/moved.js\n+hi\n*** End Patch",
      }),
      /Private Git|managed history/,
    );
  }
});

test("canonical containment handles separators, case and escapes", async (t) => {
  const { projA, external } = await scopeFixture(t, { scope: "project" });
  void external;
  assert.equal(isWithinDirectory(projA, "src/a.js"), true);
  assert.equal(isWithinDirectory(projA, path.join(projA, "src", "a.js")), true);
  assert.equal(isWithinDirectory(projA, projA), true);
  // Backslash separators resolve to the same target.
  assert.equal(
    isWithinDirectory(projA, projA.replaceAll(path.sep, "\\") + "\\src\\a.js"),
    true,
  );
  assert.equal(isWithinDirectory(projA, "src/../src/a.js"), true);
  assert.equal(isWithinDirectory(projA, "../escape.js"), false);
  assert.equal(isWithinDirectory(projA, path.join(projA, "..", "other.js")), false);
  // Absolute sibling roots are outside.
  const sibling = path.join(path.dirname(projA), "projB", "x.js");
  assert.equal(isWithinDirectory(projA, sibling), false);
  if (process.platform === "win32") {
    // Windows containment is case-insensitive.
    assert.equal(
      isWithinDirectory(projA.toLowerCase(), projA.toUpperCase() + "\\src\\a.js"),
      true,
    );
    assert.equal(isPathAllowedByScope("project", {
      directory: projA,
      filePath: projA.toUpperCase() + "\\SRC\\A.JS",
    }), true);
  }
  // Empty or missing roots never contain.
  assert.equal(isWithinDirectory("", "src/a.js"), false);
  assert.equal(isWithinDirectory(projA, ""), false);
});

test("scope combines with the readonly agreement without bypass", async (t) => {
  const { external, check } = await scopeFixture(t, {
    scope: "project",
    preset: "inspect",
  });
  // Out-of-scope writes report the scope first.
  await assert.rejects(
    check("write", { filePath: path.join(external, "x.js") }),
    /limited to this project folder/,
  );
  // In-scope writes are still blocked by the inspect-only agreement.
  await assert.rejects(check("write", { filePath: "src/x.js" }), /inspect only/);
  await assert.rejects(
    check("apply_patch", { patchText: "*** Begin Patch\n*** Add File: src/x.js\n+hi\n*** End Patch" }),
    /inspect only/,
  );
  // In-scope reads stay allowed; protected reads stay blocked as managed history.
  await check("read", { filePath: "src/x.js" });
  await assert.rejects(
    check("read", { filePath: ".state/webpage/settings.json" }),
    /Private Git|managed history/,
  );
  // Raw Git still routes through git_project in every scope.
  await assert.rejects(check("bash", { command: "git status" }), /agreement/);
});
