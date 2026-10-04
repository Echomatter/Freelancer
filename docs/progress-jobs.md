# Background progress and project preparation

Project switching uses the same in-page loading stage as chats, with the current
project name and preparation phase. It never opens the add-project dialog.
During indexing, **Continue in background** opens the workspace without cancelling
the index job; its progress and Stop/Retry controls remain below the header.
Browser reads time out after 30 seconds so a stalled connection releases loading
controls and offers recovery. This does not stop or resend native work.

`src/echoflex/ProgressStatus.tsx` is the reusable presentation component. It accepts a status label, semantic state, optional measured percentage, optional details, dismiss callback and one configurable action. Callers own execution and persistence; a dismiss callback never implies cancellation. Text and controls sit inside a slim color-changing bar. Running work uses an indeterminate sweep; waiting/partial states use warning, success uses green, and errors use the danger palette. Reduced-motion preferences disable animation. Labels and native progress semantics keep state understandable without color.

Published model-data updates, file and conversation index refreshes, and SQLite optimize/check/compact jobs share this component below the workspace header. Jobs remain visible across navigation. Stop is offered only where work can actually stop. SQLite maintenance does not offer a fake cancellation control; compaction retains its confirmation. Index/maintenance terminal jobs offer Retry, Rebuild or Run again as appropriate, plus dismiss. Model-data updates report source outcomes and retain published data; a terminal result can be dismissed and another source update requested explicitly. Cancelling stays pending until requests settle. Restart marks an interrupted model-data refresh without replaying it. An unresolved legacy model-research retirement keeps its retained project/session reference inspectable and offers no new research or retry. Index/maintenance progress survives browser reload but is held by the current server process.

First opening a project shows real steps: open the folder, load models/agents/settings, build file search, then build conversation search. The same branded bar reports current work and file counts. Preparation indexes only the selected project; explicit Content & Storage refreshes still cover all registered projects. The project-local Node indexer extracts text/code, delimited and structured data, DOCX/XLSX, safe ZIP members and PDF text layers, and publishes file search and requested fact layers transactionally into the per-user SQLite database. PDFs with text layers use the Node extractor; `pdftotext` is preferred when installed, and optional OCR requires `pdftoppm` and `tesseract`. Published indexes record readiness, including empty projects and per-file extraction gaps, so future opens reuse them. Extraction gaps are retained as skipped files in a completed refresh. Operational failures, interrupted preparation and unreadable native conversations do not record readiness; the workspace can still open. Completed index work is preserved on Stop. Native conversations remain in OpenCode; system configuration conversations are excluded from conversation search.

File discovery uses Git's tracked and untracked source inventory with native
ignore rules, including nested `.gitignore`, local/global excludes and explicit
negations. Tracked files and explicit Git includes can override ordinary
generated-folder exclusions. Credential files, private runtime state and symbolic
links remain excluded. Without Git, directory scanning excludes common dependency,
build, release and cache folders. Every source remains contained in the selected
project root; documents are never reassigned by project name.

Scanning stops before publication if it exceeds 100,000 inventory entries,
10,000 eligible files or 512 MiB of eligible input. The previous index remains
available and the error explains how to narrow the source inventory. Individual
unsupported or unreadable documents do not fail the whole project: oversized
eligible files (16 MiB for text, 64 MiB for documents/archives) and extraction gaps
are reported as skipped. Unknown formats are sampled with an 8 KiB read rather
than loading every binary file. Source reads are bounded and a file that changes
during capture is reported for a later refresh. Hashes preserve unchanged-file
reuse; changing extraction rules or schema forces re-extraction. Historical source
revisions and retained memory/pin evidence remain preserved.

Capture is limited to 4,096 units and 2,097,152 indexed characters per source,
with 262,144 characters per unit. Source metadata records when this capture is limited. Search is
a locator for original evidence, not proof that every part of a large document
was captured. Outbound receipts contain bounded change and failure previews with
explicit totals and omitted counts; the warehouse retains the complete summary.
File progress streams separately from the 4 MiB JSON receipt and keeps only a
16,384-character diagnostic tail. Stop, timeout and output-limit paths wait for process
closure before releasing the project/job lease. Historical oversized progress
errors are shortened in status responses without deleting durable receipts.
Each publication stages in a uniquely owned directory under the current user's
OS temporary folder, outside the registered warehouse. Cleanup removes only the
known stage database and SQLite sidecars, then removes the empty directory without
recursion. A forcibly killed process may leave temporary scratch for inspection;
it cannot introduce unregistered files into the warehouse or block a later launch.

The status API is `/api/index/jobs` with GET/POST plus `/stop` and `/dismiss`. Supported kinds are `prepare`, `files`, `chats`, `optimize`, `check`, and `compact`. One status-managed index or SQLite operation runs at a time. Initial statuses are returned before work begins. SQLite maintenance runs on a worker thread so the server remains responsive; native SQLite locking still applies to concurrent writes. The UI/runtime contract is version 10; restart an older server after rebuilding.

The native `content_index` tool forwards cancellation to its indexer process and
uses a ten-minute timeout, a 4 MiB stdout limit, and a bounded stderr diagnostic
tail. A timeout, cancellation, or oversized result is an explicit tool failure;
it is not reported as a completed index. Large retrieval results can be narrowed
with the source/family filters and row limit.

Validation: `tests/index-jobs.test.mjs` covers scoping, restart readiness, partial completion, cancellation and SQLite failures. `tests/progress-jobs.browser.mjs` exercises the production UI with real file/SQLite indexing in an isolated project and simulated native conversations. Model-data service/store/source contracts cover publication and recovery; `tests/model-ratings.browser.mjs` and `tests/model-data.browser.mjs` exercise explicit source selection, stored browsing, key status, cancellation and stale reads with deterministic source responses. These fixtures do not prove real public-feed access, provider authentication or inference. See [Published model data](model-ratings.md).
