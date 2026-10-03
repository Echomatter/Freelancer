---
name: managed-git
description: Use Freelancer's managed Git tool for agreed repository work, exact previews, merges, and explicit agreement requests.
---

# Managed Git

Use the `git_project` tool for repository history actions. It resolves the saved
project agreement, native permission, and repository checks. This skill teaches
procedure only; it grants no Git, GitHub, publication, or shell authority.

## Ordinary agreed work

- Use `action: "inspect"` to read the current project/Git agreement and state.
- Use `action: "preview"` to review the exact proposed operation before running
  it. Use `action: "execute"` only with the returned `planID` for that preview.
- Use `action: "prepare"` when the agreed task needs its task branch prepared
  before implementation. Chats do not switch branches by themselves.
- For an ordinary merge into the agreed main branch, preview with
  `action: "merge"` and the exact `branch`, inspect the result, then call
  `action: "merge"` with the returned `planID`. The tool requests native
  `git_project` permission; do not add a separate user question for this flow.

## Work outside the agreement

Use `action: "request"` with a concise `reason` and either the proposed
`agreement` changes or the exact `tool` (`git` or `gh`) and `args`. If the tool
returns native questions, present those questions unchanged with OpenCode's
`question` tool, wait for the recorded answer, and continue only with the exact
returned `planID` after approval. A question response does not bypass the
tool's subsequent permission or repository checks.

Never publish, stage unrelated files, change agreements, or bypass a denied
operation through shell commands. Preserve unrelated work and report whether an
action was only previewed, locally completed, or actually synchronized.

This optional guidance does not change the saved agreement or native permission.
