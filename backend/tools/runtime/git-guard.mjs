import { readRuntimeText as readFile } from './state-database.mjs';

import path from "node:path";
import {
  classifyToolOperation,
  extractToolPaths,
  isInspectAllowed,
  isManagedGitCommand,
  isPathAllowedByScope,
  isProtectedPath,
  resolveFileAccessScope,
} from "./tool-operations.mjs";

// Project Git enforcement is intentionally independent from agent names.
// The saved GitHub agreement is authority; skills are guidance.
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
  const projects = Array.isArray(settings.projects) ? settings.projects : [];
  const p = projects.find((p) => same(p.directory, directory));

  // Actual private-state protection runs before any scope or tracking logic
  // and stays ahead of the tracking-off return below. Native
  // external-directory permissions govern other paths.
  if (["read", "write", "edit", "apply_patch", "lsp", "glob", "grep"].includes(input.tool)) {
    for (const file of extractToolPaths(input.tool, args ?? {})) {
      if (isProtectedPath(directory, file))
        throw Error("Use the GitHub panel or git_project for managed history. Private Git/application state is not a project source file.");
    }
  }

  // User-facing filesystem guard: authored fileAccessScope in saved settings.
  // 'project' allows only the current project directory, 'projects' allows
  // any registered settings.projects directory, 'computer' (default) keeps
  // the current capability-first behavior for non-private paths. Applies to
  // every named agent identically. Private state stays blocked above in every
  // scope; native external-directory permissions still apply and 'computer'
  // never permits credential/private state or bypasses authority.
  // Bash/custom-tool file effects are native-controlled, not sandboxed here.
  if (["read", "write", "edit", "apply_patch", "lsp", "glob", "grep"].includes(input.tool)) {
    const scope = resolveFileAccessScope(settings);
    if (scope !== "computer") {
      for (const file of extractToolPaths(input.tool, args ?? {})) {
        if (!isPathAllowedByScope(scope, { directory, projects, filePath: file })) {
          const label =
            scope === "project" ? "Files in this project" : "Files in all projects";
          const where =
            scope === "project"
              ? "this project folder"
              : "a registered project folder";
          throw Error(
            `Files are limited to ${where} (${label}). Change the file access scope in settings to allow files elsewhere. Private Git/application state stays blocked in every scope and native permissions still apply.`,
          );
        }
      }
    }
  }

  if (!p) return;
  const agreement = settings.gitProjects?.[p.id];

  // The inspect preset is a Git-history agreement, not a project-wide
  // read-only assignment. Enforce it only on managed Git mutations;
  // captured readOnly execution policy and native permissions govern other
  // tool operations. Shell Git bypass is blocked separately below.
  const isInspectOnly = agreement?.tracking && agreement.preset === "inspect";
  if (isInspectOnly && input.tool === "git_project" && !isInspectAllowed(input.tool, args ?? {})) {
    const kind = classifyToolOperation(input.tool, args ?? {});
    throw Error(
      `This project's saved GitHub agreement is inspect only, so managed Git history changes are blocked (${input.tool}:${kind}). Use git_project request to ask the user to change the agreement.`,
    );
  }

  const text = String(args.command ?? "");
  if (isManagedGitCommand(text))
    throw Error(
      "Use git_project or the GitHub panel so the saved project agreement is enforced.",
    );

  if (!agreement?.tracking) return;

}
