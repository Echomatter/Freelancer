import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { test, expect } from './support/browser-test.mjs';
import { colorFixture } from './fixtures/color-app.mjs';
import { palettes, customThemePalette } from '../domain/theme.mjs';
import { colorChannels } from '../domain/color.mjs';

test('all thumbnails match the layout; custom rolls preview, save, reload and remove', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(colorFixture());
  const page = await browser.newPage({ viewport: { width: 1380, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const rgb = color => `rgb(${colorChannels(color).join(', ')})`;
  async function appearance() {
    const menu = page.getByRole('button', { name: 'Application settings', exact: true });
    if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Theme', exact: true })).toBeVisible();
  }
  await page.goto(f.url); await appearance();
  await expect(page.locator('.palette-option')).toHaveCount(palettes.length);
  const audit = await page.locator('.palette-option').evaluateAll(elements => elements.map(element => {
    const color = (selector, property = 'backgroundColor') => getComputedStyle(element.querySelector(selector))[property];
    return { label: element.getAttribute('aria-label'), colors: {
      bg: color('.palette-mini-main'), sidebar: color('.palette-mini-nav'), paper: color('.palette-mini-card'),
      accent: color('.palette-mini-card b'), text: color('.palette-mini-main i'), muted: color('.palette-mini-main i:nth-child(2)'),
      tint: color('.palette-mini-nav b'), line: color('.palette-mini', 'borderTopColor'),
    }, opacity: getComputedStyle(element.querySelector('.palette-mini-main i')).opacity };
  }));
  for (const p of palettes) {
    const actual = audit.find(row => row.label === `Use ${p.name} palette`);
    assert.ok(actual, p.name);
    for (const [key, color] of Object.entries(actual.colors)) assert.equal(color, rgb(p.tokens[key]), `${p.name}: ${key}`);
    assert.equal(actual.opacity, '1');
  }
  let fail = false, saves = 0;
  await page.route('**/api/appearance', async route => {
    saves++;
    if (fail) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Theme save failed for this test.' }) });
    await route.continue();
  });
  await page.getByRole('button', { name: 'Create a theme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
  const colors = () => page.locator('.custom-theme-preview').evaluate(element => ['--bg', '--sidebar', '--accent'].map(key => getComputedStyle(element).getPropertyValue(key)));
  const first = await colors();
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  assert.notDeepEqual(await colors(), first);
  assert.equal(saves, 0, 'rolling never persists or switches the saved theme');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.getByLabel('Generated theme style').selectOption('dark');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(page.getByText('Dark palette · Readability checked · Unsaved')).toBeVisible();
  await page.getByLabel('Theme name (optional)').fill('Midnight Confetti');
  fail = true;
  await page.getByRole('button', { name: 'Save & use', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Theme save failed' })).toBeVisible();
  assert.equal(await page.getByLabel('Theme name (optional)').inputValue(), 'Midnight Confetti');
  assert.equal((await f.store.read('settings')).appearance.customThemes, undefined);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  fail = false;
  await page.getByRole('button', { name: 'Save & use', exact: true }).click();
  const savedButton = page.getByRole('button', { name: 'Use Midnight Confetti palette', exact: true });
  await expect(savedButton).toHaveAttribute('aria-pressed', 'true');
  const appearanceState = (await f.store.read('settings')).appearance;
  const custom = appearanceState.customThemes[0], palette = customThemePalette(custom);
  assert.equal(custom.mode, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', custom.id);
  assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--bg').trim()), palette.tokens.bg);
  // Hold bootstrap through React startup to catch a flash back to Light.
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/bootstrap*', async route => { await gate; await route.continue(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Connecting', { exact: false }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', custom.id);
  assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--bg').trim()), palette.tokens.bg);
  release(); await page.unroute('**/api/bootstrap*');
  await appearance();
  await page.getByRole('button', { name: /^Light themes/ }).click();
  await page.getByRole('button', { name: /^Dark themes/ }).click();
  await expect(savedButton).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Generate theme', exact: true }).click();
  const dismiss = page.locator('.index-job-progress').getByRole('button', { name: /Dismiss/ });
  if (await dismiss.isVisible()) await dismiss.click();
  const usage = page.getByRole('button', { name: /Show provider availability/ });
  if (await usage.getAttribute('aria-expanded') === 'true') await usage.click();
  await mkdir('artifacts/custom-themes', { recursive: true });
  await page.locator('.custom-theme-draft').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/custom-themes/desktop.png' });
  await page.locator('.palette-picker').screenshot({ path: 'artifacts/custom-themes/generator.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toBeVisible();
  assert.ok(await page.locator('.custom-theme-draft').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await page.locator('.custom-theme-draft').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/custom-themes/narrow.png' });
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Midnight Confetti theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  assert.equal((await f.store.read('settings')).appearance.customThemes.length, 0);
  await page.getByRole('button', { name: 'Generate theme', exact: true }).click();
  await page.getByRole('button', { name: 'Save & use', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use My theme 1 palette', exact: true })).toHaveAttribute('aria-pressed', 'true');
  assert.deepEqual(errors, []);
  console.log(`PASS ${audit.length} complete thumbnail mappings and custom-theme lifecycle`);
});
