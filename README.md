# Freelancer

Freelancer is a local workspace for working on projects with AI. Open a folder, describe what you want done, and follow the work in a chat. You can choose a model, ask for a plan or a code change, and bring in another specialist to review the result. Freelancer runs on your Windows computer in a browser or Chrome app window, with [OpenCode](https://opencode.ai/) doing the AI work behind the scenes.

![Freelancer application banner](assets/freelancer-banner.svg)

## Quick start (Windows)

1. Download the source ZIP from [the Freelancer repository](https://github.com/Echomatter/Freelancer) and extract it, or clone `https://github.com/Echomatter/Freelancer.git` with Git. Open **PowerShell** in the resulting folder.
2. Run the setup:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
   ```

3. When setup finishes, Freelancer opens in a Chrome app window. The installer also creates desktop shortcuts for starting and restarting it.
4. In Freelancer, add your project folder, connect a model provider under **Application settings → Providers**, and start a chat. Try: “Look through this project and explain how to run it.”

Setup installs or checks Node.js, Git, GitHub CLI and OpenCode, plus Chrome for the desktop shortcuts, then builds and starts the app. You will still need to sign in to any model provider you want to use. For a browser-only setup without desktop shortcuts, add `-NoShortcuts -NoLaunch` to the setup command, then [start it in a browser](docs/getting-started.md#start-in-a-browser). See [getting started](docs/getting-started.md) for requirements, manual installation and troubleshooting.

## What can you do with it?

- **Work on a folder:** Ask questions about your project, request changes, attach context and return to past chats.
- **Choose how to work:** Pick an agent and a workflow, such as Engineer + Build for implementation or Researcher + Explore for investigation. These are starting points, not commands you have to memorize.
- **Get another perspective:** Ask the assistant to give a focused task to another model, such as researching an issue or reviewing a change. Follow its progress and inspect its conversation.
- **Stay in control:** Review questions and permission requests, see task progress, and decide when to save or share changes. GitHub is optional; connecting an account does not automatically upload your project.
- **Make the space yours:** Adjust the layout and appearance, browse available models, and search project files and conversations.

Closing the browser window does not stop the local server or work already running. If you used the desktop shortcut, use the tray icon’s **Exit Freelancer** command to stop it. If you started the server with `npm.cmd start`, keep that PowerShell window open and press **Ctrl+C** to stop it.

### For everyday use

Start with [your first project and chat](docs/getting-started.md#first-use). The [handbook](docs/README.md) has guides for project history, usage estimates, saved data, workers and more. Your project files stay in their folders; Freelancer stores its own organization and search data locally, while OpenCode keeps its conversations and provider sign-ins. See [where data lives](docs/local-data.md).

## For contributors and technical readers

This is a source-run React interface served by a local Node.js server. Native OpenCode handles conversations, models, authentication, tools and permissions. Freelancer adds the project UI, saved organization, search, worker coordination and managed Git actions. There is no hosted Freelancer service or packaged installer. The [architecture guide](docs/ARCHITECTURE.md) maps ownership and source entry points; [repository instructions](AGENTS.md) cover changes to this codebase.

To run an already installed checkout manually, use Node.js **22.13 or newer** and the native OpenCode executable (`opencode-ai@1.18.31` is the [documented baseline](docs/getting-started.md#prerequisites)). From the repository root:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open the local URL printed by the server. For frontend development, see [development setup](docs/getting-started.md#development-and-checks). Useful checks are:

```powershell
npm.cmd run test:fast
npm.cmd run test:git
npm.cmd run build
```

The full suite is `npm.cmd test`; after a build, `npm.cmd run test:browser` exercises browser journeys with simulated services. `npm.cmd run smoke:runtime` checks installed OpenCode startup without making a model request. Tests do not establish that your own provider sign-in or model inference works.
