import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('fact model filters share the query contract and memory evidence reads only its typed revision', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture({ timers: false })), data = f.app.localData.get();
  const memory = data.createMemory({ id: 'memory:exact-fact-evidence', kind: 'note', title: 'Exact retained fact source', body: 'Original cited revision.', source: { projectID: f.project.id } });
  data.reviseMemory({ id: memory.id, expectedRevision: 1, body: 'Later revised source.' });
  const examples = [
    ['native', 'Native revision reference', { kind: 'memory-revision', memoryID: memory.id, revision: 1 }],
    ['authored', 'Authored revision reference', { ref: { kind: 'memory', memoryID: memory.id, memoryRevision: 2 } }],
    ['missing', 'Missing revision reference', { kind: 'memory-revision', memoryID: memory.id }],
    ['conflict', 'Conflicting revision reference', { kind: 'memory-revision', memoryID: memory.id, revision: 1, memoryRevision: 2 }],
    ['untyped', 'Untyped revision reference', { memoryID: memory.id, memoryRevision: 1 }],
    ['zero', 'Zero revision reference', { kind: 'memory-revision', memoryID: memory.id, revision: 0 }],
    ['negative', 'Negative revision reference', { kind: 'memory', memoryID: memory.id, memoryRevision: -1 }],
  ];
  for (const [id, label, ref] of examples) data.addClaim({ id: `claim:exact-${id}`, predicate: `Review fixture ${label}`, value: label,
    origin: 'user-stated', epistemicState: 'unverified', method: 'retained evidence fixture', scope: { projectID: f.project.id },
    modelProvider: 'fixture', modelID: 'model-a', evidence: [{ id: `evidence:${id}`, relation: 'supports', ...ref }] });
  data.addClaim({ id: 'claim:other-model', predicate: 'Review fixture Other model reference', value: 'Other model reference',
    origin: 'user-stated', epistemicState: 'unverified', method: 'other native model fixture', scope: { projectID: f.project.id },
    modelProvider: 'fixture', modelID: 'model-b', evidence: [{ id: 'evidence:other', kind: 'memory', memoryID: memory.id, memoryRevision: 2, relation: 'supports' }] });
  const canonical = await f.api('knowledge', { operation: 'query', domain: 'facts', query: 'Review fixture', model: 'fixture/model-a' });
  assert.deepEqual(canonical.results.map(row => row.id).sort(), examples.map(([id]) => `claim:exact-${id}`).sort());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), requests = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/knowledge') && request.method() === 'POST') requests.push(request.postDataJSON());
  });
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Search all content', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search all content', exact: true }).fill('Review fixture');
  await page.getByLabel('Model ID', { exact: true }).fill('fixture/model-a');
  const facts = page.getByLabel('Fact results'), claim = label => facts.locator('.knowledge-claim').filter({ hasText: `Review fixture ${label}` });
  await expect(facts.locator('.knowledge-claim')).toHaveCount(canonical.results.length);
  await expect(facts).not.toContainText('Other model reference');
  assert.ok(requests.some(row => row.operation === 'query' && row.domain === 'facts' && row.model === 'fixture/model-a'), 'the browser forwards its model through the shared facts query contract');
  await page.getByRole('tab', { name: 'Facts', exact: true }).click();
  await expect(page.getByLabel('Model ID', { exact: true })).toHaveValue('fixture/model-a');
  await claim('Native revision reference').locator('summary').click();
  await claim('Native revision reference').getByRole('button', { name: 'Read retained memory evidence', exact: true }).click();
  const reader = page.getByRole('dialog', { name: 'Exact retained fact source', exact: true });
  await expect(reader.locator('.knowledge-memory-body')).toHaveText('Original cited revision.');
  await expect(reader.getByLabel('Retained revision', { exact: true })).toHaveValue('1');
  await reader.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await claim('Authored revision reference').locator('summary').click();
  await claim('Authored revision reference').getByRole('button', { name: 'Read retained memory evidence', exact: true }).click();
  await expect(reader.locator('.knowledge-memory-body')).toHaveText('Later revised source.');
  await expect(reader.getByLabel('Retained revision', { exact: true })).toHaveValue('2');
  await reader.getByRole('button', { name: 'Close dialog', exact: true }).click();
  let unavailableReads = 0;
  page.on('request', request => { if (request.url().includes('/api/memory/item?')) unavailableReads++; });
  for (const [, label] of examples.slice(2)) {
    await claim(label).locator('summary').click();
    await expect(claim(label).getByRole('button', { name: 'Read retained memory evidence', exact: true })).toBeDisabled();
    await expect(claim(label)).toContainText('its exact retained revision was not recorded');
  }
  assert.equal(unavailableReads, 0, 'unavailable evidence never substitutes the latest memory revision');
  await page.getByLabel('Model ID', { exact: true }).fill('fixture/model-b');
  await expect(facts.locator('.knowledge-claim')).toHaveCount(1);
  await expect(facts).toContainText('Other model reference');
});

test('delayed memory readers cannot overwrite a newer request or reopen after close and unmount', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture({ timers: false })), data = f.app.localData.get();
  for (const name of ['First', 'Second']) {
    const memory = data.createMemory({ id: `memory:reader-${name}`, kind: 'note', title: `${name} retained source`, body: `${name} retained body.`, source: { projectID: f.project.id } });
    data.addClaim({ predicate: `${name} reader evidence`, value: name, origin: 'user-stated', epistemicState: 'unverified', method: 'reader timing fixture',
      evidence: [{ id: `reader-evidence:${name}`, kind: 'memory', memoryID: memory.id, memoryRevision: 1, relation: 'supports' }] });
  }
  const firstID = 'memory:reader-First', firstItem = await f.api('memory/item?' + new URLSearchParams({ id: firstID }));
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Search all content', exact: true }).click();
  await page.getByRole('tab', { name: 'Facts', exact: true }).click();
  const fact = name => page.getByLabel('Fact results').locator('.knowledge-claim').filter({ hasText: `${name} reader evidence` });
  for (const name of ['First', 'Second']) await fact(name).locator('summary').click();
  const read = name => fact(name).getByRole('button', { name: 'Read retained memory evidence', exact: true });
  let held = null;
  const holdNext = () => {
    let entered, release, finished;
    const state = { entered: new Promise(resolve => entered = resolve), gate: new Promise(resolve => release = resolve), finished: new Promise(resolve => finished = resolve), enter: () => entered(), release: () => release(), finish: () => finished() };
    held = state; return state;
  };
  await page.route('**/api/memory/item?**', async route => {
    const state = held;
    if (!state || new URL(route.request().url()).searchParams.get('id') !== firstID) return route.continue();
    held = null; state.enter(); await state.gate;
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(firstItem) }); }
    finally { state.finish(); }
  });
  const first = page.getByRole('dialog', { name: 'First retained source', exact: true }), second = page.getByRole('dialog', { name: 'Second retained source', exact: true });
  const flushRender = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  let state = holdNext();
  await read('First').click(); await state.entered;
  await read('Second').click();
  await expect(second.locator('.knowledge-memory-body')).toHaveText('Second retained body.');
  state.release(); await state.finished; await flushRender();
  await expect(first).toHaveCount(0); await expect(second).toBeVisible();
  await second.getByRole('button', { name: 'Close dialog', exact: true }).click();

  await read('First').click(); await expect(first).toBeVisible();
  state = holdNext();
  await first.getByRole('button', { name: 'Check latest revision', exact: true }).click(); await state.entered;
  await first.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await read('Second').click(); await expect(second).toBeVisible();
  state.release(); await state.finished; await flushRender();
  await expect(first).toHaveCount(0); await expect(second).toBeVisible();
  await second.getByRole('button', { name: 'Close dialog', exact: true }).click();

  state = holdNext();
  await read('First').click(); await state.entered;
  await page.locator('.indexed-search-page').getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('.indexed-search-page')).toHaveCount(0);
  state.release(); await state.finished; await flushRender();
  await expect(first).toHaveCount(0); await expect(page.locator('.memory-reader')).toHaveCount(0);
});

test('retained reader distinguishes unknown source checks from missing sources without replacing capture time', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  f.state.messages.ses_history = [{ info: { id: 'msg_availability', role: 'user', time: { created: 300 } },
    parts: [{ type: 'text', text: 'Captured before source availability changed.' }] }];
  await f.api('history/pin', { project: f.project.id, session: 'ses_history', pinned: true, revision: 0 }, 'PUT');
  const id = `conversation:${f.project.id}:ses_history`;
  const item = () => f.api('memory/item?' + new URLSearchParams({ id }));
  await expect.poll(async () => (await item()).job?.status).toBe('completed');
  const original = await item();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Search all content', exact: true }).click();
  await page.getByRole('button', { name: 'Read pinned memory Important conversation', exact: true }).click();
  const reader = page.getByRole('dialog', { name: 'Important conversation', exact: true });
  const transcript = reader.locator('.memory-reader-messages');
  await expect(transcript).toContainText('Captured before source availability changed.');
  const request = f.host.request.bind(f.host);
  let sourceStatus = 503;
  f.host.request = async (route, options) => {
    if (route === '/session/ses_history/message') throw Object.assign(Error('Source check fixture unavailable.'), { status: sourceStatus });
    return request(route, options);
  };
  await reader.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
  await expect.poll(async () => (await item()).revision).toBe(original.revision + 1);
  await reader.getByRole('button', { name: 'Check latest revision', exact: true }).click();
  const unknown = await item();
  assert.equal(unknown.coverage, 'unknown_source');
  assert.equal(unknown.capturedAt, original.capturedAt);
  await expect(reader).toContainText('The source could not be checked. Its availability is unknown.');
  await expect(reader).not.toContainText('OpenCode reported this conversation missing.');
  await expect(transcript).toContainText('Captured before source availability changed.');
  await reader.getByText('Capture boundary and evidence', { exact: true }).click();
  const shownTime = value => page.evaluate(timestamp => new Date(timestamp).toLocaleString(), value);
  await expect(reader.locator('dt:has-text("Source captured") + dd')).toHaveText(await shownTime(original.capturedAt));
  await expect(reader.locator('dt:has-text("Last source check") + dd')).toHaveText(await shownTime(unknown.boundary.attemptedAt));
  await expect(reader.locator('dt:has-text("Retained revision recorded") + dd')).toHaveText(await shownTime(unknown.boundary.snapshotCreatedAt));

  sourceStatus = 404;
  await reader.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
  await expect.poll(async () => (await item()).revision).toBe(unknown.revision + 1);
  await reader.getByRole('button', { name: 'Check latest revision', exact: true }).click();
  const missing = await item();
  assert.equal(missing.coverage, 'missing_source');
  assert.equal(missing.capturedAt, original.capturedAt);
  await expect(reader).toContainText('OpenCode reported this conversation missing.');
  await expect(reader).not.toContainText('Its availability is unknown.');
  await expect(transcript).toContainText('Captured before source availability changed.');
  await expect(reader.locator('dt:has-text("Source captured") + dd')).toHaveText(await shownTime(original.capturedAt));
  await expect(reader.locator('dt:has-text("Last source check") + dd')).toHaveText(await shownTime(missing.boundary.attemptedAt));
  await reader.getByLabel('Retained revision', { exact: true }).selectOption(String(original.revision));
  await expect(transcript).toContainText('Captured before source availability changed.');
  await expect(reader).not.toContainText('OpenCode reported this conversation missing.');
  await expect(reader.locator('dt:has-text("Last source check") + dd')).toHaveText(await shownTime(original.boundary.attemptedAt));
  await expect(reader.getByRole('button', { name: 'Open live conversation', exact: true })).toBeVisible();
});

test('indexed-search', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  try {
    await mkdir(path.join(f.root, 'tools'));
    const indexer = await readFile('backend/tools/project-content-indexer.mjs', 'utf8');
    await writeFile(path.join(f.root, 'tools', 'project-content-indexer.mjs'), indexer.replace('../../server/data/schema.sql', '../server/data/schema.sql').replace('../../domain/content-query.mjs','../domain/content-query.mjs').replace('../../shared/local-storage-path.mjs','../shared/local-storage-path.mjs'));
    await mkdir(path.join(f.root, 'server', 'data'), { recursive: true });
    await copyFile('server/data/schema.sql', path.join(f.root, 'server', 'data', 'schema.sql'));
    await mkdir(path.join(f.root,'domain'),{recursive:true});
    await copyFile('domain/content-query.mjs',path.join(f.root,'domain','content-query.mjs'));
    await mkdir(path.join(f.root,'shared'),{recursive:true});
    await copyFile('shared/local-storage-path.mjs',path.join(f.root,'shared','local-storage-path.mjs'));
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
    assert.deepEqual(chats.results.map((row) => [row.project, row.session]), [[f.project.id, 'ses_worker']]);
    assert.equal(chats.results[0].navigationSession, 'ses_history');
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
    await page.getByRole('button', { name: 'Open conversation Linked worker in History project', exact: true }).waitFor();
    assert.equal(await page.locator('.indexed-search-result').count(), 3);
    await page.getByRole('tab', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open conversation Linked worker in History project', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Read retained file evidence Second project/search-source.txt', exact: true }).click();
    const evidenceReader = page.getByRole('dialog', { name: 'Retained file evidence', exact: true });
    await expect(evidenceReader).toContainText('shared cross project needle appears in the second project file');
    await expect(evidenceReader.getByRole('button', { name: 'Open live file', exact: true })).toBeVisible();
    await evidenceReader.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('tab', { name: 'All content', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open conversation Linked worker in History project', exact: true })).toBeVisible();
    if (process.env.FREELANCER_QA_SHOTS) {
      await mkdir(process.env.FREELANCER_QA_SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'search-results.png'), fullPage: true });
    }
    await expect(page.locator('#application-settings-links').getByRole('button', { name: 'Conversation history', exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.locator('#application-settings-links').getByRole('button', { name: 'Git defaults', exact: true, includeHidden: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pin parent conversation Important conversation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unpin parent conversation Important conversation', exact: true })).toBeEnabled();
    assert.ok((await f.api('history?project=' + f.project.id)).sessions.find(row => row.id === 'ses_history').organization.pinnedAt);
    await page.getByRole('button', { name: 'Manage chats', exact: true }).click();
    await expect(page.locator('.history-page').getByRole('button', { name: 'Unpin Important conversation', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unpin parent conversation Important conversation', exact: true })).toBeVisible();
    await page.route('**/api/history/pin', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Pin unavailable' }) }));
    await page.getByRole('button', { name: 'Unpin parent conversation Important conversation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Pin unavailable');
    await expect(page.getByRole('button', { name: 'Unpin parent conversation Important conversation', exact: true })).toBeEnabled();
    await page.unroute('**/api/history/pin');
    await page.getByRole('button', { name: 'Unpin parent conversation Important conversation', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pin parent conversation Important conversation', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Open conversation Linked worker in History project', exact: true }).click();
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
    await expect(page.getByRole('button', { name: 'Open conversation Linked worker in History project', exact: true })).toBeVisible();
    await page.unroute('**/api/history/search?**');

    await page.getByRole('button', { name: 'Search all content', exact: true }).click();
    let failFileSearch = true;
    await page.route('**/api/index/search?**', route => failFileSearch
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'File search unavailable' }) })
      : route.continue());
    await page.getByRole('searchbox', { name: 'Search all content' }).fill('');
    await page.getByRole('searchbox', { name: 'Search all content' }).fill('shared cross project needle');
    await expect(page.getByRole('alert')).toContainText('Files: File search unavailable');
    await expect(page.getByRole('button', { name: 'Open conversation Linked worker in History project', exact: true })).toBeVisible();
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

test('knowledge memory snapshots, authored notes, and facts', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  try {
    f.state.messages.ses_history = [
      { info: { id: 'msg_memory_original', role: 'user', time: { created: 300 } }, parts: [{ type: 'text', text: 'Original retained alpha decision.' }] },
      { info: { id: 'msg_memory_answer', role: 'assistant', parentID: 'msg_memory_original', time: { created: 310, completed: 320 } }, parts: [{ type: 'text', text: 'Use the original source revision.' }] },
    ];
    await f.api('history?project=' + f.project.id);
    await f.api('history/pin', { project: f.project.id, session: 'ses_history', pinned: true, revision: 0 }, 'PUT');
    const memoryID = `conversation:${f.project.id}:ses_history`;
    await expect.poll(async () => (await f.api('memory/item?' + new URLSearchParams({ id: memoryID }))).job?.status).toBe('completed');
    const original = await f.api('memory/item?' + new URLSearchParams({ id: memoryID }));
    assert.equal(original.coverage, 'complete');
    const page = await browser.newPage();
    page.setDefaultTimeout(12000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(f.url);
    await page.getByRole('button', { name: 'Application settings', exact: true }).click();
    await page.getByRole('button', { name: 'Search all content', exact: true }).click();
    await page.getByRole('tab', { name: 'Pinned Memory', exact: true }).click();
    await page.getByRole('button', { name: 'Read pinned memory Important conversation', exact: true }).click();
    const reader = page.getByRole('dialog', { name: 'Important conversation', exact: true });
    await expect(reader.locator('.memory-reader-messages')).toContainText('Original retained alpha decision.');
    await expect(reader.getByRole('button', { name: 'Open live conversation', exact: true })).toBeVisible();
    f.state.messages.ses_history.push({ info: { id: 'msg_memory_later', role: 'user', time: { created: 400 } }, parts: [{ type: 'text', text: 'Later native source beta revision.' }] });
    await f.app.history.indexCurrent(f.project.id, 'ses_history', f.state.messages.ses_history);
    await reader.getByRole('button', { name: 'Check latest revision', exact: true }).click();
    await expect(reader.getByText('A newer retained source revision is available. This memory still shows its captured revision. Refresh snapshot creates another memory revision.', { exact: true })).toBeVisible();
    await expect(reader.locator('.memory-reader-messages')).not.toContainText('Later native source beta revision.');
    await reader.getByText('Capture boundary and evidence', { exact: true }).click();
    await expect(reader.getByText(/Live source content was not checked\./)).toBeVisible();
    await reader.getByText('Capture boundary and evidence', { exact: true }).click();
    const sourceChanged = await f.api('memory/item?' + new URLSearchParams({ id: memoryID }));
    assert.equal(sourceChanged.sourceUpdates.state, 'newer-retained');
    assert.equal(sourceChanged.revision, original.revision, 'Retaining newer source content does not automatically refresh curated memory.');
    assert.equal(sourceChanged.snapshotHash, original.snapshotHash);
    assert.equal(sourceChanged.pinnedAt, original.pinnedAt);
    assert.equal(sourceChanged.pinRevision, original.pinRevision);
    await reader.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
    await expect(reader.getByText('A newer retained revision is available. Select it above to read its evidence.', { exact: true })).toBeVisible();
    await expect(reader.locator('.memory-reader-messages')).not.toContainText('Later native source beta revision.');
    const refreshed = await f.api('memory/item?' + new URLSearchParams({ id: memoryID }));
    await reader.getByLabel('Retained revision', { exact: true }).selectOption(String(refreshed.revision));
    await expect(reader.locator('.memory-reader-messages')).toContainText('Later native source beta revision.');
    await reader.getByLabel('Retained revision', { exact: true }).selectOption(String(original.revision));
    await expect(reader.locator('.memory-reader-messages')).not.toContainText('Later native source beta revision.');
    let uncertainRefreshes = 0;
    await page.route('**/api/memory/refresh', route => {
      uncertainRefreshes++;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Capture response unavailable' }) });
    });
    await reader.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
    await expect(reader.getByRole('alert')).toContainText('Capture was not confirmed. Check the latest revision before retrying.');
    await expect(reader.getByRole('button', { name: 'Refresh snapshot', exact: true })).toBeDisabled();
    assert.equal(uncertainRefreshes, 1, 'an uncertain capture response does not replay the refresh request');
    await page.unroute('**/api/memory/refresh');
    await reader.getByRole('button', { name: 'Check latest revision', exact: true }).click();
    await expect(reader.getByRole('button', { name: 'Refresh snapshot', exact: true })).toBeEnabled();
    await expect(reader.getByRole('alert')).toHaveCount(0);
    await reader.getByRole('button', { name: 'Close dialog', exact: true }).click();

    await page.getByRole('tab', { name: 'Memories', exact: true }).click();
    await page.getByRole('button', { name: 'New memory', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'New memory', exact: true });
    await editor.getByLabel('Memory title', { exact: true }).fill('Fresh setup decision');
    await editor.getByLabel('Memory text', { exact: true }).fill('Use native OpenCode defaults.');
    await editor.getByRole('button', { name: 'Save memory', exact: true }).click();
    const noteReader = page.getByRole('dialog', { name: 'Fresh setup decision', exact: true });
    await expect(noteReader.locator('.knowledge-memory-body')).toHaveText('Use native OpenCode defaults.');
    await noteReader.getByRole('button', { name: 'Pin memory', exact: true }).click();
    await expect(noteReader.getByRole('button', { name: 'Unpin memory', exact: true })).toBeVisible();
    await noteReader.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('tab', { name: 'Pinned Memory', exact: true }).click();
    await page.getByRole('button', { name: 'Read pinned memory Fresh setup decision', exact: true }).click();
    await noteReader.getByRole('button', { name: 'Unpin memory', exact: true }).click();
    await expect(noteReader.getByRole('button', { name: 'Pin memory', exact: true })).toBeVisible();
    await noteReader.getByRole('button', { name: 'Edit memory', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit memory', exact: true });
    await edit.getByLabel('Memory text', { exact: true }).fill('Use confirmed native OpenCode defaults.');
    await edit.getByRole('button', { name: 'Save memory', exact: true }).click();
    await expect(noteReader.locator('.knowledge-memory-body')).toHaveText('Use confirmed native OpenCode defaults.');
    await noteReader.getByLabel('Retained revision', { exact: true }).selectOption('1');
    await expect(noteReader.locator('.knowledge-memory-body')).toHaveText('Use native OpenCode defaults.');
    await noteReader.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.getByRole('tab', { name: 'Pinned Memory', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Read pinned memory Fresh setup decision', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Memories', exact: true }).click();
    await page.getByRole('button', { name: 'Read memory Fresh setup decision', exact: true }).click();
    await noteReader.getByRole('button', { name: 'Archive memory', exact: true }).click();
    await expect(noteReader.getByRole('button', { name: 'Restore memory', exact: true })).toBeVisible();
    await expect(noteReader).toContainText('Its retained revisions and pin are preserved.');
    await noteReader.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Read memory Fresh setup decision', exact: true })).toHaveCount(0);
    await page.getByLabel('Include archived memories', { exact: true }).check();
    await page.getByRole('button', { name: 'Read memory Fresh setup decision', exact: true }).click();
    await noteReader.getByRole('button', { name: 'Restore memory', exact: true }).click();
    await expect(noteReader.getByRole('button', { name: 'Archive memory', exact: true })).toBeVisible();
    await expect(noteReader.locator('.knowledge-memory-body')).toHaveText('Use confirmed native OpenCode defaults.');
    await noteReader.getByRole('button', { name: 'Forget memory', exact: true }).click();
    await page.getByRole('dialog', { name: 'Forget retained memory?', exact: true }).getByRole('button', { name: 'Forget memory', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Read memory Fresh setup decision', exact: true })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Facts', exact: true }).click();
    await page.getByRole('button', { name: 'New fact', exact: true }).click();
    const factEditor = page.getByRole('dialog', { name: 'New fact', exact: true });
    await expect(factEditor.getByLabel('Claim origin', { exact: true })).toHaveValue('user-stated');
    await expect(factEditor.getByLabel('Epistemic status', { exact: true })).toHaveValue('unverified');
    await factEditor.getByLabel('Fact statement', { exact: true }).fill('Default configuration authority');
    await factEditor.getByLabel('Fact value', { exact: true }).fill('Native OpenCode');
    await factEditor.getByLabel('How this claim was established', { exact: true }).fill('Recorded user statement with captured conversation evidence.');
    await factEditor.getByRole('button', { name: 'Save fact', exact: true }).click();
    await expect(factEditor.getByRole('alert')).toContainText('Select at least one retained source revision');
    const evidenceLabel = `Important conversation · retained revision ${refreshed.revision}`;
    await expect(factEditor.getByLabel('Retained source revision', { exact: true }).locator('option')).toContainText([evidenceLabel]);
    await factEditor.getByLabel('Retained source revision', { exact: true }).selectOption({ label: evidenceLabel });
    await factEditor.getByRole('button', { name: 'Add evidence', exact: true }).click();
    await expect(factEditor.getByRole('alert')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Fact editor and retained source picker fit phone width');
    assert.equal(await factEditor.locator('.ef-dialog-body').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Fact editor content does not overflow its dialog');
    if (process.env.FREELANCER_QA_SHOTS) await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'knowledge-fact-editor-phone.png'), fullPage: true });
    await factEditor.getByRole('button', { name: 'Add evidence', exact: true }).scrollIntoViewIfNeeded();
    if (process.env.FREELANCER_QA_SHOTS) await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'knowledge-fact-evidence-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await factEditor.getByRole('button', { name: 'Save fact', exact: true }).click();
    const authoredFact = page.getByLabel('Fact results').locator('.knowledge-claim').filter({ hasText: 'Default configuration authority' });
    await expect(authoredFact).toContainText('Native OpenCode');
    await expect(authoredFact).toContainText('unverified');
    await expect(authoredFact).toContainText('Recorded user statement');
    await authoredFact.getByRole('button', { name: 'Correct fact Default configuration authority', exact: true }).click();
    const correction = page.getByRole('dialog', { name: 'Correct fact', exact: true });
    await correction.getByLabel('Fact value', { exact: true }).fill('Confirmed native configuration');
    await correction.getByLabel('Epistemic status', { exact: true }).selectOption('supported');
    await correction.getByLabel('How this claim was established', { exact: true }).fill('Explicit review of the retained source revision.');
    await correction.getByLabel('Reason for correction', { exact: true }).fill('Clarify the configuration source.');
    await correction.getByLabel('Retained source revision', { exact: true }).selectOption({ label: evidenceLabel });
    await correction.getByRole('button', { name: 'Add evidence', exact: true }).click();
    await correction.getByRole('button', { name: 'Save correction', exact: true }).click();
    await expect(authoredFact).toContainText('Confirmed native configuration');
    await authoredFact.locator('summary').click();
    await authoredFact.getByRole('button', { name: 'Read retained memory evidence', exact: true }).click();
    await expect(reader.locator('.memory-reader-messages')).toContainText('Later native source beta revision.');
    await reader.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const factHistory = await f.api('knowledge', { operation: 'claims', query: 'Default configuration authority', includeHistorical: true });
    assert.equal(factHistory.results.length, 2, 'fact correction retains the prior claim');
    assert.equal(factHistory.results.find(row => row.epistemicState === 'supported').evidence[0].memoryRevision, refreshed.revision, 'evidence keeps the explicit retained revision');

    f.app.localData.get().addClaim({ predicate: 'Native settings ownership', value: 'OpenCode', origin: 'user-stated', epistemicState: 'supported', method: 'human review', scope: { projectID: f.project.id }, evidence: [{ id: memoryID, relation: 'supports' }] });
    const prior = f.app.localData.get().addClaim({ predicate: 'Historical settings ownership', value: 'Freelancer', origin: 'source-reported', epistemicState: 'unverified', method: 'captured source', scope: { projectID: f.project.id }, evidence: [{ id: 'prior-source', relation: 'supports' }] });
    f.app.localData.get().correctClaim({ id: prior.id, epistemicState: 'supported', value: 'OpenCode', evidence: [{ id: memoryID, relation: 'supersedes' }] });
    await page.getByRole('tab', { name: 'Memories', exact: true }).click();
    await page.getByRole('tab', { name: 'Facts', exact: true }).click();
    await expect(page.getByLabel('Fact results')).toContainText('Native settings ownership');
    await expect(page.getByLabel('Fact results')).toContainText('user-stated');
    await page.getByLabel('Include historical claims', { exact: true }).check();
    await page.getByLabel('Claim status', { exact: true }).selectOption('superseded');
    await expect(page.getByLabel('Fact results')).toContainText('Freelancer');
    await page.getByLabel('Fact results').locator('.knowledge-claim').filter({ hasText: 'Historical settings ownership' }).locator('summary').click();
    await expect(page.getByLabel('Fact results')).toContainText('prior-source');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Knowledge tabs, filters, and evidence fit phone width');
    if (process.env.FREELANCER_QA_SHOTS) await page.screenshot({ path: path.join(process.env.FREELANCER_QA_SHOTS, 'knowledge-facts-phone.png'), fullPage: true });
    await page.close();
  } finally { await f.close(); }
});

test('delayed file evidence cannot replace a newer file or memory reader, reopen after close, or survive unmount', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const [{ createHash }, { DatabaseSync }] = await Promise.all([import('node:crypto'), import('node:sqlite')]);
  const f = await own(localDataFixture({ timers: false })), data = f.app.localData.get(), files = [];
  const db = new DatabaseSync(data.filename);
  try {
    for (const name of ['First', 'Second']) {
      const text = `${name} exact retained file body.`, hash = createHash('sha256').update(text).digest('hex');
      const ref = { kind: 'file', sourceIdentity: `file:reader-${name}`, revisionIdentity: `revision:${hash}`, locator: 'L1', unitSha256: hash };
      db.prepare('INSERT INTO content_source_revisions VALUES(?,?,?,?,?,?)').run(ref.sourceIdentity, ref.revisionIdentity,
        process.platform === 'win32' ? path.resolve(f.directory).toLowerCase() : path.resolve(f.directory), `${name}.txt`, '{}', 1000);
      db.prepare('INSERT INTO content_unit_revisions VALUES(?,?,1,?,?,?,?,?,?)').run(ref.sourceIdentity, ref.revisionIdentity, ref.locator, '', text, 6, text.length, hash);
      files.push({ name, text, ref });
    }
  } finally { db.close(); }
  for (const file of files) data.addClaim({ predicate: `${file.name} file reader evidence`, value: file.name, origin: 'user-stated',
    epistemicState: 'unverified', method: 'file reader timing fixture', evidence: [{ id: `file-evidence:${file.name}`, relation: 'supports', ...file.ref }] });
  const memory = data.createMemory({ id: 'memory:file-reader-race', kind: 'note', title: 'Newer memory source', body: 'Newer exact retained memory body.' });
  data.addClaim({ predicate: 'Memory reader evidence', value: 'Memory', origin: 'user-stated', epistemicState: 'unverified', method: 'cross-reader timing fixture',
    evidence: [{ id: 'file-reader-memory-evidence', kind: 'memory', memoryID: memory.id, memoryRevision: 1, relation: 'supports' }] });
  const filePayload = await f.api('knowledge/evidence?' + new URLSearchParams({ ...files[0].ref, unitHash: files[0].ref.unitSha256 }));
  const memoryPayload = await f.api('memory/item?' + new URLSearchParams({ id: memory.id }));
  assert.equal(filePayload.text, files[0].text);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), gates = [];
  let heldFile = null, heldMemory = null;
  const holdNext = kind => {
    let enter, release, finish;
    const state = { entered: new Promise(resolve => enter = resolve), gate: new Promise(resolve => release = resolve), finished: new Promise(resolve => finish = resolve),
      enter: () => enter(), release: () => release(), finish: () => finish() };
    gates.push(state); if (kind === 'file') heldFile = state; else heldMemory = state; return state;
  };
  await own(Promise.resolve({ close: async () => { gates.forEach(state => state.release()); await page.unrouteAll({ behavior: 'wait' }); } }));
  const fulfillHeld = async (route, state, payload) => {
    state.enter(); await state.gate;
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }); }
    finally { state.finish(); }
  };
  await page.route('**/api/knowledge/evidence?**', route => {
    if (!heldFile || new URL(route.request().url()).searchParams.get('sourceIdentity') !== files[0].ref.sourceIdentity) return route.continue();
    const state = heldFile; heldFile = null; return fulfillHeld(route, state, filePayload);
  });
  await page.route('**/api/memory/item?**', route => {
    if (!heldMemory || new URL(route.request().url()).searchParams.get('id') !== memory.id) return route.continue();
    const state = heldMemory; heldMemory = null; return fulfillHeld(route, state, memoryPayload);
  });
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Search all content', exact: true }).click();
  await page.getByRole('tab', { name: 'Facts', exact: true }).click();
  const claim = predicate => page.getByLabel('Fact results').locator('.knowledge-claim').filter({ hasText: predicate });
  for (const predicate of ['First file reader evidence', 'Second file reader evidence', 'Memory reader evidence']) await claim(predicate).locator('summary').click();
  const readFile = name => claim(`${name} file reader evidence`).getByRole('button', { name: 'Read retained evidence', exact: true });
  const readMemory = () => claim('Memory reader evidence').getByRole('button', { name: 'Read retained memory evidence', exact: true });
  const fileReader = page.getByRole('dialog', { name: 'Retained file evidence', exact: true }), memoryReader = page.getByRole('dialog', { name: 'Newer memory source', exact: true });
  const releaseHeld = async state => { state.release(); await state.finished; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };

  let state = holdNext('file');
  await readFile('First').click(); await state.entered;
  await readFile('Second').click(); await expect(fileReader.locator('.knowledge-retained-text')).toHaveText(files[1].text);
  await releaseHeld(state); await expect(fileReader.locator('.knowledge-retained-text')).toHaveText(files[1].text);
  await fileReader.getByRole('button', { name: 'Close dialog', exact: true }).click();

  state = holdNext('file');
  await readFile('First').click(); await state.entered;
  await readMemory().click(); await expect(memoryReader.locator('.knowledge-memory-body')).toHaveText(memoryPayload.body);
  await releaseHeld(state); await expect(fileReader).toHaveCount(0); await expect(memoryReader).toBeVisible();
  await memoryReader.getByRole('button', { name: 'Close dialog', exact: true }).click();

  state = holdNext('memory');
  await readMemory().click(); await state.entered;
  await readFile('Second').click(); await expect(fileReader.locator('.knowledge-retained-text')).toHaveText(files[1].text);
  await releaseHeld(state); await expect(memoryReader).toHaveCount(0); await expect(fileReader).toBeVisible();
  await fileReader.getByRole('button', { name: 'Close dialog', exact: true }).click();

  state = holdNext('file');
  await readFile('First').click(); await state.entered;
  await readFile('Second').click(); await expect(fileReader).toBeVisible();
  await fileReader.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await releaseHeld(state); await expect(fileReader).toHaveCount(0); await expect(memoryReader).toHaveCount(0);

  state = holdNext('file');
  await readFile('First').click(); await state.entered;
  await page.locator('.indexed-search-page').getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.locator('.indexed-search-page')).toHaveCount(0);
  await releaseHeld(state); await expect(fileReader).toHaveCount(0); await expect(memoryReader).toHaveCount(0);
});

test('a pending retained reader blocks snapshot mutations and cannot bypass uncertain delivery review', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  f.state.messages.ses_history = [{ info: { id: 'msg_reader_refresh_guard', role: 'user', time: { created: 300 } }, parts: [{ type: 'text', text: 'Retained before the pending source check.' }] }];
  await f.api('history/pin', { project: f.project.id, session: 'ses_history', pinned: true, revision: 0 }, 'PUT');
  const id = `conversation:${f.project.id}:ses_history`, readItem = () => f.api('memory/item?' + new URLSearchParams({ id }));
  await expect.poll(async () => (await readItem()).job?.status).toBe('completed');
  const item = await readItem(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), gates = [];
  let held = null, refreshes = 0;
  const holdNextRead = () => {
    let enter, release, finish;
    const state = { entered: new Promise(resolve => enter = resolve), gate: new Promise(resolve => release = resolve), finished: new Promise(resolve => finish = resolve),
      enter: () => enter(), release: () => release(), finish: () => finish() };
    gates.push(state); held = state; return state;
  };
  await own(Promise.resolve({ close: async () => { gates.forEach(state => state.release()); await page.unrouteAll({ behavior: 'wait' }); } }));
  await page.route('**/api/memory/item?**', async route => {
    if (!held || new URL(route.request().url()).searchParams.get('id') !== id) return route.continue();
    const state = held; held = null; state.enter(); await state.gate;
    try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(item) }); }
    finally { state.finish(); }
  });
  await page.route('**/api/memory/refresh', route => {
    refreshes++; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Capture response unavailable' }) });
  });
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Search all content', exact: true }).click();
  await page.getByRole('button', { name: 'Read pinned memory Important conversation', exact: true }).click();
  const reader = page.getByRole('dialog', { name: 'Important conversation', exact: true }), refresh = reader.getByRole('button', { name: 'Refresh snapshot', exact: true });
  await expect(refresh).toBeEnabled();
  let state = holdNextRead();
  await reader.getByRole('button', { name: 'Check latest revision', exact: true }).click(); await state.entered;
  for (const name of ['Refresh snapshot', 'Unpin memory', 'Archive memory', 'Forget memory']) await expect(reader.getByRole('button', { name, exact: true })).toBeDisabled();
  await refresh.evaluate(button => button.click());
  assert.equal(refreshes, 0, 'a pending GET cannot submit capture work');
  state.release(); await state.finished; await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(reader.getByRole('alert')).toContainText('Capture was not confirmed. Check the latest revision before retrying.');
  await expect(refresh).toBeDisabled();
  assert.equal(refreshes, 1);

  state = holdNextRead();
  await reader.getByRole('button', { name: 'Check latest revision', exact: true }).click(); await state.entered;
  await expect(refresh).toBeDisabled();
  await refresh.evaluate(button => button.click());
  assert.equal(refreshes, 1, 'uncertain delivery stays locked while its explicit check is pending');
  state.release(); await state.finished;
  await expect(refresh).toBeEnabled(); await expect(reader.getByRole('alert')).toHaveCount(0);
  assert.equal(refreshes, 1, 'checking the latest persisted revision does not resubmit capture');
});
