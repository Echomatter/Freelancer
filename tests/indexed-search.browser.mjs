import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('indexed-search', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  try {
    await mkdir(path.join(f.root, 'tools'));
    const indexer = await readFile('backend/tools/project-content-indexer.mjs', 'utf8');
    await writeFile(path.join(f.root, 'tools', 'project-content-indexer.mjs'), indexer.replace('../../server/data/schema.sql', '../server/data/schema.sql'));
    await mkdir(path.join(f.root, 'server', 'data'), { recursive: true });
    await copyFile('server/data/schema.sql', path.join(f.root, 'server', 'data', 'schema.sql'));
    const secondDirectory = path.join(f.root, 'second-project');
    await mkdir(secondDirectory);
    await writeFile(path.join(f.directory, 'search-source.txt'), 'shared cross project needle appears in the first project file');
    await writeFile(path.join(secondDirectory, 'search-source.txt'), 'shared cross project needle appears in the second project file');
    const second = { id: 'second_project', name: 'Second project', directory: secondDirectory };
    await f.store.update('settings', (settings) => ({ ...settings, projects: [...settings.projects, second] }));
    const nativeRequest = f.host.request.bind(f.host);
    f.host.request = (route, options = {}) => {
      if (route.startsWith('/file/content?')) {
        const relative = new URL(`http://fixture${route}`).searchParams.get('path');
        return readFile(path.join(options.directory, relative), 'utf8').then((content) => ({ content, type: 'text' }));
      }
      return nativeRequest(route, options);
    };
    await f.api('index/stats');
    const rebuilt = await f.app.rebuildContentIndex();
    assert.equal(rebuilt.failures.length, 0, JSON.stringify(rebuilt.failures));
    const indexed = await f.api('index/search?' + new URLSearchParams({ q: 'shared cross project needle' }));
    assert.deepEqual(new Set(indexed.results.map((row) => row.project)), new Set([f.project.id, second.id]));
    assert.ok(indexed.results.every((row) => row.path === 'search-source.txt'));
    const scoped = await f.api('index/search?' + new URLSearchParams({ q: 'shared cross project needle', project: second.id }));
    assert.deepEqual(scoped.results.map((row) => row.project), [second.id]);

    const page = await browser.newPage();
    page.setDefaultTimeout(12000);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(f.url);
    await page.getByRole('button', { name: 'Application settings', exact: true }).click();
    await page.getByRole('button', { name: 'Search files', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search project files' }).fill('shared cross project needle');
    await page.getByRole('button', { name: 'Open Second project/search-source.txt', exact: true }).waitFor();
    assert.equal(await page.locator('.indexed-search-result').count(), 2);
    if (process.env.FREELANCER_QA_SHOTS) {
      await mkdir(process.env.FREELANCER_QA_SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'search-results.png'), fullPage: true });
    }
    await page.getByRole('button', { name: 'Open Second project/search-source.txt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
    await expect(page.locator('.file-preview')).toContainText('shared cross project needle appears in the second project file');

    await page.getByRole('button', { name: 'Search all project files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Search files', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Data & Storage', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Local data', exact: true })).toBeVisible();
    if (process.env.FREELANCER_QA_SHOTS) await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'data-storage.png'), fullPage: true });
    await page.getByRole('button', { name: 'Manage content index', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Content index', exact: true })).toBeVisible();
    if (process.env.FREELANCER_QA_SHOTS) await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'content-index.png'), fullPage: true });
    await page.getByRole('button', { name: 'Search project files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Search files', exact: true })).toBeVisible();
    await page.close();
  } finally {
    await f.close();
  }
});
