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
    await f.api('history?project=history_project&scope=all');
    f.state.messages.ses_worker = [{
      info: { id: 'msg_unified_search', role: 'user', time: { created: 300 } },
      parts: [{ type: 'text', text: 'shared cross project needle appears in this conversation' }],
    }];
    await f.app.history.indexCurrent(f.project.id, 'ses_worker', f.state.messages.ses_worker);
    const indexed = await f.api('index/search?' + new URLSearchParams({ q: 'shared cross project needle' }));
    assert.deepEqual(new Set(indexed.results.map((row) => row.project)), new Set([f.project.id, second.id]));
    assert.ok(indexed.results.every((row) => row.path === 'search-source.txt'));
    const scoped = await f.api('index/search?' + new URLSearchParams({ q: 'shared cross project needle', project: second.id }));
    assert.deepEqual(scoped.results.map((row) => row.project), [second.id]);
    const chats = await f.api('history/search?' + new URLSearchParams({ q: 'shared cross project needle' }));
    assert.deepEqual(chats.results.map((row) => [row.project, row.session]), [[f.project.id, 'ses_history']]);
    const scopedChats = await f.api('history/search?' + new URLSearchParams({ q: 'shared cross project needle', project: second.id }));
    assert.deepEqual(scopedChats.results, []);

    const page = await browser.newPage();
    page.setDefaultTimeout(12000);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(f.url);
    const applicationSettings = page.getByRole('button', { name: 'Application settings', exact: true });
    const openApplicationSettings = async () => {
      if (await applicationSettings.getAttribute('aria-expanded') !== 'true') await applicationSettings.click();
    };
    await openApplicationSettings();
    await page.getByRole('button', { name: 'Search all content', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search all content' }).fill('shared cross project needle');
    await page.getByRole('button', { name: 'Open file Second project/search-source.txt', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Open conversation Important conversation in History project', exact: true }).waitFor();
    assert.equal(await page.locator('.indexed-search-result').count(), 3);
    if (process.env.FREELANCER_QA_SHOTS) {
      await mkdir(process.env.FREELANCER_QA_SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'search-results.png'), fullPage: true });
    }
    await expect(page.locator('#application-settings-links').getByRole('button', { name: 'Conversation history', exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.locator('#application-settings-links').getByRole('button', { name: 'Git defaults', exact: true, includeHidden: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pin Important conversation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unpin Important conversation', exact: true })).toBeEnabled();
    assert.ok((await f.api('history?project=' + f.project.id)).sessions.find(row => row.id === 'ses_history').organization.pinnedAt);
    await page.getByRole('button', { name: 'Manage chats', exact: true }).click();
    await expect(page.locator('.history-page').getByRole('button', { name: 'Unpin Important conversation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unpin Important conversation', exact: true })).toBeVisible();
    await page.route('**/api/history/pin', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Pin unavailable' }) }));
    await page.getByRole('button', { name: 'Unpin Important conversation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Pin unavailable');
    await expect(page.getByRole('button', { name: 'Unpin Important conversation', exact: true })).toBeEnabled();
    await page.unroute('**/api/history/pin');
    await page.getByRole('button', { name: 'Unpin Important conversation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pin Important conversation', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Open conversation Important conversation in History project', exact: true }).click();
    await expect(page.locator('.composer textarea')).toBeVisible();

    await openApplicationSettings();
    await page.getByRole('button', { name: 'Search all content', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search all content' }).fill('shared cross project needle');
    await page.getByRole('button', { name: 'Open file Second project/search-source.txt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
    await expect(page.locator('.file-preview')).toContainText('shared cross project needle appears in the second project file');

    await page.locator('.page-title-actions').getByRole('button', { name: 'Search project content', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Search project content', exact: true })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search project content' }).fill('shared cross project needle');
    await expect(page.getByRole('button', { name: 'Open file Second project/search-source.txt', exact: true })).toBeVisible();
    assert.equal(await page.locator('.indexed-search-result').count(), 1, 'project search scopes files and conversations');

    await openApplicationSettings();
    let failConversationSearch = true;
    await page.route('**/api/history/search?**', route => failConversationSearch
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Conversation search unavailable' }) })
      : route.continue());
    await page.getByRole('button', { name: 'Search all content', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search all content' }).fill('shared cross project needle');
    await expect(page.getByRole('alert')).toContainText('Conversations: Conversation search unavailable');
    await expect(page.getByRole('button', { name: 'Open file Second project/search-source.txt', exact: true })).toBeVisible();
    failConversationSearch = false;
    await page.getByRole('button', { name: 'Retry search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open conversation Important conversation in History project', exact: true })).toBeVisible();
    await page.unroute('**/api/history/search?**');

    await page.getByRole('button', { name: 'Search all content', exact: true }).click();
    let failFileSearch = true;
    await page.route('**/api/index/search?**', route => failFileSearch
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'File search unavailable' }) })
      : route.continue());
    await page.getByRole('searchbox', { name: 'Search all content' }).fill('');
    await page.getByRole('searchbox', { name: 'Search all content' }).fill('shared cross project needle');
    await expect(page.getByRole('alert')).toContainText('Files: File search unavailable');
    await expect(page.getByRole('button', { name: 'Open conversation Important conversation in History project', exact: true })).toBeVisible();
    failFileSearch = false;
    await page.getByRole('button', { name: 'Retry search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open file Second project/search-source.txt', exact: true })).toBeVisible();
    await page.unroute('**/api/index/search?**');

    let failIndexStats = true;
    await page.route('**/api/index/stats', route => failIndexStats
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Index stats unavailable' }) })
      : route.continue());
    await page.locator('.settings-drawer-links').getByRole('button', { name: 'Content & Storage', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Content & Storage', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Index data: Index stats unavailable');
    await expect(page.getByRole('heading', { name: 'Local data', exact: true })).toBeVisible();
    await expect(page.getByText('Freelancer organization & drafts', { exact: true })).toBeVisible();
    await expect(page.getByText('Index coverage unavailable · retry above', { exact: true }).first()).toBeVisible();
    failIndexStats = false;
    await page.getByRole('button', { name: 'Retry index data', exact: true }).click();
    await expect(page.getByLabel('Content index overview')).toBeVisible();

    await page.locator('.page-title-actions').getByRole('button', { name: 'Search all content', exact: true }).click();
    await page.unroute('**/api/index/stats');
    let failStorage = true;
    await page.route('**/api/storage', route => failStorage
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Storage unavailable' }) })
      : route.continue());
    await page.locator('.settings-drawer-links').getByRole('button', { name: 'Content & Storage', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Storage data: Storage unavailable');
    await expect(page.getByLabel('Content index overview')).toBeVisible();
    await expect(page.getByText('Archive controls unavailable', { exact: true }).first()).toBeVisible();
    failStorage = false;
    await page.getByRole('button', { name: 'Retry storage data', exact: true }).click();
    await expect(page.getByText('Freelancer organization & drafts', { exact: true })).toBeVisible();
    if (process.env.FREELANCER_QA_SHOTS) await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'content-storage.png'), fullPage: true });
    await page.locator('.page-title-actions').getByRole('button', { name: 'Search all content', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Search all content', exact: true })).toBeVisible();
    await page.close();
  } finally {
    await f.close();
  }
});
