# ChatGPT / Codex project import

Open project → **Browse folders…** selects a folder, including local drive roots. **Next** checks for local Codex history. New projects offer **Bring your chats along?** before file and conversation indexing. Select conversations or **Skip import**. Nothing is selected by default. Already registered projects open normally without rescanning import history. An explicitly requested import from a former same-named folder can use `sourceDirectory` in the import preview for an existing project that has not completed onboarding.

This is a one-time, one-way snapshot. Ordinary setup only offers entries whose recorded working directory matches the exact resolved project folder. Sibling folders, nested folders and other worktrees are not combined by remote URL or name. If matching folder names exist under another path, setup says so. When the user explicitly approves an old-folder import, the selected recorded folder must have the same basename as the destination, each transcript is checked against its recorded folder, and that folder is retained in provenance. The transcript's session ID must also match. Archived source chats are offered; their imported copies are available, with original archive status retained as provenance.

Detection uses `CODEX_HOME` or `.codex` and opens the newest `state_N.sqlite` catalog read-only, validating required `threads` columns. Only catalog-selected files under `sessions` or `archived_sessions` are read. The adapter accepts JSONL `session_meta` and `response_item` messages/tool records, with old user/agent events as fallback when message records are absent, avoiding duplicate representations. Unreadable catalogs explain the problem and allow Skip. Windows package detection and the macOS ChatGPT app distinguish an installed app without local history. Cloud-only ChatGPT conversations cannot be imported automatically because they lack a verifiable local repository path; no cloud account or credential store is read.

The source catalog, transcripts and native OpenCode database are never edited. Auth files, hidden reasoning, system/developer instructions and external attachment bytes are excluded. User/assistant text and tool inputs/results can contain sensitive text, as in the original conversation. Images become placeholders. Missing tool results are labeled as unrecorded, not live work. Limits are 64 MB per transcript and 128 MB / 500 conversations per setup. The snapshot stops at the previewed file length; an unfinished trailing JSON record is omitted and noted in provenance. A malformed complete record fails the import. Persisted messages are not silently truncated.

## Storage and presentation

Schema 6 adds `chatgpt_chats`, `chatgpt_messages`, `chatgpt_continuations` and `project_onboarding`. Imported headers/provenance and message records are owned by the first two, separate from OpenCode and derived search. Deterministic `ses_chatgpt_…` IDs are project-scoped. Messages use the existing `info`/`parts` contract and React renderer. Imported IDs cannot reach native chat actions.

History, pin/hide/restore, JSON/Markdown export and conversation search support snapshots. Original text remains indexed after rebuilds. Import and the setup marker commit together before onboarding invokes index jobs. Response retries are idempotent; completed setup cannot add more conversations. Removing and reopening the same project reuses saved history. Nothing continuously monitors Codex.

## Continuation

**Continue in Freelancer** creates a session through OpenCode's supported API and records its link to the snapshot. The original stays read-only; the continuation displays the original transcript followed by native messages. It uses the normal agent, workflow, model, permissions, paid-model rules and Git agreement. Viewing or continuing a snapshot alone does not make an inference call.

The first user send includes a bounded orientation excerpt as a supported synthetic text part in the same native request. The UI shows **Orienting…** and asks the model to orient before answering. The excerpt preserves the opening request and recent exchanges, labels omissions, and explains that historical instructions, approvals, tool authority and claimed execution do not authorize current work. Current files must be checked. This is context, not a fabricated compaction event or direct insertion of old native messages. The UI hides the transport part because the original transcript is already displayed; it persists in native context for subsequent turns and compaction.

Direct native database injection would couple us to private schemas, IDs, parent links, token accounting, migrations and concurrent writers. Supported session/prompt APIs avoid that dependency. Source transcript format evolution remains an adapter boundary and fails without modifying the source.

Creation is serialized and durably marked before native creation. An uncertain creation or persistence failure does not create a second session automatically; the user is directed to check native history. Linked continuations are reused on repeated clicks. Existing sender uncertain-delivery safeguards still govern prompts.

## Verification

`tests/chatgpt-import.test.mjs` covers scope, identity, exclusions, snapshots, replay protection, search, archive/export, native continuation and source preservation. `tests/chatgpt-import.browser.mjs` covers folder browsing, optional import, narrow layout, import-before-index sequencing, shared rendering and orientation. Provider responses are simulated. Local format inspection is distinct from live inference.

Rebuild and restart for UI contract 10 and schema 6. Existing drafts, history, ratings and indexes migrate in place.
