# Model catalog verification

Observed on 2026-10-03 on Windows, using the source branch
`codex/source-model-catalog`. The initial checks below used isolated stores and
native fixtures. The installed deployment follow-up is recorded separately.

## Source and contract evidence

Context7 was used for Models.dev, Artificial Analysis, OpenCode, React and the
TypeSafe JavaScript SDK. Current upstream schemas and the installed SDK
declarations were checked where relevant. Artificial Analysis's indexed guidance
was stale; its current official Free OpenAPI contract was used instead. See
[source contracts and field mapping](model-data-sources.md).

No Jev questions, example contracts or judgments were invented. Catalog facts
remain JSON state for an existing caller's published request contract.

## Executed checks

| Check | Observed result |
| --- | --- |
| Production build (`npm run build`) | Passed, including TypeScript and the existing component check. |
| Generated palette check | Passed. |
| Complete fast contract suite | 1,012 passed: 1,007 regular tests and 5 separate Windows recorder tests. |
| Application/catalog/service/store regression after the final private native-alias repair | 78 passed, including matching both canonical and deployment evidence without exposing private request metadata. |
| Focused worker/service/store/HTTP checks | 44 passed, including staged publication, actual-exit coordination, checkpoint lease restore, cleanup admission and recovery of every active receipt. |
| Catalog/help/dialog browser run | 8 passed. |
| Expanded browser closure including native model defaults | Initial selection: 9 passed, 1 documentation hover failure. Trace showed the indexing result disappearing and moving the hovered trigger; fixture now click-pins the existing card during assertions. Documentation rerun: 1 passed. Dedicated hover/leave/focus checks remain. |
| Final browser pass after the private native-alias repair | 7 passed: all 5 model-data journeys and both native model-default journeys; no uncaught browser errors. |
| 1440 and 390 pixel source-data screenshots | Inspected; source identities, dates and facts readable, without horizontal overflow. |
| Complete live public Models.dev worker import | Passed: 8,841 source records and 237,485 facts published in schema 23; 276 seconds total. Stored list/detail reads verified after publication. |
| Disposable actual native startup | Passed with OpenCode 1.18.31: `model_catalog` discovered alongside shared tools and skills; named agents, empty vanilla MCP inventory, frontend assets and HTTP bootstrap verified. Fixture process close, unchanged native config/source and temporary-data cleanup confirmed. No inference or provider sign-in. |

The 100 ms heartbeat continued through the public import: 2,628 observations,
2,524 during publication, maximum observed gap approximately 301 ms. This is a
host-specific responsiveness observation, not a timing guarantee.

The public-feed check initially exposed a too-short 180-second worker deadline
and expensive sorted cleanup batches. The worker now has a finite 600-second
deadline, indexed bounded cleanup, progress phases and a scoped checkpoint lease
on the main connection; SQLite FULL durability remains enabled. Adapter network
bounds remain 60 seconds overall and 15 seconds per request.

Detailed output is retained under ignored `artifacts/model-catalog-*`, including
the failed diagnostic runs. A disposable failed-import database was retained
after tool policy blocked its cleanup. It contains fixture/public-feed data and
was not the user's database.

## Remaining unverified access

Authenticated Artificial Analysis Free access is now verified by the authenticated
follow-up section. No model inference, paid endpoint or Jev judgment was used. Browser/native
fixtures do not prove other providers' authentication or inference. The installed
deployment follow-up below verifies the catalog and credential settings in the
real application.
## Authenticated Artificial Analysis follow-up — 2026-10-03

After the user supplied a key, the production `fetchModelDataSource` adapter
successfully authenticated against the official Free catalog, followed all
four pages, and validated/normalized **690 records**. The response reported a
Free tier, a 100-request limit and 96 requests remaining. No inference or paid
endpoint was called. Raw keys, request headers and catalog bodies were not
printed or written to repository files.

The key was sealed with Windows DPAPI for the current user and a successful
decrypt/compare round trip was confirmed without disclosing it. The encrypted
setup value is held outside Git at
`%LOCALAPPDATA%\Freelancer\setup\artificial-analysis.dpapi`.
At that time it was pending transfer into the catalog's normal SQLite credential
store: the older installation returned HTTP 404 for that endpoint. The follow-up
below records the completed transfer and publication. The sealed setup file was
preserved outside Git.

## Installed deployment follow-up — 2026-10-03

The current working tree was built and deployed to the existing non-Git folder
`%LOCALAPPDATA%/Programs/Freelancer`. This includes uncommitted authored feature
files; it is not a claim of a new commit, merge or publication. The old payload
was archived and a verified schema-22 data backup retained before schema 23
opened the same registered `freelancer-workspace-v2` warehouse.

The post-upgrade read-only check passed SQLite integrity and foreign keys. All
46 previous durable tables remained with no count decreases, and all 24 runtime
marker identities remained unchanged. The application retained the same project,
222 existing session IDs, synthetic memory revision and three judgment
definitions. Native OpenCode configuration and authentication file hashes were
unchanged.

The normal local credential endpoint accepted the previously sealed Artificial
Analysis key; it reports configured Windows protected storage. No plaintext key
was written to files or displayed. Through the actual Chrome UI, Update model
data selected both sources and completed job
`6caf5c54-4d88-4749-a558-dce51a9c6936`: **8,841 Models.dev records and 690 Artificial
Analysis records**. The observed AA response quota was 92 of 100 requests
remaining; this is an observation at that refresh, not a future quota guarantee.

A real native OpenCode chat exercised `model_catalog` status, list, search and
detail against those stored snapshots. Its catalog-to-evidence preparation and
inspection retained exact source provenance without inference. A caller's limit
of 10 initially returned a partial fact page with explicit missing-field warnings;
the limit applies before attribute filtering. Missing from that page did not mean
missing from the retained source. Reusing that contract with the published
maximum limit of 200 resolved all six requested attributes, with no missing
fields or truncation and the same source snapshot. The tool correctly rejected an attempted
unsupported `describe` operation; its published operations remain status, list,
search and detail.

The same installed chat made successful real calls through Context7 (resolve and
query), Fetch (official TypeSafe SDK page), Sequential Thinking, and Playwright
(new public-documentation tab, DOM read and closing only that test tab). All six
Jev MCP operations and native SDK/evidence/knowledge inference are documented in
[the evidence verification](evidence-evaluation-verification.md).

The full native inventory exposed an unbounded React render of more than 3,000
cards. Native model browsing now renders at most 50 cards per page while filtering
and ordering the complete inventory. Tool argument hints also spell out the
knowledge packet and existing-definition formats observed during live testing.
The production build passed. The new 3,435-model browser journey passed, as did
the five existing catalog journeys and two native-default journeys (eight
journeys on the same build). The large inventory check covered page bounds,
complete-inventory search, filter/order resets, refresh preservation, inventory
shrink, the update dialog and a 390-pixel layout with no horizontal overflow.

After the final installed restart, all 222 original sessions plus the one test
session, original memory/definitions, native config/auth hashes and all 12
judgment run IDs were retained. Both generation-one catalog snapshots and the
single completed refresh job retained their identities: no automatic refresh
replayed. The protected credential successfully decrypted and matched the
authorized setup value in memory, without disclosure or another external fetch.
Verified backups exist both before schema 23 and after the live tests.

The actual installed UI showed 50 mounted native cards, advanced from results
1–50 to 51–100 and returned to page one. Tools, Skills and Connected Services
disclosures opened and closed; 22 skills and five connected services were
observed. Loopback and same-machine LAN pages returned HTTP 200, normal local
client API requests returned 200, and missing-client/unpaired-LAN API requests
returned 403. This is not an authenticated test from a separate remote device
or proof of inference through every other provider.

Sanitized receipts are retained locally in the ignored
`artifacts/jev-installed-deploy-20261003/` directory. The installed deployment
manifest records the actual working-tree payload and its source/build hashes.

## Reviewed AA model links — 2026-10-03

After storage was scoped to configured models, the authenticated AA download
still succeeded but retained zero records. OpenCode's normal model inventory
does not provide the synthetic AA identity fields that the previous matcher
required. The source feed itself contained relevant configurations.

The authored identity registry now bridges current Models.dev canonical model
IDs to reviewed AA configuration UUIDs. Primary public AA release/creator
metadata and the preserved authenticated feed agreed on all 690 identity tuples
checked during this review. The registry contains identity assertions and
provenance only. Refresh matching checks each source's UUID, creator, name,
slug and release date, plus current canonical context. Changed or missing
assertions stay unlinked. AA tested configurations remain separate from native
provider reasoning variants, prices and performance.

The production build passed, along with **130 focused contracts** and **six
model-data browser journeys**. The new contracts cover plain native models,
separate configurations across providers, tampered identities, canonical
context ordering and reuse, persistence after service restart, and a failed
required identity refresh preserving the last successful AA snapshot.

The installed non-Git application was stopped gracefully, updated with a
verified 724-file source/build selection, and started through its standard
launcher. A real Chrome UI refresh selected both sources and completed:

| Source | Downloaded records | Linked records | Configured native models covered |
| --- | ---: | ---: | ---: |
| Models.dev | 8,841 | 111 | 79 |
| Artificial Analysis | 690 | 101 | 58 |

Installed API pagination and read-only database checks confirmed that every
current source record matches only configured native IDs. All 79 models retain
source coverage. Sonnet 5.5 and GPT-5.4 searches return AA records and numeric
evaluation facts; searches for Cerebras and an unconfigured fixture model
return zero. Sonnet 5.5's five AA configurations have distinct UUIDs, and Chrome
shows their evaluation configurations, reviewed link evidence and the actual
published intelligence value. Source-reported nulls remain null.

The installed warehouse has 101 current AA configuration records and no
generated legacy ratings. This was a source-data refresh, without model
inference. Models without verified AA identities remain unlinked. Counts are
observations from this update, not guarantees for future feeds.

Sanitized verification and screenshots are retained in the ignored
`artifacts/aa-identity-20261003/` directory. The prior installed code is backed up
there; the earlier warehouse backup from the scoped cleanup remains preserved.

