# Published model data

## User guide

Open **Application settings → Models** to browse models from your connected
OpenCode providers plus keyless OpenCode Free. The page uses the same provider
scope as the chat and session-default selectors; its provider filter contains
those providers. Search, sort and **All / Free** filter this inventory. All
matching models appear in a scrolling card grid. Choose a model in the chat
composer or Session defaults.

**Application settings → Providers** shows connected providers and OpenCode Free.
Choose **Add provider** to open OpenCode's native provider setup.

Each compact card shows native identity, provider, observed availability,
access type, context/output limits and known capabilities. Matched models.dev
deployment prices appear as published input/output prices per million tokens.
Separate Artificial Analysis sections show each tested configuration's
Intelligence, Coding and Agentic indices, output speed in tokens/second and
time to first token in seconds, when supplied.

**—** means a value is unavailable or has no asserted source match. It does not
mean zero, an unsupported capability or a failed model. A read failure remains
an explicit error. Source identities and evaluation configurations remain
separate; similar names and model families do not establish a match. Index
values stay on their source's scale rather than becoming percentages or app
ratings. Different scales and tested configurations are not interchangeable.

Source labels, links and capture dates identify the stored information. Known
publication or measurement dates remain attached to their source values; the
capture date is when Freelancer retrieved the source, not when it tested the
model. Published deployment prices are references, separate from your account
charges, quotas and **Available Usage**. General explanations live under the
help icon. Full source records and historical legacy estimates remain available
internally through the warehouse and shared tools.

### Update selected sources

Choose **Update model data**, select the sources, then **Update selected sources**.
models.dev requires no key and is selected initially. Artificial Analysis needs
its separate API key and must be selected deliberately. This downloads published
source data, then retains records with asserted identity matches to your connected
native models and OpenCode Free. It does not run an OpenCode researcher, model
inference or Jev, and does not change the current chat model. Source feeds may
contain thousands of unrelated models; those records are not stored as a second
model inventory. Models.dev canonical records are also retained when a matched
deployment explicitly references their `canonical_model_id`. A provider
connection does not guarantee that a source has a
documented match for its models. Zero matching records is a valid source result,
and missing or ambiguous matches are not filled with guessed identities.

Configure sources in **Application settings → Capabilities → Model data
sources**. Source selection uses the server's configured status. Paired remote
devices can update configured sources without access to source-key management.

The shared progress bar reports each source result. **Stop** cancels unfinished
requests. Successful source publications remain saved, while failed, interrupted
or unfinished sources keep their previous stored data. Hiding progress does not
cancel the job; the Models action reveals it again. **OK** dismisses a terminal
result durably. Restart records an interrupted refresh without silently replaying
it. Request another update explicitly when needed. Stored records stay readable
while interrupted staging is cleared; another update waits for that cleanup. A
cleanup failure remains visible and prevents another refresh until local storage
is ready.

Browsing models, card reads and status polling use stored data. They do not
start source downloads. The card grid has no previous/next page controls. Stored
source reads retain their internal response bounds and snapshot consistency.

### Source keys

Open **Application settings → Capabilities → Model data sources** to inspect
source status. Manage the optional Artificial Analysis API key on this computer.
The field is write-only and is cleared when it is submitted, including when
delivery fails. The response contains only configured status and storage
provenance. Check configuration before resubmitting an uncertain request.

The server uses Windows protected storage for a saved key, or its own environment
configuration. The source key is separate from native OpenCode provider
authentication and is not placed in app settings, agent prompts or model records.
Saving a key does not download data. Removing a saved key does not remove an
environment key. A missing key, source quota, network failure or invalid payload
remains an explicit source outcome; there is no paid-model fallback.

Source attribution is retained. Artificial Analysis free API data is intended
for internal use; do not treat the stored feed as a redistribution license.

## Technical contract

`server/model-data.mjs` owns source refresh orchestration. Its adapters and the
per-user SQLite model-data store retain original source identities, configurations,
fact values, units/scales, source references and dates. Native inventory stays
independent, and documented exact identity matching is presentation metadata.
Legacy `model_catalog` estimates remain separately labeled historical data for
models in the current configured inventory. Catalog replacement validates every
row before one transaction prunes absent IDs and updates retained metadata. An
invalid inventory cannot trigger pruning; a validated empty scope clears catalog
rows. The Models UI and the shared `model_catalog` tool read the stored source
subset for configured models, rather than a complete upstream catalog.
Storage cleanup removes obsolete source snapshots and unrelated records while
preserving the scoped source facts and independent historical job receipts.

Each published source snapshot records `sourceMetadata.scope`: its
`configured-native-models` kind, sorted `nativeModelIDs`, received record/fact
counts and retained record/fact counts. These counts distinguish a downloaded
feed from the subset stored. Matching uses the documented identity matcher;
ambiguity remains explicit and never merges models or evaluation configurations.

See [source contracts and field mapping](model-data-sources.md) for the verified
API envelopes, exact fact keys, units, source bounds and published Jev contracts.

The model-data API provides these routes:

| Route | Purpose |
| --- | --- |
| `GET /api/models/data?operation=list` | Bounded stored records for catalog queries, `total`, `page.limit`, `nextCursor`, source status and current job. Optional `query`, `source`, `kind` and criteria/snapshot-bound `cursor`; changed snapshots require a new first page. Models presents matching facts through native model cards. |
| `GET /api/models/data?operation=detail&id=…` | Exact stable source-record facts; a native provider/model ID returns separate matching records rather than a merged family. Each record retains missingness and fact continuation. |
| `GET /api/models/data?operation=status` | Read the durable job, stored source outcomes and safe configured-source status. |
| `POST /api/models/data` with `operation:refresh` | Explicitly request `sources:["modelsdev","artificial-analysis"]` or the chosen subset; paired remote devices can update configured sources. |
| `POST /api/models/data` with `operation:cancel` or `dismiss` | Act on the exact job `id`; cancellation and terminal dismissal are distinct. |
| `GET /api/models/data/credentials` | This-computer credential management: configured status, storage provenance and sources; no key. |
| `PUT /api/models/data/credentials` | This-computer credential management: write `artificialAnalysisKey`; return status only. |
| `DELETE /api/models/data/credentials` | This-computer credential management: remove the saved source key; environment configuration retains its ownership. |

The browser polls status without mutation and cancels stale card reads when
their model inventory or source version changes, or the reader unmounts.
The presentation selects compact facts while full source records, missingness
and bounded continuation remain available to internal catalog readers.
Refresh jobs are server-owned;
`running` and transient `cancelling` stay active. Stop is disabled while
cancellation settles. Terminal `completed`, `partial`, `failed`, `cancelled` and
`interrupted` receipts retain per-source results.

### Refresh worker and publication

The production refresh uses the fixed Node worker entry
`server/model-data-worker.mjs`, coordinated by
`server/model-data-worker-client.mjs`. It opens the existing registered per-user
SQLite file through its own connection. Fetching, normalization, validation and
scoping and staged publication run there. The downloaded feed stays inside the
worker; only its configured-model subset is published. The server receives
bounded progress, quota and final receipts and
sanitized failures. Injected fixture adapters can use the service's direct path;
those fixtures do not prove the production worker path.

Progress distinguishes fetching, validated records, publication preparation and
committed record/fact operations. Private staging rows are written in transaction
batches of at most 1,000 operations. Readers keep using the prior published
snapshot. After every row is stored, one transaction marks the snapshot complete
and switches the source's current pointer and publication receipt. Each batch
and the final transaction check the owning job and source generation, so
superseded work cannot publish over a newer owner. Identical content can reuse a
retained complete snapshot.

The main SQLite connection holds a checkpoint lease for the worker's lifetime:
its automatic WAL checkpoints are temporarily disabled, then its previous
setting is restored after actual worker exit, including any uncertain-exit wait.
The worker connection keeps its own checkpointing and `synchronous=FULL` writes.
This moves model-data checkpoint work off the main connection without lowering
the database's durability setting.

| Boundary | Default limit |
| --- | --- |
| Complete worker operation | 10 minutes for download, validation and SQLite publication. |
| Source adapter | 60 seconds total for its download sequence, including pagination and bounded attempts; each HTTP request has a 15-second deadline. |

The worker budget does not extend the adapter's HTTP budget. These are execution
bounds, not measured completion times or guarantees that a public feed will finish.

**Stop** requests abort and waits for the worker's actual exit. The coordinator
can terminate an unresponsive worker; if exit is unconfirmed, the job remains
`cancelling` with an explicit waiting status. A pointer committed just before
cancellation is reconciled from durable source state, preserving that successful
publication. Service shutdown also waits for owned work and cleanup.

Startup marks unfinished jobs interrupted without replaying their downloads.
Orphaned staging is purged asynchronously in bounded transactions that yield
between batches. The same maintenance gate covers cleanup after worker completion
or cancellation. Published snapshots stay readable; new refreshes are rejected
until that cleanup finishes, even when the previous job already has a terminal
receipt. Status exposes `maintenance.state` as `cleaning`,
`failed` or `ready`. Cleanup failure preserves published data, reports an error
and blocks another refresh. Staging is private work, not partially published data.

For actual model execution, routing evidence and permissions, see
[Named agents](named-agents.md), [Available Usage](available-usage.md) and
[instruction ownership](instruction-sources.md). A source-data refresh is not
provider authentication, inference, task quality or a live benchmark test.
