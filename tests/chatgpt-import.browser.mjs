import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { codexHistoryFixture } from './fixtures/codex-history.mjs';

const f = await localDataFixture();
await codexHistoryFixture(f);
let indexedAfterImport = false;
f.app.rebuildContentIndex = async ({ projectID }) => {
  indexedAfterImport = f.app.chatgpt.list(projectID).length === 1;
  assert.equal(indexedAfterImport, true, 'import precedes content indexing');
  return { projects: 1, sources: 1, failures: [] };
};
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let releaseInitialListing;
const initialListing = new Promise(resolve => { releaseInitialListing = resolve; });
let heldInitialListing = false;
const shots = process.env.FREELANCER_QA_SHOTS;
async function shot(name) { if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png') }); } }
try {
  await page.route('**/api/projects/folders?**', async route => {
    if (!heldInitialListing && new URL(route.request().url()).searchParams.get('directory') === '') {
      heldInitialListing = true;
      await initialListing;
    }
    await route.continue();
  });
  await page.goto(f.url);
  await page.locator('.project-navigation .nav-accordion-trigger').click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const project = page.getByRole('dialog', { name: 'Open project', exact: true });
  await project.getByRole('button', { name: 'Browse folders…' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose project folder', exact: true });
  await picker.getByRole('textbox', { name: 'Folder path' }).fill(f.root);
  releaseInitialListing();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
    button.textContent === 'Go to folder' && !button.disabled));
  assert.equal(await picker.getByRole('textbox', { name: 'Folder path' }).inputValue(), f.root,
    'the initial listing must preserve a path typed while it was loading');
  assert.equal(await picker.getByRole('button', { name: 'Use this folder', exact: true }).isDisabled(), true,
    'an unvisited typed path cannot accidentally select the previous listing');
  await picker.getByRole('button', { name: 'Go to folder', exact: true }).click();
  await picker.getByRole('status').getByText(f.root, { exact: true }).waitFor();
  await picker.getByRole('button', { name: 'project', exact: true }).click();
  await picker.getByRole('status').getByText(f.directory, { exact: true }).waitFor();
  await shot('folder-picker');
  await picker.getByRole('button', { name: 'Use this folder', exact: true }).click();
  assert.equal(await project.getByRole('textbox', { name: 'Project folder' }).inputValue(), f.directory);
  await project.getByRole('button', { name: 'Next', exact: true }).click();
  const importing = page.getByRole('dialog', { name: 'Bring your chats along?', exact: true });
  await importing.waitFor();
  assert.equal(indexedAfterImport, false);
  assert.equal(await importing.getByText('Other repository', { exact: true }).count(), 0);
  await importing.getByRole('checkbox', { name: /Turquoise widget/ }).check();
  await shot('import-preview');
  await page.setViewportSize({ width: 390, height: 800 });
  const bounds = await importing.boundingBox(); assert.ok(bounds.width <= 390 && bounds.height <= 800);
  await shot('import-preview-narrow');
  await page.setViewportSize({ width: 1280, height: 900 });
  await importing.getByRole('button', { name: 'Import 1 and open project', exact: true }).click();
  await importing.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: 'Turquoise widget' }).click();
  await page.getByText('Fix the turquoise widget', { exact: true }).waitFor();
  await page.getByText('The turquoise widget needs a color fix.', { exact: true }).waitFor();
  assert.equal(indexedAfterImport, true);
  assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).getAttribute('readonly'), '');
  await shot('imported-conversation');
  await page.getByRole('button', { name: 'Continue in Freelancer', exact: true }).click();
  await page.getByText('Continued from a ChatGPT / Codex snapshot.', { exact: false }).waitFor();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Carry on with the widget');
  await page.getByRole('combobox', { name: 'Parent model', exact: true }).selectOption('opencode/free');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.locator('.imported-chat-notice').getByText('Orienting…', { exact: true }).waitFor();
  await page.locator('.chat-transcript').getByText('Carry on with the widget', { exact: true }).waitFor();
  assert.equal(await page.getByText('Fix the turquoise widget', { exact: true }).count(), 1);
  await shot('orienting-conversation');
  assert.deepEqual(errors, []);
  console.log('PASS folder picker, optional exact-repo import before indexing, shared transcript view, read-only snapshot and native orientation');
} catch (error) { console.error('Page errors:', errors); console.error(await page.locator('body').innerText()); await shot('failure'); throw error; }
finally { releaseInitialListing(); await browser.close(); await f.close(); }
