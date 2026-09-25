import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const f = await localDataFixture();
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
];
f.state.messages.ses_second = [
  { info: { id: 'second-user', role: 'user' }, parts: [{ id: 'second-text', type: 'text', text: 'Second project transcript' }] },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let holdSecond = false, holdFirst = false;
let releaseSecond, releaseFirst;
const secondGate = new Promise(resolve => { releaseSecond = resolve; });
const firstGate = new Promise(resolve => { releaseFirst = resolve; });
let firstRevalidationFinished = false;

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

try {
  await page.route('**/api/chat?**', async route => {
    const url = new URL(route.request().url());
    const selected = url.searchParams.get('session');
    if (holdSecond && selected === 'ses_second') await secondGate;
    if (holdFirst && selected === 'ses_history') {
      await firstGate;
      await route.continue();
      firstRevalidationFinished = true;
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
  assert.deepEqual(errors, []);
  console.log('PASS full-area loading and recent cross-project chat appears before revalidation, then refreshes live state');
} finally {
  releaseSecond(); releaseFirst();
  await browser.close();
  await f.close();
}
