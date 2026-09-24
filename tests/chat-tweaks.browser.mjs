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
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(12000);
  await page.goto(f.url);
  const settings = page.locator('.usage-dock .settings-drawers');
  const usage = page.locator('.usage-dock .usage-sidebar');
  await settings.waitFor(); await usage.waitFor();
  const settingsBounds = await settings.boundingBox(), usageBounds = await usage.boundingBox();
  assert.ok(settingsBounds && usageBounds && settingsBounds.y + settingsBounds.height <= usageBounds.y,
    'usage estimate appears below settings in navigation');
  await usage.getByRole('button', { name: /Show provider availability/ }).click();
  await usage.getByRole('button', { name: /Hide provider availability/ }).waitFor();

  await page.locator('.sidebar .sessions').getByRole('button', { name: /Important conversation/ }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('.composer textarea');
    return input && !input.disabled;
  });
  await page.locator('.request-working').last().locator('summary').first().click();
  await page.getByRole('button', { name: /Agent finished: Engineer/ }).click();
  const work = page.locator('.request-working').last();
  await work.locator('summary').first().click();
  const thought = work.locator('.reasoning-text');
  await thought.getByText('Read the relevant file first.').waitFor();
  assert.equal(await work.locator('details.reasoning').count(), 0);
  const thoughtBounds = await thought.boundingBox(), commandBounds = await work.locator('.tool-card').boundingBox();
  assert.ok(thoughtBounds && commandBounds && thoughtBounds.y < commandBounds.y,
    'worker thought is visible above its command card');
  console.log('PASS usage below settings; worker thoughts visible before command cards');
} finally { await browser.close(); await f.close(); }
