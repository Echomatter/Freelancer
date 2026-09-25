# State-aware chat sender

## Interaction

The composer has one dynamic action: Send when idle with content, Stop when a response is running and the text box is empty, and a Delegate / Queue / Interrupt dialog when text is entered during a response. Stop uses a circular icon so it does not look like a checkbox. Opening or dismissing the dialog never aborts a response. Interrupt stops the native response and cancels waiting deliveries while preserving the draft. Shift+Enter and IME composition retain their normal editing behavior. Local attachments use native OpenCode file parts on a normal send. They stay in the browser until sent, are limited to four files (4 MB each, 6 MB total), and are not included in saved text drafts or Queue / Delegate. During a response, the action stays Stop if only files are attached; typed text opens the dialog and leaves those files in the composer for a later send.

The dialog captures the originating project, chat and draft. It offers a model override without changing global defaults. Cancelling preserves the draft. A successful submission clears only the exact captured draft, never text typed later or a draft in another chat.

## Queue

Queue waits for the native parent turn to finish, including its running tools and pending questions/permissions. Requests fire in FIFO order, one parent turn at a time, even after navigating away. Each request snapshots its own parent model, effort, workflow and agent choices. An override applies to that queued turn, not the running parent or saved defaults. Pending requests are visible and cancellable.

## Delegate

Delegate submits a bounded concern through the existing OpenCode parent prompt path as soon as it can accept input. The handoff asks the current parent to delegate that concern to a worker using the chosen child model, while continuing the original task. It never aborts the parent, changes its model, or creates a second delegation/permission system. Worker creation and execution remain authoritative in the existing native delegate flow; acceptance of the handoff is not proof that a worker has started. The normal activity cards report actual worker execution.

Delegate requires an established parent chat. Workflow identity does not grant authority; explicit inspection constraints still apply. Existing model eligibility, quota, free-only, task and paid-delegation permissions remain in force. A model dropdown selection is not permission to bypass those controls.

The delegate request is a native parent message so the parent can act on it; the user sees it collapsed as a Handoff card. The worker's completed report is collapsed as a Handoff card in the worker chat. The native transcript remains available to agents through the parent/worker relationship.

## Delivery safeguards

The server, not an open browser tab, owns pending delivery. Requests carry an idempotency key and are bound to a project and session. Duplicate submission must not dispatch twice. Stop pauses/cancels waiting delivery before aborting the active native turn. Unknown native state fails closed. Ambiguous transport outcomes must be reported for inspection rather than retried blindly.

The outbox contains pending transport intent, not a replacement chat database. Native OpenCode messages, sessions, auth, tools, permissions and todos remain authoritative. Private state belongs under ignored `backend/.state/`.

A busy native session remains busy even if no assistant message has arrived; elapsed time alone does not prove a slow inference has stopped. Native idle with an older unanswered turn, a terminal assistant error, or an already completed response permits recovery. Stopped or failed submitted deliveries require inspection before later queued work resumes.

## Verification

Cover busy/idle transitions, queue FIFO, pending approval gates, duplicate clicks, model scope, cancellation/stop, navigation and draft preservation, stale/failed status, ambiguous delivery, and restart recovery. Verify Enter, Shift+Enter, IME, Escape, focus return and narrow layouts. Do not claim live provider/worker validation based only on mocked transport tests.
