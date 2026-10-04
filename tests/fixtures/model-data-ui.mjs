// Browser-only deterministic source responses. No public feed or inference runs.
export async function modelDataUIRoutes(page, { configured = false, count = 30 } = {}) {
  const retrievedAt = Date.parse('2026-10-03T12:00:00Z');
  const records = Array.from({ length: count }, (_, index) => ({
    id: `modelsdev:record-${String(index).padStart(2, '0')}`, source: 'modelsdev', kind: index ? 'model' : 'deployment',
    name: index ? `Source model ${String(index).padStart(2, '0')}` : 'Matched native model', provider: index ? undefined : 'opencode',
    modelID: index ? `source-model-${index}` : 'free', aliases: [], identifiers: index ? { sourceID: `source-model-${index}` } : { nativeID: 'opencode/free' },
    configuration: { context: 64000 }, sourceReference: { url: 'https://models.dev', path: `records[${index}]` },
    sourceDates: { retrievedAt }, identityMatch: { status: index ? 'unmatched' : 'exact', nativeIDs: index ? [] : ['opencode/free'] },
    fieldPresence: { categories: { pricing: { state: 'partial' }, performance: { state: 'missing' },
      capabilities: { state: 'not-covered-by-source' }, context: { state: 'present' }, evaluations: { state: 'source-reported-unavailable' } },
      missingAttributes: [{ attribute: 'evaluations.fixture_index', state: 'source-reported-unavailable' }] },
  }));
  records.push({ id: 'artificial-analysis:configuration-fixture', source: 'artificial-analysis', kind: 'configuration',
    name: 'Measured α configuration', modelID: 'fixture-alpha', aliases: [], identifiers: { sourceID: 'fixture-alpha' },
    configuration: { reasoning_effort: 'high' }, sourceReference: { url: 'https://artificialanalysis.ai', path: 'data[0]' },
    sourceDates: { retrievedAt }, identityMatch: { status: 'unmatched', nativeIDs: [] } });
  const state = { configured, job: null, legacy: null, maintenance: { state: 'ready', error: null }, jobs: 0, records, gets: [], mutations: [], credentialWrites: [], beforeResponse: null, rejectListCursor: false };
  const sources = () => [
    { id: 'modelsdev', name: 'models.dev', state: 'ready', configured: true, recordCount: count, lastSuccessAt: retrievedAt,
      lastAttemptAt: retrievedAt, attribution: 'Models.dev source fixture', version: 'fixture-v1' },
    { id: 'artificial-analysis', name: 'Artificial Analysis', state: 'ready', configured: state.configured, recordCount: 1,
      lastSuccessAt: retrievedAt, attribution: 'Artificial Analysis source fixture' },
  ];
  const credentials = () => ({ artificialAnalysis: { configured: state.configured, storage: 'Windows protected storage' }, sources: sources() });
  const status = () => ({ job: state.job, sources: sources(), legacy: state.legacy, maintenance: state.maintenance });
  const detail = (record, params) => {
    const offset = Number(params.get('cursor') || 0), limit = Number(params.get('limit') || 25);
    const facts = record.source === 'artificial-analysis' ? [{ attribute: 'evaluations.fixture_index', value: 42.5, units: 'points',
      scale: { minimum: 0, maximum: 100 }, configuration: record.configuration,
      sourceRef: { url: 'https://artificialanalysis.ai', path: 'evaluations.fixture_index' }, dates: { retrievedAt, measuredAt: null },
      identityMatch: record.identityMatch }] : [
      { attribute: 'cost.input', value: 0.25, units: 'USD per million input tokens', sourceRef: { url: 'https://models.dev', path: 'cost.input' }, dates: { retrievedAt } },
      { attribute: 'limit.context', value: 64000, units: 'tokens', sourceRef: { url: 'https://models.dev', path: 'limit.context' }, dates: { retrievedAt } },
      ...Array.from({ length: 28 }, (_, index) => ({ attribute: `source.extra_${index + 1}`, value: index + 1,
        sourceRef: { url: 'https://models.dev', path: `extra[${index}]` }, dates: { retrievedAt } })),
    ];
    return { record, facts: facts.slice(offset, offset + limit), nextCursor: offset + limit < facts.length ? String(offset + limit) : null,
      missingness: ['publication date unknown'], sources: sources(), identityMatch: record.identityMatch };
  };
  await page.route('**/api/models/data**', async route => {
    const request = route.request(), url = new URL(request.url()), params = url.searchParams;
    let response, responseStatus = 200;
    if (url.pathname.endsWith('/credentials')) {
      if (request.method() === 'PUT') { state.credentialWrites.push(request.postDataJSON()); state.configured = true; }
      else if (request.method() === 'DELETE') { state.credentialWrites.push({ operation: 'remove' }); state.configured = false; }
      response = credentials();
    } else if (request.method() === 'POST') {
      const body = request.postDataJSON(); state.mutations.push(body);
      if (body.operation === 'refresh') state.job = { id: `source-job-${++state.jobs}`, status: 'running', sources: body.sources,
        createdAt: retrievedAt, updatedAt: retrievedAt, summary: 'Updating selected model-data sources…', results: [] };
      else if (body.operation === 'cancel' && body.id === state.job?.id) state.job = { ...state.job, status: 'cancelling', summary: 'Cancelling model-data requests…' };
      else if (body.operation === 'dismiss' && body.id === state.job?.id && !['running', 'cancelling'].includes(state.job.status)) state.job = null;
      else { responseStatus = 409; response = { error: 'Wait for this model-data refresh to finish.' }; }
      response ??= status();
    } else {
      state.gets.push(Object.fromEntries(params));
      const operation = params.get('operation');
      if (operation === 'status') response = status();
      else if (operation === 'list') {
        const query = (params.get('query') || '').toLocaleLowerCase(), source = params.get('source'), kind = params.get('kind');
        const filtered = records.filter(record => (!query || `${record.name} ${record.modelID}`.toLocaleLowerCase().includes(query)) &&
          (!source || source === record.source) && (!kind || kind === record.kind));
        const offset = Number(params.get('cursor') || 0), limit = Number(params.get('limit') || 25);
        response = { records: filtered.slice(offset, offset + limit), total: filtered.length, limit,
          nextCursor: offset + limit < filtered.length ? String(offset + limit) : null, ...status() };
        if (state.rejectListCursor && params.get('cursor')) {
          responseStatus = 400; response = { error: 'Model data cursor is invalid or belongs to different criteria. Start a new search.' };
        }
      } else if (operation === 'detail') {
        const id = params.get('id');
        if (id === 'opencode/free') response = { matches: [detail(records[0], params)], sources: sources(), identityMatch: records[0].identityMatch };
        else { const record = records.find(record => record.id === id); response = record ? detail(record, params) : { record: null, sources: sources() }; }
      } else { responseStatus = 400; response = { error: 'Unknown model data operation.' }; }
    }
    const body = JSON.stringify(response);
    if (state.beforeResponse) await state.beforeResponse({ operation: params.get('operation'), params, request });
    await route.fulfill({ status: responseStatus, contentType: 'application/json', body });
  });
  return state;
}

export async function openModels(page, url, expect) {
  await page.goto(url);
  await expect(page.locator('.project-navigation .nav-accordion-trigger')).toHaveAttribute('aria-label', 'History project');
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
}
