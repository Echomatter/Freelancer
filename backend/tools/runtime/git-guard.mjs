import { readFile } from "node:fs/promises";
import path from "node:path";

// Project Git enforcement is intentionally independent from agent/workflow names.
// The saved GitHub agreement is authority; workflows and skills are guidance.
export async function gitToolGuard({
  toolkitRoot,
  directory,
  input,
  args,
}) {
  let settings;
  try {
    settings = JSON.parse(
      await readFile(
        path.join(toolkitRoot, ".state/webpage/settings.json"),
        "utf8",
      ),
    );
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw Error("Project Git policy cannot be read. No tool was run.");
  }
  const same = (a, b) =>
    process.platform === "win32"
      ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
      : path.resolve(a) === path.resolve(b);
  const p = settings.projects.find((p) => same(p.directory, directory));
  if (!p) return;
  const agreement = settings.gitProjects?.[p.id];

  const readers = new Set([
    "git_project",
    "skill",
    "read",
    "glob",
    "grep",
    "list",
    "question",
    "todoread",
    "todowrite",
    "task",
    "delegate",
    "content_index",
    "websearch",
    "webfetch",
    "bash",
  ]);
  const isInspectOnly = agreement?.tracking && agreement.preset === "inspect";
  if (isInspectOnly && !readers.has(input.tool))
    throw Error(
      "This project's saved GitHub agreement is inspect only, so source writes are blocked. Read, search, delegate inspection, or change the agreement in the GitHub panel.",
    );

  if (!agreement?.tracking) return;
  const text = String(args.command ?? "");
  if (/\b(?:git|gh)(?:\.exe)?(?:\s|["'])/i.test(text))
    throw Error(
      "Use git_project or the GitHub panel so the saved project agreement is enforced.",
    );

  if (["read", "write", "edit"].includes(input.tool)) {
    const file = String(args.filePath ?? args.path ?? "");
    const rel = path
      .relative(directory, path.resolve(directory, file))
      .replaceAll("\\", "/");
    if (
      rel === ".." ||
      rel.startsWith("../") ||
      path.isAbsolute(rel) ||
      /(?:^|\/)(?:\.git|\.state)(?:\/|$)/i.test(rel)
    )
      throw Error(
        "Use the GitHub panel or git_project for managed history. Private Git/application state is not a project source file.",
      );
  }
}
