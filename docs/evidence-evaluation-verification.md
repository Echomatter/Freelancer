# Evidence evaluation verification

Verified from the development source on **2026-10-03**, branch
`codex/source-model-catalog`. The running installed application was preserved.

## Delivered

- Shared native `evidence_evaluation` tool with describe, prepare, evaluate and
  inspect operations. `describe` exposes the local v1 JSON Schema and bounds.
- Deterministic cached evidence selection using existing catalog/knowledge
  helpers, projections, joins, arithmetic, comparisons and conditional overlays.
  No new database, MCP server, arbitrary code execution or SQL entry point.
- Explicit independent TypeSafe batches and dependent stages, verified typed
  results, request-local scenarios, identical-question reuse and deterministic
  compositions with declared weights/ranges/scales.
- Existing judgment ledger for actual calls, bounded session-owned inspection
  receipts, native permission and read-only checks, source-change detection and
  cancellation/shutdown draining. No action consequences or implicit refresh.
- Refreshed bounded-judgment skill, capability description and documentation.

## Checks performed

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Focused evaluation/provider contracts | **79/79 passed** | Generic examples, arithmetic/joins, unknowns, provenance, scenario ordering/reuse, cumulative receipt bounds, invalid/stale/partial results, native denial and disconnect/shutdown. All inference responses were synthetic. |
| Full fast regression rerun | **1,083/1,083 passed** | 1,078 regular JavaScript contracts plus 5 Windows recorder contracts. The four later-added receipt/metadata review regressions passed in the focused 79-case run; counts overlap and should not be added. Real Git fixtures are excluded by this suite. |
| Repaired plugin inventory fixtures and service checks | **46/46 passed** | The first full run had two fixtures expecting six plugins. They now expect seven; source/native config preservation still passes. |
| Selected production browser journeys | **15/15 passed** | Shared capability connection/disclosure/description paths, documentation help, model catalog and legacy model data flow. Fixture providers/catalog data, not live remote accounts. |
| Production build | **Passed**, Vite 5.70 s | Includes the project boundary check and TypeScript check. |
| Palette CSS check; Git whitespace check | **Passed** | Static checks only. |
| Actual native runtime smoke | **Passed** | Disposable OpenCode **1.18.31** discovered the new shared tool and shared skills. Named agents, SQLite drivers, vanilla empty optional MCP inventory and browser bootstrap passed. Native/source configuration stayed unchanged; process closure and scratch-data removal were confirmed. No model inference or provider sign-in. |

The final native smoke observed Node **24.16.0**, Bun **1.3.14** and SQLite
**3.53.0**. The installed application process remained PID **11160**, started
at **12:34:07 ET**. Source work was not published, merged or deployed by this goal.

## Published contracts checked

Context7 was used to resolve TypeSafe's current documentation and check question
builders, shared state/batching, typed result fields and reported-model semantics.
The installed **@typesafe-ai/sdk 0.6.0** declarations and its actual serializer/
parser were also checked using synthetic HTTP responses. Vendor examples and
contracts are sourced from the [JavaScript SDK reference](https://docs.typesafe.ai/sdk/javascript),
[typed result interface](https://docs.typesafe.ai/sdk/javascript/api/interfaces/SystemOneResult),
[primitive documentation](https://docs.typesafe.ai/primitives),
[parallel-question cookbook](https://docs.typesafe.ai/cookbooks/parallel_questions)
and [model documentation](https://docs.typesafe.ai/models).

Freelancer's evaluation schema is an application contract. It is not presented
as a TypeSafe wire format. Numeric validation is an explicit local policy, not a
claimed vendor precision guarantee. The live verification below led to a
representation-specific Score compatibility correction.

## Authenticated live verification, 2026-10-03

The user explicitly requested real Jev tests in the application. The existing
process environment supplied the credentials; they were neither displayed nor
copied into configuration, source files or proof artifacts. Tests were submitted
through Chrome's actual Freelancer composer using the connected free native
`opencode/big-pickle` model to invoke the tools. Jev calls were authenticated,
external inference, using only synthetic support notes selected for these tests.

The installed application at `http://127.0.0.1:58633` retained PID **11160** and
its original start time. Its native Jev MCP connection exercised all six tools:
model listing, a mixed-primitive batch, each single-primitive wrapper, and inline
two-item triage. Every inference reported **`jev-1.13.0`**:

| Installed native path | Input/output tokens | Reported latency | Observed result |
| --- | --- | --- | --- |
| `jev_jev_models` | No inference usage | Not measured | Authenticated inventory returned `jev-latest` and `jev-preview`. |
| `jev_jev_ask` | 503 / 77 | 199 ms | Choice cancellation; refund Check 0.03; urgency Score 0.13. |
| `jev_jev_classify` | 350 / 39 | 180 ms | Cancellation, confidence 1; no extra no-match option when disabled. |
| `jev_jev_check` | 337 / 20 | 200 ms | Refund probability 0.03, verdict no. |
| `jev_jev_score` | 328 / 17 | 178 ms | Urgency 0.13; matching rubric/distribution. |
| `jev_jev_triage` | 610 / 42 | 316 ms aggregate | Two inline items in input order; refund probabilities 0.03 and 0.99; zero failed items. No file paths were submitted. |
| `knowledge` / `judgment-evaluate-batch` | 756 / 69 | 935 ms | Three actual answers; durable history readback matched the batch run IDs. |
| `knowledge` / `judgment-evaluate` | 632 / 20 | 291 ms | Separate actual Check receipt, probability 0.03, same cited synthetic memory revision. |

Installed inference receipts sum to **3,516 input / 284 output tokens**. Triage
has two remote item requests; its aggregate usage is counted once. Model listing
and ledger reads are not counted as inference. Check has no separate confidence.
MCP wrapper `act`/`review` labels were returned data; no action consequences were
executed. Native tool calls passed through their normal permission hooks; the
saved native permissions allowed these calls without a visible approval prompt.

The new source `evidence_evaluation` tool is absent from this older installed
payload. It was tested in a second real Freelancer server on port **58733**, with
an isolated app database and synthetic test project. It used actual native
OpenCode, inherited provider authentication and the real TypeSafe SDK. It was
not a fixture server or direct invocation of the private agent HTTP route.

The first real source evaluation exposed overly strict Score consistency
validation. Choice and Check remained inspectable but nonreusable; the dependent
question was blocked and the composition unavailable. A repeated evaluation of
that same failed receipt retained its run IDs and usage rather than replaying
inference. Bounded, explicitly diagnostic SDK calls with synthetic inputs then
captured examples such as reported Score **5.08** with a displayed-bin mean of
**5.10**, and **4.76** with mean **4.75**. The official SDK forwards these numeric
values unchanged, and vendor documentation does not promise an exact precision.

The source adapter now checks a mathematically feasible interval only for
hundredth-resolution responses, preserving the reported values and recording
local validation metadata. Bin bounds, exact keys, unit sum, rubric matching,
higher-precision consistency, and discrepancies outside that interval still
reject. Captured live cases and rejection regressions passed in the **81/81**
focused provider/evaluation contract rerun. The isolated source server was
gracefully restarted for a fresh native-tool verification; the installed server
was preserved.

The repaired source-native evaluation passed with **five reusable answers**
and three actual provider calls, all reporting `jev-1.13.0`:

| Provider batch | Input/output tokens | Reported latency | Observed result |
| --- | --- | --- | --- |
| Stage 0, subscription note | 547 / 69 | 297 ms | Intent cancellation; refund probability 0.04; urgency Score 0.21. |
| Stage 0, separate synthetic feedback | 521 / 20 | 140 ms | Ten-level satisfaction Score 5.01, displayed-bin mean 4.99; recorded local compatibility bounds [4.925, 5.075]. |
| Stage 1, declared prior answers | 578 / 22 | 183 ms | Consistency Check 0.98; selected prior intent/refund answers were explicitly present in its submitted state. |

The fresh receipt `f609da0e-1e90-4bb0-aa8f-9c07c38e35e5` and native inspection
retained all five run IDs. Recomposition through `evaluate` plus
`compositionJson` returned `recombined: true`, refund-view **4** on a declared
0–100 scale, with the identical run IDs, three provider stages and usage
(**1,646 input / 111 output tokens**). No further inference was needed. A
separate pure factual contract evaluated **6 × 7 = 42**, with zero questions,
zero provider stages, `status: factual` and `requiresInference: false`.

After shutdown, a read-only inspection of the isolated durable ledger confirmed
exactly **eight expected runs**: the original three invalid responses and five
successful rerun questions. No new runs were written by inspection, the cached
failed evaluation, recomposition or the factual calculation. Shared-batch usage
was written once per actual provider call; the isolated ledger totaled
**2,193 input / 180 output tokens**, including the original failed batch.

The free parent model initially attempted an unsupported `recompose` operation.
The native tool rejected it with `Unknown evidence operation.`; the parent then
used the published `evaluate` operation with `compositionJson`. This argument
error remains in the proof. No separate operation or guessed API alias was added.

Sanitized actual tool receipts are retained locally under the ignored
`artifacts/jev-live-20261003/` folder: `installed-tool-results.json`,
`source-original-failure.json`, `source-repaired-results.json`, and the SDK
numeric diagnostic files. `ledger-proof.json` records the read-only run/usage
inspection. The original failure is retained separately from the
passing rerun. Browser screenshots show the installed MCP results and the
source-native evidence results. Both isolated source-app processes were
gracefully shut down with confirmed exit code 0 after testing; the installed
app remained running. The isolated app database is retained in
`%TEMP%/freelancer-jev-live-20261003-data` for durable test-ledger inspection.

## Limits

The live checks establish authentication and successful inference for the tested
native MCP/SDK/evidence paths and inputs. Recorded token counts and latency are
observations, not billing verification, calibration or accuracy guarantees.
File-path triage, permission denial and cancellation against the remote provider
were not exercised live; their local safeguards remain covered by fixtures.
The initial source verification did not deploy these changes. The installed
deployment follow-up below records their subsequent deployment and live checks.

Full inspection receipts expire after one hour or server restart; actual
recorded question results/state remain in the existing judgment ledger. The
guard excludes credential storage, sensitive field names and recognizable
tokens; arbitrary prose still requires deliberate selection of necessary,
authorized evidence. The [feature guide](evidence-evaluation.md) describes the
source, scenario and receipt boundaries.

## Installed deployment follow-up — 2026-10-03

The current source, including the Score compatibility correction and generic
evidence tool, was deployed to `%LOCALAPPDATA%/Programs/Freelancer` after a
verified backup. The same registered warehouse upgraded from schema 22 to 23;
existing sessions, memory, definitions and native config/authentication were
preserved. See [catalog deployment verification](model-data-verification.md).

Through the real installed Chrome composer, a named Engineer using the connected
free `opencode/big-pickle` model invoked all six Jev MCP operations successfully.
Actual inference reported `jev-1.13.0`. Triage used two inline synthetic notes;
no file-path or private-document upload was tested.

The native evidence evaluation returned receipt
`9645f9e0-334e-4857-bf05-13a38c1a8f59`, five reusable answers and three successful
provider stages. Stage usage totaled **1,646 input / 111 output tokens**. Inspect
retained the five durable run IDs. Changing only the composition returned a
refund view of **3** on its explicit 0–100 scale with those identical run IDs,
stages and usage; no new inference was needed. The initial recomposition request
encountered a socket close; the subsequent recomposition succeeded. This was not
an inference retry. A questions-empty deterministic contract returned **42**,
`status: factual`, `requiresInference: false` and zero provider stages.

The native knowledge single evaluation returned
`abe58d70-1f37-41db-a950-684c43194931` using the existing synthetic memory and
definition. A two-question batch returned
`209a750d-4db8-43ca-878f-0da16dec0fc1` with durable refund/urgency run IDs;
judgment-history confirmed their evidence/state identities. Usage was **654/38**
for the single call and **683/34** for the batch. The knowledge calls reused the
three existing definitions and created no new memory. The generic evaluator
recorded its five caller question definitions in the normal ledger. Invalid
argument attempts remain in the proof: the parent initially
guessed a factual composition field and several knowledge definition/batch JSON
formats. They were rejected before inference; successful calls used the existing
definition IDs and the exact returned packet. Native argument descriptions and
the remember skill now state those formats explicitly.

The same chat also read actual stored model-catalog records, prepared catalog
evidence and inspected it without invoking Jev or refreshing sources. Full
receipts remain process-local and expire at restart; the actual recorded Jev
questions and results remain durable.

The read-only installed ledger check found **12 runs/results**, the original four
plus exactly eight new SDK/knowledge question results. Recomposition, factual
arithmetic, catalog reads and invalid argument attempts added no question runs.
The warehouse retained one memory, eight definitions (three original and five
caller questions), two catalog snapshots, 9,531 source records, 254,224 facts and
one protected credential row. Credential contents were not read by that check.
After the final installed restart, all 12 run IDs were unchanged. Ephemeral
inspection receipts were allowed to expire at restart, as documented; no native
request or remote judgment was automatically replayed.

Sanitized installed proof is retained under ignored
`artifacts/jev-installed-deploy-20261003/`, including `live-tool-results.json`,
`jev-proof.json`, before/after preservation checks, catalog status and deployment
metadata. These live checks establish the tested paths and inputs, not universal
provider availability, billing correctness, remote cancellation or judgment
accuracy.
