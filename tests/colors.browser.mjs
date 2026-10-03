import { browserPalettes, capturePalette, paletteArtifacts } from './support/palettes.mjs';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { colorFixture } from './fixtures/color-app.mjs';
import { palettes } from '../domain/theme.mjs';
import { colorChannels, contrast } from '../domain/color.mjs';
import { providerTokens, providerDefaults } from '../domain/provider-colors.mjs';
import { test, expect } from './support/browser-test.mjs';

test('colors', { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  // Build then run. COLOR_OFFLINE=1 uses the same loopback fetch bridge needed by
  // restricted editing sandboxes; CI navigates the actual server normally.

  const f = await own(colorFixture());

  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(9000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const offline = process.env.COLOR_OFFLINE === '1';
  let fault = false, saves = 0, release, gate;
  if (offline) {
    await page.exposeBinding('colorFetch', async (_, route, options) => {
      if (route === '/api/appearance') { saves++; if (gate) await gate; if (fault) return { status: 400, body: JSON.stringify({ error: 'Deliberate save failure' }) }; }
      const response = await fetch(f.url + route, options);
      return { status: response.status, body: await response.text() };
    });
    await page.addInitScript(() => {
      // about:blank is not the secure loopback origin used by the actual app.
      // Supply only the missing secure-context API in this offline test harness.
      if (!crypto.randomUUID) crypto.randomUUID = () => {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
        const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      };
      window.fetch = async (route, options = {}) => {
        if (String(route).startsWith('/api/events')) return new Response(new ReadableStream({ start(controller) {
          const timer = setInterval(() => controller.enqueue(new TextEncoder().encode('data: {}\n\n')), 700);
          options.signal?.addEventListener('abort', () => { clearInterval(timer); controller.close(); }, { once: true });
        } }));
        const { status, body } = await window.colorFetch(String(route), { method: options.method, body: options.body, headers: options.headers });
        return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
      };
    });
  } else await page.route('**/api/appearance', async route => {
    saves++; if (gate) await gate;
    if (fault) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Deliberate save failure' }) });
    return route.continue();
  });
  const report = text => console.log('PASS ' + text);
  const rgb = hex => 'rgb(' + colorChannels(hex).join(', ') + ')';
  async function load() {
    if (!offline) return page.goto(f.url);
    await page.goto('about:blank');
    const html = await (await fetch(f.url)).text();
    await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, ''));
    const dir = new URL('../dist/assets/', import.meta.url), files = await readdir(dir);
    await page.addStyleTag({ content: await readFile(new URL(files.find(n => n.endsWith('.css')), dir), 'utf8') });
    await page.addScriptTag({ type: 'module', content: await readFile(new URL(files.find(n => n.startsWith('index-') && n.endsWith('.js')), dir), 'utf8') });
  }
  async function settings(tab = 'Appearance') { const group = page.getByRole('button', { name: 'Application settings', exact: true }); if (await group.getAttribute('aria-expanded') !== 'true') await group.click(); await page.getByRole('button', { name: tab, exact: true }).click(); }
  async function colorOf(locator, expected) { await locator.first().waitFor(); await page.waitForFunction(({ selector, color }) => getComputedStyle(document.querySelector(selector)).color === color, { selector: await locator.first().evaluate(el => { el.dataset.colorProbe = 'current'; return '[data-color-probe="current"]'; }), color: expected }); await locator.first().evaluate(el => delete el.dataset.colorProbe); }
  async function readable(locator, label) {
    const pair = await locator.first().evaluate(element => {
      let background = 'rgba(0, 0, 0, 0)', cursor = element;
      while (cursor) {
        const color = getComputedStyle(cursor).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { background = color; break; }
        cursor = cursor.parentElement;
      }
      return [getComputedStyle(element).color, background];
    });
    const hex = value => '#' + value.match(/[\d.]+/g).slice(0, 3).map(c => Math.round(Number(c)).toString(16).padStart(2, '0')).join('');
    assert.ok(contrast(hex(pair[0]), hex(pair[1])) >= 4.5, `${label}: ${pair.join(' on ')}`);
  }
  async function chooseTheme(id) {
    const palette = palettes.find(p => p.id === id), name = palette.name;
    const group = page.getByRole('button', { name: palette.mode === 'light' ? /^Light themes/ : /^Dark themes/ });
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
    await page.getByRole('button', { name: `Use ${name} palette`, exact: true }).click();
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, id);
    await page.waitForFunction(() => [...document.querySelectorAll('.palette-option')].every(button => !button.disabled));
  }
  async function screenshot(name) { const directory = paletteArtifacts('colors'); await mkdir(directory, { recursive: true }); await page.screenshot({ path: `${directory}/${name}.png`, fullPage: false, animations: 'disabled' }); }
  try {
    await load(); await settings();
    await expect(page.locator('.palette-group-toggle[aria-expanded="false"]')).toHaveCount(4);
    await page.getByRole('button', { name: /^Light themes/ }).click();
    await page.getByRole('button', { name: /^Dark themes/ }).click();
    await page.getByRole('button', { name: /^Use .* palette$/ }).first().waitFor();
    assert.equal(await page.getByRole('button', { name: /^Use .* palette$/ }).count(), palettes.length);
    assert.equal(await page.getByLabel('Generated theme style').count(), 0);
    for (const p of browserPalettes) {
      await test.step(`${p.name}: shell, selection, focus and contrast`, async () => {
        await chooseTheme(p.id);
        assert.equal(await page.locator('html').evaluate(e => getComputedStyle(e).backgroundColor), rgb(p.tokens.bg));
        assert.equal(await page.locator('.sidebar').evaluate(e => getComputedStyle(e).backgroundColor), rgb(p.tokens.sidebar));
        const button = page.getByRole('button', { name: `Use ${p.name} palette` });
        await button.focus();
        assert.equal(await button.evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
        assert.equal(await button.getAttribute('aria-pressed'), 'true');
        await readable(page.locator('.settings-drawer-links button.selected'), p.name + ' active navigation');
        await readable(page.locator('.topbar .badge.success'), p.name + ' success');
        await button.hover(); await readable(button, p.name + ' palette hover');
        if (capturePalette(p.id)) await screenshot(p.id);
      });
    }
    report(`${browserPalettes.length} saved palettes, live shell surfaces, selected and focused palette cards`);
    await chooseTheme('sandstone');
    fault = true; gate = new Promise(r => { release = r; });
    const failedSave = page.getByRole('button', { name: `Use ${palettes.find(p => p.id === 'midnight').name} palette` }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'midnight');
    release(); gate = undefined; await failedSave;
    await page.getByRole('alert').filter({ hasText: 'Deliberate save failure' }).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'sandstone');
    fault = false; await chooseTheme('midnight');
    report('failed palette save leaves confirmed palette intact');
    await page.getByRole('button', { name: 'Providers', exact: true }).click();
    const openai = page.getByRole('region', { name: 'OpenAI settings' });
    const copilot = page.getByRole('region', { name: 'GitHub Copilot settings' });
    const free = page.getByRole('region', { name: 'OpenCode Free settings' });
    assert.equal(await free.getByLabel('OpenCode Free hex color').inputValue(), providerDefaults.opencode);
    const billing = openai.getByLabel('Monthly cost (USD)'); await billing.fill('42');
    await openai.getByRole('button', { name: 'OpenAI: Rose', exact: true }).click();
    const initialColor = await openai.getByRole('heading', { name: 'OpenAI', exact: true }).locator('.provider-identity').evaluate(e => getComputedStyle(e).color);
    // Choosing a swatch is only a preview until Save color succeeds.
    assert.equal(initialColor, rgb(providerTokens('openai', { theme: 'midnight' })['--provider-fg']));
    let before = saves;
    gate = new Promise(r => { release = r; });
    await openai.getByRole('button', { name: 'Save color', exact: true }).click();
    assert.equal(await openai.getByRole('button', { name: 'Save color', exact: true }).isDisabled(), true);
    release(); gate = undefined;
    await openai.getByText('Provider color saved.', { exact: true }).waitFor();
    assert.equal(saves - before, 1);
    assert.equal(await billing.inputValue(), '42', 'color save must not erase unsaved billing edits');
    const rose = rgb(providerTokens('openai', { theme: 'midnight', providerColors: { openai: '#c34f85' } })['--provider-fg']);
    await colorOf(openai.getByRole('heading', { name: 'OpenAI', exact: true }).locator('.provider-identity'), rose);
    assert.equal(await free.getByLabel('OpenCode Free hex color').inputValue(), providerDefaults.opencode);
    await readable(openai.getByRole('heading', { name: 'OpenAI', exact: true }).locator('.provider-identity'), 'provider heading');
    await readable(openai.locator('.provider-color-preview strong'), 'provider preview text');
    await readable(openai.locator('.provider-preview-icon'), 'provider solid marker');
    await readable(openai.getByRole('button', { name: 'Reconnect', exact: true }), 'secondary action');
    const primary = page.getByRole('button', { name: 'Save billing preferences' });
    await primary.scrollIntoViewIfNeeded(); await primary.hover(); await readable(primary, 'primary action hover');
    await openai.scrollIntoViewIfNeeded();
    await screenshot('providers-midnight');
    report('provider preview, single confirmed save, OpenCode Free green, no billing or cross-provider changes');
    await openai.getByLabel('OpenAI hex color').fill('#ffff00'); fault = true;
    await openai.getByRole('button', { name: 'Save color', exact: true }).click();
    await openai.getByRole('alert').waitFor();
    await readable(openai.getByRole('alert'), 'custom inline error');
    await colorOf(openai.getByRole('heading', { name: 'OpenAI', exact: true }).locator('.provider-identity'), rose);
    fault = false;
    await openai.getByLabel('OpenAI hex color').fill('invalid');
    assert.equal(await openai.getByRole('button', { name: 'Save color', exact: true }).isDisabled(), true);
    await openai.getByLabel('OpenAI hex color').fill('#c34f85');
    const appSettings = page.getByRole('button', { name: 'Application settings', exact: true });
    if (await appSettings.getAttribute('aria-expanded') !== 'true') await appSettings.click();
    await page.getByRole('button', { name: 'Models', exact: true }).click();
    await colorOf(page.locator('.provider-model-card[data-provider="openai"] h3 .provider-identity'), rose);
    assert.equal(await page.locator('.provider-model-card').count(), 4);
    report('invalid and failed custom colors never apply; model cards use confirmed provider shades');
    const chats = page.locator('.chat-navigation');
    await chats.getByRole('button', { name: 'Chats', exact: true }).click();
    await chats.locator('.nav-chat-select').filter({ hasText: 'Color test chat' }).click();
    await colorOf(page.locator('.message.assistant .message-label .provider-identity'), rose);
    const neutral = await page.locator('.message.assistant .markdown p').first().evaluate(e => getComputedStyle(e).color);
    assert.equal(neutral, rgb(palettes.find(p => p.id === 'midnight').tokens.text));
    await page.getByRole('button', { name: /^Agents / }).click();
