# Scheduled Prompts

Scheduled prompts are server-side local jobs. The timer runs in the Node server, so closing the browser does not stop an already running server or cancel its schedules.

Open **Application settings → Scheduled prompts → New schedule**. Choose a project,
write a prompt, choose its agent, workflow and model, then choose a first run and
repeat interval. The time picker uses your browser's local timezone. The schedule
list shows the next run and latest dispatch, with an **Open run** link to its chat.
You can edit, pause, resume or delete schedules there; deleting keeps existing chats.
Keep the computer awake and server running. Restart the server after installing
this feature; refreshing the browser alone does not update server code.

Schedules are global and persisted in `backend/.state/webpage/schedules.json`. A schedule must choose an existing project plus explicit `agent`, `workflow`, and `model` values from the current catalog. The scheduler validates those choices when saving and again before each run, including that the chosen model is currently connected or a free OpenCode model. It does not grant permissions, alter Git policy, or bypass provider consent; dispatch goes through the normal sender and execution path. Scheduling runs locally; model inference uses the selected provider as usual.

API shape:

```json
{
  "id": "sch_...",
  "title": "Daily triage",
  "prompt": "Review the current project status.",
  "project": "project-id",
  "agent": "engineer",
  "workflow": "build",
  "model": "provider/model",
  "frequency": "once",
  "firstRunAt": "2026-09-26T12:00:00.000Z",
  "enabled": true,
  "nextRunAt": "2026-09-26T12:00:00.000Z",
  "lastRunAt": null,
  "lastDispatchAt": null,
  "lastStatus": null,
  "lastError": null,
  "lastSession": null,
  "history": []
}
```

Endpoints:

- `GET /api/schedules` returns `{ "schedules": [...] }`.
- `POST /api/schedules` creates a schedule from `title`, `prompt`, `project`, `agent`, `workflow`, `model`, `frequency`, `firstRunAt`, and optional `enabled`.
- `PUT /api/schedules` updates a schedule and requires `id` in the body. Partial pause with `{ "id": "...", "enabled": false }` is allowed even if the original project, agent, workflow, or model is no longer available.
- `DELETE /api/schedules` deletes a schedule and requires `id` in the body. Delete does not validate the original project catalog.

Run behavior:

- Each run creates a new chat with the schedule title, then sends the prompt through the normal sender execution path.
- `daily` and `weekly` use fixed elapsed intervals of 24 hours and 7 days from `firstRunAt`; they are not calendar or timezone recurrences.
- Missed runs are skipped. Runs more than 60 seconds late, including after server restart or machine sleep/wake, are recorded as `skipped_missed`; overdue `once` schedules are disabled and overdue recurring schedules advance to the next future interval without catch-up bursts.
- A schedule never overlaps itself. If the previous scheduled chat is still busy or has native permission/question decisions pending, the due run is recorded as `skipped_overlap` and the next occurrence is scheduled.
- Before creating or sending a scheduled chat, the server durably records `lastStatus: "dispatching"`. If the server stops or the sender cannot confirm delivery after that claim, the schedule is paused with `lastStatus: "uncertain"`; inspect the native chat before enabling it again. Uncertain dispatch is not retried automatically.
- Moving to another project requires the previous chat to be finished. Its previous `lastSession` linkage and history are then cleared so overlap checks do not read the wrong project.
- Catalog/availability failures pause the affected schedule. Storage failures stop scheduling and surface in the settings page; resolve the storage issue and restart the server. Nothing is dispatched without a saved claim.
- `dispatched` means the native sender accepted the prompt, not that the task succeeded. Open its chat to see results and answer approvals. Git/PR work follows the existing managed Git agreement and native permissions.
