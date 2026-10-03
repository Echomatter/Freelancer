import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { codexHistoryFixture } from './fixtures/codex-history.mjs';
import { test, expect } from './support/browser-test.mjs';

test('chatgpt-import', { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  await own(codexHistoryFixture(f));
  let indexedAfterImport = false;
  f.app.rebuildContentIndex = async ({ projectID }) => {
    indexedAfterImport = f.app.chatgpt.list(projectID).length === 1;
    assert.equal(indexedAfterImport, true, 'import precedes content indexing');
    return { projects: 1, sources: 1, failures: [] };
  };

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
    const importing = page.getByRole('dialog', { name: 'Import conversations', exact: true });
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
    await page.getByRole('button', { name: 'Message options', exact: true }).click();
    await expect(page.getByRole('button', { name: /Attach files/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Close message options' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Message options', exact: true })).toBeFocused();
    await shot('imported-conversation');
    await page.getByRole('button', { name: 'Continue in Freelancer', exact: true }).click();
    await page.getByText('Continued from a ChatGPT / Codex snapshot.', { exact: false }).waitFor();
    const composer = page.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill('Carry on with the widget');
    await page.getByRole('button', { name: 'Message options', exact: true }).click();
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
});

test('skipped project imports an explicitly chosen former source folder and shows its completed receipt', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  const source = await codexHistoryFixture(f);
  const recordedDirectory = path.join(f.root, 'former-workspace', path.basename(f.directory));
  await assert.rejects(access(recordedDirectory), /ENOENT/, 'the recorded source folder no longer exists');
  const catalog = new DatabaseSync(source.database);
  try { catalog.prepare('UPDATE threads SET cwd=? WHERE id=?').run(recordedDirectory, 'codex-exact'); }
  finally { catalog.close(); }
  await writeFile(source.source, source.records.map(row => JSON.stringify(row.type === 'session_meta'
    ? { ...row, payload: { ...row.payload, cwd: recordedDirectory } } : row)).join('\n') + '\n');
  const sourceBefore = await readFile(source.source), catalogBefore = await readFile(source.database);
  const preview = await f.api('projects/import-preview', { directory: f.directory });
  const skipped = await f.api('projects/setup', { token: preview.token, selected: [] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(f.url);
  const projects = page.locator('.project-navigation .nav-accordion-trigger');
  await expect(projects).toHaveAttribute('aria-label', skipped.project.name);
  const manage = async () => {
    if (await projects.getAttribute('aria-expanded') !== 'true') await projects.click();
    await expect(projects).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: `Manage ${skipped.project.name}`, exact: true }).click();
    await page.getByRole('dialog', { name: 'Manage project', exact: true })
      .getByRole('button', { name: 'Import ChatGPT / Codex history', exact: true }).click();
  };
  await manage();
  const importing = page.getByRole('dialog', { name: 'Import conversations', exact: true });
  await expect(importing).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Open project', exact: true })).toHaveCount(0);
  await expect(importing).toContainText('Import was skipped earlier');
  await expect(importing.getByRole('combobox', { name: 'Other recorded folders for this project', exact: true }))
    .toContainText(recordedDirectory);
  await importing.getByRole('button', { name: 'Choose source folder…', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose recorded conversation folder', exact: true })).toBeVisible();
  await expect(importing).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Choose recorded conversation folder', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true }).click();
  await importing.getByRole('textbox', { name: 'Recorded conversation folder', exact: true }).fill(recordedDirectory);
  await expect(importing.getByRole('button', { name: 'Import selected and open project', exact: true })).toBeDisabled();
  await importing.getByRole('button', { name: 'Preview conversations', exact: true }).click();
  await importing.getByRole('checkbox', { name: /Turquoise widget/ }).check();
  const importButton = importing.getByRole('button', { name: 'Import 1 and open project', exact: true });
  await expect(importButton).toBeDisabled();
  await importing.getByRole('checkbox', { name: /Copy the selected snapshots from/ }).check();
  await expect(importButton).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 800 });
  const bounds = await importing.boundingBox();
  assert.ok(bounds.width <= 390 && bounds.height <= 800);
  assert.equal(await importing.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'long source paths fit the dialog');
  if (process.env.FREELANCER_QA_SHOTS) {
    await mkdir(process.env.FREELANCER_QA_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'import-former-source-narrow.png') });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await importButton.click();
  await expect(importing).toHaveCount(0);
  await expect(page.locator('.chat-loading-stage')).toHaveCount(0);
  const imported = f.app.chatgpt.list(skipped.project.id);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].source.recordedDirectory, recordedDirectory);
  assert.deepEqual(await readFile(source.source), sourceBefore);
  assert.deepEqual(await readFile(source.database), catalogBefore);
  await manage();
  await expect(importing).toContainText('History import already completed');
  await expect(importing).toContainText('1 conversation snapshot was saved');
  await expect(importing.getByRole('checkbox')).toHaveCount(0);
  await expect(importing.getByRole('button', { name: /Import .* and open project/ })).toHaveCount(0);
  await importing.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(importing).toHaveCount(0);
  assert.equal(f.app.chatgpt.list(skipped.project.id).length, 1, 'opening a completed import cannot duplicate it');
});

test('cancelled import previews cannot reopen or replace a newer source selection', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  await codexHistoryFixture(f);
  const stale = await f.api('projects/import-preview', { directory: f.directory });
  stale.chats[0].title = 'Stale preview must not appear';
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let held;
  const gates = [], cancelled = [];
  const holdNext = () => {
    let enter, release, finish;
    const state = { entered: new Promise(resolve => enter = resolve), gate: new Promise(resolve => release = resolve),
      finished: new Promise(resolve => finish = resolve), enter: () => enter(), release: () => release(), finish: () => finish() };
    gates.push(state); held = state; return state;
  };
  await own(Promise.resolve({ close: async () => { for (const state of gates) state.release(); await page.unrouteAll({ behavior: 'wait' }); } }));
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/api/projects/import-preview') cancelled.push(request.failure()?.errorText);
  });
  await page.route('**/api/projects/import-preview', async route => {
    const state = held;
    if (!state) return route.continue();
    held = null; state.enter(); await state.gate;
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stale) }); }
    finally { state.finish(); }
  });
  await page.goto(f.url);
  const chooseProject = async () => {
    const projects = page.locator('.project-navigation .nav-accordion-trigger');
    if (await projects.getAttribute('aria-expanded') !== 'true') await projects.click();
    await expect(projects).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Open project', exact: true });
    await dialog.getByRole('textbox', { name: 'Project folder', exact: true }).fill(f.directory);
    return dialog;
  };
  let project = await chooseProject(), state = holdNext();
  await project.getByRole('button', { name: 'Next', exact: true }).click();
  await state.entered;
  await project.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(project).toHaveCount(0);
  project = await chooseProject();
  await project.getByRole('button', { name: 'Next', exact: true }).click();
  const importing = page.getByRole('dialog', { name: 'Import conversations', exact: true });
  await expect(importing.getByRole('checkbox', { name: /Turquoise widget/ })).toBeVisible();
  state.release(); await state.finished;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(importing).not.toContainText('Stale preview must not appear');
  await expect(importing.getByRole('checkbox', { name: /Turquoise widget/ })).toBeVisible();
  state = holdNext();
  await importing.getByRole('button', { name: 'Preview conversations', exact: true }).click();
  await state.entered;
  await importing.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(importing).toHaveCount(0);
  state.release(); await state.finished;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(importing).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Open project', exact: true })).toHaveCount(0);
  await expect.poll(() => cancelled.length, { message: 'both pending preview reads were actually cancelled' }).toBeGreaterThanOrEqual(2);
  assert.equal(f.app.chatgpt.list(f.project.id).length, 0, 'preview cancellation never imports history');
});
