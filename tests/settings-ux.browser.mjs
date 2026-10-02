import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';
import { settingsPages } from '../src/settings-catalog.mjs';
import { lightPalettes, darkPalettes } from '../domain/theme.mjs';
import { generateCustomTheme } from '../domain/custom-themes.mjs';

// Exercise actual application destinations, not a second mocked settings renderer.
for (const mode of ['light', 'dark', 'custom']) for (const width of [360, 1440]) {
  test(`all 18 settings destinations: ${mode}, ${width}px`, { tag: ['@app', '@settings'] }, async ({ appBrowser, own }) => {
    test.setTimeout(120000);
    const fixture = await own(localDataFixture());
    const custom = mode === 'custom' ? generateCustomTheme({ mode: 'dark', saved: [], avoid: [] }) : null;
    const theme = custom?.id ?? (mode === 'light' ? lightPalettes[0].id : darkPalettes[0].id);
    await fixture.store.update('settings', value => ({ ...value, appearance: { ...value.appearance, theme, ...(custom ? { customThemes: [custom] } : {}) } }));
    const page = await appBrowser.newPage({ viewport: { width, height: 960 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(fixture.url);
      for (const entry of settingsPages) {
        const trigger = page.getByRole('button', { name: entry.scope === 'project' ? 'Project settings' : 'Application settings', exact: true });
        if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
        await page.locator(`#${entry.scope}-settings-links`).getByRole('button', { name: entry.title, exact: true }).click();
        const heading = page.getByRole('heading', { name: entry.title, exact: true, level: 1 });
        await expect(heading).toBeVisible();
        const header = page.locator(`[data-settings-page="${entry.scope}/${entry.id}"]`);
        await expect(header).toHaveAttribute('data-settings-layout', entry.layout);
        await expect(header.locator('.settings-page-description')).toHaveText(entry.description);
        await expect(page.locator(`#${entry.scope}-settings-links button[aria-label="${entry.title}"]`)).toHaveAttribute('aria-current', 'page');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${entry.title}: document overflow`);
        const overflow = await header.evaluate(element => {
          const page = element.closest('.page');
          return page.scrollWidth > page.clientWidth + 2;
        });
        assert.equal(overflow, false, `${entry.title}: page overflow`);
        // Keep screenshots with Playwright failure artifacts; do not make actions
        // such as auth, sync, archive, or starting a goal part of a layout sweep.
        if (entry.id === 'content-storage') {
          await expect(page.getByRole('heading', { name: 'File access', exact: true })).toBeVisible();
          assert.ok(await page.evaluate(() => !!(document.getElementById('content-storage-access').compareDocumentPosition(document.getElementById('content-storage-maintenance')) & Node.DOCUMENT_POSITION_FOLLOWING)));
        }
      }
      assert.deepEqual(errors, []);
    } finally { await appBrowser.close(); }
  });
}
