# Getting started

[Overview](../README.md) · [Handbook](README.md) · [Architecture](ARCHITECTURE.md)

Freelancer currently runs from a source checkout on Windows. Use a browser or the provided Chrome app-window shortcut. There is no additional native application shell.

For a fresh computer, download and extract the repository's source ZIP, or clone `https://github.com/Echomatter/Freelancer.git` if Git is installed. Open PowerShell in its root and run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1`. The script checks or installs Node.js, Git, GitHub CLI, Chrome, and native OpenCode; runs `npm ci`, the production build, and native startup smoke; then creates desktop links and launches the app. Use `-NoShortcuts -NoLaunch` for browser-only setup, or `-SkipPrerequisiteInstall` to require prerequisites already installed. Existing Freelancer and OpenCode data stay in their user folders; the script does not copy them into the checkout. GitHub and provider connections still need your own sign-in.

## Prerequisites

| Dependency | Required for |
| --- | --- |
| Windows, Node.js **24.10+**, and npm | The supported source-run application; the local data service uses Node's built-in `node:sqlite`. |
| Native OpenCode | Model inventory/authentication, chat execution, tools, permissions, todos, native history/export. |
| Windows PowerShell **5.1** | Native executable discovery and backend quota/model-selection scripts. Installing `pwsh` on another OS does not by itself make startup supported. |
| Git | Cloning the repository and enabling project history. GitHub CLI is needed only for managed GitHub connection/upload. |
| Python 3 | Optional document indexing and evidence maintenance/tests. PDF indexing additionally needs `pdftotext`; OCR is an optional external-tool fallback. |
| Google Chrome | Only for the provided Chrome app-window shortcut. Ordinary browser use does not require that shortcut. |

The [package manifest](../package.json) pins `@opencode-ai/plugin` to `1.18.31`. A repeatable baseline installation is:

```powershell
node --version
npm.cmd --version
npm.cmd install -g opencode-ai@1.18.31
opencode.cmd --version
```

A different installed native version needs its own startup/behavior check. OpenCode owns its update configuration and installation lifecycle. Keep provider credentials out of repository files and chat instructions.

## Start in a browser

From PowerShell:

```powershell
Set-Location C:\path\to\Freelancer
npm.cmd ci
npm.cmd run build
npm.cmd start
```

The server prints a JSON line containing its loopback `url`. Open that URL. The port is chosen at startup unless explicitly configured; do not bookmark a guessed fixed port. Keep the terminal running. **Ctrl+C** stops a server started this way.

`npm.cmd` is the Windows command shim and avoids a blocked `npm.ps1` launcher. No permanent PowerShell execution-policy change is required by these instructions.

## First use

1. **Choose the project folder.** Use the project picker to add/open the directory you intend the model to inspect. Enter the absolute folder path; no native folder chooser is required. When enabling managed Git history, use the repository root rather than a nested directory. Opening a folder does not upload it to GitHub.
2. **Connect providers.** Expand **Application settings → Providers** in the bottom sidebar. Its provider and model list comes from your OpenCode installation; connection methods and credentials are handled by OpenCode's native auth flow. Do not paste credentials into a chat. Provider/model availability depends on the actual connection, not a README model list. General OpenCode options and MCP servers stay in your native OpenCode configuration and are shared with Freelancer.
3. **Choose the parent and job.** Select an available model and its reported intelligence level and a named agent. Describe planning, exploration or review intent in the request itself. The same Agents catalog is used for delegated work; custom agents need no extra backend definition. Only native permissions, user constraints and project agreements set authority.
4. **Set useful defaults.** **Project settings → Session defaults** stores the starting named agent and intelligence choice; the default model is saved in the project’s native OpenCode configuration. Set worker concurrency, depth, free preference and paid behavior under **Project settings → Delegation**.
5. **Send a bounded request.** Watch native questions/permissions and the Details panel. Waiting for permission is not the same as active execution. Open a child card to inspect its own conversation. Use a disposable project and free model for an initial inference test where appropriate.

The **Available Usage** meter is an estimate from provider observations. A missing percentage is not proof of exhaustion. Its sidebar disclosure keeps you in the current chat. [Interpret the meter →](available-usage.md)

The sidebar keeps the project picker, recent chats, and Available Usage meter visible. Expand **Project settings** for Files, Search project content, Goals, Session defaults, Delegation, and GitHub. Expand **Application settings** for Agents, Models, Available Usage, Providers, Appearance, Capabilities, Scheduled prompts, Search all content, Content & Storage, File access, and Remote access. Capabilities lists tools and skills, with one shared MCP connection section. Technical explanations are in each card’s help bubble. File access scope is under **Application settings → File access**. The text-only breadcrumb starts with the project folder, which opens Files. In delegated chats, parent titles return to their conversations; the current chat appears last. File browsing follows the folder path through to the current file. Settings use folder → current page without an extra settings-scope crumb. Narrow screens keep the folder and nearest parent above the current title. Connection state and controls such as Details remain beside the breadcrumb. Each icon opens its feature in the main pane; collapsing the drawers leaves more room for recent chats. Use **Search all content → Conversations** for conversation browsing, archive, restore and export. **Content & Storage** shows project archives, local data locations, index coverage and database stats, and offers index refresh and SQLite maintenance.

GitHub is optional. **Project settings → GitHub** separately configures local checkpoints, account sign-in, the destination repository, and the working agreement. Connecting is not uploading. [Set up Git safely →](github-projects.md)

## Search and memories

Open **Application settings → Search all content** to search across registered
projects, or **Project settings → Search project content** to stay within one
project. Choose **Files**, **Conversations** or **Memories** to focus the list,
or **All content** to search them together.
Search matches the words you enter; **Exact phrase** also requires their order.
It may miss paraphrases. Page help describes which sources were indexed;
**Show more** expands a limited result list.

- **Files and conversations:** Open the live source or read retained file
  evidence. Live content can differ from the indexed revision. Refresh indexes
  in Content & Storage; open chats also refresh their indexed text as they load.
- **Remember a file or chat:** Click **Remember** to save it immediately, without
  filling in a form. The reader opens the saved memory; choose **Edit memory**
  whenever you want to change its title, add a summary or record more details.
  File, Chat and Custom labels identify its source. File memories retain indexed
  extracted text; they do not copy original binary files.
- **Captured sources:** Chat capture can take time; the reader shows progress
  and incomplete or unavailable coverage. A saved memory can still be capturing.
  **Refresh snapshot** reads the source again. Earlier revisions remain available
  in the revision picker. **Open live conversation** opens the current native
  chat separately. A source error does not prove that the chat was deleted.
  Capture details show when the text was captured separately from the latest
  source check; a failed check preserves earlier retained text.
- **Custom memories:** Use **New memory** to save a title and optional text, choosing a project
  scope when needed. Optional structured data and evidence live under expandable
  details. A memory can also retain observations, preferences, dates, status and
  relationships. **Edit memory** creates a revision of the same record; older
  titles, content and evidence remain readable. For files and chats, edited memory
  text or a model-written summary is separate from the retained source capture.

The model uses the same memory save as the UI. It can add a summary or structured
details, but those are optional.

**Archive memory** hides it from the ordinary memory list; include archived
memories to find it and choose **Restore memory**. Neither action archives the
native conversation. **Forget memory** requires confirmation and removes the
retained content, revisions and remembered-chat links. Its native conversation remains in
OpenCode, and existing backups may contain copies. Conversation and project
archives have separate controls in Search all content → Conversations and Content & Storage.

## Convenient Windows shortcut

After building the UI:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/create-desktop-shortcut.ps1
```

This creates `Freelancer.lnk` on the desktop. It starts or reuses the verified server for this checkout, opens the current URL in a **Chrome app window**, and keeps a controller in the Windows system tray. Closing Chrome leaves the server running. Use the tray icon's **Exit Freelancer** command to close the server cleanly. The execution-policy flag applies to this invocation, not a persistent machine-policy change.

For icon artwork changes, add `-RefreshPublicAssets` to regenerate the 192/512 PNGs alongside the local ICO and shortcut. The ICO contains native frames from 16 to 256 pixels. An already running tray loads the updated icon the next time its controller starts.

The favicon, desktop link, and installable-page manifest use the same F mark as the application corner. A plain `chrome.exe --app` launch still groups under Chrome on the Windows taskbar because the running executable is Chrome; that part cannot be overridden from this checkout. Chrome's **Install page as app** can create a separately grouped taskbar entry, but it remembers the current loopback port, which may change on restart. Use the provided `Freelancer.lnk` for a reliable fresh-URL launch.

The launcher verifies the source root, process, lock, and live page before reusing a server. A stale remembered port is not used. Its diagnostic output is under `backend/.state/webpage/server.stdout.log` and `server.stderr.log`.

Use one desktop icon: **Freelancer**. The shortcut creator moves the old matching
**Freelancer Restart** shortcut into a local backup folder. Restart is available
in the tray menu. **Open in browser** opens a regular browser tab, and **Start in →
Chrome app / Browser** saves the default for the desktop icon and **Open Freelancer**.
**Application settings → Remote access** configures a fixed LAN port and pairs
remembered devices with a one-time QR code. See [remote access](network-access.md).

The tray **Restart server** command sends the server's authenticated shutdown request, waits for its process and application lock to close, then starts it again. It never force-kills a live server. The equivalent command is `scripts/restart-web.ps1`. Use **Exit Freelancer** to stop both tray and server.

If the Freelancer database cannot be recovered and you choose to reset all local Freelancer data, stop the server with **Exit Freelancer**, inspect any pending or uncertain deliveries, then run `node scripts/reset-local-data.mjs --confirm`. The reset acquires the application lock, validates a fresh registered database, replaces the Freelancer SQLite file family, restores project/domain settings, and preserves the separate application-settings document. It deletes local drafts, receipts, goals, schedules, usage observations, memories, pins, indexed evidence, and imported local history. Native OpenCode conversations and credentials, project source files, and Git history remain under their existing owners. Relaunch Freelancer and use **Application settings → Content & Storage → Refresh File Index** and **Refresh Conversation Index** to rebuild retrieval data.

## Updating and recovery

Preserve local work and update your checkout through your normal Git workflow. Then reinstall locked dependencies when needed, rebuild, and restart the real server:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Use the new printed URL. A browser reload alone leaves old server code running. The client/server compatibility check can report **Restart needed** when their contracts differ.

After an explicit backup restore, **Content & Storage** shows **Restored work is
paused**. Review restored chats, queued messages, goals, schedules, retained research sessions and Git
activity, then choose **Review automatic work → Allow automatic work** when
ready. Cancelling leaves background continuation paused. If another restore
superseded the one you reviewed, reload the storage status and review the current
restore before confirming again. The review survives restart; uncertain sends
and Git actions still require their usual inspection.

| Symptom | Check first |
| --- | --- |
| SQLite/startup import error | `node --version` must be at least 24.10. Confirm the process is using that Node installation. |
| OpenCode will not start | Confirm the native executable is installed and discoverable. The current host launcher is Windows-specific; the npm plugin dependency alone is not the native engine. |
| Freelancer is already running | Reuse the existing server/shortcut or stop that checkout's server normally. Do not remove the lock while its owner is live. |
| Vite opens but API calls fail | Start the application server too, with the development port below. Vite is not the backend. |
| Usage is unknown or refresh fails | Check the provider connection and collector/runtime; preserve the distinction between failed telemetry and failed model execution. Do not edit quota files to invent availability. |
| Draft conflict or failed save | Preserve the text in the composer. Retry, or copy it before explicitly choosing **Load saved draft**, which replaces the box with the saved revision. |
| Archive is blocked | Resolve active work, pending questions/permissions, or unresolved sender delivery. Archive does not implicitly stop or cancel them. |
| Restored work is paused | Review the restored state in Content & Storage, then explicitly allow automatic work for the current restore. |
| Git action is blocked | Reinspect the agreement, preview, repository state, and credential-store guidance. Do not force-push or use raw shell commands to bypass the managed action. |

**Application settings → Content & Storage** shows resolved locations. `FREELANCER_DATA_HOME` must be absolute and selects the unified per-user Freelancer database and its separate Freelancer-only settings document. A fresh install does not import earlier Freelancer files or databases; OpenCode configuration, credentials and conversations remain under OpenCode's native ownership. Archive is not a backup. [Data and recovery limits →](local-data.md)

## Development and checks

Use `npm run test:ui` to select and inspect browser journeys interactively.
`npm test` builds, runs the browser journeys, then all JavaScript contracts.
`npm run test:fast` runs contracts without real Git; `npm run test:git` runs
those fixtures separately. See [testing](testing.md) for focused runs, traces,
reports and the exhaustive palette sweep.

For frontend iteration, start the actual backend on the port configured in [Vite's proxy](../vite.config.ts):

```powershell
# Terminal 1, in the repository
$env:FREELANCER_WEB_PORT = '47840'
npm.cmd start

# Terminal 2, in the same repository
npm.cmd run dev
```

Use the URL Vite prints. `npm run build` creates the production UI; `npm start` serves it. Same-LAN phone access is available from the production tray menu; see [network access](network-access.md). See [the architecture](ARCHITECTURE.md) before changing ownership or adding another service.

Baseline checks:

```powershell
npm.cmd test
npm.cmd run build
node scripts/palette-css.mjs --check
npm.cmd run smoke:runtime
```

`npm run test:browser` runs all production browser journeys, including agent editing and simulated native execution.

`npm run test:contracts` runs JavaScript contracts in `tests/` and `backend/tests/`, including documentation-link checks. The smoke check starts the **installed** OpenCode and checks native roles, skills, tools, built assets, and bootstrap without asking a model to infer. It can still touch app-local runtime state; it is not a completely offline fixture.

Additional checks, depending on the changed area:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File backend/tests/selector-contract.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File backend/tests/outcome-contract.ps1
python -m unittest discover -s backend/tests -p '*_test.py'
```

For production-browser journeys, after building:

```powershell
npx.cmd playwright install chromium
npm.cmd run test:browser
```

Playwright is a development dependency; the browser journeys use controlled native/provider fixtures and disposable data/repositories. They are not live account, UAC/keyring, or Windows shortcut launch tests. Restricted-environment `*_OFFLINE` bridge options described in feature guides do not prove normal-navigation/CSP behavior.

Use the [current workflows](../.github/workflows/) for exact CI gates. Historical logs and counts are evidence for their recorded commit only.
