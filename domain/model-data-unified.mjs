// Read-time tool schema. Stored facts and upstream wire schemas remain unchanged.
export const MODEL_OBSERVATION_SCHEMA_ID = 'freelancer.model-observations';
export const MODEL_OBSERVATION_SCHEMA_VERSION = 1;
// Native OpenCode tool output is bounded at 50 KB. Leave room for its envelope.
export const MODEL_CATALOG_AGENT_RESPONSE_BYTES = 40_000;
const pick = (value,keys) => Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));

function compactQuota(value) {
  if(!value)return null;
  return {...pick(value,['limit','remaining','resetAt','tier','retryAfterMs']),
    ...(Array.isArray(value.requestTimes)?{trackedRequestCount:value.requestTimes.length}:{})};
}
export function compactModelSnapshotMetadata(metadata) {
  if(!metadata)return null;
  const original=metadata.sourceMetadata??{},scope=original.scope;
  const sourceMetadata={...pick(original,['pages','requests','tier','intelligenceIndexVersion']),
    ...(original.pagination?{pagination:pick(original.pagination,['page','page_size','total_pages','has_more'])}:{})};
  if(scope)sourceMetadata.scope={...pick(scope,['kind','matchedNativeModelCount','receivedFactCount','receivedRecordCount','retainedFactCount','retainedRecordCount']),
    ...Object.fromEntries(['nativeModelIDs','canonicalLinks','modelLinks','identityLinks'].filter(key=>Array.isArray(scope[key]))
      .map(key=>[`${key}Count`,scope[key].length])),globalMappingsOmitted:true};
  return {...pick(metadata,['factCount']),...(metadata.quota?{quota:compactQuota(metadata.quota)}:{}),sourceMetadata};
}
export function compactModelDataSource(source) {
  return {...pick(source,['id','source','name','url','attribution','configured','state','status','currentSnapshotID','currentJobID',
    'lastSuccessAt','lastRefreshAt','lastAttemptAt','retryAt','recordCount','version','updatedAt','error']),
    ...(source.quota?{quota:compactQuota(source.quota)}:{}),
    current:source.current?{...pick(source.current,['contentSha256','retrievedAt','recordCount','sourceReference']),
      metadata:compactModelSnapshotMetadata(source.current.metadata)}:null};
}
export function compactModelDataStatus(status) {
  return {sources:(status.sources??[]).map(compactModelDataSource),
    job:status.job?pick(status.job,['id','status','createdAt','updatedAt','summary','sources','results','error']):null,
    ...(status.maintenance?{maintenance:status.maintenance}:{})};
}
const sources = ['modelsdev', 'artificial-analysis'];
const common = {
  'identity.id': { modelsdev: 'id', 'artificial-analysis': 'id' },
  'identity.name': { modelsdev: 'name', 'artificial-analysis': 'name' },
  'identity.slug': { 'artificial-analysis': 'slug' },
  'metadata.description': { modelsdev: 'description' },
  'metadata.release_date': { modelsdev: 'release_date', 'artificial-analysis': 'release_date' },
  'metadata.last_updated': { modelsdev: 'last_updated' },
  'metadata.knowledge_cutoff': { modelsdev: 'knowledge' },
  'metadata.license': { modelsdev: 'license' },
  'capabilities.attachments': { modelsdev: 'attachment' },
  'capabilities.reasoning': { modelsdev: 'reasoning' },
  'capabilities.tools': { modelsdev: 'tool_call' },
  'capabilities.structured_output': { modelsdev: 'structured_output' },
  'capabilities.temperature': { modelsdev: 'temperature' },
  'capabilities.open_weights': { modelsdev: 'open_weights' },
  'reasoning.options': { modelsdev: 'reasoning_options' },
  'modalities.input': { modelsdev: 'modalities.input' },
  'modalities.output': { modelsdev: 'modalities.output' },
  'limits.context': { modelsdev: 'limit.context' },
  'limits.input': { modelsdev: 'limit.input' },
  'limits.output': { modelsdev: 'limit.output' },
  'pricing.input': { modelsdev: 'cost.input', 'artificial-analysis': 'pricing.price_1m_input_tokens' },
  'pricing.output': { modelsdev: 'cost.output', 'artificial-analysis': 'pricing.price_1m_output_tokens' },
  'pricing.cache_read': { modelsdev: 'cost.cache_read', 'artificial-analysis': 'pricing.price_1m_cache_hit_tokens' },
  'pricing.cache_write': { modelsdev: 'cost.cache_write', 'artificial-analysis': 'pricing.price_1m_cache_write_tokens' },
  'pricing.reasoning': { modelsdev: 'cost.reasoning' },
  'pricing.input_audio': { modelsdev: 'cost.input_audio' },
  'pricing.output_audio': { modelsdev: 'cost.output_audio' },
  'performance.output_tokens_per_second': { 'artificial-analysis': 'performance.median_output_tokens_per_second' },
  'performance.time_to_first_token': { 'artificial-analysis': 'performance.median_time_to_first_token_seconds' },
  'performance.time_to_first_answer_token': { 'artificial-analysis': 'performance.median_time_to_first_answer_token_seconds' },
  'performance.end_to_end_response_time': { 'artificial-analysis': 'performance.median_end_to_end_response_time_seconds' },
  'evaluation_cost.intelligence_total': { 'artificial-analysis': 'artificial_analysis_intelligence_index_cost.total_cost' },
  'evaluation_cost.intelligence_per_task': { 'artificial-analysis': 'artificial_analysis_intelligence_index_cost.cost_per_task.total_cost' },
};
for (const name of ['intelligence','coding','agentic','finance_and_accounting','strategy_and_ops','legal',
  'healthcare_and_medical','engineering','economics'])
  common[`ratings.artificial-analysis.${name}`] = { 'artificial-analysis': `evaluations.artificial_analysis_${name}_index` };
const reverse = Object.fromEntries(sources.map(source => [source, new Map(Object.entries(common)
  .filter(([,fields]) => fields[source]).map(([key,fields]) => [fields[source],key]))]));
const priceSuffixes = new Set(['input','output','cache_read','cache_write','reasoning','input_audio','output_audio']);

export function modelObservationKey(source, attribute) {
  const mapped = reverse[source]?.get(attribute);
  if (mapped) return mapped;
  if (source === 'modelsdev') {
    const cost = /^(?:cost\.(?:context_over_200k|tiers\.\d+)|experimental\.modes\.[^.]+\.cost)\.([^.]+)$/.exec(attribute);
    if (cost && priceSuffixes.has(cost[1])) return `pricing.${cost[1]}`;
    if (/^benchmarks\.\d+\.score$/.test(attribute)) return 'benchmarks.score';
    if (/^benchmarks\.\d+$/.test(attribute)) return 'benchmarks.result';
  }
  return `source.${source}.${attribute}`;
}

// SQL filters contain only literal source names and fixed, authored glob patterns.
// Selection precedes pagination so an earlier unrelated fact page cannot hide a match.
export function modelObservationAttributeFilter(source, attributes) {
  const exact = new Set(), globs = new Set();
  for (const requested of attributes) {
    if (common[requested]) {
      if (common[requested][source]) exact.add(common[requested][source]);
      if (source === 'modelsdev' && requested.startsWith('pricing.')) {
        const suffix = requested.slice('pricing.'.length);
        if (priceSuffixes.has(suffix)) for (const prefix of ['cost.context_over_200k','cost.tiers.*','experimental.modes.*.cost'])
          globs.add(`${prefix}.${suffix}`);
      }
    } else if (source === 'modelsdev' && requested === 'benchmarks.score') globs.add('benchmarks.[0-9]*.score');
    else if (source === 'modelsdev' && requested === 'benchmarks.result') globs.add('benchmarks.[0-9]*');
    else if (requested.startsWith(`source.${source}.`)) exact.add(requested.slice(`source.${source}.`.length));
    else exact.add(requested); // Existing source-native selectors remain valid.
  }
  return { exact: [...exact].sort(), patterns: [...globs].sort().map(glob =>
    ({ glob, exclude: glob === 'benchmarks.[0-9]*' ? 'benchmarks.*.*' : null })) };
}

export function toModelObservation(fact, record) {
  const source = record.source ?? record.identifiers?.source ?? (record.id.startsWith('modelsdev:') ? 'modelsdev' : 'artificial-analysis');
  return { ...fact, key: modelObservationKey(source,fact.attribute), source,
    availability: fact.value === null ? 'source-reported-unavailable' : 'present',
    provenance: { recordID: record.id, snapshotID: record.snapshotID ?? null,
      snapshotSha256: record.snapshotSha256 ?? null } };
}

export function modelObservationCoverage(record, observations, requested, truncated = false) {
  const source = record.source ?? record.identifiers?.source;
  const selected=new Set(requested??observations.flatMap(row=>[row.key,row.attribute]));
  const coverage = Object.entries(record.fieldPresence?.attributes ?? {}).map(([attribute,entry]) =>
    ({ key: modelObservationKey(source,attribute), attribute, ...entry }))
    .filter(row=>selected.has(row.key)||selected.has(row.attribute));
  const requestedCoverage = (requested ?? []).map(attribute => {
    const found = observations.filter(row => row.key === attribute || row.attribute === attribute);
    const covered = common[attribute] ? !!common[attribute][source]
      : attribute.startsWith('benchmarks.') ? source === 'modelsdev' : true;
    return { key: attribute, state: found.length ? found.some(row => row.value !== null) ? 'present' : 'source-reported-unavailable'
      : !covered ? 'not-covered' : truncated ? 'not-in-page' : 'not-recorded', observations: found.length };
  });
  return { attributes: coverage, requested: requestedCoverage,
    categories: record.fieldPresence?.categories ?? {}, partial: truncated,
    note: 'Absent and null values remain unknown. A source field does not establish account pricing, deployment performance, native support or authorization.' };
}

export function toModelObservationRecord(detail, { attributes } = {}) {
  const record = detail.record ?? detail;
  const { raw, rawBytes, rawTruncated,fieldPresence,sourceSnapshot,...metadata } = record;
  const observations = (detail.facts ?? []).map(fact => toModelObservation(fact,record));
  return { ...metadata,...(sourceSnapshot?{sourceSnapshot:{sourceReference:sourceSnapshot.sourceReference,
      metadata:compactModelSnapshotMetadata(sourceSnapshot.metadata)}}:{}),observations, observationPage: detail.page ?? null,
    nextCursor: detail.nextCursor ?? null, observationsTruncated: detail.factsTruncated === true,
    observationsRequested: Array.isArray(detail.facts),
    coverage: modelObservationCoverage(record,observations,attributes,detail.factsTruncated === true) };
}

export function modelObservationSchema() {
  return { id: MODEL_OBSERVATION_SCHEMA_ID, version: MODEL_OBSERVATION_SCHEMA_VERSION,
    observation: { required: ['id','subject','key','attribute','source','value','availability','configuration','sourceRef','dates','provenance'],
      fields: { key: 'Canonical selector key from attributes; unrecognized fields use source.<source>.<originalAttribute>.',
        attribute: 'Exact original source attribute; retained for compatibility. Selectors accept key or attribute.',
        value: 'Original JSON, including false, zero, strings and null. No normalization or imputation.',
        availability: 'present | source-reported-unavailable', units: 'Original units or null', scale: 'Original scale/version or null',
        configuration: 'Original provider, price tier, experimental mode or AA tested configuration',
        sourceRef: 'Exact upstream URL and JSON pointer', dates: 'Source dates and retrieval time; retrieval is not measurement',
        provenance: 'Exact source record and immutable snapshot hash. Exact source pointer is sourceRef; asserted identity evidence is identityMatch.' } },
    attributes: Object.entries(common).map(([key,sourceAttributes]) => ({ key,sourceAttributes })),
    repeatedAttributes: [{ key:'pricing.*',source:'modelsdev',meaning:'Base, context tiers and modes share pricing keys; keep their configurations separate.' },
      { key:'benchmarks.score',source:'modelsdev',meaning:'Original named benchmark score; metric/harness/variant/version retained, never equated to AA indices.' },
      { key:'benchmarks.result',source:'modelsdev',meaning:'Original named benchmark object.' }],
    sourceCoverage: { modelsdev: 'Canonical models and provider deployments: specifications, published prices, optional source benchmarks.',
      'artificial-analysis': 'Free endpoint: nine composite indices, token prices, evaluation costs and provider-median performance. Individual benchmarks, percentiles, provider detail, limits and capabilities are outside this endpoint.' },
    selection: 'Detail attributes are filtered before bounded pagination. Use source record IDs from records[].id for evidence; native detail returns separate records for each asserted model/deployment/tested configuration.',
    scope: 'Published comparison snapshots are scoped to configured native inventory; schema discovery never fetches or broadens the catalog.',
    boundaries: ['No averaged ratings, invented measurement ranges, or missing-value zeros','Source prices and performance remain separate by configuration','Native execution identity and permissions remain authoritative'] };
}
