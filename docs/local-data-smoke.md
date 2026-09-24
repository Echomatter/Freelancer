# Local data: installed-runtime smoke checks

Use these checks after updating the application. They supplement the automated native-data fixtures; they are not claims that a real provider or browser export has already been exercised.

1. Use Node.js 22.13 or newer, run `npm ci` and `npm run build`, then restart the local server and reload the interface. The UI protocol must match `domain/protocol.mjs`. Do not reuse an older running server.
2. Open Application settings > Data & Storage. Confirm the displayed Freelancer location, legacy JSON location and shared OpenCode database location. A missing native database path must say unavailable, not show a guessed path. No credentials should be displayed.
3. In a disposable project, type a draft, wait for the saved indicator, reload and verify recovery. Open the same chat in another window, edit both, and verify a conflicting save retains local text and asks for explicit reload rather than silently overwriting.
4. Pin a completed chat, put it away, use Undo, and verify its messages, child-worker links and usage remain unchanged. A running chat, unresolved queued delivery or pending approval must block archiving. When native archive cannot be safely reversed, the interface must say Hidden in Freelancer.
5. Export a selected completed conversation as JSON and Markdown. Confirm the selected worker inclusion and attachment-reference notice. JSON is a Freelancer envelope around native exports, not a full backup or a promise of direct native import. Verify that unsent drafts and authentication stores are absent.
6. In the Chrome window, request a conversation export, locate the downloaded file, and inspect the chosen format. Browser download settings control the location and any save prompt. Freelancer does not claim a verified on-disk save or manage overwriting that destination.
7. Put the project away, reopen it through Data & Storage, and confirm its source folder, Git history and saved Git agreement have not changed. Confirm individually archived chats remain archived after project restoration.

Do not use permanent deletion, direct SQLite edits or real publishing operations to perform these checks. Archive is organization, not backup or disk cleanup. See [the data model and ownership guide](local-data.md) for the schema and boundaries.
