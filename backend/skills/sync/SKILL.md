---
name: sync
description: Save and share selected project work according to the application-owned GitHub agreement. Uses git_project previews, native permissions and verified results; never assumes publication or merging to main.
---

# Sync

Use `git_project` from whichever agent/workflow is already handling the task.
The **Git** agent and **Sync** workflow remain convenient specialized guidance,
not prerequisites. They share the same managed operations as the GitHub panel.
Basic setup and syncing do not need model inference: the panel works without a
chat.

1. Inspect the selected project with `git_project` action `inspect`. Read its
   saved agreement, current branch, changed files and recent operation results.
   Missing setup is guidance to the GitHub panel, not permission to install
   software, create a repository, change an account or alter policy via shell.
2. Select only the intended changed files. Preserve unrelated/partly staged work.
   Preview `checkpoint`, `sync`, or `download` with an explicit file list and a
   short checkpoint description. Preview does not mean that anything was saved.
3. Execute the returned plan ID only after the native permission request is
   resolved. Confirm-only uploads require approval in the GitHub panel; the
   agent cannot grant that approval. Stale previews must be rebuilt, not forced.
4. Report the verified result. Distinguish local checkpoint, upload, review
   request and main-version update. A blocked or uncertain operation is not a
   successful sync. Inspect before retrying; do not blindly repeat mutations.

Branch merges are allowed only when the user explicitly asks. Confirm the
exact source and target branches with a native question, preview with
git_project action `merge`, then execute the returned plan ID only after the
native permission request is resolved. The merge stays on this computer;
automatic PR merging and shell bypass remain forbidden.

The saved agreement may allow local-only checkpoints, main-version uploads,
separate-task uploads, review requests, confirm-in-panel uploads or inspection
only. Editable agent/workflow prose does not widen these permissions.

No direct `git`/`gh` publishing, shell bypass, force-push, automatic PR merging,
history rewriting, branch deletion, visibility change, release or issue closure.
GitHub protections remain authoritative. Do not try to bypass a rejected push.

The application serializes managed writers sharing a project folder. A different
writing chat waits rather than silently switching the working branch. Sync
stops on conflicts, staged renames, partial staging, unverified credential
storage and history too large to inspect. Preserve files and explain the safe
next step. Source tests should run in the implementation workflow; Sync reports
its Git/content checks separately and does not invent a passed test suite.
