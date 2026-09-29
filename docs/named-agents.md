# Named agents

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Worker budget](delegation-budget.md)

**Agents** is the sole authored catalog. Engineer, Researcher, Designer and custom definitions can lead chats or execute workers. Worker means a running assignment. Work runs in the fixed Build mode; planning, exploration or review intent belongs in the request text, not in a separate mode control.

Edit expertise, instructions and an optional default model on Agents. Explicit assignment models win over defaults. Automatic routing uses eligible connected capacity, normally preferring free models. A paid default never grants spending permission.

Root requests capture their catalog and limits. Later edits affect future roots; current workers retain captured instructions. Root and child use `server/execution.mjs`. Native profiles contain identity/permissions, not duplicate personas or pins. New IDs refresh native discovery only while idle.

The current catalog is supplied in execution context. Use `delegate({agent, task, model?})`; no preflight or second selection call is needed. Optional `freeOnly`, `inspectionOnly` and `independentReview` express real constraints. `delegate()` remains available for catalog details.

New workers start in the background so the parent can continue independent work; their card updates with observed progress and completion. The native child session and a local assignment receipt preserve the parent/worker link from dispatch. The parent can call `delegate({workers: true})` to rediscover assignments and `delegate({worker: childSessionID})` to read the current native child transcript, tool activity and status. Use `from` and `limit` to page messages. This reads OpenCode directly; the content index is not involved. Results contain a child session and compact `worker_result`, labeled structured completion, fallback or partial. Completion remains unverified until acceptance checks pass. Follow up with `delegate({worker: childSessionID, task})` to keep the same agent/model/context. Busy or uncertain workers cannot be silently restarted.

Workers can delegate within native depth and shared concurrency ceilings. Explicit no-workers instructions/settings prevent delegation. Native questions and permissions remain attached to the worker session and surface above other dialogs in its parent conversation. See [Echoflex dialogs](echoflex-dialogs.md) for priority and keyboard behavior and the canonical [architecture](ARCHITECTURE.md) for authority, storage and Git rules.

Inspection-only assignments deny source-edit tools and managed Git execution.
Shell commands still use OpenCode's native shell permissions; Freelancer does
not parse arbitrary shell programs into read/write classifications or provide a
filesystem sandbox. An inspection-only instruction must also be honored when
using shell tools. Agent labels alone never change native permissions.
