# Getting started

[Overview](../README.md) · [Handbook](README.md) · [Architecture](ARCHITECTURE.md)

Freelancer currently runs from a source checkout on Windows. Use a browser or the provided Chrome app-window shortcut. There is no additional native application shell.

For a fresh computer, download and extract the repository's source ZIP, or clone `https://github.com/Echomatter/Freelancer.git` if Git is installed. Open PowerShell in its root and run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1`. The script checks or installs Node.js, Git, GitHub CLI, Chrome, and native OpenCode; runs `npm ci`, the production build, and native startup smoke; then creates desktop links and launches the app. Use `-NoShortcuts -NoLaunch` for browser-only setup, or `-SkipPrerequisiteInstall` to require prerequisites already installed. Existing Freelancer and OpenCode data stay in their user folders; the script does not copy them into the checkout. GitHub and provider connections still need your own sign-in.

## Prerequisites

| Dependency | Required for |
| --- | --- |
| Windows, Node.js **22.13+**, and npm | The supported source-run application; the local data service uses Node's built-in `node:sqlite`. |
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

A different installed native version needs its own startup/behavior check. Freelancer disables OpenCode's in-app automatic update in its local configuration; it does not manage your global installation lifecycle. Keep provider credentials out of repository files and chat instructions.

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
2. **Connect providers.** Expand **Application settings → Providers** in the bottom sidebar. The application exposes OpenAI, GitHub Copilot, OpenCode Go, and OpenCode Free. Native OpenCode supplies the authentication methods and model inventory. OpenCode Go can use its native key method; do not paste credentials into a chat. Provider/model availability depends on the actual connection, not a README model list.
3. **Choose the parent and job.** Select an available model and its reported intelligence level, an agent persona, and a workflow. Engineer + Build is the default implementation pairing. The same Agents catalog is used for delegated work; custom agents need no extra backend definition. Plan, Explore and Review guide the approach; only native permissions, user constraints and project agreements set authority.
4. **Set useful defaults.** **Project settings → Session defaults** stores the starting workflow, persona, parent model, and intelligence choice for the selected project. Set worker concurrency, depth, free preference and paid behavior under **Project settings → Delegation**.
5. **Send a bounded request.** Watch native questions/permissions and the Details panel. Waiting for permission is not the same as active execution. Open a child card to inspect its own conversation. Use a disposable project and free model for an initial inference test where appropriate.

The **Available Usage** meter is an estimate from provider observations. A missing percentage is not proof of exhaustion. Its sidebar disclosure keeps you in the current chat. [Interpret the meter →](available-usage.md)

The sidebar keeps the project picker, recent chats, and Available Usage meter visible. Expand **Project settings** for Files, Agents, Workflows, GitHub, and project defaults. Expand **Application settings** for Models, Providers, Appearance, Data & Storage, Content index, Git defaults, and History. Each icon opens its feature in the main pane; collapsing the drawers leaves more room for recent chats. History searches indexed titles and message text across registered projects and can filter by model. Open chats refresh their indexed text as they load. **Application settings → Content index** shows coverage and database stats, refreshes files throughout all registered project roots or all native conversations, and offers SQLite maintenance. Both indexes are retrieval aids; native chats and project files remain the sources of truth.

GitHub is optional. **Project settings → GitHub** separately configures local checkpoints, account sign-in, the destination repository, and the working agreement. Connecting is not uploading. [Set up Git safely →](github-projects.md)

## Convenient Windows shortcut

After building the UI:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/create-desktop-shortcut.ps1
```

This creates `Freelancer.lnk` on the desktop. It starts or reuses the verified server for this checkout, opens the current URL in a **Chrome app window**, and keeps a controller in the Windows system tray. Closing Chrome leaves the server running. Use the tray icon's **Exit Freelancer** command to close the server cleanly. The execution-policy flag applies to this invocation, not a persistent machine-policy change.

The favicon, desktop link, and installable-page manifest use the same F mark as the application corner. A plain `chrome.exe --app` launch still groups under Chrome on the Windows taskbar because the running executable is Chrome; that part cannot be overridden from this checkout. Chrome's **Install page as app** can create a separately grouped taskbar entry, but it remembers the current loopback port, which may change on restart. Use the provided `Freelancer.lnk` for a reliable fresh-URL launch.

The launcher verifies the source root, process, lock, and live page before reusing a server. A stale remembered port is not used. Its diagnostic output is under `backend/.state/webpage/server.stdout.log` and `server.stderr.log`.

For a second shortcut that gracefully restarts the local server and opens a fresh Chrome app window after an update:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/create-restart-shortcut.ps1
```

The tray **Restart server** command sends the server's authenticated shutdown request, waits for its process and application lock to close, then starts it again. It never force-kills a live server. The equivalent command is `scripts/restart-web.ps1`. Use **Exit Freelancer** to stop both tray and server.

If local search data is irreparably corrupt and you accept losing its derived indexes and imported local history, stop the server with **Exit Freelancer**, then run `node scripts/reset-local-data.mjs --confirm`. The reset acquires the application lock, validates a fresh database, replaces only the Freelancer SQLite file family, and verifies the settings JSON is unchanged. Native OpenCode chats and project files remain elsewhere. Relaunch Freelancer and use **Application settings → Content index → Refresh File Index** and **Refresh Conversation Index** to rebuild retrieval data.

## Updating and recovery

Preserve local work and update your checkout through your normal Git workflow. Then reinstall locked dependencies when needed, rebuild, and restart the real server:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Use the new printed URL. A browser reload alone leaves old server code running. The client/server compatibility check can report **Restart needed** when their contracts differ.

| Symptom | Check first |
| --- | --- |
| SQLite/startup import error | `node --version` must be at least 22.13. Confirm the process is using that Node installation. |
| OpenCode will not start | Confirm the native executable is installed and discoverable. The current host launcher is Windows-specific; the npm plugin dependency alone is not the native engine. |
| Freelancer is already running | Reuse the existing server/shortcut or stop that checkout's server normally. Do not remove the lock while its owner is live. |
| Vite opens but API calls fail | Start the application server too, with the development port below. Vite is not the backend. |
| Usage is unknown or refresh fails | Check the provider connection and collector/runtime; preserve the distinction between failed telemetry and failed model execution. Do not edit quota files to invent availability. |
| Draft conflict or failed save | Preserve the text in the composer. Retry, or copy it before explicitly choosing **Load saved draft**, which replaces the box with the saved revision. |
| Archive is blocked | Resolve active work, pending questions/permissions, or unresolved sender delivery. Archive does not implicitly stop or cancel them. |
| Git action is blocked | Reinspect the agreement, preview, repository state, and credential-store guidance. Do not force-push or use raw shell commands to bypass the managed action. |

**Application settings → Data & Storage** shows resolved locations. `FREELANCER_DATA_HOME` must be absolute and affects the new organization/draft store only; it does not migrate old JSON settings or OpenCode data. Archive is not a backup. [Data and recovery limits →](local-data.md)

## Development and checks

Use `npm run test:fast` during iteration. It discovers application and backend
contracts automatically and skips only the real-Git integration files;
`npm run test:git` runs those separately. `npm run test:app` and
`npm run test:backend` isolate the application and runtime suites. `npm test`
runs everything, with real-Git scenarios concurrent in isolated repositories.

For frontend iteration, start the actual backend on the port configured in [Vite's proxy](../vite.config.ts):

```powershell
# Terminal 1, in the repository
$env:FREELANCER_WEB_PORT = '47840'
npm.cmd start

# Terminal 2, in the same repository
npm.cmd run dev
```

Use the URL Vite prints. `npm run build` creates the production UI; `npm start` serves it. See [the architecture](ARCHITECTURE.md) before changing ownership or adding another service.

Baseline checks:

```powershell
npm.cmd test
npm.cmd run build
node scripts/palette-css.mjs --check
npm.cmd run smoke:runtime
```

`npm run test:browser` runs all production browser journeys, including agent editing and simulated native execution.

`npm test` runs JavaScript files in `tests/` and `backend/tests/`, including documentation-link checks. The smoke check starts the **installed** OpenCode and checks native roles, skills, tools, built assets, and bootstrap without asking a model to infer. It can still touch app-local runtime state; it is not a completely offline fixture.

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
