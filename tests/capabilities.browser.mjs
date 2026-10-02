import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { attachMcpHost } from './fixtures/mcp-host.mjs';
import { test, expect } from './support/browser-test.mjs';

async function openCapabilities(page, url) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.locator('.settings-drawer-links:not([hidden])').getByRole('button', { name: 'Capabilities', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capabilities', exact: true })).toBeVisible();
}

test('shared MCP connections can be added, authenticated, disabled and re-enabled without identity selectors', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ timers: false }));
  const native = attachMcpHost(fixture.host);
  const page = await appBrowser.newPage({ viewport: { width: 1280, height: 900 } });
  await openCapabilities(page, fixture.url);
  await expect(page.getByText(/No connections/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Enable native LSP tool' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.getByLabel('Service name', { exact: true }).fill('browser');
  await page.getByLabel('MCP server URL', { exact: true }).fill('https://fixture.example/mcp');
  const save = page.getByRole('button', { name: 'Save shared connection', exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I approve connecting to this service.' }).check();
  await save.click();
  await expect(page.getByRole('button', { name: 'Authenticate browser', exact: true })).toBeVisible();
  assert.equal(native.config.mcp.browser.type, 'remote');
  assert.equal((await fixture.store.read('settings')).mcp, undefined);
  await page.getByRole('button', { name: 'Authenticate browser', exact: true }).click();
  await expect(page.getByText('Sign-in finished.')).toBeVisible();
  assert.equal(native.statuses.browser, 'connected');
  await page.getByRole('button', { name: 'Disable browser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enable browser', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enable browser', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable browser', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  // Reload reads the same native global configuration; no selected-project copy.
  await openCapabilities(page, fixture.url);
  await expect(page.getByRole('button', { name: 'Disable browser', exact: true })).toBeVisible();
});

test('capability observations and failed MCP actions are honest and sanitized', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }, testInfo) => {
  const fixture = await own(localDataFixture({ timers: false }));
  const native = attachMcpHost(fixture.host, { browser: { type: 'remote', url: 'https://fixture.example/mcp', enabled: true } });
  const original = fixture.host.request.bind(fixture.host);
  let failTools = false;
  fixture.host.request = async (route, options) => {
    if (route === '/experimental/tool/ids') {
      if (failTools) throw Object.assign(Error('private server detail'), { status: 503 });
      return ['read', 'delegate', 'question', 'skill'];
    }
    if (route === '/skill') return [{ name: 'verify', location: 'backend/skills/verify/SKILL.md' }];
    return original(route, options);
  };
  const page = await appBrowser.newPage();
  await openCapabilities(page, fixture.url);
  const readRow = page.getByRole('list', { name: 'Tool inventory' }).getByRole('listitem').filter({ has: page.locator('code').getByText('read', { exact: true }) });
  await expect(readRow).toContainText('Loaded');
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'MCP', exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('capabilities-cleanup.png') });
  await expect(page.getByText(/Registered.*unverified/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Help: Tools', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('Loaded means OpenCode provides this tool.');
  await page.getByText('Technical details', { exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('Request:');
  await page.setViewportSize({ width: 360, height: 740 });
  await expect.poll(async () => {
    const box = await page.getByRole('tooltip').boundingBox();
    return box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 361 && box.y + box.height <= 741;
  }).toBe(true);
  await page.keyboard.press('Escape');
  native.fail = true;
  await page.getByRole('button', { name: 'Test / retry browser', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('not confirmed');
  await expect(page.getByText(/Native shared MCP configuration is unavailable/)).toBeVisible();
  assert.equal(await page.getByText('private-token: do-not-forward').count(), 0);
  native.fail = false;
  await page.getByRole('button', { name: 'Refresh connections', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disable browser', exact: true })).toBeVisible();
  failTools = true;
  await page.getByRole('button', { name: 'Refresh tools', exact: true }).click();
  await expect(readRow).toContainText('Unknown');
  await page.getByRole('button', { name: 'Help: Tools', exact: true }).click();
  await page.getByText('Technical details', { exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText('Native inspection failed or timed out.');
  assert.equal(await page.getByText('private server detail').count(), 0);
});
