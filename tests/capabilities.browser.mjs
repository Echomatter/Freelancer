import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('capabilities are one simple platform page with honest states and an LSP opt-in', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture());
  const original = fixture.host.request.bind(fixture.host);
  let fail = false;
  fixture.host.request = async (route, options) => {
    const url = new URL(route, 'http://native');
    if (url.pathname === '/experimental/tool/ids') {
      if (fail) throw Object.assign(Error('private server detail'), { status: 503 });
      return ['read', 'delegate', 'question', 'skill'];
    }
    if (route === '/skill') return [{ name: 'verify', location: 'backend/skills/verify/SKILL.md' }];
    if (route === '/mcp') return { playwright: { status: 'needs_auth' } };
    if (route === '/lsp') return [];
    return original(route, options);
  };
  const page = await appBrowser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const open = async () => {
    const top = page.getByRole('button', { name: 'Application settings', exact: true });
    if ((await top.getAttribute('aria-expanded')) !== 'true') await top.click();
    await page.locator('.settings-drawer-links:not([hidden])').getByRole('button', { name: 'Capabilities', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Capabilities', exact: true })).toBeVisible();
  };
  try {
    await page.goto(fixture.url);
    await open();
    await expect(page.getByText(/nothing to set up/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Skills' })).toContainText('Skills');
    await expect(page.getByText('verify', { exact: true })).toBeVisible();
    await expect(page.getByText('Native MCP authentication is required.', { exact: true })).toBeVisible();
    const toggle = page.getByRole('checkbox', { name: 'Enable native LSP tool' });
    await expect(toggle).not.toBeChecked();
    await page.setViewportSize({ width: 360, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await toggle.check();
    await page.getByRole('button', { name: 'Save native tool choice' }).click();
    await expect(page.getByText('Saved. Restart Freelancer to apply the native LSP tool setting.', { exact: true })).toBeVisible();
    assert.equal((await fixture.store.read('settings')).nativeLspToolEnabled, true);
    fail = true;
    await page.locator('.settings-content').getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('Native inspection failed or timed out.', { exact: true }).first()).toBeVisible();
    assert.equal(await page.getByText('private server detail').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await appBrowser.close(); }
});
