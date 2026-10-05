# Project goals

## Active goal: Unified data, memory, and evidence warehouse

Build Freelancer's operational, content, memory, and evidence warehouse
in one fresh per-user SQLite database, with Freelancer-only application
preferences kept separately. Preserve OpenCode as the execution engine and
native owner of general options, provider inventory/authentication, and MCP
configuration. New installs start with empty Freelancer-owned data and use the
user's existing OpenCode setup; this goal does not import the user's previous
Freelancer databases, JSON state, settings, or Memory files. Keep schema
upgrades and separately user-selected import features distinct from that
previous-install migration. Do not add another MCP server or copy credentials.
This remains an active implementation objective; fresh-runtime startup now
activates the unified store, while full warehouse coverage and retrieval checks
remain unfinished.

Use the [unified data, memory, and evidence warehouse plan](Freelancer_Unified_Data_Memory_Warehouse_Plan.md)
and its companion [code-port and migration map](Freelancer_Code_Port_and_Migration_Map.md)
as the design references and acceptance checklist.

Open **Project settings → Goals** to save an objective. Saving creates one linked
chat and does not start a model. Optional execution and delegation choices begin
with project defaults and are saved for this goal. Add an optional short title
when creating a goal, or rename it through Edit. New and Edit use the same form,
with execution, delegation and running options shown in separate groups.
Delegation uses the same choices as project settings: Agent decides, Encourage
delegation, or No delegation. Encourage asks for useful worker assignments while
keeping the same model, permission and concurrency limits.

| Status | Meaning |
| --- | --- |
| Ready | Saved, not started |
| Running | Pursuing the objective, including useful worker activity |
| Paused | Needs an answer, capacity, inspection or an explicit Resume; the reason is shown |
| Complete | The recorded interpretation has evidence and the native plan is reconciled |

Start begins work. Resume continues the same conversation and unfinished plan.
Open chat only navigates. A Target icon identifies the chat in navigation and
history. The Goals toolbar tab shows the title, lifecycle status, reason and
Start/Resume or Stop controls together. Objective and checkpoint disclosures
keep long plans out of the activity list. Use Manage goal to edit the objective.
Hide goal dismisses the header without
stopping work; Show goal restores it, like the cards below the conversation.
A new objective revision makes the header visible again.
The Goals tab appears only in its linked goal chat.

Edit an active objective to send a revision through Steer; older revisions remain
available. Execution settings remain visible but locked while the goal runs;
stop the goal to edit them. Card actions are always visible. Long objectives,
previous revisions and checkpoint evidence stay within scrollable areas.
Automatic continuation waits for the parent response to settle; queued user
messages take precedence. A continue checkpoint lets the parent keep doing useful
independent work while side workers run. Waiting and completion checkpoints wait
for outstanding worker work. Missing checkpoints trigger bounded same-chat
recovery. Settled failed worker deliveries are reconciled from native history;
the parent inspects remaining uncertainty without asking you to confirm routine
worker statuses. Uncertain input is preserved and never replayed automatically.

Stop prevents further automatic continuations and requests a stop for the parent
and its descendants. Stopping remains visible while acknowledgement is pending;
failed acknowledgement is reported. Tools already executing may finish. Native
tasks and partial results remain. Browser navigation never stops execution.

Only one autonomous goal runs per project. Ordinary chats can still work in the
same directory: project scope is not filesystem isolation, and no automatic
worktree is created.

Free-model rotation applies only to a free parent. Starting or resuming a
subscription model preserves that model and its reasoning setting. A free parent
uses eligible free capacity on a genuine availability error, including a native
free-tier retry waiting for a later reset. Freelancer stops
that stalled parent turn, confirms it ended, and continues in the same chat on
another eligible free model. Existing workers and queued user input are preserved.
A failed test does not cause rotation. Exhaustion pauses the goal; Resume refreshes
availability. Free models from one provider may share a limit, so switching or
parallel workers cannot bypass that provider's account-wide capacity. There is
no paid fallback or automatic quota-reset restart.

Optional automatic approval answers ordinary native tool requests once, only
while the goal is Running. Explicit denials, paid delegation consent, questions
and the Git agreement remain separate boundaries. Stopping or completing a goal
does not authorize later ordinary chat requests.

Completed chats remain available for questions. Opening one or asking what
happened does not restart automation. Use Resume explicitly. Archive and Restore
keep the goal and chat together and preserve history. Missing native conversations
are reported rather than replaced. After a server restart, a running goal
reconciles its existing chat and continues automatically. Explicit Stop remains
in effect. Uncertain parent deliveries pause without replay; uncertain worker
deliveries remain available for the parent to inspect.
Explicit Resume acknowledges a failed, accepted goal continuation once native
work is confirmed idle, including interruptions with no assistant error record.
It creates a fresh continuation in the same chat; it does not replay the old
delivery or dismiss uncertain transport and unrelated queued user input.

See [chat delivery](state-aware-sender.md) for Delegate, Queue, Steer and editable
pending messages. [Technical lifecycle](goals-execution.md) describes the controller.
