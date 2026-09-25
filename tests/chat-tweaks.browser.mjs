import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const f = await localDataFixture();
f.state.messages.ses_history = [
  { info: { id: 'msg_user', role: 'user' }, parts: [{ id: 'prt_user', type: 'text', text: 'Review the work' }] },
  { info: { id: 'msg_parent', role: 'assistant' }, parts: [{ id: 'prt_agent', type: 'tool', tool: 'delegate',
    state: { status: 'completed', input: { agentID: 'engineer' }, metadata: { sessionId: 'ses_worker', agentName: 'Engineer' } } }] },
];
f.state.messages.ses_worker = [
  { info: { id: 'msg_worker_user', role: 'user' }, parts: [{ id: 'prt_worker_user', type: 'text', text: 'Inspect the code' }] },
  { info: { id: 'msg_worker_reply', role: 'assistant' }, parts: [
    { id: 'prt_reason', type: 'reasoning', text: 'Read the relevant file first.' },
    { id: 'prt_command', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'sample.ts' }, output: 'File contents' } },
  ] },
];
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
let releaseChat;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(12000);
  const chatGate = new Promise(resolve => { releaseChat = resolve; });
  await page.goto(f.url);
  await page.route('**/api/chat**', async route => { await chatGate; await route.continue(); });
  const settings = page.locator('.usage-dock .settings-drawers');
  const usage = page.locator('.usage-dock .usage-sidebar');
  await settings.waitFor(); await usage.waitFor();
  const settingsBounds = await settings.boundingBox(), usageBounds = await usage.boundingBox();
  assert.ok(settingsBounds && usageBounds && settingsBounds.y + settingsBounds.height <= usageBounds.y,
    'usage estimate appears below settings in navigation');
  await usage.getByRole('button', { name: /Show provider availability/ }).click();
  await usage.getByRole('button', { name: /Hide provider availability/ }).waitFor();

  const chats = page.locator('.chat-navigation');
  await chats.getByRole('button', { name: 'Chats' }).click();
  await chats.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
  const cover = page.locator('.composer-loading');
  await cover.waitFor({ state: 'visible' });
  const coverBox = await cover.boundingBox(), wrapBox = await page.locator('.composer-wrap').boundingBox();
  assert.ok(coverBox && wrapBox && Math.abs(coverBox.y + coverBox.height - wrapBox.y - wrapBox.height) < 2,
    'loading cover reaches the composer bottom');
  assert.equal(await cover.evaluate(e => getComputedStyle(e).borderBottomLeftRadius), '0px');
  releaseChat();
  await cover.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => {
    const input = document.querySelector('.composer textarea');
    return input && !input.disabled;
  });
  await page.locator('.request-working').last().locator('summary').first().click();
  await page.getByRole('button', { name: /Agent finished: Engineer/ }).click();
  const work = page.locator('.request-working').last();
  await work.locator('summary').first().click();
  const prose = page.locator('.message.assistant').last();
  await prose.getByText('Read the relevant file first.').waitFor();
  assert.equal(await work.getByText('Read the relevant file first.').count(), 0,
    'reasoning prose stays with the assistant response');
  assert.equal(await work.locator('details.reasoning').count(), 0);
  assert.equal(await work.locator('.tool-card').count(), 1,
    'the work card contains the tool call');
  console.log('PASS usage below settings; reasoning prose stays in chat and tool calls stay in work card');
} finally { releaseChat?.(); await browser.close(); await f.close(); }
