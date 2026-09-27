import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('chat-loading-cache', { tag: ["@app","@chat"] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  const secondDirectory = path.join(f.root, 'another-project');
  await mkdir(secondDirectory);
  const secondProject = { id: 'other_project', name: 'Other project', directory: secondDirectory };
  await f.store.update('settings', settings => ({ ...settings,
    projects: [f.project, secondProject], lastProjectID: f.project.id,
  }));
  f.state.sessions.push({ id: 'ses_second', title: 'Second project chat', directory: secondDirectory,
    time: { created: 300, updated: 400 } });
  f.state.messages.ses_history = [
    { info: { id: 'first-user', role: 'user' }, parts: [{ id: 'first-text', type: 'text', text: 'First project transcript' }] },
    { info: { id: 'first-assistant', role: 'assistant' }, parts: [{ id: 'worker-tool', type: 'tool', tool: 'task', state: {
      status: 'completed', input: { role: 'Researcher' }, metadata: { sessionId: 'ses_worker', selected_model: 'opencode/free' },
    } }] },
  ];
  f.state.messages.ses_worker = [
    { info: { id: 'worker-user', role: 'user' }, parts: [{ id: 'worker-assignment', type: 'text', text: 'Inspect the delegated task and preserve the parent constraints.' }] },
    { info: { id: 'worker-assistant', role: 'assistant' }, parts: [{ id: 'worker-text', type: 'text', text: 'Worker cached transcript' }] },
  ];
  f.state.messages.ses_second = [
    { info: { id: 'second-user', role: 'user' }, parts: [{ id: 'second-text', type: 'text', text: 'Second project transcript' }] },
  ];

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let holdSecond = false, holdFirst = false, holdWorker = false, holdSecondStale = false;
  let releaseSecond, releaseFirst, releaseWorker, releaseSecondStale;
  const secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const workerGate = new Promise(resolve => { releaseWorker = resolve; });
  const secondStaleGate = new Promise(resolve => { releaseSecondStale = resolve; });
  let firstRevalidationFinished = false;
  let workerRevalidationFinished = false;
  let markStaleStarted;
  const staleStarted = new Promise(resolve => { markStaleStarted = resolve; });

  const chooseProject = async name => {
    const nav = page.locator('.project-navigation');
    await nav.getByRole('button', { name: /^(Projects|History project|Other project)$/ }).first().click();
    await nav.locator('.nav-project-select').filter({ hasText: name }).click();
  };
  const chooseChat = async title => {
    const nav = page.locator('.chat-navigation');
    const trigger = nav.getByRole('button', { name: 'Chats', exact: true });
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    await nav.locator('.nav-chat-select').filter({ hasText: title }).click();
  };
  const openWorker = async () => {
    const work = page.locator('.request-working').last();
    if (!(await work.evaluate(element => element.open))) await work.locator('summary').first().click();
    await work.getByRole('button', { name: /Agent finished: Researcher .* Open conversation/ }).click();
  };

  try {
    await page.route('**/api/chat?**', async route => {
      const url = new URL(route.request().url());
      const selected = url.searchParams.get('session');
      if (holdSecondStale && selected === 'ses_second') { markStaleStarted(); await secondStaleGate; }
      if (holdSecond && selected === 'ses_second') await secondGate;
      if (holdFirst && selected === 'ses_history') {
        await firstGate;
        await route.continue();
        firstRevalidationFinished = true;
        return;
      }
      if (holdWorker && selected === 'ses_worker') {
        await workerGate;
        await route.continue();
        workerRevalidationFinished = true;
        return;
      }
      await route.continue();
    });
    await page.goto(f.url);
    await chooseChat('Important conversation');
    await page.getByText('First project transcript').waitFor();
    await page.getByRole('button', { name: 'Details', exact: true }).click();

    await chooseProject('Other project');
    holdSecond = true;
    await chooseChat('Second project chat');
    const stage = page.locator('.chat-loading-stage');
    await stage.waitFor();
    const stageBox = await stage.boundingBox();
    const layoutBox = await page.locator('.conversation-layout').boundingBox();
    assert.ok(stageBox && layoutBox && Math.abs(stageBox.width - layoutBox.width) < 2 &&
      Math.abs(stageBox.height - layoutBox.height) < 2,
    'uncached loading fills chat and Details together');
    assert.equal(await page.locator('.composer').count(), 0);
    assert.equal(await page.locator('.work-details').count(), 0);
    await mkdir('artifacts/chat-loading', { recursive: true });
    await page.screenshot({ path: 'artifacts/chat-loading/full-stage.png' });
    releaseSecond();
    await page.getByText('Second project transcript').waitFor();

    f.state.messages.ses_history.push({ info: { id: 'fresh-assistant', role: 'assistant' },
      parts: [{ id: 'fresh-text', type: 'text', text: 'Fresh native update' }] });
    holdFirst = true;
    await chooseProject('History project');
    await page.getByText('First project transcript').waitFor();
    assert.equal(firstRevalidationFinished, false, 'cached chat appears before its network read completes');
    assert.equal(await stage.count(), 0, 'a recent chat has no loading stage');
    assert.equal(await page.locator('.composer textarea').isDisabled(), true,
      'composer waits for live native state before accepting input');
    assert.equal(await page.locator('.work-details').count(), 1, 'Details returns with the cached chat');
    await page.screenshot({ path: 'artifacts/chat-loading/recent-chat.png' });
    releaseFirst();
    await page.getByText('Fresh native update').waitFor();
    await page.waitForFunction(() => !document.querySelector('.composer textarea')?.disabled);

    await openWorker();
    await page.getByText('Worker cached transcript').waitFor();
    const assignment = page.locator('.assignment-card');
    assert.equal(await assignment.evaluate(element => element.open), false);
    await assignment.locator('summary').click();
    await assignment.getByText('Inspect the delegated task and preserve the parent constraints.').waitFor();
    await page.getByRole('button', { name: 'Back to parent chat' }).click();
    await page.getByText('First project transcript').waitFor();
    f.state.messages.ses_worker.push({ info: { id: 'worker-fresh', role: 'assistant' },
      parts: [{ id: 'worker-fresh-text', type: 'text', text: 'Fresh worker update' }] });
    holdWorker = true;
    await openWorker();
    await page.getByText('Worker cached transcript').waitFor();
    assert.equal(workerRevalidationFinished, false, 'cached worker appears before worker revalidation completes');
    assert.equal(await page.locator('.composer textarea').isDisabled(), true,
      'worker composer also waits for live native state before accepting input');
    releaseWorker();
    await page.getByText('Fresh worker update').waitFor();
    await page.waitForFunction(() => !document.querySelector('.composer textarea')?.disabled);

    holdSecondStale = true;
    await chooseProject('Other project');
    await chooseChat('Second project chat');
    await staleStarted;
    await chooseProject('History project');
    await chooseChat('Important conversation');
    await page.getByText('First project transcript').waitFor();
    const staleFinished = page.waitForResponse(response => response.url().includes('/api/chat?') && response.url().includes('session=ses_second'));
    releaseSecondStale();
    await (await staleFinished).finished();
    assert.equal(await page.getByText('Second project transcript').count(), 0,
      'late stale project chat response does not replace the selected chat');
    assert.deepEqual(errors, []);
    console.log('PASS full-area loading, recent project and worker chats appear before revalidation, and stale reads do not replace selection');
  } finally {
    releaseSecond(); releaseFirst(); releaseWorker(); releaseSecondStale();
    await browser.close();
    await f.close();
  }
});
