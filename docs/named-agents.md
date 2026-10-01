# Named agents

[Overview](../README.md) · [Architecture](ARCHITECTURE.md) · [Worker budget](delegation-budget.md)

**Agents** is the sole authored catalog. Engineer, Researcher, Designer and custom definitions can lead chats or execute workers. All named agents share the same available tools; their instructions shape expertise and approach, not authority. Create a custom agent for durable expertise or guidance you want across assignments, not as a permission profile or one-off worker. Worker means a running assignment. Work runs in the fixed Build mode; planning, exploration or review intent belongs in the request text, not in a separate mode control.

Edit expertise, instructions and an optional default model on Agents. Explicit assignment models win over defaults. Automatic routing uses eligible connected capacity, normally preferring free models. A paid default never grants spending permission.

Root requests capture their catalog and limits. Later edits affect future roots; current workers retain captured instructions. Root and child use `server/execution.mjs`. Native profiles contain identity/permissions, not duplicate personas or pins. New IDs refresh native discovery only while idle.

The current catalog is supplied in execution context. Use `delegate({agent, task, model?})`; no preflight or second selection call is needed. `delegate()` with no arguments returns the current agent IDs and eligible `budget.modelPool`. An explicit `model` must be an exact provider/model ID from that pool; omit it for automatic eligible routing. Use `freeOnly:true` when free capacity is a hard requirement rather than passing aliases such as `free`. Optional `inspectionOnly` and `independentReview` express other real constraints.

New workers start in the background so the parent can continue independent work; their card updates with observed progress and completion. The native child session and a local assignment receipt preserve the parent/worker link from dispatch. The parent can call `delegate({workers: true})` to rediscover assignments and `delegate({worker: childSessionID})` to read the current native child transcript, tool activity and status. Use `from` and `limit` to page messages. This reads OpenCode directly; the content index is not involved. Results contain a child session and compact `worker_result`, labeled structured completion, fallback or partial. Completion remains unverified until acceptance checks pass. Follow up with `delegate({worker: childSessionID, task})` to keep the same agent/model/context. Busy or uncertain workers cannot be silently restarted.

Workers can delegate within native depth and shared concurrency ceilings. Explicit no-workers instructions/settings prevent delegation. Native questions and permissions remain attached to the worker session and surface above other dialogs in its parent conversation. See [Echoflex dialogs](echoflex-dialogs.md) for priority and keyboard behavior and the canonical [architecture](ARCHITECTURE.md) for authority, storage and Git rules.

The chat's **Agents** tab shows graphical cards for the selected turn, including
agent identity, model, status, current action and measured elapsed time. Only
active, fresh activity animates. Select a card to open the agent's native chat,
where its handoff instructions and reports remain. Failed handoff notices stay
visible beside the card. **Back to parent chat** returns from a worker's Agents
tab without interrupting execution.

Continue an idle or finished worker for the same assignment; steer active work
with a correction to take effect at the next supported boundary; queue independent
follow-up work for FIFO delivery after the current turn. Do not create an
overlapping replacement when a worker's stop or delivery state is uncertain.
Parents can steer and queue their own workers explicitly. Use
`delegate({worker: childSessionID, task: "Correction", delivery: "steer"})`
to adjust ongoing work at the next supported model boundary without aborting.
Use `delivery: "queue"` for a FIFO follow-up after that worker's turn settles.
Both preserve its conversation, agent, model, reasoning and captured constraints;
paid routes still use native consent. The durable sender retains pending input,
which can be edited in the worker chat. Worker inspection reports saved delivery,
admission and input evidence separately. A saved handoff does not prove the worker
has acted on it. Steer leaves Queue intact, and executing tools may finish first.

## Asking the user

Agents can use OpenCode's native `question` tool to request ad-hoc input. It is
the same native request path rendered by the standard Questions card in
`src/Question.tsx`; worker questions are scoped to their parent conversation.
Use it when a missing answer materially affects correctness, safety, or a
user-owned decision and cannot be resolved from the request or project context.
Ask a small, focused set with enough context to decide and concrete options;
use custom input when the choices are not exhaustive. Wait for the user's
recorded answer before acting on it. For optional decisions, state a reasonable
default and proceed when consistent with the request. Never use questions to
request tool permission, consent to paid-model use, or Git agreement changes;
those have separate native authorization flows. Do not invent or infer an
answer from dismissal, delay, or a tool result.

The shared contract in `server/execution.mjs` applies to every named agent and
worker: tools and skills enable work but do not grant authority; native todos
track work; saved goals require `pursue-goal` recovery and evidence-based
`goal_checkpoint` updates; delegation is bounded and workers may be steered or
queued without assuming the handoff was acted on. The backend owns model
inventory, eligibility, evidence and routing; leave the parent model unchanged,
use automatic routing unless a real constraint requires an exact eligible
model, and preserve paid-use consent. Follow tool schemas, user steering,
captured instructions, native permissions, and the saved Git agreement.
Execution completion is distinct from verified success.

Inspection-only assignments deny source-edit tools and managed Git execution.
Shell commands still use OpenCode's native shell permissions; Freelancer does
not parse arbitrary shell programs into read/write classifications or provide a
filesystem sandbox. An inspection-only instruction must also be honored when
using shell tools. Agent labels alone never change native permissions.
