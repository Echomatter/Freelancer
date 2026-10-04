import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('project folder opens directly before indexing', { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  await f.store.update('settings', settings => ({ ...settings, projects: [], lastProjectID: undefined }));
  let indexedProject;
  f.app.rebuildContentIndex = async ({ projectID }) => {
    indexedProject = projectID;
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
    await page.setViewportSize({ width: 390, height: 800 });
    const bounds = await project.boundingBox(); assert.ok(bounds.width <= 390 && bounds.height <= 800);
    await shot('open-project-narrow');
    await page.setViewportSize({ width: 1280, height: 900 });
    await project.getByRole('button', { name: 'Open project', exact: true }).click();
    await expect(project).toHaveCount(0);
    await expect(page.locator('.chat-loading-stage')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Import conversations', exact: true })).toHaveCount(0);
    const saved = (await f.store.read('settings')).projects.find(row => row.directory === f.directory);
    assert.ok(saved);
    assert.equal(indexedProject, saved.id, 'the selected project goes directly to indexing');
    const projects = page.locator('.project-navigation .nav-accordion-trigger');
    if (await projects.getAttribute('aria-expanded') !== 'true') await projects.click();
    await page.getByRole('button', { name: `Manage ${saved.name}`, exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Manage project', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import ChatGPT / Codex history', exact: true })).toHaveCount(0);
    await shot('manage-project');
    assert.deepEqual(errors, []);
    console.log('PASS folder picker, direct project opening, narrow layout and retired import controls');
  } catch (error) { console.error('Page errors:', errors); console.error(await page.locator('body').innerText()); await shot('failure'); throw error; }
  finally { releaseInitialListing(); await browser.close(); await f.close(); }
});

