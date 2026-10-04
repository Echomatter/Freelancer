import { createHash, randomUUID } from 'node:crypto';
import { modelObservationAttributeFilter } from '../../domain/model-data-unified.mjs';

const SOURCES = new Set(['modelsdev', 'artificial-analysis']);
const KINDS = new Set(['model', 'deployment', 'configuration']);
const STATUSES = new Set(['not-loaded', 'never-refreshed', 'running', 'updating', 'needs-key', 'complete', 'completed', 'partial', 'failed', 'interrupted', 'cancelled', 'cancelling']);
const JOB_STATUSES = new Set(['running', 'cancelling', 'complete', 'completed', 'partial', 'failed', 'interrupted', 'cancelled', 'dismissed']);
const TERMINAL_JOB_STATUSES = new Set(['complete', 'completed', 'partial', 'failed', 'interrupted', 'cancelled', 'dismissed']);
const MAX_RECORDS = 20_000;
const MAX_FACTS = 2_000_000;
const MAX_FACTS_PER_RECORD = 10_000;
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const MAX_RECORD_RAW_BYTES = 8 * 1024 * 1024;
const MAX_FACT_VALUE_BYTES = 64 * 1024;
const MAX_CLIENT_RAW_BYTES = 16 * 1024;
const MAX_DETAIL_BYTES = 1024 * 1024;
const MAX_PAGE = 200;
const MAX_OFFSET = 100_000;
const MAX_STAGING_CLEANUP_BATCH = 1000;
const secretName = /^[a-z][a-z0-9._-]{0,63}$/;
const modelDevFields = ['attachment','reasoning','tool_call','structured_output','open_weights','release_date','last_updated',
  'modalities.input','modalities.output','limit.context','limit.input','limit.output','cost.input','cost.output'];
const aaFields = ['artificial_analysis_intelligence_index','artificial_analysis_coding_index','artificial_analysis_agentic_index',
  'artificial_analysis_finance_and_accounting_index','artificial_analysis_strategy_and_ops_index','artificial_analysis_legal_index',
  'artificial_analysis_healthcare_and_medical_index','artificial_analysis_engineering_index','artificial_analysis_economics_index',
  'price_1m_input_tokens','price_1m_output_tokens','price_1m_cache_hit_tokens','price_1m_cache_write_tokens',
  'median_output_tokens_per_second','median_time_to_first_token_seconds','median_time_to_first_answer_token_seconds',
  'median_end_to_end_response_time_seconds'];

const fail = (message, status = 400) => Object.assign(Error(message), { status });
const byteLength = value => Buffer.byteLength(value, 'utf8');
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw fail('Model data contains a non-finite number.');
    return value;
  }
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw fail('Model data must contain plain JSON values.');
  return Object.fromEntries(Object.keys(value).sort().map(key => {
    if (['__proto__','prototype','constructor'].includes(key)) throw fail('Model data contains a reserved JSON field.');
    return [key, stable(value[key])];
  }));
}
const json = value => JSON.stringify(stable(value));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const boundedJSON = (value, label, maxBytes) => {
  const serialized = json(value ?? {});
  if (byteLength(serialized) > maxBytes) throw fail(`${label} exceeds the ${maxBytes}-byte storage limit.`);
  return serialized;
};
function validateQuota(value) {
  if (!isObject(value)) throw fail('Source quota metadata must be an object.');
  const copy = { ...stable(value) };
  if (copy.requestTimes !== undefined) {
    if (!Array.isArray(copy.requestTimes) || copy.requestTimes.length > 100) throw fail('Source request-time quota history is invalid.');
    copy.requestTimes = copy.requestTimes.map(item => timestamp(item, 'request time')).sort((a, b) => a - b);
  }
  return boundedJSON(copy, 'Source quota metadata', 32 * 1024);
}
const timestamp = (value, label) => {
  const n = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(n) || n < 0 || n > 8.64e15) throw fail(`${label} must be a valid timestamp.`);
  return Math.trunc(n);
};
const text = (value, label, max = 5000, { optional = false } = {}) => {
  if (optional && value == null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(`${label} must be non-empty text up to ${max} characters.`);
  return value;
};
const sourceID = value => {
  if (!SOURCES.has(value)) throw fail('Unknown model data source.');
  return value;
};
const normalized = value => String(value ?? '').normalize('NFKC').toLowerCase();
function fieldPresence(source, facts) {
  const expected = source === 'modelsdev' ? modelDevFields : aaFields.map(value =>
    value.startsWith('artificial_analysis_') ? `evaluations.${value}` : value.startsWith('price_') ? `pricing.${value}` : `performance.${value}`);
  const values = new Map();
  for (const fact of facts) {
    const prior = values.get(fact.details.attribute) ?? [];
    prior.push(fact.details.value);
    values.set(fact.details.attribute, prior);
  }
  const attributes = Object.fromEntries(expected.map(attribute => {
    const present = values.get(attribute);
    const state = !present ? 'missing' : present.some(value => value !== null) ? 'present' : 'source-reported-unavailable';
    return [attribute, { state, present: !!present, source: 'source-snapshot' }];
  }));
  const groups = source === 'modelsdev' ? {
    pricing: ['cost.input','cost.output'], capabilities: ['attachment','reasoning','tool_call','structured_output','open_weights'],
    context: ['limit.context','limit.input','limit.output'], performance: null, evaluations: ['benchmarks'],
  } : {
    pricing: aaFields.filter(value => value.startsWith('price_')).map(value => `pricing.${value}`),
    capabilities: null, context: null, performance: aaFields.filter(value => value.startsWith('median_')).map(value => `performance.${value}`),
    evaluations: aaFields.filter(value => value.startsWith('artificial_analysis_')).map(value => `evaluations.${value}`),
  };
  const categories = Object.fromEntries(Object.entries(groups).map(([category, fields]) => {
    if (!fields) return [category, { state: 'not-covered-by-source', attributes: [] }];
    const states = fields.map(field => attributes[field]?.state ?? (values.has(field) || [...values.keys()].some(key => key.startsWith(`${field}.`)) ? 'present' : 'missing'));
    const present = states.filter(state => state === 'present').length;
    const unavailable = states.filter(state => state === 'source-reported-unavailable').length;
    return [category, { state: present === states.length ? 'present' : present ? 'partial' : unavailable ? 'source-reported-unavailable' : 'missing',
      attributes: fields }];
  }));
  return { attributes, categories, missingAttributes: Object.entries(attributes).filter(([, value]) => value.state !== 'present').map(([attribute, value]) => ({ attribute, state: value.state })) };
}
function validateSnapshot(input) {
  if (!isObject(input) || input.schemaVersion !== 1) throw fail('Unsupported model data snapshot schema.');
  const source = sourceID(input.source);
  if (!Array.isArray(input.records) || input.records.length > MAX_RECORDS) throw fail(`Model data snapshot must contain at most ${MAX_RECORDS} records.`);
  const retrievedAt = timestamp(input.retrievedAt, 'retrievedAt');
  const sourceReference = input.sourceReference ?? {};
  if (!isObject(sourceReference)) throw fail('Snapshot sourceReference must be an object.');
  const ids = new Set();
  let factCount = 0;
  const records = input.records.map((record, ordinal) => {
    if (!isObject(record)) throw fail(`Model data record ${ordinal} must be an object.`);
    const id = text(record.id, `record ${ordinal} id`, 512);
    if (!id.startsWith(`${source}:`)) throw fail(`Model data record ${id} is not qualified by its source.`);
    if (ids.has(id)) throw fail('Model data snapshot contains duplicate record IDs.');
    ids.add(id);
    if (!KINDS.has(record.kind)) throw fail(`Model data record ${id} has an unsupported kind.`);
    const name = text(record.name, `record ${id} name`, 1000);
    const aliases = record.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.length > 256 || aliases.some(alias => typeof alias !== 'string' || alias.length > 1000))
      throw fail(`Model data record ${id} has invalid aliases.`);
    const facts = record.facts ?? [];
    if (!Array.isArray(facts) || facts.length > MAX_FACTS_PER_RECORD) throw fail(`Model data record ${id} exceeds ${MAX_FACTS_PER_RECORD} facts.`);
    factCount += facts.length;
    if (factCount > MAX_FACTS) throw fail(`Model data snapshot exceeds ${MAX_FACTS} facts.`);
    const safeFacts = facts.map((fact, factOrdinal) => {
      if (!isObject(fact)) throw fail(`Fact ${factOrdinal} on ${id} must be an object.`);
      const attribute = text(fact.attribute, `fact ${factOrdinal} attribute`, 300);
      const value = fact.value === undefined ? null : stable(fact.value);
      if (fact.units != null && (typeof fact.units !== 'string' || fact.units.length > 100)) throw fail(`Fact ${attribute} has invalid units.`);
      for (const field of ['configuration', 'sourceRef', 'dates', 'identityMatch'])
        if (fact[field] != null && !isObject(fact[field])) throw fail(`Fact ${attribute} has invalid ${field}.`);
      if (fact.scale != null && !isObject(fact.scale)) throw fail(`Fact ${attribute} has invalid scale.`);
      const valueJSON = json(value);
      if (byteLength(valueJSON) > MAX_FACT_VALUE_BYTES) throw fail(`Fact ${attribute} exceeds the ${MAX_FACT_VALUE_BYTES}-byte value limit.`);
      const valueText = typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' ? String(value) : null;
      const valueNumber = typeof value === 'number' && Number.isFinite(value) ? value : null;
      const details = {
        attribute, value, units: fact.units ?? null, scale: fact.scale ?? null,
        configuration: fact.configuration ?? {}, sourceRef: fact.sourceRef ?? {},
        dates: { retrievedAt, ...(fact.dates ?? {}) }, identityMatch: fact.identityMatch ?? {},
      };
      return { details, valueJSON, valueText, valueNumber, identityStatus: identityStatus(details.identityMatch) };
    });
    const rawJSON = boundedJSON(record.raw ?? {}, `Raw model data for ${id}`, MAX_RECORD_RAW_BYTES);
    const identifiers = record.identifiers ?? {};
    const configuration = record.configuration ?? {};
    const sourceRecordReference = record.sourceReference ?? {};
    const sourceDates = record.sourceDates ?? {};
    for (const [field, value] of Object.entries({ identifiers, configuration, sourceRecordReference, sourceDates }))
      if (!isObject(value)) throw fail(`Model data record ${id} has invalid ${field}.`);
    const normalizedName = normalized(name);
    const searchText = normalized([name, record.provider, record.modelID, ...aliases, JSON.stringify(identifiers),
      ...safeFacts.flatMap(fact => [fact.details.attribute, fact.valueText])].filter(Boolean).join('\n'));
    const identity = record.identityMatch ?? identifiers.identityMatch ?? {};
    const presence = fieldPresence(input.source, safeFacts);
    return {
      id, kind: record.kind, name, normalizedName,
      provider: text(record.provider, `record ${id} provider`, 500, { optional: true }),
      modelID: text(record.modelID, `record ${id} modelID`, 1000, { optional: true }),
      aliases, identifiers, configuration, sourceReference: sourceRecordReference, sourceDates,
      rawJSON, facts: safeFacts,
      presence,
      identityStatus: identityStatus(identity),
      searchText,
    };
  });
  const sourceMetadata = input.sourceMetadata ?? {};
  const quota = input.quota ?? null;
  if (!isObject(sourceMetadata) || quota !== null && !isObject(quota)) throw fail('Snapshot source metadata is invalid.');
  const prepared = {
    schemaVersion: 1, source, retrievedAt,
    sourceReference: stable(sourceReference), sourceMetadata: stable(sourceMetadata), quota: quota === null ? null : stable(quota), records,
  };
  const digest = createHash('sha256');
  const prefix = '{"records":[';
  // Attempt/page counts describe retrieval, not changed model facts. Keep them
  // in durable snapshot metadata without making a retry duplicate the catalog.
  const { requests: retrievalRequests, pages: retrievalPages, ...contentMetadata } = prepared.sourceMetadata;
  const suffix = `],"schemaVersion":1,"source":${json(source)},"sourceMetadata":${json(contentMetadata)},"sourceReference":${json(prepared.sourceReference)}}`;
  digest.update(prefix);
  let snapshotBytes = byteLength(prefix) + byteLength(suffix);
  records.forEach((record, index) => {
    if (index) { digest.update(','); snapshotBytes++; }
    const { rawJSON, ...stored } = record;
    const contentRecord = { ...stored, raw: JSON.parse(rawJSON), facts: record.facts.map(fact => {
      const dates = { ...fact.details.dates }; delete dates.retrievedAt;
      return { ...fact.details, dates };
    }) };
    const serialized = json(contentRecord);
    snapshotBytes += byteLength(serialized);
    if (snapshotBytes > MAX_SNAPSHOT_BYTES) throw fail(`Model data snapshot exceeds the ${MAX_SNAPSHOT_BYTES}-byte storage limit.`);
    digest.update(serialized);
  });
  digest.update(suffix);
  if (snapshotBytes > MAX_SNAPSHOT_BYTES) throw fail(`Model data snapshot exceeds the ${MAX_SNAPSHOT_BYTES}-byte storage limit.`);
  return { ...prepared, contentSha256: digest.digest('hex'), recordCount: records.length, factCount };
}
function identityStatus(value) {
  const status = isObject(value) ? value.status : undefined;
  return ['exact', 'documented-alias', 'reviewed'].includes(status) ? status : 'unmatched';
}
function cursorCriteria(criteria, cursor) {
  const fingerprint = hash(criteria);
  if (cursor === undefined || cursor === null || cursor === '') return { fingerprint, offset: 0 };
  if (typeof cursor !== 'string' || cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw fail('Model data cursor is invalid.');
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw Error();
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || Object.keys(value).sort().join(',') !== 'f,o,v' || value.v !== 1 || value.f !== fingerprint
      || !Number.isInteger(value.o) || value.o <= 0 || value.o > MAX_OFFSET) throw Error();
    return { fingerprint, offset: value.o };
  } catch { throw fail('Model data cursor is invalid or belongs to different criteria. Start a new search.'); }
}
const nextCursor = (fingerprint, offset) => offset > MAX_OFFSET ? null : Buffer.from(JSON.stringify({ v: 1, f: fingerprint, o: offset })).toString('base64url');
function resultJob(row) {
  if (!row) return null;
  const result = JSON.parse(row.result_json);
  const sources = JSON.parse(row.sources_json);
  return { id: row.job_id, status: row.status, sources,
    summary: result.summary ?? null, results: Array.isArray(result.results) ? result.results : sources.map(source => result.sources?.[source] ?? { source, status: 'pending', recordCount: 0, error: null }),
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at, finishedAt: row.finished_at };
}

/** Durable source-backed model snapshots, facts and refresh state in the local SQLite database. */
export function createModelDataStore(db, tx) {
  const updateJobSourceResult = (jobID, source, patch) => {
    const row = db.prepare('SELECT result_json,sources_json FROM model_data_refresh_jobs WHERE job_id=?').get(jobID);
    if (!row) return;
    const result = JSON.parse(row.result_json);
    result.sources ??= {};
    result.sources[source] = { source, ...(result.sources[source] ?? {}), ...patch };
    if (Array.isArray(result.results)) {
      const index = result.results.findIndex(item => item.source === source);
      const merged = { source, ...(index >= 0 ? result.results[index] : {}), ...patch };
      if (index >= 0) result.results[index] = merged; else result.results.push(merged);
    }
    db.prepare('UPDATE model_data_refresh_jobs SET result_json=?,updated_at=? WHERE job_id=?')
      .run(json(result), Date.now(), jobID);
  };
  const sourceStatus = source => {
    const row = db.prepare(`SELECT s.*,p.content_sha256,p.retrieved_at,p.record_count AS snapshot_record_count,
      p.source_reference_json,p.metadata_json AS snapshot_metadata_json
      FROM model_data_sources s LEFT JOIN model_data_snapshots p ON p.snapshot_id=s.current_snapshot_id WHERE s.source=?`).get(source);
    return row && {
      id: row.source, source: row.source, generation: row.generation, state: row.status, status: row.status, currentSnapshotID: row.current_snapshot_id,
      currentJobID: row.current_job_id, lastSuccessAt: row.last_refresh_at, lastRefreshAt: row.last_refresh_at,
      lastAttemptAt: row.last_attempt_at, retryAt: row.retry_at, recordCount: row.record_count,
      version: row.version, updatedAt: row.updated_at,
      error: row.error, quota: row.quota_json ? JSON.parse(row.quota_json) : null,
      metadata: JSON.parse(row.metadata_json), current: row.content_sha256 ? {
        contentSha256: row.content_sha256, retrievedAt: row.retrieved_at, recordCount: row.snapshot_record_count,
        sourceReference: JSON.parse(row.source_reference_json), metadata: JSON.parse(row.snapshot_metadata_json),
      } : null,
    };
  };
  const job = id => resultJob(db.prepare('SELECT * FROM model_data_refresh_jobs WHERE job_id=?').get(id));
  let backgroundWriteLeaseCount = 0;
  let savedWalAutoCheckpoint = null;
  let obsoleteCleanupActive = false;
  const assertObsoleteCleanupIdle = (claimedSnapshotID = null) => {
    if (db.prepare("SELECT 1 FROM model_data_refresh_jobs WHERE status IN ('running','cancelling') LIMIT 1").get()
        || db.prepare("SELECT 1 FROM model_data_sources WHERE status IN ('running','updating','cancelling') LIMIT 1").get())
      throw fail('Finish the active model data refresh before removing obsolete snapshots.', 409);
    const staging = claimedSnapshotID === null
      ? db.prepare("SELECT 1 FROM model_data_snapshots WHERE publication_status='staging' LIMIT 1").get()
      : db.prepare("SELECT 1 FROM model_data_snapshots WHERE publication_status='staging' AND snapshot_id<>? LIMIT 1").get(claimedSnapshotID);
    if (staging) throw fail('Clean up model data staging before removing obsolete snapshots.', 409);
  };
  const assertObsoleteCleanupClaim = snapshotID => {
    assertObsoleteCleanupIdle(snapshotID);
    if (!db.prepare(`SELECT 1 FROM model_data_snapshots s WHERE s.snapshot_id=? AND s.publication_status='staging'
      AND NOT EXISTS (SELECT 1 FROM model_data_sources d WHERE d.current_snapshot_id=s.snapshot_id)`).get(snapshotID))
      throw fail('The obsolete model data snapshot changed; cleanup stopped.', 409);
  };
  const ownedRefresh = (sourceIDValue, jobID) => {
    const refresh = db.prepare('SELECT * FROM model_data_refresh_jobs WHERE job_id=?').get(jobID);
    const source = db.prepare('SELECT * FROM model_data_sources WHERE source=?').get(sourceIDValue);
    if (!refresh || refresh.status !== 'running' || !source || source.current_job_id !== jobID
        || !JSON.parse(refresh.sources_json).includes(sourceIDValue)
        || JSON.parse(refresh.generations_json)[sourceIDValue] !== source.generation)
      throw fail('Model data refresh was superseded; its snapshot was not published.', 409);
    return { refresh, source, generation: source.generation };
  };
  const removeStagingWithinTransaction = (snapshotID, jobID) => {
    const staged = db.prepare(`SELECT 1 FROM model_data_snapshots
      WHERE snapshot_id=? AND job_id=? AND publication_status='staging'`).get(snapshotID, jobID);
    if (!staged) return false;
    db.prepare(`DELETE FROM model_data_facts WHERE record_key IN
      (SELECT record_key FROM model_data_records WHERE snapshot_id=?)`).run(snapshotID);
    db.prepare('DELETE FROM model_data_records WHERE snapshot_id=?').run(snapshotID);
    return db.prepare(`DELETE FROM model_data_snapshots WHERE snapshot_id=? AND job_id=? AND publication_status='staging'`)
      .run(snapshotID, jobID).changes === 1;
  };
  const removeStagingSnapshotBounded = async (snapshotID, jobID) => {
    const yieldEventLoop = () => new Promise(resolve => setImmediate(resolve));
    while (true) {
      const deleted = tx(() => {
        if (!db.prepare(`SELECT 1 FROM model_data_snapshots WHERE snapshot_id=? AND job_id=? AND publication_status='staging'`)
          .get(snapshotID, jobID)) return 0;
        const rows = db.prepare(`SELECT f.fact_id FROM model_data_records r
          JOIN model_data_facts f ON f.record_key=r.record_key WHERE r.snapshot_id=? LIMIT ?`)
          .all(snapshotID, MAX_STAGING_CLEANUP_BATCH);
        if (!rows.length) return 0;
        const placeholders = rows.map(() => '?').join(',');
        return db.prepare(`DELETE FROM model_data_facts WHERE fact_id IN (${placeholders})`).run(...rows.map(row => row.fact_id)).changes;
      });
      if (!deleted) break;
      await yieldEventLoop();
    }
    while (true) {
      const deleted = tx(() => {
        if (!db.prepare(`SELECT 1 FROM model_data_snapshots WHERE snapshot_id=? AND job_id=? AND publication_status='staging'`)
          .get(snapshotID, jobID)) return 0;
        const rows = db.prepare(`SELECT r.record_key FROM model_data_records r WHERE r.snapshot_id=?
          AND NOT EXISTS (SELECT 1 FROM model_data_facts f WHERE f.record_key=r.record_key) LIMIT ?`)
          .all(snapshotID, MAX_STAGING_CLEANUP_BATCH);
        if (!rows.length) return 0;
        const placeholders = rows.map(() => '?').join(',');
        return db.prepare(`DELETE FROM model_data_records WHERE snapshot_id=? AND record_key IN (${placeholders})`)
          .run(snapshotID, ...rows.map(row => row.record_key)).changes;
      });
      if (!deleted) break;
      await yieldEventLoop();
    }
    const removed = tx(() => {
      const row = db.prepare(`SELECT 1 FROM model_data_snapshots s WHERE s.snapshot_id=? AND s.job_id=?
        AND s.publication_status='staging' AND NOT EXISTS
          (SELECT 1 FROM model_data_records r WHERE r.snapshot_id=s.snapshot_id)
        AND NOT EXISTS (SELECT 1 FROM model_data_sources d WHERE d.current_snapshot_id=s.snapshot_id)`)
        .get(snapshotID, jobID);
      return row ? db.prepare(`DELETE FROM model_data_snapshots WHERE snapshot_id=? AND job_id=?
        AND publication_status='staging'`).run(snapshotID, jobID).changes === 1 : false;
    });
    return removed;
  };
  const sourcePublication = (snapshot, source, jobID, selectedID, generation) => {
    const currentQuota = source.quota_json ? JSON.parse(source.quota_json) : null;
    const quota = snapshot.quota === null ? currentQuota : {
      ...(currentQuota ?? {}), ...snapshot.quota,
      ...(currentQuota?.requestTimes ? { requestTimes: currentQuota.requestTimes } : {}),
    };
    const version = [snapshot.sourceMetadata.version, snapshot.sourceMetadata.intelligenceIndexVersion]
      .find(value => typeof value === 'string' && value.length <= 256) ?? null;
    db.prepare(`UPDATE model_data_sources SET current_snapshot_id=?,status='complete',last_refresh_at=?,updated_at=?,error=NULL,
      last_attempt_at=COALESCE(last_attempt_at,?),record_count=?,version=?,quota_json=?
      WHERE source=? AND current_job_id=? AND generation=?`).run(selectedID, snapshot.retrievedAt, Date.now(), snapshot.retrievedAt,
        snapshot.recordCount, version ?? source.version, quota === null ? null : validateQuota(quota), snapshot.source, jobID, generation);
    updateJobSourceResult(jobID, snapshot.source, { status: 'complete', recordCount: snapshot.recordCount,
      contentSha256: snapshot.contentSha256, snapshotID: selectedID, error: null });
  };

  return {
    modelDataStatus() {
      const sources = [...SOURCES].map(sourceStatus);
      const row = db.prepare('SELECT job_id FROM model_data_refresh_jobs ORDER BY created_at DESC,job_id DESC LIMIT 1').get();
      return { sources, job: row ? job(row.job_id) : null };
    },
    modelDataActiveJobs(options = {}) {
      const limit = options.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw fail('Active job limit must be from 1 to 500.');
      const rows = db.prepare(`SELECT * FROM model_data_refresh_jobs WHERE status IN ('running','cancelling')
        ORDER BY created_at,job_id LIMIT ?`).all(limit + 1);
      return { jobs: rows.slice(0, limit).map(resultJob), truncated: rows.length > limit };
    },
    beginModelDataBackgroundWrite() {
      if (backgroundWriteLeaseCount === 0) {
        const current = db.prepare('PRAGMA wal_autocheckpoint').get()?.wal_autocheckpoint;
        savedWalAutoCheckpoint = Number.isSafeInteger(current) && current >= 0 ? current : 1000;
        db.exec('PRAGMA wal_autocheckpoint=0');
      }
      backgroundWriteLeaseCount++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        backgroundWriteLeaseCount--;
        if (backgroundWriteLeaseCount === 0) {
          const restore = savedWalAutoCheckpoint ?? 1000;
          savedWalAutoCheckpoint = null;
          db.exec(`PRAGMA wal_autocheckpoint=${restore}`);
        }
      };
    },
    beginModelDataRefresh(input = {}) {
      if (obsoleteCleanupActive) throw fail('Model data snapshot cleanup is still running. Try the refresh again when it finishes.', 409);
      const id = text(input.id ?? randomUUID(), 'Refresh job ID', 128);
      const sources = [...new Set(input.sources ?? [])].map(sourceID).sort();
      if (!sources.length || sources.length > SOURCES.size) throw fail('Choose one or more supported model data sources.');
      const createdAt = timestamp(input.createdAt ?? Date.now(), 'createdAt');
      let generations = {};
      tx(() => {
        const existingJob = db.prepare('SELECT * FROM model_data_refresh_jobs WHERE job_id=?').get(id);
        if (existingJob) {
          if (existingJob.status !== 'running') throw fail('Refresh job is no longer accepting sources.', 409);
          const priorSources = JSON.parse(existingJob.sources_json);
          generations = JSON.parse(existingJob.generations_json);
          const added = sources.filter(source => !priorSources.includes(source));
          sources.splice(0, sources.length, ...new Set([...priorSources, ...sources]).values());
          for (const source of added) {
            const current = db.prepare('SELECT generation FROM model_data_sources WHERE source=?').get(source);
            generations[source] = current.generation + 1;
            db.prepare(`UPDATE model_data_sources SET generation=?,status='running',current_job_id=?,error=NULL,last_attempt_at=?,retry_at=NULL,updated_at=? WHERE source=?`)
              .run(generations[source], id, createdAt, createdAt, source);
            updateJobSourceResult(id, source, { status: 'pending', recordCount: 0, error: null });
          }
          db.prepare('UPDATE model_data_refresh_jobs SET sources_json=?,generations_json=?,status=\'running\',updated_at=?,finished_at=NULL WHERE job_id=?')
            .run(json(sources), json(generations), Date.now(), id);
          return;
        }
        for (const source of sources) {
          const current = db.prepare('SELECT generation FROM model_data_sources WHERE source=?').get(source);
          if (!current) throw fail('Model data source has not been initialized.', 500);
          generations[source] = current.generation + 1;
        }
        db.prepare(`INSERT INTO model_data_refresh_jobs(job_id,status,sources_json,generations_json,created_at,updated_at)
          VALUES(?,'running',?,?,?,?)`).run(id, json(sources), json(generations), createdAt, createdAt);
        const update = db.prepare(`UPDATE model_data_sources SET generation=?,status='running',current_job_id=?,error=NULL,last_attempt_at=?,retry_at=NULL,updated_at=? WHERE source=?`);
        for (const source of sources) {
          update.run(generations[source], id, createdAt, createdAt, source);
          updateJobSourceResult(id, source, { status: 'pending', recordCount: 0, error: null });
        }
      });
      return job(id);
    },
    saveModelDataSourceStatus(sourceInput, patch = {}, jobID) {
      const source = sourceID(sourceInput);
      if (!isObject(patch)) throw fail('Source status patch must be an object.');
      const permitted = new Set(['status', 'state', 'lastRefreshAt', 'lastSuccessAt', 'lastAttemptAt', 'retryAt', 'recordCount', 'version', 'error', 'quota', 'metadata', 'updatedAt']);
      if (Object.keys(patch).some(key => !permitted.has(key))) throw fail('Source status patch contains unsupported fields.');
      const status = patch.status ?? patch.state;
      if (status !== undefined && !STATUSES.has(status)) throw fail('Unsupported model data source status.');
      const updatedAt = timestamp(patch.updatedAt ?? Date.now(), 'updatedAt');
      const quotaJSON = patch.quota === undefined ? undefined : patch.quota === null ? null : validateQuota(patch.quota);
      const metadataJSON = patch.metadata === undefined ? undefined : boundedJSON(patch.metadata, 'Source metadata', 64 * 1024);
      const errorText = patch.error == null ? patch.error : text(patch.error, 'Source error', 1000);
      const lastRefreshInput = patch.lastSuccessAt ?? patch.lastRefreshAt;
      const lastRefresh = lastRefreshInput == null ? lastRefreshInput : timestamp(lastRefreshInput, 'lastSuccessAt');
      const lastAttempt = patch.lastAttemptAt == null ? patch.lastAttemptAt : timestamp(patch.lastAttemptAt, 'lastAttemptAt');
      const retryAt = patch.retryAt == null ? patch.retryAt : timestamp(patch.retryAt, 'retryAt');
      const recordCount = patch.recordCount === undefined ? undefined : Number.isInteger(patch.recordCount) && patch.recordCount >= 0 ? patch.recordCount : (() => { throw fail('recordCount must be a nonnegative integer.'); })();
      const version = patch.version === undefined ? undefined : patch.version === null ? null : text(patch.version, 'Version', 256);
      tx(() => {
        const current = db.prepare('SELECT * FROM model_data_sources WHERE source=?').get(source);
        if (!current) throw fail('Unknown model data source.');
        if (jobID !== undefined && current.current_job_id !== jobID) throw fail('A newer refresh owns this source.', 409);
        const update = db.prepare(`UPDATE model_data_sources SET status=?,last_refresh_at=?,last_attempt_at=?,retry_at=?,record_count=?,version=?,error=?,quota_json=?,metadata_json=?,updated_at=? WHERE source=?`);
        update.run(status ?? current.status, lastRefresh === undefined ? current.last_refresh_at : lastRefresh,
          lastAttempt === undefined ? current.last_attempt_at : lastAttempt, retryAt === undefined ? current.retry_at : retryAt,
          recordCount ?? current.record_count, version === undefined ? current.version : version,
          errorText === undefined ? current.error : errorText, quotaJSON === undefined ? current.quota_json : quotaJSON,
          metadataJSON === undefined ? current.metadata_json : metadataJSON, updatedAt, source);
        if (jobID) updateJobSourceResult(jobID, source, { status: status ?? current.status, error: errorText === undefined ? current.error : errorText,
          recordCount: recordCount ?? current.record_count });
      });
      return sourceStatus(source);
    },
    publishModelDataSource(input, { jobID } = {}) {
      const snapshot = validateSnapshot(input);
      if (typeof jobID !== 'string' || !jobID) throw fail('A refresh job is required to publish source data.');
      const snapshotID = `${snapshot.source}:${snapshot.contentSha256}`;
      let deduplicated = false;
      tx(() => {
        const refresh = db.prepare('SELECT * FROM model_data_refresh_jobs WHERE job_id=?').get(jobID);
        const source = db.prepare('SELECT * FROM model_data_sources WHERE source=?').get(snapshot.source);
        if (!refresh || refresh.status !== 'running' || !source || source.current_job_id !== jobID
            || !JSON.parse(refresh.sources_json).includes(snapshot.source)
            || JSON.parse(refresh.generations_json)[snapshot.source] !== source.generation)
          throw fail('Model data refresh was superseded; its snapshot was not published.', 409);
        const prior = db.prepare(`SELECT snapshot_id FROM model_data_snapshots
          WHERE source=? AND content_sha256=? AND publication_status='complete' ORDER BY created_at,snapshot_id LIMIT 1`)
          .get(snapshot.source, snapshot.contentSha256);
        deduplicated = !!prior;
        if (!prior) {
          db.prepare(`INSERT INTO model_data_snapshots(snapshot_id,source,content_sha256,schema_version,retrieved_at,
            source_reference_json,metadata_json,record_count,job_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
            .run(snapshotID, snapshot.source, snapshot.contentSha256, 1, snapshot.retrievedAt,
              json(snapshot.sourceReference), json({ factCount: snapshot.factCount, sourceMetadata: snapshot.sourceMetadata, quota: snapshot.quota }), snapshot.recordCount, jobID, Date.now());
          const saveRecord = db.prepare(`INSERT INTO model_data_records(record_key,snapshot_id,source,record_id,kind,name,normalized_name,
            provider,model_id,aliases_json,identifiers_json,configuration_json,source_reference_json,source_dates_json,field_presence_json,raw_json,identity_status,search_text)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
          const saveFact = db.prepare(`INSERT INTO model_data_facts(fact_id,record_key,ordinal,attribute,value_json,value_text,value_number,units,
            scale_json,configuration_json,source_ref_json,dates_json,identity_match_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
          for (const record of snapshot.records) {
            const recordKey = hash([snapshotID, record.id]);
            saveRecord.run(recordKey, snapshotID, snapshot.source, record.id, record.kind, record.name, record.normalizedName,
              record.provider, record.modelID, json(record.aliases), json(record.identifiers), json(record.configuration),
              json(record.sourceReference), json(record.sourceDates), json(record.presence), record.rawJSON, record.identityStatus, record.searchText);
            record.facts.forEach((fact, ordinal) => {
              const factID = hash([recordKey, ordinal, fact.details]);
              const value = fact.details.value;
              saveFact.run(factID, recordKey, ordinal, fact.details.attribute, fact.valueJSON, fact.valueText, fact.valueNumber,
                fact.details.units, fact.details.scale == null ? null : json(fact.details.scale), json(fact.details.configuration),
                json(fact.details.sourceRef), json(fact.details.dates), json(fact.details.identityMatch));
            });
          }
        }
        const selectedID = prior?.snapshot_id ?? snapshotID;
        const currentQuota = source.quota_json ? JSON.parse(source.quota_json) : null;
        const quota = snapshot.quota === null ? currentQuota : {
          ...(currentQuota ?? {}), ...snapshot.quota,
          ...(currentQuota?.requestTimes ? { requestTimes: currentQuota.requestTimes } : {}),
        };
        const version = [snapshot.sourceMetadata.version, snapshot.sourceMetadata.intelligenceIndexVersion]
          .find(value => typeof value === 'string' && value.length <= 256) ?? null;
        db.prepare(`UPDATE model_data_sources SET current_snapshot_id=?,status='complete',last_refresh_at=?,updated_at=?,error=NULL,
          last_attempt_at=COALESCE(last_attempt_at,?),record_count=?,version=?,quota_json=?
          WHERE source=? AND current_job_id=? AND generation=?`).run(selectedID, snapshot.retrievedAt, Date.now(), snapshot.retrievedAt,
            snapshot.recordCount, version ?? source.version, quota === null ? null : validateQuota(quota), snapshot.source, jobID,
            JSON.parse(refresh.generations_json)[snapshot.source]);
        updateJobSourceResult(jobID, snapshot.source, { status: 'complete', recordCount: snapshot.recordCount,
          contentSha256: snapshot.contentSha256, snapshotID, error: null });
      });
      return { source: snapshot.source, snapshotID, contentSha256: snapshot.contentSha256, retrievedAt: snapshot.retrievedAt,
        recordCount: snapshot.recordCount, factCount: snapshot.factCount, deduplicated, unchanged: deduplicated };
    },
    async modelDataPublishStaged(input, { jobID, signal, onProgress } = {}) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      if (typeof onProgress !== 'undefined' && typeof onProgress !== 'function') throw fail('Progress callback must be a function.');
      if (typeof jobID !== 'string' || !jobID) throw fail('A refresh job is required to publish source data.');
      const snapshot = validateSnapshot(input);
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      let stageID = null, generation = null, selectedID = null, deduplicated = false, cleanupAfterPublish = false;
      const finalSnapshotID = `${snapshot.source}:${snapshot.contentSha256}`;
      tx(() => {
        const owner = ownedRefresh(snapshot.source, jobID);
        generation = owner.generation;
        const prior = db.prepare(`SELECT snapshot_id FROM model_data_snapshots WHERE source=? AND content_sha256=?
          AND publication_status='complete' ORDER BY created_at,snapshot_id LIMIT 1`).get(snapshot.source, snapshot.contentSha256);
        if (prior) {
          selectedID = prior.snapshot_id;
          deduplicated = true;
          sourcePublication(snapshot, owner.source, jobID, selectedID, generation);
          return;
        }
        const activeStage = db.prepare(`SELECT snapshot_id FROM model_data_snapshots WHERE source=? AND job_id=?
          AND publication_status='staging' LIMIT 1`).get(snapshot.source, jobID);
        if (activeStage) throw fail('This refresh already has an active staged publication.', 409);
        stageID = `${snapshot.source}:staging:${randomUUID()}`;
        db.prepare(`INSERT INTO model_data_snapshots(snapshot_id,source,content_sha256,schema_version,retrieved_at,
          source_reference_json,metadata_json,record_count,publication_status,job_id,created_at)
          VALUES(?,?,?,?,?,?,?,?, 'staging',?,?)`).run(stageID, snapshot.source, snapshot.contentSha256, 1, snapshot.retrievedAt,
            json(snapshot.sourceReference), json({ factCount: snapshot.factCount, sourceMetadata: snapshot.sourceMetadata, quota: snapshot.quota }),
            snapshot.recordCount, jobID, Date.now());
      });
      if (deduplicated) return { source: snapshot.source, snapshotID: selectedID, contentSha256: snapshot.contentSha256,
        retrievedAt: snapshot.retrievedAt, recordCount: snapshot.recordCount, factCount: snapshot.factCount,
        deduplicated: true, unchanged: true };

      const totalOperations = snapshot.recordCount + snapshot.factCount;
      const insertRecord = db.prepare(`INSERT INTO model_data_records(record_key,snapshot_id,source,record_id,kind,name,normalized_name,
        provider,model_id,aliases_json,identifiers_json,configuration_json,source_reference_json,source_dates_json,field_presence_json,raw_json,identity_status,search_text)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insertFact = db.prepare(`INSERT INTO model_data_facts(fact_id,record_key,ordinal,attribute,value_json,value_text,value_number,units,
        scale_json,configuration_json,source_ref_json,dates_json,identity_match_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      let pending = [], processedOperations = 0, recordsInserted = 0, factsInserted = 0;
      const flush = async () => {
        if (!pending.length) return;
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        const batch = pending;
        tx(() => {
          const owner = ownedRefresh(snapshot.source, jobID);
          if (owner.generation !== generation || !db.prepare(`SELECT 1 FROM model_data_snapshots
            WHERE snapshot_id=? AND job_id=? AND publication_status='staging'`).get(stageID, jobID))
            throw fail('Staged model data was superseded before publication.', 409);
          for (const operation of batch) {
            if (operation.type === 'record') insertRecord.run(...operation.args);
            else insertFact.run(...operation.args);
          }
        });
        processedOperations += batch.length;
        const batchRecords = batch.reduce((count, operation) => count + (operation.type === 'record' ? 1 : 0), 0);
        recordsInserted += batchRecords;
        factsInserted += batch.length - batchRecords;
        pending = [];
        await onProgress?.({ stage: 'publishing', processedOperations, totalOperations, recordsInserted, factsInserted });
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      };
      try {
        for (const record of snapshot.records) {
          const recordKey = hash([stageID, record.id]);
          pending.push({ type: 'record', args: [recordKey, stageID, snapshot.source, record.id, record.kind, record.name, record.normalizedName,
            record.provider, record.modelID, json(record.aliases), json(record.identifiers), json(record.configuration),
            json(record.sourceReference), json(record.sourceDates), json(record.presence), record.rawJSON, record.identityStatus, record.searchText] });
          for (let ordinal = 0; ordinal < record.facts.length; ordinal++) {
            const fact = record.facts[ordinal], value = fact.details.value;
            const factID = hash([recordKey, ordinal, fact.details]);
            pending.push({ type: 'fact', args: [factID, recordKey, ordinal, fact.details.attribute, fact.valueJSON, fact.valueText, fact.valueNumber,
              fact.details.units, fact.details.scale == null ? null : json(fact.details.scale), json(fact.details.configuration),
              json(fact.details.sourceRef), json(fact.details.dates), json(fact.details.identityMatch)] });
            if (pending.length >= 1000) await flush();
          }
          if (pending.length >= 1000) await flush();
        }
        await flush();
        if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        tx(() => {
          const owner = ownedRefresh(snapshot.source, jobID);
          if (owner.generation !== generation) throw fail('Staged model data was superseded before publication.', 409);
          const staged = db.prepare(`SELECT snapshot_id FROM model_data_snapshots WHERE snapshot_id=? AND job_id=?
            AND publication_status='staging'`).get(stageID, jobID);
          if (!staged) throw fail('Staged model data is unavailable.', 409);
          const complete = db.prepare(`SELECT snapshot_id FROM model_data_snapshots WHERE source=? AND content_sha256=?
            AND publication_status='complete' ORDER BY created_at,snapshot_id LIMIT 1`).get(snapshot.source, snapshot.contentSha256);
          if (complete) {
            selectedID = complete.snapshot_id;
            deduplicated = true;
            cleanupAfterPublish = true;
          } else {
            selectedID = finalSnapshotID;
            db.exec('PRAGMA defer_foreign_keys=ON');
            db.prepare('UPDATE model_data_records SET snapshot_id=? WHERE snapshot_id=?').run(selectedID, stageID);
            db.prepare(`UPDATE model_data_snapshots SET snapshot_id=?,publication_status='complete'
              WHERE snapshot_id=? AND job_id=? AND publication_status='staging'`).run(selectedID, stageID, jobID);
          }
          sourcePublication(snapshot, owner.source, jobID, selectedID, generation);
        });
        if (cleanupAfterPublish) {
          try { await removeStagingSnapshotBounded(stageID, jobID); }
          catch { /* keep the published pointer; explicit job cleanup can remove this private duplicate later */ }
        }
      } catch (error) {
        try { await removeStagingSnapshotBounded(stageID, jobID); } catch { /* startup/job cleanup can retry */ }
        throw error;
      }
      return { source: snapshot.source, snapshotID: selectedID, contentSha256: snapshot.contentSha256,
        retrievedAt: snapshot.retrievedAt, recordCount: snapshot.recordCount, factCount: snapshot.factCount,
        deduplicated, unchanged: deduplicated };
    },
    cleanupModelDataStaging(jobID) {
      const id = text(jobID, 'Refresh job ID', 128);
      return tx(() => {
        const rows = db.prepare(`SELECT snapshot_id FROM model_data_snapshots WHERE job_id=? AND publication_status='staging'
          ORDER BY created_at,snapshot_id`).all(id);
        let removed = 0;
        for (const row of rows) if (removeStagingWithinTransaction(row.snapshot_id, id)) removed++;
        return { jobID: id, removedSnapshots: removed };
      });
    },
    modelDataStagingJobs(options = {}) {
      const limit = options.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        throw fail('Staging recovery limit must be from 1 to 500.');
      const rows = db.prepare(`SELECT s.job_id,COALESCE(j.status,'missing') AS job_status,
        group_concat(DISTINCT s.source) AS source_ids
        FROM model_data_snapshots s LEFT JOIN model_data_refresh_jobs j ON j.job_id=s.job_id
        WHERE s.publication_status='staging' AND (j.job_id IS NULL OR j.status NOT IN ('running','cancelling') OR NOT EXISTS
          (SELECT 1 FROM model_data_sources d WHERE d.source=s.source AND d.current_job_id=s.job_id))
        GROUP BY s.job_id,j.status ORDER BY min(s.created_at),s.job_id LIMIT ?`).all(limit + 1);
      const truncated = rows.length > limit;
      return { jobs: rows.slice(0, limit).map(row => ({ jobID: row.job_id, status: row.job_status,
        sources: row.source_ids ? row.source_ids.split(',').sort() : [] })), truncated };
    },
    async modelDataCleanupStaging(jobID) {
      const id = text(jobID, 'Refresh job ID', 128);
      const yieldEventLoop = () => new Promise(resolve => setImmediate(resolve));
      const stagedRows = db.prepare(`SELECT snapshot_id FROM model_data_snapshots
        WHERE job_id=? AND publication_status='staging' ORDER BY created_at,snapshot_id`).all(id);
      let removedSnapshots = 0;
      for (const { snapshot_id: snapshotID } of stagedRows) {
        while (true) {
          const deleted = tx(() => {
            const rows = db.prepare(`SELECT f.fact_id FROM model_data_records r
              JOIN model_data_facts f ON f.record_key=r.record_key WHERE r.snapshot_id=? LIMIT ?`)
              .all(snapshotID, MAX_STAGING_CLEANUP_BATCH);
            if (!rows.length) return 0;
            const placeholders = rows.map(() => '?').join(',');
            return db.prepare(`DELETE FROM model_data_facts WHERE fact_id IN (${placeholders})`).run(...rows.map(row => row.fact_id)).changes;
          });
          if (!deleted) break;
          await yieldEventLoop();
        }
        while (true) {
          const deleted = tx(() => {
            const rows = db.prepare(`SELECT r.record_key FROM model_data_records r WHERE r.snapshot_id=?
              AND NOT EXISTS (SELECT 1 FROM model_data_facts f WHERE f.record_key=r.record_key) LIMIT ?`)
              .all(snapshotID, MAX_STAGING_CLEANUP_BATCH);
            if (!rows.length) return 0;
            const placeholders = rows.map(() => '?').join(',');
            return db.prepare(`DELETE FROM model_data_records WHERE snapshot_id=? AND record_key IN (${placeholders})`)
              .run(snapshotID, ...rows.map(row => row.record_key)).changes;
          });
          if (!deleted) break;
          await yieldEventLoop();
        }
        const removed = tx(() => {
          const row = db.prepare(`SELECT 1 FROM model_data_snapshots s WHERE s.snapshot_id=? AND s.job_id=?
            AND s.publication_status='staging' AND NOT EXISTS
              (SELECT 1 FROM model_data_records r WHERE r.snapshot_id=s.snapshot_id)
            AND NOT EXISTS (SELECT 1 FROM model_data_sources d WHERE d.current_snapshot_id=s.snapshot_id)`)
            .get(snapshotID, id);
          return row ? db.prepare(`DELETE FROM model_data_snapshots WHERE snapshot_id=? AND job_id=?
            AND publication_status='staging'`).run(snapshotID, id).changes : 0;
        });
        removedSnapshots += removed;
        await yieldEventLoop();
      }
      return { jobID: id, removedSnapshots };
    },
    async modelDataCleanupObsoleteSnapshots() {
      if (obsoleteCleanupActive) throw fail('Model data snapshot cleanup is already running.', 409);
      obsoleteCleanupActive = true;
      const counts = { removedSnapshots: 0, removedRecords: 0, removedFacts: 0 };
      const yieldEventLoop = () => new Promise(resolve => setImmediate(resolve));
      try {
        const snapshots = tx(() => {
          assertObsoleteCleanupIdle();
          return db.prepare(`SELECT s.snapshot_id FROM model_data_snapshots s WHERE s.publication_status='complete'
            AND NOT EXISTS (SELECT 1 FROM model_data_sources d WHERE d.current_snapshot_id=s.snapshot_id)
            ORDER BY s.created_at,s.snapshot_id`).all();
        });
        for (const { snapshot_id: snapshotID } of snapshots) {
          const claimed = tx(() => {
            assertObsoleteCleanupIdle();
            const candidate = db.prepare(`SELECT s.job_id FROM model_data_snapshots s
              WHERE s.snapshot_id=? AND s.publication_status='complete' AND NOT EXISTS
                (SELECT 1 FROM model_data_sources d WHERE d.current_snapshot_id=s.snapshot_id)`).get(snapshotID);
            if (!candidate) return false;
            if (candidate.job_id === null || !db.prepare('SELECT 1 FROM model_data_refresh_jobs WHERE job_id=?').get(candidate.job_id))
              throw fail('An obsolete model data snapshot has no retained refresh job; cleanup stopped.', 409);
            // Retire the non-current snapshot before yielding. Content deduplication
            // cannot republish partially deleted rows; interrupted deletion is
            // recoverable through the existing terminal-job staging cleanup.
            return db.prepare(`UPDATE model_data_snapshots SET publication_status='staging'
              WHERE snapshot_id=? AND publication_status='complete' AND NOT EXISTS
                (SELECT 1 FROM model_data_sources d WHERE d.current_snapshot_id=model_data_snapshots.snapshot_id)`)
              .run(snapshotID).changes === 1;
          });
          if (!claimed) continue;
          while (true) {
            const deleted = tx(() => {
              assertObsoleteCleanupClaim(snapshotID);
              const rows = db.prepare(`SELECT f.fact_id FROM model_data_records r
                JOIN model_data_facts f ON f.record_key=r.record_key WHERE r.snapshot_id=? LIMIT ?`)
                .all(snapshotID, MAX_STAGING_CLEANUP_BATCH);
              if (!rows.length) return 0;
              const placeholders = rows.map(() => '?').join(',');
              return db.prepare(`DELETE FROM model_data_facts WHERE fact_id IN (${placeholders})`)
                .run(...rows.map(row => row.fact_id)).changes;
            });
            counts.removedFacts += deleted;
            if (!deleted) break;
            await yieldEventLoop();
          }
          while (true) {
            const deleted = tx(() => {
              assertObsoleteCleanupClaim(snapshotID);
              const rows = db.prepare(`SELECT r.record_key FROM model_data_records r WHERE r.snapshot_id=?
                AND NOT EXISTS (SELECT 1 FROM model_data_facts f WHERE f.record_key=r.record_key) LIMIT ?`)
                .all(snapshotID, MAX_STAGING_CLEANUP_BATCH);
              if (!rows.length) return 0;
              const placeholders = rows.map(() => '?').join(',');
              return db.prepare(`DELETE FROM model_data_records WHERE snapshot_id=? AND record_key IN (${placeholders})`)
                .run(snapshotID, ...rows.map(row => row.record_key)).changes;
            });
            counts.removedRecords += deleted;
            if (!deleted) break;
            await yieldEventLoop();
          }
          counts.removedSnapshots += tx(() => {
            assertObsoleteCleanupClaim(snapshotID);
            return db.prepare(`DELETE FROM model_data_snapshots WHERE snapshot_id=? AND publication_status='staging'
              AND NOT EXISTS (SELECT 1 FROM model_data_records r WHERE r.snapshot_id=model_data_snapshots.snapshot_id)
              AND NOT EXISTS (SELECT 1 FROM model_data_sources d WHERE d.current_snapshot_id=model_data_snapshots.snapshot_id)`)
              .run(snapshotID).changes;
          });
          await yieldEventLoop();
        }
        return counts;
      } catch (error) {
        error.cleanup = { ...counts };
        throw error;
      } finally {
        obsoleteCleanupActive = false;
      }
    },
    finishModelDataRefresh(id, patch = {}) {
      if (!isObject(patch) || !JOB_STATUSES.has(patch.status)) throw fail('Refresh completion needs a supported status.');
      const updatedAt = timestamp(patch.updatedAt ?? Date.now(), 'updatedAt');
      const resultJSON = patch.result === undefined && patch.results === undefined && patch.summary === undefined ? undefined
        : boundedJSON({
          ...(patch.summary === undefined ? {} : { summary: text(patch.summary, 'Refresh summary', 2000) }),
          ...(patch.results === undefined ? {} : { results: patch.results }),
          ...(patch.result === undefined ? {} : { detail: patch.result }),
        }, 'Refresh result', 256 * 1024);
      const errorText = patch.error == null ? patch.error : text(patch.error, 'Refresh error', 1000);
      tx(() => {
        const current = db.prepare('SELECT * FROM model_data_refresh_jobs WHERE job_id=?').get(id);
        if (!current) throw fail('Refresh job was not found.', 404);
        const dismissing = patch.status === 'dismissed' && TERMINAL_JOB_STATUSES.has(current.status) && current.status !== 'dismissed';
        if (!['running','cancelling'].includes(current.status) && !dismissing) throw fail('Refresh job is no longer active.', 409);
        const terminal = TERMINAL_JOB_STATUSES.has(patch.status);
        db.prepare(`UPDATE model_data_refresh_jobs SET status=?,result_json=?,error=?,updated_at=?,finished_at=? WHERE job_id=?`)
          .run(patch.status, resultJSON ?? current.result_json, errorText === undefined ? current.error : errorText, updatedAt, terminal ? updatedAt : null, id);
        if (terminal) {
          const sources = JSON.parse(current.sources_json);
          const update = db.prepare(`UPDATE model_data_sources SET status=?,error=?,updated_at=? WHERE source=? AND current_job_id=?`);
          for (const source of sources) {
            const existing = db.prepare('SELECT status,error FROM model_data_sources WHERE source=?').get(source);
            const status = patch.status === 'dismissed' ? (existing?.status ?? 'not-loaded')
              : ['complete','completed'].includes(existing?.status) ? 'complete'
              : ['failed','needs-key','cancelled','interrupted'].includes(existing?.status) ? existing.status
              : patch.status === 'partial' && existing?.status !== 'failed' ? 'partial'
              : patch.status === 'completed' ? 'complete' : patch.status;
            const sourceError = status === 'failed' ? (existing?.error ?? errorText ?? current.error)
              : ['interrupted','cancelled','needs-key'].includes(status) ? (existing?.error ?? errorText ?? current.error) : null;
            update.run(status, sourceError, updatedAt, source, id);
          }
        }
      });
      return job(id);
    },
    modelDataList(options = {}) {
      const query = options.query === undefined || options.query === null || options.query === '' ? '' : text(options.query, 'Query', 300);
      const search = normalized(query);
      const source = options.source == null || options.source === '' ? null : sourceID(options.source);
      const kind = options.kind == null || options.kind === '' ? null : options.kind;
      if (kind && !KINDS.has(kind)) throw fail('Choose a model, deployment or configuration record.');
      const identity = options.identityStatus == null || options.identityStatus === '' ? null : options.identityStatus;
      if (identity && !['unmatched', 'exact', 'documented-alias', 'reviewed'].includes(identity)) throw fail('Unknown identity-match status.');
      const missingAttribute = options.missingAttribute == null || options.missingAttribute === '' ? null : text(options.missingAttribute, 'Missing attribute', 300);
      const limit = options.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Limit must be from 1 to 100.');
      const responseLimit = options.responseLimit ?? limit;
      if (!Number.isInteger(responseLimit) || responseLimit < 1 || responseLimit > limit) throw fail('Response page size must fit the requested limit.');
      const snapshots = db.prepare(`SELECT source,current_snapshot_id AS snapshotID FROM model_data_sources
        WHERE current_snapshot_id IS NOT NULL ${source ? 'AND source=?' : ''} ORDER BY source`).all(...(source ? [source] : []));
      const criteria = { query: search, source, kind, identity, missingAttribute, limit, snapshots };
      const { fingerprint, offset } = cursorCriteria(criteria, options.cursor);
      const where = snapshots.length ? [`(${snapshots.map(() => '(r.source=? AND r.snapshot_id=?)').join(' OR ')})`] : ['0'];
      const params = snapshots.flatMap(row => [row.source,row.snapshotID]);
      if (source) { where.push('r.source=?'); params.push(source); }
      if (kind) { where.push('r.kind=?'); params.push(kind); }
      if (identity) { where.push('r.identity_status=?'); params.push(identity); }
      if (search) { where.push('instr(r.search_text,?)>0'); params.push(search); }
      if (missingAttribute) {
        where.push(`NOT EXISTS (SELECT 1 FROM model_data_facts f WHERE f.record_key=r.record_key AND f.attribute=? AND f.value_json<>'null')`);
        params.push(missingAttribute);
      }
      const total = db.prepare(`SELECT count(*) AS n FROM model_data_records r
        WHERE ${where.join(' AND ')}`).get(...params).n;
      const rows = db.prepare(`SELECT r.record_id,r.source,r.snapshot_id,r.kind,r.name,r.provider,r.model_id,r.aliases_json,
        r.identifiers_json,r.configuration_json,r.source_reference_json,r.source_dates_json,r.field_presence_json,r.identity_status,
        p.content_sha256,p.retrieved_at,p.record_count,
        (SELECT count(*) FROM model_data_facts f WHERE f.record_key=r.record_key) AS fact_count
        FROM model_data_records r JOIN model_data_snapshots p ON p.snapshot_id=r.snapshot_id
        WHERE ${where.join(' AND ')} ORDER BY r.normalized_name,r.source,r.record_id LIMIT ? OFFSET ?`)
        .all(...params, responseLimit + 1, offset);
      const hasMore = rows.length > responseLimit;
      const items = rows.slice(0, responseLimit).map(row => ({
        id: row.record_id, source: row.source, snapshotID: row.snapshot_id, snapshotSha256: row.content_sha256,
        retrievedAt: row.retrieved_at, kind: row.kind, name: row.name, provider: row.provider, modelID: row.model_id,
        aliases: JSON.parse(row.aliases_json), identifiers: JSON.parse(row.identifiers_json),
        configuration: JSON.parse(row.configuration_json), sourceReference: JSON.parse(row.source_reference_json),
        sourceDates: JSON.parse(row.source_dates_json), identityStatus: row.identity_status,
        fieldPresence: JSON.parse(row.field_presence_json), missingness: JSON.parse(row.field_presence_json).missingAttributes,
        factCount: row.fact_count, recordCount: row.record_count,
      }));
      const nextOffset = offset + items.length;
      return { records: items, total, truncated: hasMore, nextCursor: hasMore && nextOffset < MAX_OFFSET ? nextCursor(fingerprint, nextOffset) : null,
        page: { limit, ...(responseLimit < limit ? {responseLimit,boundedBy:'native-response-bytes'} : {}),offset, returned: items.length, hasMore, continuation: hasMore && nextOffset < MAX_OFFSET ? 'available' : hasMore ? 'offset-limit' : 'complete', consistency: 'moving-snapshot' },
        coverage: 'Source-backed model catalog records from the published source snapshots selected for this page. A changed source snapshot invalidates its continuation cursor. Native identity status is only exact/documented/reviewed when explicitly recorded; unmatched does not prove absence.' };
    },
    modelDataDetail(id, options = {}) {
      const recordID = text(id, 'Record ID', 512);
      const limit = options.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw fail(`Limit must be from 1 to ${MAX_PAGE}.`);
      const responseLimit = options.responseLimit ?? limit;
      if (!Number.isInteger(responseLimit) || responseLimit < 1 || responseLimit > limit) throw fail('Response page size must fit the requested limit.');
      const current = db.prepare(`SELECT r.*,p.content_sha256,p.retrieved_at,p.source_reference_json AS snapshot_source_reference,
        p.metadata_json AS snapshot_metadata FROM model_data_records r JOIN model_data_sources s ON s.source=r.source
        JOIN model_data_snapshots p ON p.snapshot_id=r.snapshot_id
        WHERE r.record_id=? AND r.snapshot_id=s.current_snapshot_id ORDER BY r.source LIMIT 2`).all(recordID);
      if (!current.length) return { record: null };
      if (current.length > 1) throw fail('Record ID exists in multiple sources; provide a source-qualified record ID.', 409);
      const row = current[0];
      let attributes = null;
      if (options.attributes !== undefined) {
        if (!Array.isArray(options.attributes) || options.attributes.length > 30) throw fail('Attributes must be an array with at most 30 entries.');
        attributes = [...new Set(options.attributes.map(attribute => text(attribute, 'Attribute', 300)))].sort();
      }
      const selection = ['f.record_key=?'], selectedParams = [row.record_key];
      if (attributes) {
        const { exact, patterns } = modelObservationAttributeFilter(row.source,attributes);
        const clauses = [];
        if (exact.length) { clauses.push(`f.attribute IN (${exact.map(() => '?').join(',')})`); selectedParams.push(...exact); }
        for (const pattern of patterns) {
          clauses.push(pattern.exclude ? '(f.attribute GLOB ? AND f.attribute NOT GLOB ?)' : 'f.attribute GLOB ?');
          selectedParams.push(pattern.glob,...(pattern.exclude ? [pattern.exclude] : []));
        }
        selection.push(clauses.length ? `(${clauses.join(' OR ')})` : '0');
      }
      const criteria = { recordID, snapshotID: row.snapshot_id, limit, attributes };
      const { fingerprint, offset } = cursorCriteria(criteria, options.cursor);
      const factTotal = db.prepare(`SELECT count(*) AS n FROM model_data_facts f WHERE ${selection.join(' AND ')}`).get(...selectedParams).n;
      const facts = db.prepare(`SELECT f.fact_id,r.record_id AS subject,f.ordinal,f.attribute,f.value_json,f.units,f.scale_json,
        f.configuration_json,f.source_ref_json,f.dates_json,f.identity_match_json
        FROM model_data_facts f JOIN model_data_records r ON r.record_key=f.record_key
        WHERE ${selection.join(' AND ')} ORDER BY f.ordinal LIMIT ? OFFSET ?`).all(...selectedParams, responseLimit + 1, offset);
      const truncated = facts.length > responseLimit;
      const selectedFacts = facts.slice(0, responseLimit).map(fact => ({
        id: fact.fact_id, subject: fact.subject, attribute: fact.attribute, value: JSON.parse(fact.value_json), units: fact.units,
        scale: fact.scale_json ? JSON.parse(fact.scale_json) : null, configuration: JSON.parse(fact.configuration_json),
        sourceRef: JSON.parse(fact.source_ref_json), dates: JSON.parse(fact.dates_json), identityMatch: JSON.parse(fact.identity_match_json),
      }));
      const factsBytes = byteLength(json(selectedFacts));
      if (factsBytes > MAX_DETAIL_BYTES) throw fail('Fact page exceeds the bounded detail response size; request a smaller page.');
      const rawBytes = byteLength(row.raw_json);
      const raw = rawBytes <= MAX_CLIENT_RAW_BYTES && rawBytes <= MAX_DETAIL_BYTES - factsBytes ? JSON.parse(row.raw_json) : null;
      const nextOffset = offset + selectedFacts.length;
      const record = {
        id: row.record_id, source: row.source, snapshotID: row.snapshot_id, snapshotSha256: row.content_sha256, retrievedAt: row.retrieved_at,
        sourceSnapshot: { sourceReference: JSON.parse(row.snapshot_source_reference), metadata: JSON.parse(row.snapshot_metadata) },
        kind: row.kind, name: row.name, provider: row.provider, modelID: row.model_id,
        aliases: JSON.parse(row.aliases_json), identifiers: JSON.parse(row.identifiers_json),
        configuration: JSON.parse(row.configuration_json), sourceReference: JSON.parse(row.source_reference_json),
        sourceDates: JSON.parse(row.source_dates_json), identityStatus: row.identity_status,
        fieldPresence: JSON.parse(row.field_presence_json), missingness: JSON.parse(row.field_presence_json).missingAttributes,
        raw, rawTruncated: raw === null, rawBytes,
      };
      return { record, facts: selectedFacts, factTotal, factsTruncated: truncated, nextCursor: truncated && nextOffset < MAX_OFFSET ? nextCursor(fingerprint, nextOffset) : null,
        page: { limit,...(responseLimit < limit ? {responseLimit,boundedBy:'native-response-bytes'} : {}),offset, returned: selectedFacts.length, hasMore: truncated, continuation: truncated && nextOffset < MAX_OFFSET ? 'available' : truncated ? 'offset-limit' : 'complete', consistency: 'immutable-snapshot' } };
    },
    modelDataNativeMatches(nativeID, { limit = 20, source = null } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Native-match limit must be from 1 to 100.');
      if (source !== null) sourceID(source);
      const input = typeof nativeID === 'string' ? { id: nativeID } : nativeID;
      if (!isObject(input)) throw fail('Native model identity must be text or an object.');
      const provider = input.providerID ?? input.provider;
      const modelID = input.modelID ?? input.id;
      const canonical = text(modelID, 'Native model ID', 1000);
      const providerText = provider == null ? null : text(provider, 'Native provider ID', 500);
      const scopedNativeID = isObject(input.nativeModel) && typeof input.nativeModel.id === 'string' && input.nativeModel.id.length
        ? input.nativeModel.id : providerText ? `${providerText}/${canonical}` : canonical;
      const aliases = input.aliases ?? [];
      if (!Array.isArray(aliases) || aliases.length > 64 || aliases.some(value => typeof value !== 'string' || value.length > 1000))
        throw fail('Native model aliases are invalid.');
      const wanted = new Set([canonical, ...aliases]);
      if (providerText) {
        wanted.add(`${providerText}/${canonical}`);
        wanted.add(`${providerText}:${canonical}`);
      }
      const candidates = db.prepare(`SELECT r.record_id,r.snapshot_id,r.source,r.kind,r.name,r.provider,r.model_id,r.identifiers_json,r.aliases_json,r.identity_status,
        p.content_sha256,p.retrieved_at,p.metadata_json AS snapshot_metadata_json FROM model_data_records r
        JOIN model_data_sources s ON s.source=r.source AND s.current_snapshot_id=r.snapshot_id
        JOIN model_data_snapshots p ON p.snapshot_id=r.snapshot_id
        WHERE r.source IN ('modelsdev','artificial-analysis') ${source ? 'AND r.source=?' : ''}
        ORDER BY r.source,r.record_id LIMIT 40000`).all(...(source ? [source] : []));
      const found = [];
      const foundIDs = new Set();
      const linkedCanonicalIDs = new Set();
      const capturedAAModelLinks = new Map();
      const capturedAAModelMatch = row => {
        let links = capturedAAModelLinks.get(row.snapshot_id);
        if (!links) {
          links = new Map();
          const metadata = JSON.parse(row.snapshot_metadata_json);
          const modelLinks = metadata?.sourceMetadata?.scope?.modelLinks;
          for (const link of Array.isArray(modelLinks) ? modelLinks : []) {
            if (!isObject(link) || typeof link.recordID !== 'string' || !Array.isArray(link.nativeModelIDs)) continue;
            const nativeIDs = links.get(link.recordID) ?? new Set();
            for (const id of link.nativeModelIDs) if (typeof id === 'string') nativeIDs.add(id);
            links.set(link.recordID, nativeIDs);
          }
          capturedAAModelLinks.set(row.snapshot_id, links);
        }
        return links.get(row.record_id)?.has(scopedNativeID) === true;
      };
      const appendMatch = (row, identifiers) => {
        found.push({ id: row.record_id, source: row.source, snapshotID: row.snapshot_id, snapshotSha256: row.content_sha256,
          retrievedAt: row.retrieved_at, kind: row.kind, name: row.name, provider: row.provider, modelID: row.model_id,
          identityStatus: row.identity_status });
        foundIDs.add(row.record_id);
        if (row.source === 'modelsdev' && row.kind === 'deployment' && typeof identifiers.canonicalModelID === 'string'
            && identifiers.canonicalModelID.length)
          linkedCanonicalIDs.add(identifiers.canonicalModelID);
      };
      for (const row of candidates) {
        const identifiers = JSON.parse(row.identifiers_json);
        const native = input.nativeModel;
        let explicitMatch = false;
        if (isObject(native)) {
          const explicit = native.sourceIdentities?.[row.source];
          explicitMatch = !!(isObject(explicit) && (explicit.id === row.record_id ||
            typeof identifiers.sourceID === 'string' && (explicit.sourceID === identifiers.sourceID || explicit.id === identifiers.sourceID) ||
            row.source === 'modelsdev' && row.kind === 'deployment' && typeof row.provider === 'string' &&
              typeof row.model_id === 'string' && explicit.providerID === row.provider && explicit.modelID === row.model_id ||
            row.source === 'modelsdev' && row.kind === 'model' && typeof identifiers.canonicalModelID === 'string' &&
              typeof row.model_id === 'string' && explicit.canonicalModelID === identifiers.canonicalModelID));
          if (!explicitMatch && Array.isArray(native.sourceAliases?.[row.source]))
            explicitMatch = native.sourceAliases[row.source].includes(row.record_id);
        }
        if (!explicitMatch && row.source === 'artificial-analysis' && row.kind === 'configuration')
          explicitMatch = capturedAAModelMatch(row);
        if (explicitMatch) {
          appendMatch(row, identifiers);
          if (found.length >= limit) break;
          continue;
        }
        // Artificial Analysis uses a different creator/model identity domain;
        // only explicit identities, aliases or publication-captured model links
        // make a configuration eligible. Names and slugs never establish a link.
        if (row.source !== 'modelsdev') continue;
        const idValues = [row.record_id, row.model_id, identifiers.id, identifiers.nativeID, identifiers.modelID,
          identifiers.canonicalModelID, identifiers.slug, identifiers.configurationID, identifiers.configurationId,
          ...(Array.isArray(identifiers.nativeIDs) ? identifiers.nativeIDs : []),
          ...(Array.isArray(identifiers.nativeIdentityAliases) ? identifiers.nativeIdentityAliases : []), ...JSON.parse(row.aliases_json)]
          .filter(value => typeof value === 'string');
        const providerValues = [row.provider, identifiers.provider, identifiers.providerID]
          .filter(value => typeof value === 'string');
        const providerMatches = !providerText || providerValues.includes(providerText);
        const compositeMatches = providerMatches && idValues.some(value => wanted.has(value));
        const modelPair = (row.kind === 'model' || providerMatches) && wanted.has(row.model_id);
        const standaloneID = !providerText && idValues.some(value => wanted.has(value));
        if (compositeMatches || modelPair || standaloneID) {
          appendMatch(row, identifiers);
          if (found.length >= limit) break;
        }
      }
      // A source-declared deployment-to-canonical relation makes the canonical
      // facts relevant even when its ID differs from OpenCode's model ID. Keep
      // it as a separate source record; names and other provider deployments
      // never establish this relation.
      if (found.length < limit && linkedCanonicalIDs.size) {
        for (const row of candidates) {
          if (row.source !== 'modelsdev' || row.kind !== 'model' || foundIDs.has(row.record_id)) continue;
          const identifiers = JSON.parse(row.identifiers_json);
          if (typeof identifiers.canonicalModelID !== 'string' || !linkedCanonicalIDs.has(identifiers.canonicalModelID)) continue;
          appendMatch(row, identifiers);
          if (found.length >= limit) break;
        }
      }
      return { records: found, truncated: found.length === limit, matching: 'exact-declared-identifier-or-documented-alias' };
    },
    modelDataSecret(name) {
      if (typeof name !== 'string' || !secretName.test(name)) throw fail('Secret name is invalid.');
      const row = db.prepare('SELECT encrypted_value,updated_at FROM model_data_secrets WHERE name=?').get(name);
      return row?.encrypted_value ?? null;
    },
    saveModelDataSecret(name, encrypted) {
      if (typeof name !== 'string' || !secretName.test(name)) throw fail('Secret name is invalid.');
      if (encrypted === null) {
        tx(() => db.prepare('DELETE FROM model_data_secrets WHERE name=?').run(name));
        return { removed: true, name };
      }
      if (typeof encrypted !== 'string' || !/^dpapi-current-user:v1:[A-Za-z0-9+/]+={0,2}$/.test(encrypted)
          || byteLength(encrypted) > 64 * 1024) throw fail('Secret must be opaque current-user DPAPI ciphertext within the storage limit.');
      tx(() => db.prepare(`INSERT INTO model_data_secrets(name,encrypted_value,updated_at) VALUES(?,?,?)
        ON CONFLICT(name) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=excluded.updated_at`).run(name, encrypted, Date.now()));
      return { saved: true, name, updatedAt: db.prepare('SELECT updated_at FROM model_data_secrets WHERE name=?').get(name).updated_at };
    },
  };
}
