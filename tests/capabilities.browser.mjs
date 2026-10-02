import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { attachMcpHost } from './fixtures/mcp-host.mjs';
import { test, expect } from './support/browser-test.mjs';

async function openCapabilities(page, url, { expand = true } = {}) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.locator('.settings-drawer-links:not([hidden])').getByRole('button', { name: 'Capabilities', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capabilities', exact: true })).toBeVisible();
  if (expand) for (const name of ['Tools', 'Skills', 'Connected Services (MCP)']) {
    const heading = page.getByRole('heading', { name, exact: true });
    if (await heading.locator('..').locator('..').getAttribute('open') === null) await heading.click();
  }
}

test('shared MCP connections can be added, authenticated, disabled and re-enabled without identity selectors', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ timers: false }));
  const native = attachMcpHost(fixture.host);
  const page = await appBrowser.newPage({ viewport: { width: 1280, height: 900 } });
  await openCapabilities(page, fixture.url);
  await expect(page.getByText(/No custom MCP connections/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Enable native LSP tool' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.getByLabel('Service name', { exact: true }).fill('browser');
  await page.getByLabel('MCP server URL', { exact: true }).fill('https://fixture.example/mcp');
  const save = page.getByRole('button', { name: 'Save shared connection', exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I approve connecting to this service.' }).check();
  await save.click();
  await expect(page.getByRole('button', { name: 'Authenticate', exact: true })).toBeVisible();
  assert.equal(native.config.mcp.browser.type, 'remote');
  assert.equal((await fixture.store.read('settings')).mcp, undefined);
  await page.getByRole('button', { name: 'Authenticate', exact: true }).click();
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
  const readRow = page.getByRole('list', { name: 'Tool inventory' }).getByRole('listitem').filter({ has: page.getByText('read', { exact: true }) });
  await expect(readRow).toContainText('Loaded');
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Connected Services (MCP)', exact: true })).toHaveCount(1);
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
  await page.getByRole('button', { name: 'Test / retry', exact: true }).click();
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

test('capability panels start compact and remember their local disclosure state', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ timers: false }));
  attachMcpHost(fixture.host);
  const page = await appBrowser.newPage({ viewport: { width: 1280, height: 900 } });
  await openCapabilities(page, fixture.url, { expand: false });
  const panels = [
    { name: 'Tools', summary: /\d+ · \d+ available/, content: page.getByRole('list', { name: 'Tool inventory' }), key: 'tools' },
    { name: 'Skills', summary: /\d+ · \d+ available/, content: page.locator('.capability-section').nth(1), key: 'skills' },
    { name: 'Connected Services (MCP)', summary: /\d+ · \d+ ready/, content: page.locator('.mcp-service-list'), key: 'mcp' },
  ];
  for (const panel of panels) {
    const heading = page.getByRole('heading', { name: panel.name, exact: true });
    const details = page.locator('details.panel-disclosure').filter({ has: heading });
    await expect(details).not.toHaveAttribute('open', '');
    await expect(details).toContainText(panel.summary);
    await heading.click();
    await expect(details).toHaveAttribute('open', '');
    await expect(panel.content).toBeVisible();
  }
  await expect(page.getByRole('list', { name: 'Tool inventory' })).toBeVisible();
  await page.reload();
  for (const key of ['tools', 'skills', 'mcp'])
    await expect.poll(() => page.evaluate(key => localStorage.getItem(`capability-panel:${key}`), key)).toBe('open');
});

test('native service states are shown distinctly for every shared service', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ timers: false }));
  const native = attachMcpHost(fixture.host, {
    playwright: { type: 'local', command: ['playwright'], enabled: true },
    fetch: { type: 'local', command: ['fetch'], enabled: false },
    memory: { type: 'local', command: ['memory'], enabled: true },
    'sequential-thinking': { type: 'local', command: ['sequential-thinking'], enabled: true },
    context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true, oauth: false },
    jev: { type: 'local', command: ['jev'], enabled: true },
  });
  Object.assign(native.statuses, {
    playwright: 'connected', memory: 'needs_setup', 'sequential-thinking': 'error',
    context7: 'needs_auth', jev: 'unavailable',
  });
  const page = await appBrowser.newPage();
  await openCapabilities(page, fixture.url);
  const rows = page.locator('.mcp-service-list li');
  for (const [name, state] of [
    ['Playwright', 'Available'], ['Fetch', 'Disabled'], ['Memory', 'Needs setup'],
    ['Sequential Thinking', 'Error'], ['Context7', 'Needs authentication'], ['JEV', 'Unavailable'],
  ]) await expect(rows.filter({ hasText: name })).toContainText(state);
});

test('generic service templates persist native configuration and keep credentials as environment references', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ timers: false }));
  const native = attachMcpHost(fixture.host);
  const page = await appBrowser.newPage({ viewport: { width: 1280, height: 900 } });
  await openCapabilities(page, fixture.url);
  for (const name of ['Playwright', 'Fetch', 'Memory', 'Sequential Thinking', 'Context7', 'JEV'])
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.getByLabel('Service template').selectOption('jev');
  await expect(page.getByLabel('Executable and arguments (JSON array)')).toHaveValue(JSON.stringify(['npx', '-y', 'jev-mcp@0.5.1']));
  await expect(page.getByLabel('Environment references (JSON object)')).toHaveValue(JSON.stringify({ TYPESAFE_API_KEY: '{env:JEV_API_KEY}' }, null, 2));
  await expect(page.locator('.mcp-service-list li').filter({ hasText: 'JEV' })).toContainText('usage-priced');
  await page.getByLabel('Service template').selectOption('context7');
  await expect(page.getByLabel('MCP server URL')).toHaveValue('https://mcp.context7.com/mcp');
  await page.getByRole('checkbox', { name: 'I approve connecting to this service.' }).check();
  await page.getByRole('button', { name: 'Save shared connection', exact: true }).click();
  await expect.poll(() => native.config.mcp.context7?.url).toBe('https://mcp.context7.com/mcp');
  assert.equal(native.config.mcp.context7.oauth, false);
  assert.deepEqual(native.config.mcp.context7.headers, { Authorization: 'Bearer {env:CONTEXT7_API_KEY}' });
  assert.equal((await fixture.store.read('settings')).mcp, undefined);
});
