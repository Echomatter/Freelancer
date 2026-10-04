import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { normalizeModelsDev } from '../domain/model-data.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { modelDataUIRoutes, openModels } from './fixtures/model-data-ui.mjs';
import { test, expect } from './support/browser-test.mjs';

test('model data: native source identities, facts, missingness and bounded pages', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const state = await modelDataUIRoutes(page);
    await openModels(page, f.url, expect);
    await expect(page.getByRole('heading', { name: 'Your models', exact: true })).toBeVisible();
    const native = page.locator('.provider-model-card');
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    await expect(native.getByRole('heading', { name: 'Matched native model', exact: true })).toBeVisible();
    await expect(native.getByText('0.25 USD per million input tokens', { exact: true })).toBeVisible();
    await expect(native.getByText('64000 tokens', { exact: true })).toBeVisible();
    await expect(native.getByText('context: present', { exact: true })).toBeVisible();
    await expect(native.getByText('pricing: partial', { exact: true })).toBeVisible();
    await expect(native.getByText('capabilities: not covered by source', { exact: true })).toBeVisible();
    await expect(native.getByText('evaluations: source reported unavailable', { exact: true })).toBeVisible();
    await expect(native.getByText(/Published prices are source references/)).toBeVisible();
    await native.getByRole('button', { name: 'Next source facts', exact: true }).click();
    await expect(native.getByText('source.extra 28', { exact: true })).toBeVisible();
    assert.ok(state.gets.some(row => row.operation === 'detail' && row.id === state.records[0].id && row.cursor === '25'));
    await native.getByRole('button', { name: 'Back to native source matches', exact: true }).click();
    await expect(native.getByText('0.25 USD per million input tokens', { exact: true })).toBeVisible();
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    // A second synthetic publication exposes a separately configured exact match on this native card.
    state.records[0] = { ...state.records.at(-1), identityMatch: { status: 'exact', nativeIDs: ['opencode/free'] } };
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    const detail = native.getByRole('region', { name: 'Measured α configuration source data', exact: true });
    await expect(detail.getByRole('heading', { name: 'Measured α configuration', exact: true })).toBeVisible();
    await expect(detail.getByText('Matched native IDs: ["opencode/free"]', { exact: true })).toBeVisible();
    await expect(detail.getByText('evaluations.fixture index', { exact: true })).toBeVisible();
    await expect(detail.getByText('42.5 points', { exact: true })).toBeVisible();
    await expect(detail.getByText('Evaluation configuration: {"reasoning_effort":"high"}', { exact: true }).first()).toBeVisible();
    await expect(detail.getByText(/Measured: Unknown/).first()).toBeVisible();
    await expect(detail.getByRole('link', { name: 'Open source', exact: true }).first()).toHaveAttribute('href', 'https://artificialanalysis.ai/');
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    await expect(detail).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Stored source catalog', exact: true })).toHaveCount(0);
    assert.equal(state.gets.filter(row => row.operation === 'list').length, 0, 'Models reads source facts only through native model cards');
    assert.equal(state.mutations.length, 0, 'all attached source reads stay local/stored');
    assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, 0);
  } finally { await browser.close(); await f.close(); }
});

test('model data: large native inventory keeps bounded pages and full filtering', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  const extraModels = Object.fromEntries(Array.from({ length: 3422 }, (_, index) => {
    const number = index + 1, id = `native-${String(number).padStart(4, '0')}`;
    return [id, { name: `Native ${String(number).padStart(4, '0')}`, cost: { input: 0, output: 0 },
      limit: { context: 64000 + number, output: 8192 }, toolcall: true }];
  }));
  f.state.extraModels = extraModels;
  const native = f.host.request.bind(f.host);
  f.host.request = async (route, options) => {
    const value = await native(route, options);
    if (route === '/provider') {
      value.connected.push('fixture-provider');
      value.all.push({ id: 'fixture-provider', name: 'Fixture provider', models: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`other-${index}`, { name: `Other ${index}`,
          cost: { input: 1, output: 2 }, limit: { context: 5000, output: 1000 }, toolcall: true }]),
      ) });
      value.all.push({ id: 'disconnected-fixture', name: 'Not connected fixture', models: {
        outside: { name: 'Disconnected model', cost: { input: 1, output: 2 },
          limit: { context: 999999, output: 1000 }, toolcall: true },
      } });
    }
    return value;
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const sources = await modelDataUIRoutes(page);
    await openModels(page, f.url, expect);
    const cards = page.locator('.native-model-grid .provider-model-card');
    const pager = page.getByRole('group', { name: 'Native model pages', exact: true });
    const range = pager.getByRole('status');
    const next = pager.getByRole('button', { name: 'Next native page', exact: true });
    const previous = pager.getByRole('button', { name: 'Previous native page', exact: true });
    await expect(range).toHaveText('Showing 1–50 of 3,435 models');
    await expect(cards).toHaveCount(50);
    await expect(previous).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Provider filter', exact: true }).locator('option[value="disconnected-fixture"]')).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Search models', exact: true }).fill('Disconnected model');
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('No models match these filters.', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search models', exact: true }).fill('');
    await expect(range).toHaveText('Showing 1–50 of 3,435 models');
    await page.getByRole('button', { name: 'Update model data', exact: true }).click();
    const update = page.getByRole('dialog', { name: 'Update model data', exact: true });
    await expect(update).toBeVisible();
    await update.getByRole('button', { name: 'Cancel', exact: true }).click();
    await next.click();
    await expect(range).toHaveText('Showing 51–100 of 3,435 models');
    await expect(cards).toHaveCount(50);
    await previous.click();
    await expect(range).toHaveText('Showing 1–50 of 3,435 models');

    await next.click();
    await page.getByRole('textbox', { name: 'Search models', exact: true }).fill('Native 3422');
    await expect(cards).toHaveCount(1);
    await expect(cards.getByRole('heading', { name: 'Native 3422', exact: true })).toBeVisible();
    await expect(range).toHaveText('Showing 1–1 of 1 models');
    await expect(next).toBeDisabled();
    await page.getByRole('textbox', { name: 'Search models', exact: true }).fill('native-00');
    await expect(range).toHaveText('Showing 1–50 of 99 models');
    await next.click();
    await expect(cards).toHaveCount(49);
    await expect(range).toHaveText('Showing 51–99 of 99 models');
    await expect(next).toBeDisabled();
    await page.getByRole('textbox', { name: 'Search models', exact: true }).fill('');
    await expect(range).toHaveText('Showing 1–50 of 3,435 models');
    await next.click();
    await page.getByRole('combobox', { name: 'Provider filter', exact: true }).selectOption('fixture-provider');
    await expect(cards).toHaveCount(12);
    await expect(range).toHaveText('Showing 1–12 of 12 models');
    await expect(previous).toBeDisabled();
    await page.getByRole('combobox', { name: 'Provider filter', exact: true }).selectOption('');
    await next.click();
    await page.getByRole('group', { name: 'Model access', exact: true }).getByRole('button', { name: 'Free', exact: true }).click();
    await expect(cards).toHaveCount(50);
    await expect(range).toHaveText('Showing 1–50 of 3,423 models');
    await expect(previous).toBeDisabled();
    await page.getByRole('group', { name: 'Model access', exact: true }).getByRole('button', { name: 'All', exact: true }).click();
    await next.click();
    await page.getByRole('combobox', { name: 'Sort models', exact: true }).selectOption('context');
    await expect(range).toHaveText('Showing 1–50 of 3,435 models');
    await expect(cards.first().getByRole('heading')).toHaveText('Native 3422');
    await page.getByRole('combobox', { name: 'Sort models', exact: true }).selectOption('cost');
    await next.click();
    const unchangedRefresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap' && response.status() === 200);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await unchangedRefresh;
    await expect(range).toHaveText('Showing 51–100 of 3,435 models');
    const fullInventory = (await f.api('bootstrap')).models;
    assert.equal(fullInventory.length, 3436, 'scoped browsing and paging preserve the complete native inventory');
    assert.ok(fullInventory.some(model => model.id === 'disconnected-fixture/outside'), 'unconnected native inventory remains available internally');

    f.state.extraModels = Object.fromEntries(Object.entries(extraModels).slice(0, 12));
    const changedRefresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/bootstrap' && response.status() === 200);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await changedRefresh;
    await expect(cards).toHaveCount(25);
    await expect(range).toHaveText('Showing 1–25 of 25 models');
    await expect(previous).toBeDisabled();
    await expect(next).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await expect(page.getByRole('button', { name: 'Update model data', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Models', exact: true })).toHaveCount(0);
    assert.equal(sources.mutations.length, 0, 'browsing and paging never starts a source update');
    assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, 0, 'browsing never starts inference');
  } finally { await browser.close(); await f.close(); }
});

test('model data: actual shared service publishes and renders exact native source facts', { tag: ['@app'] }, async ({ appBrowser: browser, own }, info) => {
  const retrievedAt = Date.parse('2026-10-03T12:00:00Z');
  const payload = { providers: { opencode: { id: 'opencode', name: 'Synthetic provider', npm: '@ai-sdk/synthetic',
    doc: 'https://models.dev', env: ['SYNTHETIC_KEY_NAME'], models: { free: {
      id: 'free', name: 'Synthetic native deployment', description: 'Source-backed browser fixture',
      attachment: false, reasoning: false, tool_call: true, open_weights: false,
      release_date: '2026-09-30', last_updated: '2026-10-03', modalities: { input: ['text'], output: ['text'] },
      limit: { context: 64000, output: 8192 }, cost: { input: 0.125, output: 0.5 },
    } } } }, models: { 'synthetic-canonical': { id: 'synthetic-canonical', name: 'Synthetic canonical model',
    description: 'No asserted native identity', license: 'Synthetic fixture' } } };
  const snapshot = normalizeModelsDev(payload, { retrievedAt });
  let calls = 0, release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  const f = await own(localDataFixture({ timers: false, modelDataOptions: {
    env: {}, vault: { available: false }, fetchSource: async (source, { signal }) => {
      assert.equal(source, 'modelsdev'); calls++; await gate; signal.throwIfAborted(); return snapshot;
    },
  } }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await openModels(page, f.url, expect);
    const native = page.locator('.provider-model-card');
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    await expect(native.getByText(/No exact stored source match for this model\./)).toBeVisible();
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    assert.equal(calls, 0, 'stored UI reads do not fetch the synthetic source');
    await page.getByRole('button', { name: 'Update model data', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Update model data', exact: true });
    await expect(picker.getByLabel('models.dev', { exact: true })).toBeChecked();
    await expect(picker.getByLabel('Artificial Analysis', { exact: true })).toBeDisabled();
    await picker.getByRole('button', { name: 'Update selected sources', exact: true }).click();
    await expect(picker).toBeHidden();
    const progress = page.locator('.model-rating-job');
    await expect(progress.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    assert.equal(calls, 1);
    release();
    await expect(progress.getByText('models.dev: completed · 2 downloaded · 1 linked record · 1 model linked', { exact: true })).toBeVisible();
    const apiList = await f.api('models/data?operation=list&limit=25');
    assert.deepEqual(apiList.records, f.app.modelData.list({ limit: 25 }).records);
    assert.equal(apiList.total, 1, 'Unmatched canonical records are excluded from configured model storage.');
    assert.equal(apiList.records.some(record => record.name === 'Synthetic canonical model'), false);
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    const details = native.getByRole('region', { name: 'Synthetic native deployment source data', exact: true });
    await expect(details.getByRole('heading', { name: 'Synthetic native deployment', exact: true })).toBeVisible();
    await expect(details.getByText('models.dev · deployment · Identity match: exact', { exact: true })).toBeVisible();
    await expect(details.getByText('Matched native IDs: ["opencode/free"]', { exact: true })).toBeVisible();
    await expect(details.getByText('0.125 USD/1M tokens', { exact: true })).toBeVisible();
    await expect(details.getByText('64000 tokens', { exact: true })).toBeVisible();
    await expect(details.getByText('2026-09-30', { exact: true }).first()).toBeVisible();
    const formattedRetrievedAt = await page.evaluate(value => new Date(value).toLocaleString(), retrievedAt);
    await expect(details.getByText(`Retrieved: ${formattedRetrievedAt} · Published: Unknown · Measured: Unknown`, { exact: true }).first()).toBeVisible();
    await expect(details.getByText('Open source · Field: /providers/opencode/models/free/cost/input', { exact: true })).toBeVisible();
    await expect(details.getByRole('link', { name: 'Open source', exact: true }).first()).toHaveAttribute('href', snapshot.sourceReference.url);
    const apiDetail = await f.api('models/data?operation=detail&id=opencode%2Ffree&limit=25');
    assert.equal(apiDetail.matches.length, 1);
    assert.equal(apiDetail.matches[0].record.id, snapshot.records.find(record => record.kind === 'deployment').id);
    assert.equal(apiDetail.matches[0].facts.find(fact => fact.attribute === 'cost.input').dates.retrievedAt, retrievedAt);
    assert.equal(calls, 1, 'detail and internal catalog reads stay on the published store');
    await expect(page.getByRole('region', { name: 'Stored source catalog', exact: true })).toHaveCount(0);
    assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, 0);
    await progress.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(progress).toHaveCount(0);
    assert.equal((await f.api('models/data?operation=status')).job.status, 'dismissed', 'dismissal hides progress while retaining its audit receipt');
    const indexStatus = page.getByRole('button', { name: 'Dismiss index status', exact: true });
    if (await indexStatus.isVisible()) await indexStatus.click();
    const shots = path.resolve('artifacts/model-catalog-screenshots'); await mkdir(shots, { recursive: true });
    const wideShot = path.join(shots, 'model-data-shared-service-1440.png');
    await page.locator('.page').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: wideShot, fullPage: true });
    await info.attach('model-data-shared-service-1440', { path: wideShot, contentType: 'image/png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await native.locator('summary').filter({ hasText: 'Published source data' }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const narrowShot = path.join(shots, 'model-data-shared-service-390.png');
    await page.screenshot({ path: narrowShot });
    await info.attach('model-data-shared-service-390', { path: narrowShot, contentType: 'image/png' });
    await page.reload();
    await expect(page.locator('.project-navigation .nav-accordion-trigger')).toHaveAttribute('aria-label', 'History project');
    await expect(progress).toHaveCount(0);
    assert.equal((await f.api('models/data?operation=status')).job.status, 'dismissed');
    assert.equal(calls, 1, 'reload does not replay a dismissed source refresh');
  } finally { release(); await browser.close(); await f.close(); }
});

test('model data: staging maintenance preserves stored reads and blocks new refreshes', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const state = await modelDataUIRoutes(page);
    state.maintenance = { state: 'cleaning', error: null };
    state.job = { id: 'source-dismissed', status: 'dismissed', sources: ['modelsdev'], summary: 'Retained dismissed audit receipt.', results: [] };
    state.legacy = { id: 'legacy-maintenance', status: 'retirement-unverified', project: f.project.id, session: 'ses_legacy_retained', legacy: true, inference: 'retired' };
    await openModels(page, f.url, expect);
    await expect(page.getByRole('button', { name: 'Update model data', exact: true })).toBeDisabled();
    await expect(page.getByText('Clearing interrupted model data… Stored records remain readable.', { exact: true })).toBeVisible();
    await expect(page.locator('.model-data-maintenance-error')).toHaveCount(0);
    await expect(page.locator('.model-rating-job')).toHaveCount(0);
    await expect(page.locator('.model-data-legacy-warning')).toBeVisible();
    const native = page.locator('.provider-model-card');
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    const detail = native.getByRole('region', { name: 'Matched native model source data', exact: true });
    await expect(detail.getByRole('heading', { name: 'Matched native model', exact: true })).toBeVisible();
    state.maintenance = { state: 'failed', error: 'Interrupted staging could not be cleared. Stored data is preserved; inspect local storage before another update.' };
    await expect(page.locator('.model-data-maintenance-error')).toHaveText(state.maintenance.error);
    await expect(detail.getByRole('heading', { name: 'Matched native model', exact: true })).toBeVisible();
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    await expect(page.locator('.model-data-maintenance-error').getByRole('status')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Update model data', exact: true })).toBeDisabled();
    state.maintenance = { state: 'ready', error: null };
    await expect(page.getByRole('button', { name: 'Update model data', exact: true })).toBeEnabled();
    await expect(page.locator('.model-data-maintenance-error')).toHaveCount(0);
    await expect(page.locator('.model-data-legacy-warning')).toBeVisible();
    assert.equal(state.mutations.length, 0);
    assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, 0);
  } finally { await browser.close(); await f.close(); }
});

test('model data: source key, explicit selection, cancellation and narrow layout', { tag: ['@app'] }, async ({ appBrowser: browser, own }, info) => {
  const f = await own(localDataFixture({ timers: false }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const state = await modelDataUIRoutes(page);
    await openModels(page, f.url, expect);
    await page.getByRole('button', { name: 'Set up data sources', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Model data sources' }).click();
    const settings = page.getByRole('region', { name: 'Model data sources', exact: true });
    const key = settings.getByLabel('Artificial Analysis API key', { exact: true });
    const fixtureKey = 'fixture-source-key-no-real-credential';
    await key.fill(fixtureKey);
    await settings.getByRole('button', { name: 'Save source key', exact: true }).click();
    await expect(key).toHaveValue('');
    await expect(settings.getByText('Artificial Analysis key saved.', { exact: true })).toBeVisible();
    assert.deepEqual(state.credentialWrites, [{ artificialAnalysisKey: fixtureKey }]);
    assert.equal(state.mutations.length, 0, 'saving a key does not refresh sources');
    assert.ok(!JSON.stringify(await f.store.read('settings')).includes(fixtureKey));
    assert.equal(await page.evaluate(value => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(value), fixtureKey), false);
    await openModels(page, f.url, expect);
    await page.setViewportSize({ width: 390, height: 844 });
    // Paired clients can read safe source status even when credential management is host-only.
    let blockedCredentialReads = 0;
    const hostOnlyCredentials = async route => {
      blockedCredentialReads++;
      await route.fulfill({ status: 403, json: { error: 'Manage model-data credentials on this computer.' } });
    };
    await page.route('**/api/models/data/credentials', hostOnlyCredentials);
    await page.getByRole('button', { name: 'Update model data', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Update model data', exact: true });
    await expect(dialog.getByLabel('Artificial Analysis', { exact: true })).toBeEnabled();
    await dialog.getByLabel('Artificial Analysis', { exact: true }).check();
    assert.equal(blockedCredentialReads, 0, 'source selection never reads the host-only credential editor');
    await info.attach('model-data-source-selection-narrow', { body: await page.screenshot(), contentType: 'image/png' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await dialog.getByRole('button', { name: 'Update selected sources', exact: true }).click();
    await expect(dialog).toBeHidden();
    assert.deepEqual(state.mutations.at(-1), { operation: 'refresh', sources: ['modelsdev', 'artificial-analysis'] });
    const progress = page.locator('.model-rating-job');
    await progress.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(progress.getByText('Cancelling model-data requests…', { exact: true })).toBeVisible();
    await expect(progress.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Update model data', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Update model data', exact: true })).toHaveCount(0);
    assert.equal(state.mutations.filter(row => row.operation === 'refresh').length, 1);
    state.job = { ...state.job, status: 'cancelled', summary: 'Model-data refresh cancelled. Published sources were retained; unfinished sources were preserved.',
      results: [{ source: 'modelsdev', status: 'completed', recordCount: 30 }] };
    await expect(progress.getByText(/Published sources were retained/)).toBeVisible();
    await progress.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(progress).toHaveCount(0);
    await page.unroute('**/api/models/data/credentials', hostOnlyCredentials);
    await page.getByRole('button', { name: 'Set up data sources', exact: true }).click();
    await settings.getByRole('button', { name: 'Remove saved source key', exact: true }).click();
    await expect(settings.getByText('Saved Artificial Analysis key removed.', { exact: true })).toBeVisible();
    await expect(key).toHaveValue('');
    assert.equal(state.configured, false);
    assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, 0);
  } finally { await browser.close(); await f.close(); }
});

test('model data: stale filters/readers and unresolved legacy research stay inspectable', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  let release = () => {};
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const state = await modelDataUIRoutes(page);
    state.legacy = { id: 'legacy-unverified', status: 'retirement-unverified', project: f.project.id, session: 'ses_legacy_retained',
      summary: 'Retained legacy execution must be inspected.', legacy: true, inference: 'retired' };
    await openModels(page, f.url, expect);
    const warning = page.locator('.model-data-legacy-warning');
    await expect(warning.getByText('Previous ratings research has not been confirmed stopped.', { exact: true })).toBeVisible();
    await warning.locator('summary').click();
    await expect(warning.getByText(/Inspect retained session: ses_legacy_retained/)).toBeVisible();
    await expect(warning.getByRole('button', { name: /Retry|Research|Go/ })).toHaveCount(0);
    const native = page.locator('.provider-model-card');
    const search = page.getByRole('textbox', { name: 'Search models', exact: true });
    let entered, finished;
    const started = new Promise(resolve => { entered = resolve; });
    const drained = new Promise(resolve => { finished = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let holdNativeRead = true;
    state.beforeResponse = async ({ operation, params }) => {
      if (holdNativeRead && operation === 'detail' && params.get('id') === 'opencode/free') {
        holdNativeRead = false; entered(); await gate; finished();
      }
    };
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    await started;
    await search.fill('No such usable model');
    await expect(native).toHaveCount(0);
    await expect(page.getByText('No models match these filters.', { exact: true })).toBeVisible();
    state.records[0] = { ...state.records[0], name: 'Current native source' };
    await search.fill('');
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    await expect(native.getByRole('heading', { name: 'Current native source', exact: true })).toBeVisible();
    release(); await drained;
    await expect(native.getByRole('heading', { name: 'Current native source', exact: true })).toBeVisible();
    await expect(native.getByRole('heading', { name: 'Matched native model', exact: true })).toHaveCount(0);
    const readerStarted = new Promise(resolve => { entered = resolve; });
    const readerDrained = new Promise(resolve => { finished = resolve; });
    const readerGate = new Promise(resolve => { release = resolve; });
    state.beforeResponse = async ({ operation, params }) => {
      if (operation === 'detail' && params.get('id') === state.records[0].id && params.get('cursor') === '25') {
        entered(); await readerGate; finished();
      }
    };
    await native.getByRole('button', { name: 'Next source facts', exact: true }).click();
    await readerStarted;
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    await native.locator('summary').filter({ hasText: 'Published source data' }).click();
    await expect(native.getByText('0.25 USD per million input tokens', { exact: true })).toBeVisible();
    release(); await readerDrained;
    await expect(native.getByText('0.25 USD per million input tokens', { exact: true })).toBeVisible();
    await expect(native.getByText('source.extra 28', { exact: true })).toHaveCount(0);
    await expect(native.getByRole('heading', { name: 'Current native source', exact: true })).toBeVisible();
    assert.equal(state.mutations.length, 0);
    assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, 0);
  } finally { release(); await browser.close(); await f.close(); }
});
