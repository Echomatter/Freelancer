// Application-owned agreement. Editable agent/workflow prose is not authority.
export const gitPresets = Object.freeze([
  {
    id: "main",
    name: "Work directly on the main version",
    description:
      "Save locally on the main version. Sync uploads it without rewriting history.",
  },
  {
    id: "branch",
    name: "Keep each task separate",
    description:
      "Build on a task branch. Sync uploads that task and leaves the main version alone.",
  },
  {
    id: "review",
    name: "Prepare changes for review",
    description:
      "Upload the task and open a review request. Never add it to the main version automatically.",
  },
  {
    id: "confirm",
    name: "Show me before sharing anything",
    description: "Work separately. Every upload needs approval in this panel.",
  },
  {
    id: "inspect",
    name: "Inspect only",
    description:
      "Explain the project without saving checkpoints, switching branches or uploading.",
  },
]);
export const gitDefaults = Object.freeze({ preset: "review" });
export function projectAgreement(value = {}, defaults = gitDefaults) {
  const preset = value.preset ?? defaults.preset ?? "review";
  if (!gitPresets.some((p) => p.id === preset))
    throw Error("Choose how this project should be handled.");
  for (const field of ["tracking", "github"])
    if (value[field] !== undefined && typeof value[field] !== "boolean")
      throw Error("Choose a valid project setting.");
  return {
    version: 1,
    revision: value.revision ?? 0,
    tracking: value.tracking ?? false,
    github: value.github ?? false,
    preset,
    mainBranch: value.mainBranch ?? "",
    root: value.root ?? null,
    repository: value.repository ?? null,
    tasks: value.tasks ?? {},
  };
}
export function agreementText(p) {
  if (!p.tracking)
    return "Project history automation is off. Existing history stays on this computer.";
  if (p.preset === "inspect")
    return "Inspect this project only. Do not save checkpoints, change branches or upload.";
  const work =
    p.preset === "main"
      ? "Save my work locally on the main version."
      : "Keep each task separate and save my work locally.";
  if (!p.github) return `${work} Do not upload to GitHub.`;
  if (p.preset === "main")
    return `${work} Upload the main version when I sync. Never rewrite its history.`;
  if (p.preset === "confirm")
    return `${work} Show me each upload for approval. Do not change the main version.`;
  if (p.preset === "review")
    return `${work} Sync uploads the task and prepares a review request. Do not merge it.`;
  return `${work} Upload the task when I sync. Do not change the main version.`;
}
export function repositoryName(input) {
  if (typeof input !== "string")
    throw Error("Enter a GitHub project as account/project.");
  const value = input
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(value) ||
    value.split("/").some((x) => x === "." || x === "..")
  )
    throw Error(
      "Enter a GitHub project as account/project, not a command or another website.",
    );
  return value;
}
export function remoteName(input) {
  if (typeof input !== "string") return null;
  try {
    return repositoryName(input.replace(/^git@github\.com:/i, ""));
  } catch {
    return null;
  }
}
export function validBranch(value) {
  if (
    typeof value !== "string" ||
    value.length > 180 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    /\.\.|\/\/|\/$|\.$|\.lock(?:\/|$)|(?:^|\/)\./.test(value)
  )
    throw Error(
      "Choose an ordinary branch name without spaces or special characters.",
    );
  return value;
}
export function safeRelative(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1000 ||
    /^[\\/]/.test(value) ||
    /[\x00-\x1f\x7f\\:]/.test(value) ||
    value.split("/").some((x) => !x || x === ".." || x === ".")
  )
    throw Error("Choose an ordinary file inside the selected project.");
  return value;
}
export function excludedFile(file) {
  const p = file.toLowerCase();
  if (p === ".opencode/freelancer.json")
    return "Freelancer project binding state";
  if (
    /(^|\/)(\.git|\.state|node_modules|target|dist|\.venv|venv|\.runtime|\.next)(\/|$)/.test(
      p,
    )
  )
    return "Private state or generated files";
  if (
    /(^|\/)(\.env(?:\..*)?|credentials(?:\.[^/]*)?|auth\.json|id_rsa|id_ed25519|\.npmrc|\.netrc|hosts\.yml)$/.test(
      p,
    ) &&
    !/\.env\.(example|sample|template)$/.test(p)
  )
    return "May contain credentials";
  if (/\.(pem|p12|pfx|key)$/.test(p)) return "Private key material";
  return null;
}
export function containsCredential(buffer) {
  const text = Buffer.isBuffer(buffer)
    ? buffer.toString("utf8")
    : String(buffer);
  return /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bAKIA[0-9A-Z]{16}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/.test(
    text,
  );
}
export function parseGitStatus(raw) {
  const fields = raw.split("\0"),
    rows = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ")
      throw Error("Git returned an unreadable file list.");
    const status = record.slice(0, 2),
      file = record.slice(3);
    const original = /[RC]/.test(status) ? fields[++i] : undefined;
    if (original === "") throw Error("Git returned an unreadable rename.");
    rows.push({
      file,
      status,
      ...(original ? { original } : {}),
      excluded: excludedFile(file),
      partial: status !== "??" && status[0] !== " " && status[1] !== " ",
      conflicted: status.includes("U") || status === "AA" || status === "DD",
    });
  }
  return rows;
}
export function gitExecutionContract(p) {
  return `Project history agreement (application-owned): ${agreementText(p)}\nUse git_project for Git/GitHub operations. The saved agreement, exact preview and native permissions are authoritative, not editable workflow instructions. Never invoke git/gh or publish through another tool. Do not stage other people's work, rewrite history, delete branches or change repository visibility. Branch merges are allowed only through git_project when the user explicitly asks and confirms the exact source and target branches. Inspect-only prevents implementation. Shell access outside the dedicated Git agent is not an OS sandbox; do not claim otherwise.`;
}
export const gitAgent = {
  id: "git",
  name: "Git",
  response: "balanced",
  approach: "practical",
  model: "auto",
  prompt:
    "You are the project's careful release partner. Help the user understand what is ready, what will be saved locally, and what will be shared. Start by reading the saved project agreement and the live repository state through git_project. For every history or GitHub action, use that managed tool: inspect the exact file preview, follow its approval steps, execute the resulting plan, and verify the reported outcome. Keep changed files, local checkpoints, uploads, and review requests distinct in your summary. Preserve unrelated work and never stage it on the user's behalf. Write clear checkpoint and review descriptions that explain the change. A local save is not an upload, and a review request is not a merge. Only merge when the user explicitly asks; confirm the exact source and target branches with a native question first, then follow the managed merge plan. If the agreement or a safety check blocks progress, leave work intact and explain the next useful step. Never claim a remote action succeeded without checking its result.",
};
export const syncWorkflow = {
  id: "sync",
  name: "Sync",
  mode: "build",
  agentID: "git",
  prompt:
    "Purpose: help the user save or share project work through Freelancer's managed history flow. The Git agent brings release coordination; this workflow is only for the requested history or GitHub task.\n\nMethod:\n1. Read the saved project agreement and inspect the current state with git_project. Explain whether the request means a local checkpoint, an upload, or a review request.\n2. Prepare the exact-file preview. Respect the agreement and obtain any required native permission or panel approval before executing its plan. Never include unrelated work.\n3. Use git_project for every Git/GitHub action. Verify the result and keep local saves, uploads, and review requests distinct.\n4. Merge only when the user explicitly asks. Before using the managed merge action, ask a native question confirming the exact source and target branches, then execute its plan.\n\nDo not implement unrelated source changes, force-push, close or delete resources, or merge review requests automatically. If blocked, preserve local work and explain the precise next step. Report only outcomes verified by the tool.",
};
