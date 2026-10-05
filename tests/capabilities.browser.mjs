import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { attachMcpHost } from './fixtures/mcp-host.mjs';
import { test, expect } from './support/browser-test.mjs';

async function openCapabilities(page, url, { expand = true } = {}) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.locator('.settings-drawer-links:not([hidden])').getByRole('button', { name: 'Capabilities', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capabilities', exact: true })).toBeVisible();
  if (expand) for (const name of ['Tools', 'Skills', 'Connected services']) {
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
  await expect(page.getByRole('heading', { name: 'Connected services', exact: true })).toHaveCount(1);
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
    { name: 'Skills', summary: /\d+ · \d+ found/, content: page.locator('.capability-section').nth(1), key: 'skills' },
    { name: 'Connected services', summary: /\d+ configured · \d+ connected/, content: page.locator('.mcp-service-list'), key: 'mcp' },
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

test('shared capability inventory presents the Freelancer computer tool with a concise description', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ timers: false }));
  attachMcpHost(fixture.host);
  const original = fixture.host.request.bind(fixture.host);
  fixture.host.request = async (route, options) => {
    if (route === '/experimental/tool/ids') return ['computer'];
    return original(route, options);
  };
  const page = await appBrowser.newPage({ viewport: { width: 1280, height: 900 } });
  await openCapabilities(page, fixture.url);
  const row = page.getByRole('list', { name: 'Tool inventory' }).locator('details.capability-item')
    .filter({ has: page.getByText('computer', { exact: true }) });
  await expect(row).toContainText('Loaded');
  await row.locator('summary').click();
  await expect(row.locator('.capability-description')).toContainText(/browser pages and desktop applications/i);
});

test('fresh no-project workspace shows shared Tools and Skills with persistent independent collapse states', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ timers: false }));
  await fixture.store.update('settings', settings => ({ ...settings, projects: [], lastProjectID: undefined }));
  const native = attachMcpHost(fixture.host);
  const original = fixture.host.request.bind(fixture.host);
  fixture.host.request = async (route, options) => {
    if (route === '/experimental/tool/ids') return ['read', 'knowledge', 'skill'];
    if (route === '/skill') return [{ name: 'verify', location: 'native/skills/verify/SKILL.md' }];
    return original(route, options);
  };
  const page = await appBrowser.newPage({ viewport: { width: 1280, height: 900 } });
  const inspections = [];
  await page.route('**/api/capabilities*', route => {
    inspections.push(new URL(route.request().url()).searchParams);
    return route.continue();
  });
  await openCapabilities(page, fixture.url, { expand: false });
  const panel = name => page.locator('details.panel-disclosure').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const tools = panel('Tools'), skills = panel('Skills');
  for (const name of ['Tools', 'Skills']) {
    await expect(panel(name)).not.toHaveAttribute('open', '');
    await page.getByRole('heading', { name, exact: true }).click();
    await expect(panel(name)).toHaveAttribute('open', '');
  }
  await expect(page.getByRole('list', { name: 'Tool inventory' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Skill inventory' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Skill inventory' }).getByText('verify', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh tools', exact: true })).toBeEnabled();
  await page.getByRole('heading', { name: 'Tools', exact: true }).click();
  await expect(tools).not.toHaveAttribute('open', '');
  await expect(skills).toHaveAttribute('open', '');
  await openCapabilities(page, fixture.url, { expand: false });
  await expect(page.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible();
  await expect(tools).not.toHaveAttribute('open', '');
  await expect(skills).toHaveAttribute('open', '');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Tools', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Tool inventory' })).toBeVisible();
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/capabilities' && response.ok());
  await page.getByRole('button', { name: 'Refresh tools', exact: true }).click();
  await refreshed;
  await expect(page.getByRole('list', { name: 'Tool inventory' })).toBeVisible();
  await expect(tools).toHaveAttribute('open', '');
  await expect(skills).toHaveAttribute('open', '');
  assert.ok(inspections.length >= 3);
  assert.ok(inspections.every(parameters => !parameters.has('project') && !parameters.has('session')));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  assert.deepEqual((await fixture.store.read('settings')).projects, []);
  assert.ok(native.calls.every(call => !['POST', 'PATCH', 'DELETE'].includes(call.options.method)), 'inventory and disclosure actions do not change MCP configuration');
  assert.equal(fixture.calls.filter(call => /\/prompt(?:_async)?$/.test(call.route)).length, 0);
});

test('model-specific tool absence is displayed as an observed exposure state, not incompatibility', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ timers: false }));
  attachMcpHost(fixture.host);
  const page = await appBrowser.newPage();
  await page.route('**/api/capabilities*', async route => {
    const response = await route.fetch();
    const result = await response.json();
    result.tools = [{ id: 'websearch', summary: 'Search the web.', origin: 'OpenCode native', discovered: true,
      configured: true, modelExposure: false, nativePermission: 'allow', dependency: 'unverified',
      unavailableReason: 'Native websearch is not available for the selected provider/model/configuration.' }];
    await route.fulfill({ response, json: result });
  });
  await openCapabilities(page, fixture.url, { expand: false });
  await page.getByRole('heading', { name: 'Tools', exact: true }).click();
  const row = page.getByRole('list', { name: 'Tool inventory' }).getByRole('listitem')
    .filter({ has: page.getByText('websearch', { exact: true }) });
  await expect(row).toContainText('Not exposed here');
  await expect(row).not.toContainText('Model unsupported');
});

test('skill and tool rows reveal short descriptions by click and keyboard without invoking capabilities', { tag: ['@app', '@capability'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ timers: false }));
  await fixture.store.update('settings', settings => ({ ...settings, projects: [], lastProjectID: undefined }));
  const native = attachMcpHost(fixture.host);
  const original = fixture.host.request.bind(fixture.host);
  fixture.host.request = async (route, options) => {
    if (route === '/experimental/tool/ids') return ['read', 'knowledge', 'skill'];
    if (route === '/skill') return [{ name: 'remember', location: 'native/skills/remember/SKILL.md' },
      { name: 'custom-skill', description: 'Read the custom guide for this task.', location: 'native/custom-skill/SKILL.md' }];
    return original(route, options);
  };
  const page = await appBrowser.newPage({ viewport: { width: 1280, height: 900 } });
  await openCapabilities(page, fixture.url);
  const item = (list, name) => page.getByRole('list', { name: list, exact: true })
    .locator('details.capability-item').filter({ has: page.getByText(name, { exact: true }) });
  const knowledge = item('Tool inventory', 'knowledge'), remember = item('Skill inventory', 'remember');
  await expect(knowledge.locator('.capability-description')).not.toBeVisible();
  await knowledge.locator('summary').click();
  await expect(knowledge.locator('.capability-description')).toContainText(/memor|knowledge|evidence/i);
  await remember.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(remember.locator('.capability-description')).toBeVisible();
  await expect(remember.locator('.capability-description')).toContainText(/knowledge|memory|remember/i);
  await page.keyboard.press('Space');
  await expect(remember.locator('.capability-description')).not.toBeVisible();
  const custom = item('Skill inventory', 'custom-skill');
  await custom.locator('summary').click();
  await expect(custom.locator('.capability-description')).toHaveText('Read the custom guide for this task.');
  await page.setViewportSize({ width: 390, height: 844 });
  await knowledge.locator('summary').click();
  await knowledge.locator('summary').click();
  await expect(knowledge.locator('.capability-description')).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  if (process.env.FREELANCER_QA_SHOTS) await page.screenshot({ path: process.env.FREELANCER_QA_SHOTS + '/capability-descriptions-narrow.png' });
  assert.ok(native.calls.every(call => !['POST', 'PATCH', 'DELETE'].includes(call.options.method)));
  assert.equal(fixture.calls.filter(call => /\/prompt(?:_async)?$/.test(call.route)).length, 0);
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
  await expect(page.locator('.mcp-service-list li')).toHaveCount(6);
  for (const name of ['Playwright', 'Cua Driver', 'Fetch', 'Sequential Thinking', 'Context7', 'JEV'])
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up Memory', exact: true })).toHaveCount(0);
  const serviceRows = page.locator('.mcp-service-list > li');
  for (const row of await serviceRows.all()) await expect(row).toHaveCSS('display', 'grid');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => serviceRows.evaluateAll(rows => rows.every(row => {
    const lines = [...row.querySelectorAll(':scope > small')].map(line => line.getBoundingClientRect());
    return lines.every((line, index) => index === 0 || line.top >= lines[index - 1].bottom);
  }))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.getByLabel('Service template').selectOption('cua-driver');
  await expect(page.getByLabel('Executable and arguments (JSON array)')).toHaveValue(JSON.stringify(['cua-driver', 'mcp']));
  await page.getByRole('checkbox', { name: 'I approve running this command on this computer.' }).check();
  await page.getByRole('button', { name: 'Save shared connection', exact: true }).click();
  await expect.poll(() => native.config.mcp['cua-driver']?.command).toEqual(['cua-driver', 'mcp']);
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(page.getByLabel('Service template').getByRole('option', { name: 'Memory', exact: true })).toHaveCount(0);
  await page.getByLabel('Service template').selectOption('jev');
  await expect(page.getByLabel('Executable and arguments (JSON array)')).toHaveValue(JSON.stringify(['npx', '-y', 'jev-mcp@0.5.1']));
  await expect(page.getByLabel('Environment references (JSON object)')).toHaveValue(JSON.stringify({ TYPESAFE_API_KEY: '{env:JEV_API_KEY}' }, null, 2));
  await page.getByLabel('Service template').selectOption('context7');
  await expect(page.getByLabel('MCP server URL')).toHaveValue('https://mcp.context7.com/mcp');
  await page.getByRole('checkbox', { name: 'I approve connecting to this service.' }).check();
  await page.getByRole('button', { name: 'Save shared connection', exact: true }).click();
  await expect.poll(() => native.config.mcp.context7?.url).toBe('https://mcp.context7.com/mcp');
  assert.equal(native.config.mcp.context7.oauth, false);
  assert.deepEqual(native.config.mcp.context7.headers, { Authorization: 'Bearer {env:CONTEXT7_API_KEY}' });
  assert.equal((await fixture.store.read('settings')).mcp, undefined);
});
