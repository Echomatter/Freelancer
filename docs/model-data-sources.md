# Model data sources

Freelancer reads source observations for comparison; OpenCode remains authoritative for runnable models, authentication, limits observed by the runtime, and permissions. A benchmark or public price is evidence about its source configuration. It does not establish Freelancer task success, current account pricing, model availability, or permission to spend money.

## Verified contracts

Checked on **2026-10-03** against live official documentation and public source. Public Models.dev data and Artificial Analysis's public OpenAPI document were retrieved during the initial audit. A subsequent user-authorized authenticated check of the Free catalog succeeded: **690 records across four pages**, using the production fetch/normalization adapter. No inference or paid endpoint was used. See [verification](model-data-verification.md).

| Source | Fixed read endpoint | Authentication | Envelope |
| --- | --- | --- | --- |
| Models.dev | `https://models.dev/catalog.json?type=all` | None | `{providers:{[providerID]:provider},models:{[canonicalID]:model}}` |
| Artificial Analysis | `https://artificialanalysis.ai/api/v2/language/models/free?page=N` | Server-side `x-api-key` | `{tier,intelligence_index_version,pagination,data}` |

Models.dev's combined catalog retains provider deployments and canonical metadata in one request. `type=all` includes specialized models such as `decision`; it does not grant execution support. Provider data alone is available at `api.json`, canonical data at `models.json`. Source revision checked: [`c3f362a6be679c0364a49411f56baf02edc486bc`](https://github.com/anomalyco/models.dev/tree/c3f362a6be679c0364a49411f56baf02edc486bc), including the [API instructions](https://github.com/anomalyco/models.dev/blob/c3f362a6be679c0364a49411f56baf02edc486bc/README.md), [model schema](https://github.com/anomalyco/models.dev/blob/c3f362a6be679c0364a49411f56baf02edc486bc/packages/core/src/schema.ts) and [type filters](https://github.com/anomalyco/models.dev/blob/c3f362a6be679c0364a49411f56baf02edc486bc/packages/core/src/filter.ts).

Artificial Analysis's [current OpenAPI V2 definition](https://artificialanalysis.ai/api/v2/openapi) defines `LLMModelsFreeResponse`, `FreeModelData` and the nested Free schemas. Pagination is one-indexed: `{page,page_size,total_pages,has_more}`. Page size is supplied by the API. Any valid tier key receives the Free shape at this route; `tier` records the caller's actual tier. Model detail, full evaluations and provider routes require other access. The adapter never switches to those routes.

Context7 was queried for both providers during implementation. Its Artificial Analysis index returned older `/api/v2/data/llms/models` guidance and contradictory quotas. The current official [API documentation](https://artificialanalysis.ai/data-api/docs) and OpenAPI take precedence. Models.dev's Context7 schema was consistent with the current primary source.

## Identity and source schemas

The version-one snapshot records its source, retrieval timestamp, source URL, records and source observations. IDs are source-qualified and escape each identifier component. Records remain separate by kind:

- **Model:** canonical Models.dev metadata with license, links, weights and published benchmarks.
- **Deployment:** a Models.dev provider/model pair, including provider overrides, costs and limits. `canonical_model_id` explicitly links the underlying model; it does not merge deployment prices.
- **Configuration:** an Artificial Analysis UUID, original tested name and slug. Two reasoning configurations can share a slug and remain separate records.

Deployment metadata preserves capability booleans, modalities, dates, reasoning choices/budgets, structured output, context/input/output limits, request shape, experimental modes, audio/reasoning/cache costs and context price tiers. Canonical benchmarks preserve their original numeric or string score, named metric, source, date, harness, variant, dataset and version. Known wire types are validated; unknown JSON fields remain in `raw` and `source.*` observations. Dates with month precision stay month precise.

Artificial Analysis Free records retain creator identity, release date, nine named indices, evaluation cost and cost per task, four token prices, and four median performance fields. The [Free schema](https://artificialanalysis.ai/api/v2/openapi) excludes individual benchmark results, percentiles, provider detail, context/parameter/modality/license data and blended prices. Missing values remain `null`.

Matching uses asserted identifiers: exact Models.dev provider/model IDs or explicit native API aliases within the same provider, canonical model IDs, and source-qualified native mappings. Freelancer also owns reviewed source identity links for Artificial Analysis: each link associates an identified underlying model with separately retained AA tested configurations, records its evidence, and reports `reviewed-source-model-link` as the method. These are Freelancer mappings, rather than an AA claim about a native provider deployment. The exact AA UUID, original tested name, slug, creator and release metadata retain their source provenance.

Names, bare Artificial Analysis slugs, provider stripping and model families do not trigger automatic fuzzy matching. Multiple asserted candidates produce `ambiguous`; no candidate produces `unmatched`. Reviewed links never merge AA configurations or establish equivalent native reasoning variants, throughput or deployment prices. Source details show the link method and supplied HTTPS evidence references alongside **Evaluation configuration**.

### Configured storage scope

An explicit refresh downloads and validates the selected upstream feed, then filters it before publication to records with asserted matches to the captured connected OpenCode inventory plus keyless OpenCode Free. Models.dev canonical records are retained as dependencies when a matched deployment explicitly names their `canonical_model_id`; this does not merge deployment prices or configurations. Other records with no candidate in that scope are omitted from storage. Records with multiple asserted candidates keep their ambiguity; they are not treated as one model. Connecting a provider does not manufacture a source mapping, and a successful feed with zero matches publishes an empty scoped snapshot. In particular, an Artificial Analysis slug or familiar model name alone is insufficient to attach its benchmarks to a native model.

`sourceMetadata.scope` records `kind:"configured-native-models"`, sorted `nativeModelIDs`, `receivedRecordCount`, `receivedFactCount`, `retainedRecordCount` and `retainedFactCount`. Downloaded counts describe the upstream response; retained counts describe the published subset. Progress and source status distinguish **downloaded** from **linked records**, with a separate linked-native-model count when supplied. A record count can include several configurations or canonical dependencies for one model. Old receipts without downloaded counts show **stored records**. A job's counts come from its own receipt or its exact published snapshot, rather than a later source update.

Original source observations, identities, dates and configurations of retained records stay intact. Storage cleanup removes obsolete source snapshots and unrelated records. The warehouse and shared `model_catalog` tool expose the scoped subset, not an optional full catalog. This scope concerns stored comparison data and UI inventory; it never grants or denies runtime capabilities or permissions.

OpenCode's declared `Model.api.id` reaches the matcher through a private identity-only projection before public provider sanitization. API URLs, request headers and credentials are excluded from that projection and from the browser model view. Canonical and deployment matches remain separate; an alias never merges their measurements or prices.

The reviewed identity registry is authored in `domain/model-data-identities.mjs`. It contains source IDs and identity provenance, without benchmark values or credentials. AA records must still match their reviewed UUID, creator, tested name, slug and source release date; a changed identity tuple is left unlinked. An explicit provider deployment's `canonical_model_id` supplies the bridge to the underlying model. No unsupported OpenCode extension fields or manual per-user mapping setup are required.

When AA needs canonical context for a newly connected inventory, its update also refreshes Models.dev first. The job shows both sources. If that required identity update fails, the existing AA snapshot is preserved. Existing canonical context can be reused for an AA-only update. Source release dates remain source-specific, including documented differences between the catalogs.

## Observations and interpretation

Every returned observation has a stable source-record `subject`, attribute, original JSON value, units, scale metadata, configuration, exact source pointer, retrieval date and identity status. No metric is converted to the retired five estimated card scores.

The UI and tool guidance call these source attributes **observations**. Existing
snapshot/wire `facts` fields, fact-count keys and the `model_data_facts` table
keep their names and schema. They store retrieved source values, not authored
memories or independently verified conclusions.

### Shared catalog and evidence observations

`model_catalog schema` and `evidence_evaluation describe.modelCatalogSchema` expose the same read-time schema, `freelancer.model-observations` version 1. Catalog `list`, `search`, and `detail` consistently return `records[]`. List/search metadata has `observationsRequested:false`; detail supplies `records[].observations`, its bounded page and source record continuation cursor. Native model detail can return several separate source records. Use each exact `records[].id` as a catalog evidence selector's `recordID`.

Each observation adds a uniform `key`, `source`, `availability` and immutable snapshot provenance to the existing source observation. `attribute` remains the exact original source name for compatibility. Both tools accept canonical keys or original names in `attributes`; filtering happens in the database before pagination. The evidence tool uses the same catalog identity decoration and observation format. Browser source details and durable raw observations retain their existing source fields.

Native catalog output uses compact JSON and a 40,000-byte response budget, below OpenCode's tool-output boundary. Global inventory identity mappings and request-time arrays become scope/request counts; exact selected record identities, references and snapshot hashes stay intact. An observation carries its exact source pointer in `sourceRef` and identity evidence in `identityMatch`, without duplicating them inside `provenance`. Physical pages shrink when needed and disclose `page.responseLimit` and `boundedBy:"native-response-bytes"`. Continue with the original requested `limit`, filters and `nextCursor`; the cursor skips only returned rows. Multi-record native detail can also shrink its record page and marks `recordsTruncated`, directing discovery through list/search. A single observation too large for the native budget is rejected explicitly; the stored observation is preserved. Browser and durable storage schemas retain their full metadata.

| Shared key | Models.dev source | Artificial Analysis Free source |
| --- | --- | --- |
| `pricing.input`, `pricing.output` | `cost.input`, `cost.output` | `pricing.price_1m_input_tokens`, `pricing.price_1m_output_tokens` |
| `pricing.cache_read`, `pricing.cache_write` | `cost.cache_read`, `cost.cache_write` | `pricing.price_1m_cache_hit_tokens`, `pricing.price_1m_cache_write_tokens` |
| `limits.context`, `limits.input`, `limits.output` | `limit.*` | Not covered by this endpoint |
| `capabilities.tools`, `capabilities.reasoning`, `capabilities.structured_output` | `tool_call`, `reasoning`, `structured_output` | Not covered by this endpoint |
| `ratings.artificial-analysis.<index>` | Not covered | Original nine composite indices |
| `benchmarks.score`, `benchmarks.result` | Original named canonical benchmarks | Individual benchmarks excluded from Free |
| `performance.output_tokens_per_second` and time keys | Not covered | Original median performance across serving providers |

All supported keys and source mappings are discoverable from the schema. Unrecognized observations use `source.<source>.<originalAttribute>` without assigning a meaning. Repeated price tiers, experimental modes, benchmark scores and tested configurations remain separate observations. Sharing a price key does not make an AA provider median or published price equivalent to a native deployment or account cost. No scale, score, reasoning variant, missing measurement or price is invented.

Coverage distinguishes `not-covered`, `not-recorded`, `source-reported-unavailable` and `not-in-page`. A null from AA is an explicit upstream unavailable measurement; a missing optional Models.dev field is absent source data. AA's Free response shape does not expand when the caller has a paid-tier key. A missing exact source identity link likewise does not prove that a configured model lacks capabilities or that the database lost its data.

### Source-field mapping

Known fields keep their source names. Nested objects use dotted attributes; JSON pointers preserve the original field path and escaping. A record's stable identity is stored separately from its display name.

| Source field or section | Stored representation |
| --- | --- |
| Models.dev `/models/{canonicalID}` | `model` record; source-qualified canonical identity; original fields as observations and raw model JSON. |
| Models.dev `/providers/{providerID}/models/{modelID}` | Separate `deployment` record; exact native provider/model identity; optional `canonical_model_id` association. |
| Models.dev provider metadata | `raw.provider` plus `source.provider.{field}` observations; public environment variable names remain names, not credentials. |
| `attachment`, `reasoning`, `tool_call`, `structured_output`, `open_weights`, modalities and other known model fields | Source-named typed observations; booleans and arrays retain their original types. |
| `cost.*`, `cost.tiers.*`, `experimental.modes.*.cost.*` | Source-named pricing observations; units and tier/mode configuration retained. |
| `limit.*`, reasoning options, provider request shape, body and headers | Source-named observations with exact source pointers; native execution support stays independent. |
| `benchmarks.{index}.*` | Original metric, score and supplied benchmark configuration, dates and publication URL. |
| AA `id`, `name`, `slug`, creator and release date | UUID-qualified `configuration` record; original tested name and slug; no reasoning setting inferred from its name. |
| AA `evaluations.*`, `pricing.*`, `performance.*` | Same dotted attributes, source units/scale and tested configuration. |
| AA `artificial_analysis_intelligence_index_cost.*` | Source-named USD evaluation/task cost observations. |
| Unrecognized source fields | `source.*` observations and unchanged raw JSON; no fabricated schema meaning or units. |

Missing fields and explicit source `null` values have separate presence states. Retrieval timestamps and request/page counters are retained as retrieval metadata; they are not measurement dates or changed model observations. Identical content is deduplicated across retrieval times and retry counts.

| Observation family | Units and interpretation |
| --- | --- |
| Models.dev `cost.*` | USD per million tokens; tiers and experimental modes retain their configuration |
| Models.dev `limit.*` | Tokens, specific to model or deployment |
| Canonical `benchmarks.*.score` | Source-reported metric; no assumed scale or harness equivalence |
| AA `evaluations.*` | Named composite index points; higher is better; no fabricated universal range |
| AA `pricing.*` | USD per million input, output, cache-hit or cache-write tokens |
| AA `performance.*` | Median tokens/second or seconds across providers, not selected native deployment measurements |
| AA evaluation costs | USD for the full index or weighted average task |

The response index version is major/minor only. Intelligence, Coding and Agentic retain that context; independently versioned capability indices retain an unknown version when none is returned. The methodology's current patch version is not substituted into a response. Retrieval time is not measurement time. End-to-end latency assumes 500 answer tokens under the documented convention. See [AA methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking) and [capability index composition](https://artificialanalysis.ai/methodology/capability-indices).

## Quota, errors and bounds

AA documents **100 Free requests per fixed 24-hour window**, shared by its organization/user scope across keys. `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` and `X-AA-Tier` are retained; reset is Unix seconds converted to milliseconds. `Retry-After` on 429 supplies a wait duration. Freelancer's service reserves each HTTP attempt durably via `onRequest`, conservatively enforcing its own 100-per-rolling-day bound; the vendor headers govern actual shared quota. No hard Models.dev quota was found in its official API instructions.

AA Free is for internal use with attribution, without redistribution, and its self-service eligibility is below 150 employees. A visible source credit is required. These limits are from the [current tier and licensing page](https://artificialanalysis.ai/data-api); this implementation does not bundle or redistribute an authenticated AA dataset.

The adapters use fixed HTTPS GET routes, reject redirects, keep keys in headers, and sanitize failure messages. Limits: 15 seconds per request, 60 seconds overall, 16 MiB per body, 32 MiB across bodies, 20 pages and at most two attempts. Only transient network/server failures receive bounded backoff. Authentication, forbidden access, quota, malformed schema, size and pagination failures are not retried. A failed refresh returns no partially published snapshot.

Normalized snapshots are limited to 20,000 records, 10,000 observations per record, two million observations overall, 64 KiB per observation and 128 MiB overall. This bound applies to the validated full feed before configured-model filtering and differs from the HTTP body bound. The full catalog observed on 2026-10-03 used about 5.7 MB on the wire and 95.5 MB after attaching per-observation provenance, identities and configuration (8,841 records and 237,485 observations). Those historical feed counts are not the current scoped storage count; counts change with the source and native connections. The larger explicit normalized bound validates the full feed without silently truncating its observations, then only matching configured records are published. Oversize or invalid data is rejected explicitly. Stored last-success data, generation fencing, durable quotas and encrypted source secrets belong to the service/warehouse layer, not the stateless HTTP adapter.

## Evidence limits

### Published Jev contracts

Context7 and the live [TypeSafe JavaScript SDK documentation](https://docs.typesafe.ai/sdk/javascript) were checked alongside the installed `@typesafe-ai/sdk` 0.6.0 declarations. Its existing `systemOne` request accepts named questions and text, JSON object/array or null state; the result contains question-keyed answers, the reported model and token usage. See the published [request](https://docs.typesafe.ai/sdk/javascript/api/interfaces/SystemOneRequest) and [result](https://docs.typesafe.ai/sdk/javascript/api/interfaces/SystemOneResult) interfaces.

Catalog details return bounded source records and observations as usable JSON state, with original metric names, configuration, identity and provenance. Question definitions belong to their existing caller; this feature neither invents example questions nor runs Jev. A source benchmark's numeric value remains a source measurement. It is not a TypeSafe [Score response](https://docs.typesafe.ai/sdk/javascript/api/interfaces/ScoreResponse), which represents an expected position in a supplied rubric with its legend, probabilities and confidence. The existing judgment adapter and recommendation/routing behavior are retained.

### Validation boundary

The fixture contracts cover envelopes, values, dates, scales, exact identities, page completion, quota reservation, secret-safe errors, retry limits, cancellation and size bounds. Public source retrieval confirms documented shapes. Actual authenticated AA Free access and provider/model inference require separate evidence; neither is implied by those contracts.
