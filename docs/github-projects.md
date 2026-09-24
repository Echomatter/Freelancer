# Project history & GitHub

Open **Project settings → GitHub** in the left sidebar. The project history, GitHub setup, and saved working agreement live together on that page. Set the starting style for newly configured projects under **Application settings → Git defaults**.
Git saves local checkpoints; GitHub receives only the checkpoints you choose to
upload. Connecting an account or enabling history does not upload files.

## Connection and build states

The GitHub card reports two separate states: **Account connected** means the
GitHub CLI is signed in using the system credential store; **Project linked**
means this selected project has also been bound to a GitHub repository. A
signed-in account can be linked by choosing a repository in the card. The
visible **Open GitHub sign-in page** link is available when browser/device
authentication needs to be completed.

Builds do not require GitHub sign-in or a linked repository. If local project
history is enabled with a task-branch or review agreement, the first build may
ask for a local checkpoint so the main version is preserved. That checkpoint is
on this computer and is separate from GitHub upload.
Explore, Review, and Sync requests keep the checked-out branch; they do not
prepare an implementation branch.

## First setup (Windows)

1. **Turn on project history.** Install Git from the panel when needed, or use
   its official installer link when WinGet is unavailable. Windows may display
   a license or system approval. Enter your checkpoint name/email if missing;
   new identity settings are local to this project. You can edit an existing
   project's checkpoint identity in the same panel. Placeholder identities must
   be replaced before saving new history. Existing history, identity,
   branch names and staged changes are preserved. An existing remote HEAD or a single
   conventional main branch is suggested even when a task is checked out; ambiguous
   repositories require a main-version selection. The agreement lets you change
   that selection without renaming or switching branches. A folder inside another Git
   repository must be opened at that repository's root.
2. **Save the first checkpoint.** Review the selected files, describe the work,
   and approve the local-only preview. New repositories receive private-file
   and generated-file exclusions. Nothing is uploaded by this action.
3. **Connect GitHub.** Install GitHub CLI if needed and use its browser sign-in.
   Freelancer never requests an access token in chat. It refuses uploads when
   GitHub CLI reports unknown/plaintext credential storage rather than keyring
   storage. Repair the system credential store and sign in again in that case.
4. **Choose the destination.** Connect an existing account/project, or explicitly
   create a new **private** project under the signed-in account. Existing public
   repositories stay public. A conflicting origin is not overwritten. GitHub
   organization projects can be connected when you have upload access.
5. **For an empty GitHub project**, use **Upload starting version** after saving
   a clean local main checkpoint. This one-time, panel-approved upload establishes
   the main version for later task reviews. It is refused when GitHub already
   contains any branch. This is not an automatic exception to task-branch policy.

Installation/sign-in run as cancellable setup jobs. Cancelling an installer
requests cancellation; a separately launched Windows installer window may still
need closing. No security policy, UAC setting, repository protection or execution
policy is changed to make setup succeed. GitHub CLI may change its host-wide Git
protocol setting during the explicitly requested sign-in; Freelancer does not
rewrite global Git identity or install a global credential helper.

## The project agreement

- **Main version:** build on the designated local main branch; Sync uploads it
  without rewriting history.
- **Separate tasks:** Build prepares/reuses a branch for that chat before edits.
  Sync uploads the selected task and does not update main.
- **Review:** upload the task and create/reuse its open review request. It never merges automatically; merges happen only when you explicitly ask the Git agent or Sync workflow and confirm the exact branches.
- **Show me first:** the agent can prepare a preview, but every upload must be
  approved in the GitHub panel. Native permission is not a substitute.
- **Inspect only:** no managed checkpoints, branch switches or uploads. Build
  implementation is blocked; use Explore/Review for inspection.

Turn GitHub sync off for local-only use. Turning history automation off does not
delete .git, commits, files or existing GitHub projects. Working style can be
saved as a default for newly configured projects; account/repository credentials
and bindings are never copied into those defaults.

The Git persona and Sync workflow are application defaults. Their editable
instructions describe goals; the versioned project agreement owns permission.
Both the panel and the native `git_project` tool call the same application
service. Setup, account changes and policy editing are panel-only. The agent
uses one native permission request per approved plan, not one per shell command.

## Saving, getting updates and syncing

A preview binds selected files, file hashes, local branch/HEAD/index, policy
revision, account, remote repository identity/visibility, and remote branch tip.
It expires in ten minutes. Changed state requires a new preview. Nothing is
silently staged or published because the preview exists.

Checkpoints include only selected paths. Unrelated staged files remain staged.
The generated `.opencode/freelancer.json` project binding is excluded from
managed checkpoints and uploads.
Partially staged files, staged renames, unresolved conflicts and linked files
stop with guidance rather than discarding the user's selection. Current-file
and outgoing-history checks include common credential patterns and excluded
private/generated paths; deleting a secret in a later commit does not erase it
from outgoing history. This is not a comprehensive secret scanner. Review the
preview. Files over the 5 MB managed checkpoint limit are shown with a reason
and are left unselected, so smaller source changes can still be checkpointed.
The implementation limits inspected files to 5 MB, outgoing
content to 30 MB, and outgoing histories to 300 commits/10,000 objects.

**Get updates** accepts compatible fast-forward updates on a clean tree. Divergent
or unrelated histories need review; the app does not auto-merge/rebase or discard
work. **Sync** runs Git/content/whitespace checks and a non-forced explicit-ref
push, verifies the remote tip, then creates/reuses a review request when selected.
It does not run arbitrary project test scripts: validate source changes in the
implementation workflow. Git hooks remain in force; failed checks do not become
successful publication. Protected-branch refusals are not bypassed.

A connection loss is reported separately from a saved checkpoint. Interrupted
or uncertain operations are recorded as needing attention and never blindly
replayed. Repeated execution of a completed plan returns its recorded result.
After an uncertain upload, inspect GitHub and make a new preview; a branch or
review request that already exists is reused instead of duplicated.

## Boundaries

Managed writers sharing the same selected project folder are serialized. A
reservation covers branch preparation through native prompt acknowledgement;
other tasks wait for completion. This version does not create Git worktrees.
External editors/terminals are not locked, so avoid modifying a project during
an approved Git action. Git's native ref/index locks and revalidation protect
ordinary races, but this is not a filesystem transaction or an OS sandbox.

Git/Sync provides specialist guidance; any capable agent can use managed history.
Inspect-only project agreements prevent managed mutations regardless of workflow.
Native shell permissions remain authoritative; direct git/gh commands
are guarded, but arbitrary scripts and other programs with the user's filesystem
or credential access are not a security sandbox. Do not present the agreement
as protection from hostile code running with the user's OS account.

Project agreement/state lives under the existing ignored application store:
`backend/.state/webpage/settings.json` (`gitDefaults`, `gitProjects`) and
`git-operations.json`. Credentials remain with GitHub CLI's system keyring.
OpenCode still owns sessions, native model auth, permissions, tools and todos.

## Verification

Run `npm test`, `npm run build`, and:

```
npx tsc --noEmit --target ES2022 --moduleResolution bundler --module esnext --skipLibCheck backend/opencode/plugins/git-project.ts
node tests/git-project.browser.mjs
```

The browser gate requires test-only Playwright/Chromium. It uses the built UI,
real application/HTTP/store and real disposable Git repositories, not inference.
`PANEL_OFFLINE=1` is an explicit loopback bridge for restricted editing sandboxes;
normal Windows/Linux CI navigation tests the real HTTP/CSP path. Neither fixture
proves UAC, visible Chrome app behavior, credential-store availability or
live GitHub authentication. Verify those on a disposable Windows project before
release. No tests should use a user's working repository or publish real code.

Official command contracts: Git for Windows installation
<https://git-scm.com/install/windows>, GitHub CLI browser/keyring authentication
<https://cli.github.com/manual/gh_auth_login>, native Git status and commit
<https://git-scm.com/docs/git-status>, <https://git-scm.com/docs/git-commit>.
