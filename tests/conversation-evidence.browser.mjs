import assert from 'node:assert/strict';
import { openCodeSourceIdentity } from '../server/data/opencode-warehouse.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

const originalBody = 'retainedworkerneedle Café 日本語 — original worker evidence.';
const replacementBody = 'Latest native worker body; the retained search evidence must remain original.';
const parentBody = 'The current parent conversation has its own live body.';
const secondBody = 'secondretainedneedle — independent retained worker evidence.';

async function retainedFixture(own) {
  const f = await own(localDataFixture({ timers: false })), data = f.app.localData.get();
  // Model a durable capture awaiting publication. HTTP preview/navigation reads
  // can still use the native fixture, but cannot consume that pending derivation.
  f.app.history.indexCurrent = async () => false;
  f.state.messages.ses_history = [{ info: { id: 'msg_parent_live', role: 'user', sessionID: 'ses_history' },
    parts: [{ id: 'part_parent_live', type: 'text', text: parentBody }] }];
  f.state.messages.ses_other = [{ info: { id: 'msg_other_live', role: 'user', sessionID: 'ses_other' },
    parts: [{ id: 'part_other_live', type: 'text', text: 'Another current conversation body.' }] }];
  const second = { id: 'ses_evidence_second', parentID: 'ses_history', title: 'Second retained worker',
    directory: f.directory, time: { created: 111, updated: 289 } };
  f.state.sessions.push(second);
  await f.api('history?' + new URLSearchParams({ project: f.project.id, scope: 'all' }));
  const source = openCodeSourceIdentity(f.nativeFile);
  const capture = (session, text, publish) => {
    const messages = [{ info: { id: `msg_evidence_${session.id}`, sessionID: session.id, role: 'assistant',
      model: { providerID: 'opencode', modelID: 'free' }, time: { created: 250 } },
      parts: [{ id: `part_evidence_${session.id}`, type: 'text', text }] }];
    f.state.messages[session.id] = structuredClone(messages);
    const result = data.recordOpenCodeSnapshot({ ...source, projectID: f.project.id,
      session: structuredClone(session), messages, projectionSafe: true });
    if (publish) assert.equal(data.publishWarehouseDerivationJob({ id: result.derivationJobID,
      revisionToken: result.derivationRevisionToken }).published, true);
    return result;
  };
  const worker = f.state.sessions.find(row => row.id === 'ses_worker');
  const original = capture(worker, originalBody, true);
  capture(second, secondBody, true);
  const hit = (await f.api('history/search?' + new URLSearchParams({ q: 'retainedworkerneedle' }))).results[0];
  assert.equal(hit.session, 'ses_worker');
  assert.equal(hit.title, 'Linked worker');
  assert.equal(hit.navigationSession, 'ses_history');
  assert.equal(hit.organization?.pinnedAt ?? null, null, 'search does not require a parent or worker pin');
  assert.equal(hit.evidence.snapshotRevisionSha256, original.snapshotRevisionSha256);
  worker.title = 'Updated native worker title';
  worker.time.updated = 999;
  const pending = capture(worker, replacementBody, false);
  assert.notEqual(pending.snapshotRevisionSha256, original.snapshotRevisionSha256);
  const current = data.readOpenCodeSession({ ...source, projectID: f.project.id, sessionID: worker.id });
  assert.equal(current.messages[0].parts[0].text, replacementBody);
  assert.ok(data.listWarehouseDerivationJobs({ sourceID: source.sourceSystemID, includeDeferred: true })
    .some(job => job.id === pending.derivationJobID), 'the replacement has durable pending work');
  const retained = await f.api('knowledge', { operation: 'opencode-read', ...hit.evidence });
  assert.equal(retained.isCurrent, false);
  assert.equal(retained.messages[0].parts[0].text, originalBody);
  assert.equal(retained.snapshotRevisionSha256, original.snapshotRevisionSha256);
  // This journey starts after indexing, so fresh-project preparation must not
  // explicitly refresh the native replacement before retained evidence is read.
  data.markProjectIndexesReady(f.project.id);
  return { ...f, data, hit, original, pending, retained };
}

async function searchConversations(page, query) {
  const settings = page.getByRole('button', { name: 'Application settings', exact: true });
  if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
  await page.getByRole('button', { name: 'Search all content', exact: true }).click();
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search all content', exact: true }).fill(query);
}

const workerHit = page => page.locator('.content-search-conversation').filter({ hasText: 'Linked worker' });
const reader = page => page.getByRole('dialog', { name: 'Retained conversation evidence', exact: true });

test('memory cloud opens a source-linked chat summary draft', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await retainedFixture(own), page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(f.url);
  await searchConversations(page, 'retainedworkerneedle');
  const hit = workerHit(page);
  await expect(hit).toHaveCount(1);
  await hit.getByRole('button', { name: 'Add conversation summary to memory: Important conversation', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New memory', exact: true });
  await expect(editor.locator('.knowledge-selected-evidence')).toContainText('History project');
  await expect(editor.getByLabel('Memory summary', { exact: true })).toHaveAttribute('required', '');
  await editor.getByLabel('Memory summary', { exact: true }).fill('A manually curated summary of the retained chat.');
  await editor.getByRole('button', { name: 'Save memory', exact: true }).click();
  const saved = page.getByRole('dialog', { name: 'Linked worker', exact: true });
  await expect(saved.locator('.knowledge-memory-body')).toHaveText('A manually curated summary of the retained chat.');
  await expect(saved.getByText('Retained evidence · 1', { exact: true })).toBeVisible();
});

test('unpinned worker search preserves original retained evidence and separates parent navigation at phone width', { tag: ['@app'] },
  async ({ appBrowser: browser, own }, info) => {
    const f = await retainedFixture(own), page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const evidenceRequests = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/memory' && request.method() === 'POST') {
        const body = request.postDataJSON();
        if (body.operation === 'opencode-read') evidenceRequests.push(body);
      }
    });
    await page.goto(f.url);
    await test.step('Search the published worker while a replacement source remains pending', async () => {
      await searchConversations(page, 'retainedworkerneedle');
      const hit = workerHit(page);
      await expect(hit).toHaveCount(1);
      await expect(hit.locator('.indexed-result-heading strong')).toHaveText('Linked worker');
      await expect(hit).toContainText(originalBody);
      await expect(hit).toContainText('Open parent: Important conversation');
      await expect(hit).not.toContainText('Updated native worker title');
      await expect(hit.getByRole('button', { name: 'Add conversation summary to memory: Important conversation', exact: true })).toBeVisible();
      await expect(hit.getByRole('button', { name: /pin parent conversation/i })).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await hit.scrollIntoViewIfNeeded();
      await expect(hit.getByRole('button', { name: 'Read retained evidence Linked worker', exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
        'worker identity, retained evidence and parent actions fit phone width');
      await info.attach('worker-search-phone', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      await hit.getByRole('button', { name: 'Read retained evidence Linked worker', exact: true }).click();
    });
    await test.step('Read the original body and snapshot hash without substituting current native text', async () => {
      const evidence = reader(page);
      await expect(evidence).toBeVisible();
      await expect(evidence).toContainText('Linked worker');
      await expect(evidence.locator('.memory-reader-message p')).toHaveText(originalBody);
      await expect(evidence).not.toContainText(replacementBody);
      await evidence.locator('summary').filter({ hasText: 'Source identity and capture' }).click();
      await expect(evidence.locator('dt:has-text("Session") + dd')).toHaveText('ses_worker');
      await expect(evidence.locator('dt:has-text("Snapshot hash") + dd')).toHaveText(f.original.snapshotRevisionSha256);
      const requested = evidenceRequests.at(-1);
      assert.deepEqual(requested, { operation: 'opencode-read', projectID: f.project.id, sessionID: 'ses_worker',
        sourceSystemID: f.hit.evidence.sourceSystemID, snapshotRevisionSha256: f.original.snapshotRevisionSha256, limit: 500 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
        'the retained transcript and exact source identity fit phone width');
      await info.attach('worker-retained-evidence-phone', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      const liveParent = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname === '/api/chat' && url.searchParams.get('session') === 'ses_history';
      });
      await evidence.getByRole('button', { name: 'Open live conversation', exact: true }).click();
      await liveParent;
      await expect(page.locator('.chat-view .message-body')).toContainText(parentBody);
      await expect(reader(page)).toHaveCount(0);
      await expect(page.locator('.chat-view')).not.toContainText(originalBody);
    });
    await test.step('Use the separately labelled parent action without changing pin or retained evidence', async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const chats = page.locator('.chat-navigation');
      const expandChats = chats.getByRole('button', { name: 'Chats', exact: true });
      if (await expandChats.getAttribute('aria-expanded') !== 'true') await expandChats.click();
      await chats.locator('.nav-chat-select').filter({ hasText: 'Another conversation' }).click();
      await expect(page.locator('.chat-view .message-body')).toContainText('Another current conversation body.');
      await searchConversations(page, 'retainedworkerneedle');
      await workerHit(page).getByRole('button', { name: 'Open conversation Linked worker in History project', exact: true }).click();
      await expect(page.locator('.chat-view .message-body')).toContainText(parentBody);
      await expect(page.locator('.composer textarea')).toBeVisible();
      assert.equal((await f.api('memory/search?' + new URLSearchParams({ pinnedOnly: 'true' }))).results.length, 0);
      assert.equal((await f.api('knowledge', { operation: 'opencode-read', ...f.hit.evidence })).snapshotRevisionSha256,
        f.original.snapshotRevisionSha256);
      assert.ok(f.data.listWarehouseDerivationJobs({ includeDeferred: true }).some(job => job.id === f.pending.derivationJobID));
    });
  });

test('a cancelled retained conversation request cannot replace a later worker reader after search closes', { tag: ['@app'] },
  async ({ appBrowser: browser, own }) => {
    const f = await retainedFixture(own), page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let enter, release, finish, held = true;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const finished = new Promise(resolve => { finish = resolve; });
    const cancelled = [];
    page.on('requestfailed', request => {
      if (new URL(request.url()).pathname !== '/api/knowledge' || request.method() !== 'POST') return;
      const body = request.postDataJSON();
      if (body.operation === 'opencode-read' && body.sessionID === 'ses_worker') cancelled.push(request.failure()?.errorText);
    });
    await own(Promise.resolve({ close: async () => { release(); await page.unrouteAll({ behavior: 'wait' }); } }));
    await page.route('**/api/knowledge', async route => {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
      if (!held || body?.operation !== 'opencode-read' || body.sessionID !== 'ses_worker') return route.continue();
      held = false; enter(); await gate;
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f.retained) }); }
      finally { finish(); }
    });
    await page.goto(f.url);
    await searchConversations(page, 'retainedworkerneedle');
    await workerHit(page).getByRole('button', { name: 'Read retained evidence', exact: true }).click();
    await entered;
    await page.locator('.indexed-search-page').getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.locator('.indexed-search-page')).toHaveCount(0);
    await expect.poll(() => cancelled).toEqual(['net::ERR_ABORTED']);
    await searchConversations(page, 'secondretainedneedle');
    const second = page.locator('.content-search-conversation').filter({ hasText: 'Second retained worker' });
    await second.getByRole('button', { name: 'Read retained evidence', exact: true }).click();
    await expect(reader(page).locator('.memory-reader-message p')).toHaveText(secondBody);
    release(); await finished;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(reader(page)).toHaveCount(1);
    await expect(reader(page)).toContainText('Second retained worker');
    await expect(reader(page).locator('.memory-reader-message p')).toHaveText(secondBody);
    await expect(reader(page)).not.toContainText(originalBody);
  });
