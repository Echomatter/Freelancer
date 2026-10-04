// Wire schemas verified against Models.dev and the Artificial Analysis V2 Free API.
// Keep measurements in their source scale; these are not estimated card ratings.
import { MODEL_DATA_IDENTITIES, MODEL_DATA_IDENTITY_REVIEW } from './model-data-identities.mjs';

export const MODEL_DATA_SCHEMA_VERSION = 1;
export const MODEL_DATA_SOURCES = ['modelsdev', 'artificial-analysis'];
export const MODEL_DATA_LIMITS = Object.freeze({ records: 20_000, facts: 2_000_000,
  factsPerRecord: 10_000, factBytes: 64 * 1024, snapshotBytes: 128 * 1024 * 1024 });
export const MODEL_DATA_URLS = Object.freeze({
  modelsdev: 'https://models.dev/catalog.json?type=all',
  'artificial-analysis': 'https://artificialanalysis.ai/api/v2/language/models/free',
});

const aaIndices = ['intelligence', 'coding', 'agentic', 'finance_and_accounting', 'strategy_and_ops',
  'legal', 'healthcare_and_medical', 'engineering', 'economics'].map(name => `artificial_analysis_${name}_index`);
const aaPrices = ['price_1m_input_tokens', 'price_1m_output_tokens', 'price_1m_cache_hit_tokens', 'price_1m_cache_write_tokens'];
const aaPerformance = ['median_output_tokens_per_second', 'median_time_to_first_token_seconds',
  'median_time_to_first_answer_token_seconds', 'median_end_to_end_response_time_seconds'];
const modelFields = new Set(['id', 'type', 'name', 'description', 'family', 'attachment', 'reasoning',
  'reasoning_options', 'tool_call', 'structured_output', 'temperature', 'knowledge', 'release_date',
  'last_updated', 'modalities', 'open_weights', 'limit', 'license', 'links', 'weights', 'benchmarks',
  'status', 'interleaved', 'provider', 'experimental', 'canonical_model_id', 'cost']);
const boolFields = ['attachment', 'reasoning', 'tool_call', 'structured_output', 'temperature', 'open_weights'];
const priceFields = ['input', 'output', 'reasoning', 'cache_read', 'cache_write', 'input_audio', 'output_audio'];
function knownField(source, prefix, key) {
  if (!prefix) return source === 'modelsdev' ? modelFields.has(key) :
    ['id', 'name', 'slug', 'release_date', 'model_creator', 'evaluations', 'artificial_analysis_intelligence_index_cost', 'pricing', 'performance'].includes(key);
  if (source === 'modelsdev') {
    if (prefix === 'limit') return ['context', 'input', 'output'].includes(key);
    if (prefix === 'modalities') return ['input', 'output'].includes(key);
    if (/^cost(?:\.(?:context_over_200k|tiers\.\d+))?$/.test(prefix)) return [...priceFields, 'context_over_200k', 'tiers', 'tier'].includes(key);
    if (/^cost\.tiers\.\d+\.tier$/.test(prefix)) return ['type', 'size'].includes(key);
    if (prefix === 'provider') return ['npm', 'api', 'shape', 'body', 'headers'].includes(key);
    if (prefix === 'interleaved') return key === 'field';
    if (prefix === 'experimental') return key === 'modes';
    if (/^experimental\.modes\.[^.]+$/.test(prefix)) return ['cost', 'provider'].includes(key);
    if (/^experimental\.modes\.[^.]+\.cost$/.test(prefix)) return priceFields.includes(key);
    if (/^experimental\.modes\.[^.]+\.provider$/.test(prefix)) return ['body', 'headers'].includes(key);
    // Mode keys, request bodies and public header names are source-defined JSON.
    return prefix === 'experimental.modes' || prefix.includes('.body') || prefix.includes('.headers');
  }
  if (prefix === 'model_creator') return ['id', 'name'].includes(key);
  if (prefix === 'evaluations') return aaIndices.includes(key);
  if (prefix === 'pricing') return aaPrices.includes(key);
  if (prefix === 'performance') return aaPerformance.includes(key);
  if (prefix === 'artificial_analysis_intelligence_index_cost') return ['total_cost', 'cost_per_task'].includes(key);
  return prefix === 'artificial_analysis_intelligence_index_cost.cost_per_task' && key === 'total_cost';
}
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = () => { throw new TypeError('Invalid model data source schema.'); };
const requireObject = value => { if (!obj(value)) fail(); return value; };
const str = value => { if (typeof value !== 'string' || !value.trim() || value.length > 8192) fail(); return value; };
const num = (value, nullable = false, min = -Infinity) => {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) fail();
};
const integer = (value, min = 0) => { num(value, false, min); if (!Number.isSafeInteger(value)) fail(); };
const pointer = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const sourceID = (...parts) => parts.map(part => encodeURIComponent(part)).join(':');
const sortRecords = records => records.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const reviewedCanonicalModels = new Map(MODEL_DATA_IDENTITIES.map(model => [model.canonicalModelID, model]));
const reviewedArtificialAnalysisModels = new Map();
for (const model of MODEL_DATA_IDENTITIES) for (const configuration of model.configurations) {
  const entries = reviewedArtificialAnalysisModels.get(configuration.sourceID) ?? [];
  entries.push({ model, configuration });
  reviewedArtificialAnalysisModels.set(configuration.sourceID, entries);
}

function reviewedArtificialAnalysisIdentity(record) {
  if (record.kind !== 'configuration' || record.identifiers?.source !== 'artificial-analysis' ||
      record.id !== sourceID('artificial-analysis', 'configuration', record.identifiers.sourceID)) return [];
  return (reviewedArtificialAnalysisModels.get(record.identifiers.sourceID) ?? []).filter(({ model, configuration }) => {
    if (record.identifiers.creatorID !== model.creatorID || record.identifiers.slug !== configuration.slug ||
        record.name !== configuration.testedName || record.sourceDates?.release_date !== configuration.releaseDate ||
        (record.identifiers.creatorName !== undefined && record.identifiers.creatorName !== model.creatorName) ||
        (record.identifiers.creatorSlug !== undefined && record.identifiers.creatorSlug !== model.creatorSlug) ||
        (record.configuration?.testedName !== undefined && record.configuration.testedName !== configuration.testedName) ||
        (record.configuration?.slug !== undefined && record.configuration.slug !== configuration.slug)) return false;
    // List projections omit raw data. When present, the original tuple must agree too.
    if (record.raw !== undefined && (!obj(record.raw) || record.raw.id !== configuration.sourceID ||
        record.raw.name !== configuration.testedName || record.raw.slug !== configuration.slug ||
        record.raw.release_date !== configuration.releaseDate || record.raw.model_creator?.id !== model.creatorID ||
        record.raw.model_creator?.name !== model.creatorName ||
        (record.raw.model_creator?.slug !== undefined && record.raw.model_creator.slug !== model.creatorSlug))) return false;
    return true;
  });
}

function reviewedModelEvidence(model, configuration) {
  return [
    { url: MODEL_DATA_IDENTITY_REVIEW.modelsDevURL, path: `/models/${pointer(model.canonicalModelID)}`,
      label: `${model.canonicalName}: canonical source identity (${model.canonicalReleaseDate}).` },
    { url: configuration.url, path: '/currentModel',
      label: `${configuration.testedName}: source release ${model.release.slug} (${configuration.releaseDate}); ${model.reviewNote}` },
  ];
}

function date(value, nullable = false) {
  if (nullable && value === null) return;
  str(value);
  // Preserve month precision rather than inventing a day or measurement time.
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match) fail();
  const year = Number(match[1]), month = Number(match[2]), day = match[3] && Number(match[3]);
  if (month < 1 || month > 12 || (day !== undefined && (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()))) fail();
}

function json(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 10_000_000 || depth > 32) fail();
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { num(value); return; }
  if (typeof value === 'string') return;
  if (Array.isArray(value)) { for (const item of value) json(item, depth + 1, budget); return; }
  requireObject(value);
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || key.length > 8192) fail();
    json(item, depth + 1, budget);
  }
}

function https(value) {
  str(value);
  let parsed; try { parsed = new URL(value); } catch { fail(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail();
}

function checkCost(value, nested = true) {
  requireObject(value);
  for (const field of priceFields) if (field in value) num(value[field], false, 0);
  if (!('input' in value) || !('output' in value)) fail();
  if (!nested) return;
  if ('context_over_200k' in value) checkCost(value.context_over_200k, false);
  if ('tiers' in value) {
    if (!Array.isArray(value.tiers)) fail();
    const sizes = new Set();
    for (const tier of value.tiers) {
      checkCost(tier, false); requireObject(tier.tier);
      if (tier.tier.type !== 'context') fail(); integer(tier.tier.size);
      if (sizes.has(tier.tier.size)) fail(); sizes.add(tier.tier.size);
    }
  }
}

function checkModel(value, deployment) {
  requireObject(value); str(value.id); str(value.name); str(value.description);
  for (const field of boolFields) if (field in value && typeof value[field] !== 'boolean') fail();
  if (deployment) {
    for (const field of ['attachment', 'reasoning', 'tool_call', 'open_weights']) if (!(field in value)) fail();
    for (const field of ['release_date', 'last_updated', 'modalities', 'limit']) if (!(field in value)) fail();
  }
  for (const field of ['knowledge', 'release_date', 'last_updated']) if (field in value) date(value[field]);
  for (const field of ['family', 'license', 'canonical_model_id']) if (field in value) str(value[field]);
  if ('type' in value && value.type !== 'decision') fail();
  if ('status' in value && !['alpha', 'beta', 'deprecated'].includes(value.status)) fail();
  if ('limit' in value) {
    requireObject(value.limit);
    for (const field of ['context', 'input', 'output']) if (field in value.limit) num(value.limit[field], false, 0);
    if (!('context' in value.limit) || (deployment && !('output' in value.limit))) fail();
  }
  if ('modalities' in value) {
    requireObject(value.modalities);
    for (const field of ['input', 'output']) {
      if (!Array.isArray(value.modalities[field]) || value.modalities[field].some(v => !['text', 'audio', 'image', 'video', 'pdf'].includes(v))) fail();
    }
  }
  if ('reasoning_options' in value) {
    if (!Array.isArray(value.reasoning_options)) fail();
    for (const option of value.reasoning_options) {
      requireObject(option);
      if (!['toggle', 'effort', 'budget_tokens'].includes(option.type)) fail();
      if (option.type === 'effort' && (!Array.isArray(option.values) || option.values.some(v => ![null, 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'default'].includes(v)))) fail();
      if (option.type === 'budget_tokens') {
        if ('min' in option) num(option.min, false, -1);
        if ('max' in option) num(option.max, false, 0);
        if (option.min !== undefined && option.max !== undefined && option.min > option.max) fail();
      }
    }
  }
  if (deployment && ((value.reasoning && !('reasoning_options' in value)) ||
    (!value.reasoning && ('reasoning_options' in value || value.cost?.reasoning !== undefined)))) fail();
  if ('interleaved' in value && value.interleaved !== true && (!obj(value.interleaved) || !['reasoning_content', 'reasoning_details'].includes(value.interleaved.field))) fail();
  if ('cost' in value) checkCost(value.cost);
  if ('provider' in value) {
    requireObject(value.provider);
    for (const field of ['npm', 'api']) if (field in value.provider) str(value.provider[field]);
    if ('shape' in value.provider && !['responses', 'completions'].includes(value.provider.shape)) fail();
    if ('body' in value.provider) requireObject(value.provider.body);
    if ('headers' in value.provider) {
      requireObject(value.provider.headers); if (Object.values(value.provider.headers).some(v => typeof v !== 'string')) fail();
    }
  }
  if ('experimental' in value) {
    requireObject(value.experimental);
    if ('modes' in value.experimental) for (const mode of Object.values(requireObject(value.experimental.modes))) {
      requireObject(mode); if ('cost' in mode) checkCost(mode.cost, false);
      if ('provider' in mode) { requireObject(mode.provider); if ('body' in mode.provider) requireObject(mode.provider.body);
        if ('headers' in mode.provider && Object.values(requireObject(mode.provider.headers)).some(v => typeof v !== 'string')) fail(); }
    }
  }
  for (const field of ['links', 'weights', 'benchmarks']) if (field in value) {
    if (!Array.isArray(value[field])) fail();
    for (const item of value[field]) {
      requireObject(item);
      if (field === 'benchmarks') {
        str(item.name); if (typeof item.score !== 'string') num(item.score); else str(item.score);
        for (const f of ['metric', 'harness', 'variant', 'dataset', 'version']) if (f in item) str(item[f]);
        if ('source' in item) https(item.source); if ('date' in item) date(item.date);
      } else { https(item.url); for (const f of ['label', 'format', 'quantization']) if (f in item) str(item[f]); }
    }
  }
}

function makeRecord(source, kind, native, { id, provider, modelID, aliases = [], identifiers, configuration = {}, url, path, retrievedAt, indexVersion }) {
  const sourceDates = Object.fromEntries(['release_date', 'last_updated', 'knowledge'].filter(k => k in native).map(k => [k, native[k]]));
  const reference = { url, path };
  const facts = [];
  function add(attribute, value, pathSuffix, config = configuration, metadata = {}) {
    const fact = { attribute, value, units: null, scale: null, configuration: { ...config },
      sourceRef: { url, path: path + pathSuffix }, dates: { retrievedAt },
      identityMatch: { status: 'unmatched', candidateIDs: [] }, ...metadata };
    if (new TextEncoder().encode(JSON.stringify(fact)).byteLength > MODEL_DATA_LIMITS.factBytes) fail();
    facts.push(fact); if (facts.length > MODEL_DATA_LIMITS.factsPerRecord) fail();
  }
  function fields(value, prefix = '', ptr = '', known = true, config = configuration) {
    for (const [key, item] of Object.entries(value)) {
      const attr = prefix ? `${prefix}.${key}` : key;
      const sourcePath = `${ptr}/${pointer(key)}`;
      const isKnown = known && knownField(source, prefix, key);
      const metadata = {};
      if (/^(?:cost|experimental\.modes\.[^.]+\.cost)\./.test(attr) && priceFields.includes(key)) metadata.units = 'USD/1M tokens';
      if (/^limit\.(context|input|output)$/.test(attr)) metadata.units = 'tokens';
      if (source === 'artificial-analysis') {
        if (attr.startsWith('evaluations.') && aaIndices.includes(key)) {
          metadata.units = 'index points';
          metadata.scale = { kind: 'composite-index', name: key, direction: 'higher-is-better',
            // The wire number reports major.minor only; capability indices have independent unspecified versions.
            version: ['intelligence', 'coding', 'agentic'].some(v => key === `artificial_analysis_${v}_index`) ? indexVersion : null,
            minimum: null, maximum: null, methodology: key.includes('intelligence') || key.includes('coding') || key.includes('agentic')
              ? 'https://artificialanalysis.ai/methodology/intelligence-benchmarking' : 'https://artificialanalysis.ai/methodology/capability-indices' };
        }
        if (attr.startsWith('pricing.') && aaPrices.includes(key)) metadata.units = 'USD/1M tokens';
        if (attr.startsWith('performance.') && aaPerformance.includes(key)) metadata.units = key.endsWith('per_second') ? 'tokens/second' : 'seconds';
        if (attr.startsWith('artificial_analysis_intelligence_index_cost.') && key === 'total_cost') metadata.units = 'USD';
      }
      const fieldConfig = source === 'modelsdev' && /^experimental\.modes\.[^.]+$/.test(attr)
        ? { ...config, mode: key } : source === 'modelsdev' && attr === 'cost.context_over_200k'
          ? { ...config, priceTier: { type: 'context', size: 200_000 } } : config;
      if (obj(item) && Object.keys(item).length) fields(item, attr, sourcePath, isKnown, fieldConfig);
      else if (source === 'modelsdev' && attr === 'cost.tiers') {
        for (let i = 0; i < item.length; i++) fields(item[i], `${attr}.${i}`, `${sourcePath}/${i}`, true,
          { ...config, priceTier: item[i].tier });
      } else if (source === 'modelsdev' && attr === 'benchmarks') {
        for (let i = 0; i < item.length; i++) {
          const benchmark = item[i];
          add(`benchmarks.${i}`, benchmark, `${sourcePath}/${i}`, { ...config, benchmark: benchmark.name,
            harness: benchmark.harness ?? null, variant: benchmark.variant ?? null, dataset: benchmark.dataset ?? null, version: benchmark.version ?? null });
          add(`benchmarks.${i}.score`, benchmark.score, `${sourcePath}/${i}/score`, { ...config, benchmark: benchmark.name,
            harness: benchmark.harness ?? null, variant: benchmark.variant ?? null, dataset: benchmark.dataset ?? null, version: benchmark.version ?? null,
            publicationURL: benchmark.source ?? null },
          { units: benchmark.metric ?? null, scale: { kind: 'source-reported', name: benchmark.name, metric: benchmark.metric ?? null },
            dates: { retrievedAt, ...(benchmark.date ? { publishedAt: benchmark.date } : {}) } });
        }
      } else add(isKnown ? attr : `source.${attr}`, item, sourcePath, config, metadata);
    }
  }
  fields(native);
  return { id, kind, name: native.name, ...(provider ? { provider } : {}), ...(modelID ? { modelID } : {}),
    aliases, identifiers, configuration, sourceReference: reference, sourceDates, raw: native, facts };
}

export function normalizeModelsDev(payload, { retrievedAt = Date.now(), sourceReference = MODEL_DATA_URLS.modelsdev } = {}) {
  integer(retrievedAt); https(sourceReference); requireObject(payload); json(payload);
  const combined = 'providers' in payload || 'models' in payload;
  const providers = requireObject(combined ? payload.providers : payload);
  const models = combined ? requireObject(payload.models) : {};
  const records = [];
  for (const [key, model] of Object.entries(models)) {
    checkModel(model, false); if (model.id !== key) fail();
    records.push(makeRecord('modelsdev', 'model', model, { id: sourceID('modelsdev', 'model', key), modelID: key,
      identifiers: { source: 'modelsdev', canonicalModelID: key },
      url: sourceReference, path: `/models/${pointer(key)}`, retrievedAt }));
  }
  for (const [providerKey, provider] of Object.entries(providers)) {
    requireObject(provider); str(provider.id); str(provider.name); str(provider.npm); str(provider.doc);
    if (provider.id !== providerKey || !Array.isArray(provider.env) || provider.env.length === 0 || provider.env.some(v => typeof v !== 'string')) fail();
    if ('api' in provider) str(provider.api);
    for (const [key, model] of Object.entries(requireObject(provider.models))) {
      checkModel(model, true); if (model.id !== key) fail();
      const path = `${combined ? '/providers' : ''}/${pointer(providerKey)}/models/${pointer(key)}`;
      // Provider metadata is public source data, not runtime credentials.
      const providerMetadata = Object.fromEntries(Object.entries(provider).filter(([field]) => field !== 'models'));
      const record = makeRecord('modelsdev', 'deployment', model, { id: sourceID('modelsdev', 'deployment', providerKey, key),
        provider: providerKey, modelID: key, identifiers: { source: 'modelsdev', providerID: providerKey, modelID: key,
          nativeID: `${providerKey}/${key}`, ...(model.canonical_model_id ? { canonicalModelID: model.canonical_model_id } : {}) },
        configuration: { providerID: providerKey }, url: sourceReference, path, retrievedAt });
      record.raw = { model, provider: providerMetadata };
      for (const [field, value] of Object.entries(providerMetadata)) record.facts.push({ attribute: `source.provider.${field}`, value,
        units: null, scale: null, configuration: { providerID: providerKey },
        sourceRef: { url: sourceReference, path: `${combined ? '/providers' : ''}/${pointer(providerKey)}/${pointer(field)}` },
        dates: { retrievedAt }, identityMatch: { status: 'unmatched', candidateIDs: [] } });
      records.push(record);
    }
  }
  return validateModelDataSnapshot({ schemaVersion: 1, source: 'modelsdev', retrievedAt,
    sourceReference: { url: sourceReference, path: '' }, records: sortRecords(records) });
}

export function normalizeArtificialAnalysis(payload, { retrievedAt = Date.now(), sourceReference = MODEL_DATA_URLS['artificial-analysis'] } = {}) {
  integer(retrievedAt); https(sourceReference); requireObject(payload); json(payload);
  if (!['free', 'pro', 'commercial'].includes(payload.tier)) fail(); num(payload.intelligence_index_version, false, 0);
  requireObject(payload.pagination);
  for (const field of ['page', 'page_size', 'total_pages']) integer(payload.pagination[field], 1);
  if (typeof payload.pagination.has_more !== 'boolean' || payload.pagination.page > payload.pagination.total_pages ||
    payload.pagination.has_more !== (payload.pagination.page < payload.pagination.total_pages)) fail();
  if (!Array.isArray(payload.data) || payload.data.length > MODEL_DATA_LIMITS.records) fail();
  const records = payload.data.map((row, index) => {
    requireObject(row); for (const field of ['id', 'name', 'slug']) str(row[field]); date(row.release_date, true);
    if (row.model_creator !== null) { requireObject(row.model_creator); str(row.model_creator.id); str(row.model_creator.name);
      if ('slug' in row.model_creator) str(row.model_creator.slug); }
    for (const [section, fields] of [['evaluations', aaIndices], ['pricing', aaPrices], ['performance', aaPerformance]]) {
      requireObject(row[section]); for (const field of fields) num(row[section][field], true,
        section === 'evaluations' ? -Infinity : 0);
    }
    if (row.artificial_analysis_intelligence_index_cost !== null) {
      const cost = requireObject(row.artificial_analysis_intelligence_index_cost); num(cost.total_cost, false, 0);
      if (cost.cost_per_task !== null) num(requireObject(cost.cost_per_task).total_cost, false, 0);
    }
    return makeRecord('artificial-analysis', 'configuration', row, { id: sourceID('artificial-analysis', 'configuration', row.id),
      aliases: [row.slug], identifiers: { source: 'artificial-analysis', sourceID: row.id, slug: row.slug,
        ...(row.model_creator ? { creatorID: row.model_creator.id, creatorName: row.model_creator.name,
          ...(row.model_creator.slug ? { creatorSlug: row.model_creator.slug } : {}) } : {}) },
      configuration: { testedName: row.name, slug: row.slug, performanceAggregation: 'median-across-providers',
        endToEndAnswerTokens: 500, intelligenceIndexVersion: payload.intelligence_index_version },
      url: sourceReference, path: `/data/${index}`, retrievedAt, indexVersion: payload.intelligence_index_version });
  });
  return validateModelDataSnapshot({ schemaVersion: 1, source: 'artificial-analysis', retrievedAt,
    sourceReference: { url: sourceReference, path: '' },
    sourceMetadata: { tier: payload.tier, intelligenceIndexVersion: payload.intelligence_index_version,
      pagination: payload.pagination }, records: sortRecords(records) });
}

export function validateModelDataSnapshot(snapshot) {
  requireObject(snapshot);
  if (snapshot.schemaVersion !== MODEL_DATA_SCHEMA_VERSION || !MODEL_DATA_SOURCES.includes(snapshot.source)) fail();
  integer(snapshot.retrievedAt); requireObject(snapshot.sourceReference); https(snapshot.sourceReference.url);
  if (!Array.isArray(snapshot.records) || snapshot.records.length > MODEL_DATA_LIMITS.records) fail();
  const ids = new Set(); let count = 0;
  for (const record of snapshot.records) {
    requireObject(record); str(record.id); str(record.name);
    if (!record.id.startsWith(`${snapshot.source}:`) || !['model', 'deployment', 'configuration'].includes(record.kind) || ids.has(record.id)) fail();
    ids.add(record.id);
    if (record.provider !== undefined) str(record.provider); if (record.modelID !== undefined) str(record.modelID);
    if (!Array.isArray(record.aliases) || record.aliases.some(v => typeof v !== 'string')) fail();
    for (const field of ['identifiers', 'configuration', 'sourceDates', 'raw', 'sourceReference']) requireObject(record[field]);
    https(record.sourceReference.url); if (typeof record.sourceReference.path !== 'string') fail();
    if (!Array.isArray(record.facts) || record.facts.length > MODEL_DATA_LIMITS.factsPerRecord) fail();
    for (const fact of record.facts) {
      requireObject(fact); str(fact.attribute); if (!('value' in fact)) fail();
      if (fact.units !== null && typeof fact.units !== 'string') fail();
      if (fact.scale !== null) requireObject(fact.scale);
      requireObject(fact.configuration); requireObject(fact.sourceRef); https(fact.sourceRef.url);
      if (typeof fact.sourceRef.path !== 'string') fail();
      requireObject(fact.dates); integer(fact.dates.retrievedAt);
      for (const field of ['measuredAt', 'publishedAt']) if (field in fact.dates && typeof fact.dates[field] !== 'string' && !Number.isSafeInteger(fact.dates[field])) fail();
      requireObject(fact.identityMatch);
      if (!['exact', 'alias', 'ambiguous', 'unmatched'].includes(fact.identityMatch.status) ||
        !Array.isArray(fact.identityMatch.candidateIDs) || fact.identityMatch.candidateIDs.some(v => typeof v !== 'string')) fail();
      if (new TextEncoder().encode(JSON.stringify(fact)).byteLength > MODEL_DATA_LIMITS.factBytes) fail();
      if (++count > MODEL_DATA_LIMITS.facts) fail();
    }
  }
  json(snapshot);
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MODEL_DATA_LIMITS.snapshotBytes) fail();
  return snapshot;
}

/** Resolve private canonical IDs from current source records and native API identities. */
export function withModelDataCanonicalIdentities(nativeModels, modelsdevRecords) {
  if (!Array.isArray(nativeModels) || nativeModels.length > MODEL_DATA_LIMITS.records ||
      nativeModels.some(model => !obj(model) || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 512) ||
      !Array.isArray(modelsdevRecords) || modelsdevRecords.length > MODEL_DATA_LIMITS.records) fail();
  const models = structuredClone(nativeModels).map(model => ({ ...model, canonicalModelIDs: [], canonicalModelContextChecked: true }));
  // Derivation uses fields supplied by the native model API. Synthetic source
  // aliases remain supported by the public matcher, but do not create this bridge.
  const nativeIdentities = models.map(({ id, providerID, provider, api, apiID }) => ({ id, providerID, provider, api, apiID }));
  const sourceRecords = modelsdevRecords.filter(record => obj(record) && record.identifiers?.source === 'modelsdev');
  const canonicalRecords = new Map(sourceRecords.filter(record => record.kind === 'model' &&
    typeof record.modelID === 'string' && record.identifiers.canonicalModelID === record.modelID &&
    record.id === sourceID('modelsdev', 'model', record.modelID)).map(record => [record.modelID, record]));
  function currentCanonical(record) {
    if (!record) return false;
    const reviewed = reviewedCanonicalModels.get(record.modelID);
    if (!reviewed) return true;
    if (record.name !== reviewed.canonicalName || record.sourceDates?.release_date !== reviewed.canonicalReleaseDate) return false;
    return record.raw === undefined || (obj(record.raw) && record.raw.id === record.modelID &&
      record.raw.name === reviewed.canonicalName && record.raw.release_date === reviewed.canonicalReleaseDate);
  }
  const linkedIDs = new Map(models.map(model => [model.id, new Set()]));
  for (const record of sourceRecords) {
    if (!['model', 'deployment'].includes(record.kind)) continue;
    const identity = matchModelDataIdentity(record, nativeIdentities);
    if (!identity.candidateIDs.length) continue;
    let canonicalModelID = record.kind === 'model' ? record.modelID : record.identifiers.canonicalModelID;
    // Some provider records have no canonical_model_id. Their source-qualified
    // native ID may still exactly identify an existing canonical source record.
    if (record.kind === 'deployment' && canonicalModelID === undefined && canonicalRecords.has(record.identifiers.nativeID)) {
      canonicalModelID = record.identifiers.nativeID;
    }
    if (!currentCanonical(canonicalRecords.get(canonicalModelID))) continue;
    identity.candidateIDs.forEach(id => linkedIDs.get(id)?.add(canonicalModelID));
  }
  return models.map(model => ({ ...model, canonicalModelIDs: [...linkedIDs.get(model.id)].sort() }));
}

/** Keep source evidence only for asserted identities in the captured native inventory. */
export function scopeModelDataSnapshot(snapshot, nativeModels) {
  validateModelDataSnapshot(snapshot);
  if (!Array.isArray(nativeModels) || nativeModels.length > MODEL_DATA_LIMITS.records ||
      nativeModels.some(model => !obj(model) || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 512)) fail();
  const nativeModelIDs = [...new Set(nativeModels.map(model => model.id))].sort();
  const direct = snapshot.records.map(record => ({ record, identity: matchModelDataIdentity(record, nativeModels) }))
    .filter(row => row.identity.candidateIDs.length > 0);
  const retainedIDs = new Set(direct.map(row => row.record.id));
  const canonicalRecords = new Map(snapshot.source === 'modelsdev' ? snapshot.records
    .filter(record => record.kind === 'model' && typeof record.modelID === 'string').map(record => [record.modelID, record]) : []);
  const linked = new Map();
  for (const { record, identity } of direct) {
    if (snapshot.source !== 'modelsdev' || record.kind !== 'deployment') continue;
    const canonicalModelID = record.identifiers?.canonicalModelID;
    const canonical = typeof canonicalModelID === 'string' && canonicalRecords.get(canonicalModelID);
    if (!canonical) continue;
    retainedIDs.add(canonical.id);
    const row = linked.get(canonical.id) ?? { recordID: canonical.id, canonicalModelID,
      deploymentRecordIDs: new Set(), nativeModelIDs: new Set() };
    row.deploymentRecordIDs.add(record.id);
    identity.candidateIDs.forEach(id => row.nativeModelIDs.add(id));
    linked.set(canonical.id, row);
  }
  const records = snapshot.records.filter(record => retainedIDs.has(record.id));
  const canonicalLinks = [...linked.values()].sort((a, b) => a.recordID < b.recordID ? -1 : a.recordID > b.recordID ? 1 : 0).map(row => ({
    recordID: row.recordID, canonicalModelID: row.canonicalModelID,
    deploymentRecordIDs: [...row.deploymentRecordIDs].sort(), nativeModelIDs: [...row.nativeModelIDs].sort(),
  }));
  const modelLinks = direct.flatMap(({ record, identity }) => (identity.modelLinks ?? []).map(link => ({
    recordID: record.id, canonicalModelID: link.canonicalModelID,
    nativeModelIDs: link.nativeModelIDs, evidence: link.evidence,
  })));
  const matchedNativeModelCount = new Set(direct.flatMap(({ identity }) => identity.candidateIDs)).size;
  const facts = rows => rows.reduce((count, record) => count + record.facts.length, 0);
  return validateModelDataSnapshot({ ...snapshot, records,
    sourceMetadata: { ...(snapshot.sourceMetadata ?? {}), scope: {
      kind: 'configured-native-models', nativeModelIDs, canonicalLinks, modelLinks, matchedNativeModelCount,
      receivedRecordCount: snapshot.records.length, receivedFactCount: facts(snapshot.records),
      retainedRecordCount: records.length, retainedFactCount: facts(records),
    } },
  });
}

/** Match asserted identifiers only. Names, family resemblance and provider stripping are never identity proof. */
export function matchModelDataIdentity(record, nativeModels) {
  requireObject(record);
  if (!Array.isArray(nativeModels)) fail();
  const exact = new Set(), aliases = new Set();
  const reviewedLinks = new Map();
  const reviewedIdentities = reviewedArtificialAnalysisIdentity(record);
  for (const native of nativeModels) {
    if (!obj(native) || typeof native.id !== 'string') continue;
    const source = record.identifiers?.source ?? (record.id?.startsWith('modelsdev:') ? 'modelsdev' : 'artificial-analysis');
    const explicit = native.sourceIdentities?.[source];
    if (explicit && (explicit.id === record.id || (typeof record.identifiers?.sourceID === 'string' && explicit.sourceID === record.identifiers.sourceID) ||
      (typeof record.identifiers?.sourceID === 'string' && explicit.id === record.identifiers.sourceID) ||
      (source === 'modelsdev' && record.kind === 'deployment' && explicit.providerID === record.provider && explicit.modelID === record.modelID) ||
      (source === 'modelsdev' && record.kind === 'model' && explicit.canonicalModelID === record.modelID))) exact.add(native.id);
    if (source === 'modelsdev') {
      if (record.kind === 'deployment' && native.id === record.identifiers.nativeID) exact.add(native.id);
      if (record.kind === 'model' && native.id === record.modelID) exact.add(native.id);
      // Native API model IDs are explicit aliases, but a deployment still requires the same provider.
      const apiID = native.api?.id ?? native.apiID;
      const providerID = native.providerID ?? native.provider;
      if (typeof apiID === 'string' && ((record.kind === 'deployment' && providerID === record.provider && apiID === record.modelID) ||
        (record.kind === 'model' && apiID === record.modelID))) aliases.add(native.id);
    }
    if (Array.isArray(native.sourceAliases?.[source]) && native.sourceAliases[source].includes(record.id)) aliases.add(native.id);
    for (const { model, configuration } of reviewedIdentities) {
      const directCanonicalID = native.canonicalModelContextChecked !== true && native.id === model.canonicalModelID;
      if (!directCanonicalID && (!Array.isArray(native.canonicalModelIDs) ||
          !native.canonicalModelIDs.includes(model.canonicalModelID))) continue;
      aliases.add(native.id);
      const link = reviewedLinks.get(model.canonicalModelID) ?? { canonicalModelID: model.canonicalModelID,
        nativeModelIDs: new Set(), evidence: reviewedModelEvidence(model, configuration) };
      link.nativeModelIDs.add(native.id);
      reviewedLinks.set(model.canonicalModelID, link);
    }
  }
  const candidates = new Set([...exact, ...aliases]);
  const candidateIDs = [...candidates].sort();
  const status = candidateIDs.length > 1 ? 'ambiguous' : exact.size ? 'exact' : aliases.size ? 'alias' : 'unmatched';
  const modelLinks = [...reviewedLinks.values()].sort((a, b) => a.canonicalModelID.localeCompare(b.canonicalModelID))
    .map(link => ({ ...link, nativeModelIDs: [...link.nativeModelIDs].sort() }));
  return { status, candidateIDs, method: modelLinks.length ? 'reviewed-source-model-link' :
    status === 'unmatched' ? 'no-asserted-identity' : 'source-qualified-identifiers',
    ...(modelLinks.length ? { canonicalModelIDs: modelLinks.map(link => link.canonicalModelID),
      evidence: modelLinks.flatMap(link => link.evidence), modelLinks } : {}),
  };
}
