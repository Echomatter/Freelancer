import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { modelDataUIRoutes, openModels } from './fixtures/model-data-ui.mjs';
import { test, expect } from './support/browser-test.mjs';

test('model-ratings: explicit source updates replace model research', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const state = await modelDataUIRoutes(page);
    const originalSessions = f.state.sessions.length;
    await openModels(page, f.url, expect);
    const native = page.locator('.provider-model-card');
    await expect(native).toHaveCount(1);
    await expect(native.getByLabel('Model status: Not tested (connected / unverified)')).toBeVisible();
    for (const fact of ['Context 64K', 'Output 8.2K', 'Tool use', 'Variant low']) await expect(native.getByText(fact, { exact: true })).toBeVisible();
    await expect(native.locator('details')).toHaveCount(1);
    await expect(native.getByText('Published source data', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search models' })).toBeVisible();
    await page.getByRole('button', { name: 'Free', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Free', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
    assert.equal(state.mutations.length, 0, 'stored reads never start refreshes');
    await page.getByRole('button', { name: 'Update model data', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Update model data', exact: true });
    await expect(dialog.getByLabel('models.dev', { exact: true })).toBeChecked();
    await expect(dialog.getByLabel('Artificial Analysis', { exact: true })).toBeDisabled();
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Update selected sources', exact: true }).click();
    await expect(dialog).toBeHidden();
    assert.deepEqual(state.mutations, [{ operation: 'refresh', sources: ['modelsdev'] }]);
    const progress = page.locator('.model-rating-job');
    await expect(progress.getByText('Updating selected model-data sources…', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
    assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, 0, 'no research inference');
    assert.equal(f.state.sessions.length, originalSessions, 'no configuration chat is created');
    await progress.getByRole('button', { name: 'Hide model data progress', exact: true }).click();
    await expect(progress).toHaveCount(0);
    assert.equal(state.job.status, 'running', 'hiding presentation keeps server work running');
    await page.getByRole('button', { name: 'Update model data', exact: true }).click();
    await expect(progress).toBeVisible();
    assert.equal(state.mutations.length, 1, 'revealing a running job does not start a second refresh');
    state.job = { ...state.job, status: 'completed', summary: '1 of 1 model-data sources updated.',
      results: [{ source: 'modelsdev', status: 'completed', recordCount: 30 }] };
    await expect(progress.getByText('1 of 1 model-data sources updated.', { exact: true })).toBeVisible();
    await expect(progress.getByText('models.dev: completed · 30 records', { exact: true })).toBeVisible();
    await progress.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(progress).toHaveCount(0);
    assert.equal(state.job, null);
    await page.reload();
    await expect(page.locator('.project-navigation .nav-accordion-trigger')).toHaveAttribute('aria-label', 'History project');
    await expect(progress).toHaveCount(0);
    assert.equal(f.calls.filter(call => call.route.endsWith('/prompt_async')).length, 0);
  } finally { await browser.close(); await f.close(); }
});
