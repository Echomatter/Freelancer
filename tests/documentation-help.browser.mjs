import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
function documented(topic) {
  const section = readme.split(`<!-- help:${topic} -->`)[1]?.split('<!-- /help -->')[0].trim();
  if (!section) throw Error(`Missing documentation for ${topic}`);
  return section.split(/\r?\n\s*\r?\n/).slice(1).map(p => p.replace(/\s+/g, ' '));
}

test('documentation help stays contextual, accessible and sourced from the README', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  await mkdir(path.join(f.root, 'tools'));
  const indexer = await readFile('backend/tools/project-content-indexer.mjs', 'utf8');
  await writeFile(path.join(f.root, 'tools', 'project-content-indexer.mjs'), indexer.replace('../../server/data/schema.sql', '../server/data/schema.sql'));
  await mkdir(path.join(f.root, 'server', 'data'), { recursive: true });
  await copyFile('server/data/schema.sql', path.join(f.root, 'server', 'data', 'schema.sql'));
  await f.store.update('settings', s => ({ ...s, appearance: { ...s.appearance, theme: 'light' } }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(f.url);
  async function setting(name, scope = 'Application settings') {
    const menu = page.getByRole('button', { name: scope, exact: true });
    if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
    await page.locator('.settings-drawer-links').getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
  }
  async function content(topic) {
    const tip = page.locator('.help-hint-popover');
    await expect(tip).toBeVisible();
    await expect(tip.locator('p')).toHaveText(documented(topic));
    await expect(tip).toContainText('README');
    return tip;
  }
  const insideViewport = async tip => {
    const box = await tip.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  };
  await mkdir('artifacts/documentation-help', { recursive: true });

  await test.step('hover help without moving the page title or menu cards', async () => {
    await setting('Scheduled prompts');
    await expect(page.getByText('A prompt, at the right time', { exact: true })).toHaveCount(0);
    const heading = page.getByRole('heading', { name: 'Scheduled prompts', exact: true });
    const before = await heading.boundingBox();
    const cards = page.locator('.nav-card-trigger');
    await expect(cards).toHaveCount(4);
    await expect(cards.locator('.help-hint')).toHaveCount(0);
    const hint = page.getByRole('button', { name: 'Help: Scheduled prompts', exact: true });
    await expect(page.locator('h1 .help-hint, h2 .help-hint, h3 .help-hint, .page-title .help-hint')).toHaveCount(0);
    await hint.hover();
    const tip = await content('schedules');
    const after = await heading.boundingBox();
    for (const axis of ['x', 'y', 'width', 'height']) expect(after[axis]).toBeCloseTo(before[axis], 0);
    await insideViewport(tip);
    await tip.hover();
    await expect(tip).toBeVisible();
    await page.screenshot({ path: 'artifacts/documentation-help/schedules-desktop.png', fullPage: true });
    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden();
    await hint.focus();
    await content('schedules');
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await expect(hint).toBeFocused();
    await hint.click();
    await content('schedules');
    await hint.click();
    await expect(tip).toBeHidden();
  });

  await test.step('field help preserves form labels, edits and submit behavior on a narrow screen', async () => {
    await page.getByRole('button', { name: 'New schedule', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Keep this unsaved schedule');
    await page.getByLabel('Repeat', { exact: true }).selectOption('daily');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.schedule-editor .help-hint-trigger')).toHaveCount(1);
    const timing = page.locator('.schedule-editor .card-help').getByRole('button', { name: /^Help:/ });
    await timing.tap();
    await page.getByRole('combobox', { name: 'Help topic' }).selectOption('schedule-timing');
    const tip = await content('schedule-timing');
    await insideViewport(tip);
    await page.screenshot({ path: 'artifacts/documentation-help/schedule-mobile.png', fullPage: true });
    await page.getByLabel('Name', { exact: true }).tap();
    await expect(tip).toBeHidden();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Keep this unsaved schedule');
    await expect(page.getByLabel('Repeat', { exact: true })).toHaveValue('daily');
    expect((await f.api('schedules')).schedules).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  await test.step('data screens retain navigation and maintenance confirmations', async () => {
    await setting('Content & Storage');
    await page.getByRole('button', { name: 'Help: Local backups', exact: true }).focus();
    await content('local-backup');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'artifacts/documentation-help/content-storage-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Help: Index coverage', exact: true }).hover();
    await content('index-coverage');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Start clean', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm clean search indexes' });
    await expect(dialog).toContainText('Project files, OpenCode conversations, settings, and drafts are not changed.');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.screenshot({ path: 'artifacts/documentation-help/content-storage-maintenance.png', fullPage: true });
    await page.locator('.page-title-actions').getByRole('button', { name: 'Search all content', exact: true }).click();
    await page.getByRole('button', { name: 'Help: Search indexed content', exact: true }).focus();
    await content('file-search');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('searchbox', { name: 'Search all content', exact: true })).toBeVisible();
  });

  await test.step('help works in a modal and Escape closes only the hint', async () => {
    await setting('Models');
    await page.getByRole('button', { name: 'Update Model Ratings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Update Model Ratings', exact: true });
    const hint = dialog.getByRole('button', { name: 'Help: Model rating updates', exact: true });
    await hint.focus();
    const tip = await content('model-ratings');
    await insideViewport(tip);
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  await test.step('project and provider controls keep their labels', async () => {
    await setting('Session defaults', 'Project settings');
    await page.getByRole('button', { name: 'Help: Session defaults', exact: true }).focus();
    await content('session-defaults');
    await page.keyboard.press('Escape');
    await setting('Delegation', 'Project settings');
    await page.getByLabel('Apply to', { exact: true }).selectOption('project');
    await page.getByRole('button', { name: 'Help: Delegation scope', exact: true }).focus();
    await page.getByRole('combobox', { name: 'Help topic' }).selectOption('worker-models');
    await content('worker-models');
    await page.keyboard.press('Escape');
    await setting('Providers');
    await page.getByRole('button', { name: 'Help: OpenAI color — Provider colors', exact: true }).focus();
    await content('provider-color');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Save provider settings', exact: true })).toBeVisible();
  });
});
