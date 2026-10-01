// Shared operation classifier and path extraction for application guards.
// Pure helpers: no filesystem access. git-guard.mjs enforces policy; tests
// assert both classification and protected-path boundaries here.
// Native shell permissions remain authoritative. This module never parses
// shell command lines for file effects; bash is classified as shell and the
// guard only blocks the managed-Git bypass pattern.

// Known nonmutating native LSP operations (experimental lsp tool).
// Source: OpenCode lsp tool operations list. Any other operation is unknown
// and stays denied in inspect-only assignments.
export const NONMUTATING_LSP_OPERATIONS = new Set([
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
]);

// content_index operations that are retrieval or index maintenance.
// Rebuild only refreshes derived search data; it never edits project sources.
const CONTENT_INDEX_READ_OPERATIONS = new Set([
  "status",
  "search",
  "chats",
  "sources",
  "unit",
  "facts",
  "meta",
  "rebuild",
]);

// git_project operations that never change history or the saved agreement.
const GIT_PROJECT_READ_ACTIONS = new Set(["inspect", "preview"]);

// Tools that are always retrieval/dispatch and never edit project sources.
// todowrite/todoread track session todos, question asks the user,
// goal_checkpoint records goal state, skill loads instructions,
// delegate/task dispatch bounded work (delegation enforces its own readOnly).
const ALWAYS_READ_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "list",
  "webfetch",
  "websearch",
  "skill",
  "question",
  "todoread",
  "todowrite",
  "goal_checkpoint",
  "delegate",
  "task",
]);

// Tools that always mutate project sources when they succeed.
const ALWAYS_WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);

export function isManagedGitCommand(command) {
  return /\b(?:git|gh)(?:\.exe)?(?:\s|["'])/i.test(String(command ?? ""));
}

function cleanPath(value) {
  if (typeof value !== "string") return undefined;
  let text = value.trim();
  if (!text) return undefined;
  // Strip file:// URIs used by some LSP clients.
  if (/^file:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      text = decodeURIComponent(url.pathname);
      // file:///C:/... -> C:/...
      if (/^\/[A-Za-z]:\//.test(text)) text = text.slice(1);
    } catch {
      text = text.replace(/^file:\/\//i, "");
    }
  }
  // Strip surrounding quotes from patch headers.
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  return text || undefined;
}

// Parse Codex-style apply_patch envelope paths.
// Headers: *** Add File: <path>, *** Update File: <path>,
// *** Delete File: <path>, *** Move to: <newPath> (rename destination for
// the preceding Update). Returns every mentioned source and destination path.
export function parseApplyPatchPaths(patchText) {
  if (typeof patchText !== "string" || !patchText) return [];
  const paths = [];
  const lines = patchText.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    let match =
      /^\*\*\*\s+(?:Add File|Update File|Delete File)\s*:\s*(.+?)\s*$/.exec(trimmed);
    if (match) {
      const cleaned = cleanPath(match[1]);
      if (cleaned) paths.push(cleaned);
      continue;
    }
    match = /^\*\*\*\s+Move to\s*:\s*(.+?)\s*$/.exec(trimmed);
    if (match) {
      const cleaned = cleanPath(match[1]);
      if (cleaned) paths.push(cleaned);
      continue;
    }
    // Best-effort Move/Rename single-line variant:
    // *** Move File: <old> to <new> / *** Rename File: <old> to <new>
    match = /^\*\*\*\s+(?:Move|Rename)(?:\s+File)?\s*:\s*(.+?)\s+to\s+(.+?)\s*$/.exec(trimmed);
    if (match) {
      for (const part of [match[1], match[2]]) {
        const cleaned = cleanPath(part);
        if (cleaned) paths.push(cleaned);
      }
    }
  }
  return paths;
}

function patchPathsFromStructured(patch) {
  const paths = [];
  if (!Array.isArray(patch)) return paths;
  for (const entry of patch) {
    if (!entry || typeof entry !== "object") continue;
    for (const key of ["path", "file", "filePath", "filename", "resource"]) {
      const cleaned = cleanPath(entry[key]);
      if (cleaned) paths.push(cleaned);
    }
    // Move/rename destination aliases.
    for (const key of ["newPath", "to", "destination", "target", "newFile", "moveTo"]) {
      const cleaned = cleanPath(entry[key]);
      if (cleaned) paths.push(cleaned);
    }
  }
  return paths;
}

// Extract candidate project file paths targeted by a tool call.
// Used for protected/private (.git/.state) and external-path checks.
// Returns [] when the tool carries no file target (shell, search, dispatch).
export function extractToolPaths(tool, args = {}) {
  const input = args ?? {};
  if (tool === "apply_patch") {
    const paths = [];
    const texts = [];
    if (typeof input.patchText === "string" && input.patchText) texts.push(input.patchText);
    // Accept common aliases without endorsing a second schema.
    if (typeof input.patch === "string" && input.patch) texts.push(input.patch);
    if (typeof input.patch_text === "string" && input.patch_text) texts.push(input.patch_text);
    for (const text of texts) {
      for (const p of parseApplyPatchPaths(text)) paths.push(p);
    }
    if (Array.isArray(input.patch)) {
      for (const p of patchPathsFromStructured(input.patch)) paths.push(p);
    }
    if (Array.isArray(input.patches)) {
      for (const p of patchPathsFromStructured(input.patches)) paths.push(p);
    }
    if (Array.isArray(input.files)) {
      for (const entry of input.files) {
        if (typeof entry === "string") {
          const cleaned = cleanPath(entry);
          if (cleaned) paths.push(cleaned);
        } else if (entry && typeof entry === "object") {
          for (const p of patchPathsFromStructured([entry])) paths.push(p);
        }
      }
    }
    // Fallback single-file aliases if no envelope paths were found.
    if (paths.length === 0) {
      for (const key of ["filePath", "path", "file", "filename"]) {
        const cleaned = cleanPath(input[key]);
        if (cleaned) paths.push(cleaned);
      }
    }
    return paths;
  }
  if (["write", "edit", "read", "glob", "grep"].includes(tool)) {
    for (const key of ["filePath", "path", "file", "filename"]) {
      const cleaned = cleanPath(input[key]);
      if (cleaned) return [cleaned];
    }
    return [];
  }
  if (tool === "lsp") {
    for (const key of ["file", "filePath", "path", "filename", "uri"]) {
      const cleaned = cleanPath(input[key]);
      if (cleaned) return [cleaned];
    }
    return [];
  }
  return [];
}

// Operation-aware classification for inspect-only enforcement.
// Returns "read" (known nonmutating), "write" (known mutating),
// "shell" (native permissions govern; guard only blocks Git bypass), or
// "unknown" (deny in inspect-only; never allow arbitrary mutating tools).
export function classifyToolOperation(tool, args = {}) {
  const input = args ?? {};
  if (tool === "bash") return "shell";
  if (ALWAYS_WRITE_TOOLS.has(tool)) return "write";
  if (ALWAYS_READ_TOOLS.has(tool)) return "read";
  if (tool === "content_index") {
    return CONTENT_INDEX_READ_OPERATIONS.has(input.operation) ? "read" : "unknown";
  }
  if (tool === "git_project") {
    if (GIT_PROJECT_READ_ACTIONS.has(input.action)) return "read";
    // The initial request only previews an exception and returns a native
    // question. Executing an approved plan is a separate, permissioned call.
    if (input.action === "request" && !input.planID) return "read";
    // Missing/unknown actions stay denied; a bare call carries no proven
    // nonmutating operation and execute/merge/request/prepare mutate history.
    return "unknown";
  }
  if (tool === "lsp") {
    return NONMUTATING_LSP_OPERATIONS.has(input.operation) ? "read" : "unknown";
  }
  return "unknown";
}

// Inspect-only allowlist replacement: permit only known nonmutating
// operations plus shell inspection (Git bypass still blocked separately).
// Unknown tools and unknown operations stay denied.
export function isInspectAllowed(tool, args = {}) {
  const kind = classifyToolOperation(tool, args);
  return kind === "read" || kind === "shell";
}

import path from "node:path";

// Protect actual Git/application state. External directories and references
// remain subject to native permissions, not a competing workspace sandbox.
export function isProtectedPath(directory, filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return false;
  const rel = path
    .relative(directory, path.resolve(directory, filePath))
    .replaceAll("\\", "/");
  return /(?:^|\/)(?:\.git|\.state)(?:\/|$)/i.test(rel);
}

// Authored file-access scopes for the user-facing filesystem guard.
// Persisted as top-level `fileAccessScope` in saved settings; the guard
// resolves it per request. 'computer' (default) preserves the current
// capability-first external-native-boundary behavior. Every scope still
// blocks protected private state first and never bypasses native
// external-directory permissions or credential/private-state authority.
// Bash/custom-tool file effects are native-controlled and are not claimed
// as sandboxed here; only the extracted file-target tools above are scoped.
export const FILE_ACCESS_SCOPES = Object.freeze(["project", "projects", "computer"]);

export function resolveFileAccessScope(settings) {
  const value = settings?.fileAccessScope;
  return FILE_ACCESS_SCOPES.includes(value) ? value : "computer";
}

// Canonical containment: resolved absolute target must equal the root or
// sit beneath it. Case-insensitive on Windows; separator-normalized so
// `C:\proj\file`, `c:/proj/file` and `C:/PROJ/../proj/file` compare equally.
// Symlinks/aliases are not resolved here; native permissions govern them.
export function isWithinDirectory(directory, filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) return false;
  if (typeof directory !== "string" || !directory.trim()) return false;
  const sameRoot = (a, b) =>
    process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  let root;
  let target;
  try {
    root = path.resolve(directory);
    target = path.resolve(directory, filePath);
  } catch {
    return false;
  }
  if (sameRoot(root, target)) return true;
  const rel = path.relative(root, target);
  if (!rel || rel === "." ) return true;
  // Absolute or UNC escape (different drive/root) is outside.
  if (path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  if (parts[0] === "..") return false;
  return true;
}

export function isPathAllowedByScope(scope, { directory, projects = [], filePath } = {}) {
  if (scope === "computer" || scope === undefined || scope === null) return true;
  if (scope === "project") return isWithinDirectory(directory, filePath);
  if (scope === "projects") {
    const roots = Array.isArray(projects)
      ? projects.map((p) => (typeof p === "string" ? p : p?.directory)).filter(Boolean)
      : [];
    // The current directory is always an allowed root even before registration.
    if (isWithinDirectory(directory, filePath)) return true;
    return roots.some((root) => isWithinDirectory(root, filePath));
  }
  // Unknown scope values fail open to current behavior; UI normalization
  // (domain/workspace.mjs) rejects them at save time.
  return true;
}
