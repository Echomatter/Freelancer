# Local chat performance

Long chats and simultaneous sessions used to multiply several expensive reads:
every message event reloaded bootstrap and the selected chat, selected chat reads
cloned every captured request catalog, and the rail measured every turn on each
scroll frame.

The browser now scopes message events to the selected chat and linked workers.
Decisions, session lifecycle events, reconnects and unrecognized events still
refresh authoritative state. Hidden tabs defer event refreshes and activity
polling until visible. Background transcript warmup has bounded concurrency,
queue length and project targets; the existing byte/age-limited cache remains.

Unchanged JSON branches retain their identity. Completed request components can
skip rendering when another turn streams or the draft changes. The model-choice
sheet mounts only while open. Rail observers start after sibling refs attach,
including cached initial transcripts; normal scroll frames reuse anchors, with
remeasurement on real transcript/viewport or scroll-extent changes.

Server chat reads copy only that session's display receipts before leaving the
store. Captured catalogs and instructions remain durable and unchanged. Usage
observation compares incoming records and only writes changed ledgers, avoiding
whole-ledger cloning/stringification for no-op observations. Chat-only backend
snapshots omit unused preferences, routing evidence and quota reads. Activity
reconciliation uses indexed message/outcome lookups.
Worker usage attribution reuses the store's stat-validated request reader instead
of parsing captured catalogs for each assistant message. Native execution keeps
its file-backed reader; both use the same ancestry and agent identity checks.

Streaming chat summaries reuse model metadata for at most 30 seconds. Bootstrap,
dispatch and saved-default validation always request fresh native inventory;
connection changes invalidate the display cache. Chat responses include a
`Server-Timing` header separating native reads, local storage and Git status so
remaining delays can be inspected in browser developer tools without logging
conversation contents.

On the local 249-request history (about 53 MiB), eight read-only measurements
compared the old full-read/filter path with scoped display reads. Median time was
713 ms versus 1.1 ms; average transient heap allocation was about 94 MiB versus
42 KiB. These measurements describe this read path, not total application speed
or an OpenCode memory-leak claim. Raw results are in the ignored local artifact
`artifacts/performance/request-store.json`.

A live read-only check on 2026-09-29 loaded an existing 34-message chat three
times after restarting the idle local server. Final reads took 715, 537 and
516 ms with no availability warnings (bootstrap: 1.44 seconds). Earlier reads
in this run took roughly four seconds; timing instrumentation identified native
catalog reads and repeated worker-attribution parsing. These are observational
local timings, not controlled provider or whole-system benchmarks. Results are
in `artifacts/performance/live-after-restart.json`.

`tests/chat-performance.browser.mjs` exercises 250 turns, unrelated streaming,
selected-chat updates, scrolling and draft preservation. It records browser CPU,
DOM and collected-heap metrics in `artifacts/performance/chat.json`; it bounds
geometry passes and retained heap rather than imposing machine-specific timing
limits. The browser fixture simulates providers. Live inference and long-duration
OpenCode memory behavior require separate observation.

Project reads have a 30-second browser deadline, and project indexing can
continue in the background. Notifications arriving during a project transition
stay queued so returning from a failed switch does not leave the old chat stale.
Production builds retain previous hashed assets in ignored `dist/`; open tabs
can still load settings and other lazy pages after a source rebuild.
