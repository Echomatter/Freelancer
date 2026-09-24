# Contributing to Freelancer

Issues, fixes, documentation, and design improvements are welcome. Human- and
AI-assisted contributions are both welcome; please review the result and report
what you actually checked.

Start with the [setup guide](docs/getting-started.md) and [repository guide](AGENTS.md).
Keep OpenCode as the execution engine and preserve local data, native permissions,
and the saved Git agreement when changing a flow.

Before opening a pull request:

1. Run `npm run test:fast` and `npm run build`.
2. Run `npm run test:git` for Git or GitHub changes. Build first, then run
   `npm run test:browser` for interface changes.
3. Describe the user-facing behavior, relevant checks, and any limits of the
   validation. Fixture journeys do not prove live provider authentication.
4. Check the diff for credentials, local databases, conversation content,
   generated files, and personal paths before sharing it.

For bugs, include clear reproduction steps, the expected result, the actual
result, and the operating system. Never attach tokens, private chats, or logs
containing credentials.
