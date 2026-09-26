import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const f = await localDataFixture();
const todos = [
  { content: 'Review campaign references', status: 'in_progress', priority: 'high' },
  { content: 'Save draft', status: 'pending', priority: 'medium' },
];
f.state.todos.ses_history = structuredClone(todos);
f.state.messages.ses_history = [
  { info: { id: 'user', role: 'user' }, parts: [{ type: 'text', text: 'Draft a monster' }] },
  { info: { id: 'assistant', role: 'assistant', parentID: 'user', finish: 'stop', time: { completed: Date.now() } }, parts: [
    { id: 'shell', type: 'tool', tool: 'bash', state: { status: 'completed',
      input: { command: 'python -m dnd search monster' }, metadata: { exit: 1 }, output: 'Missing dependency' } },
    { id: 'reply', type: 'text', text: 'Here is an unverified draft.' },
  ] },
];
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(12000);
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
  await page.getByText('Response ended with unfinished tasks. Send a follow-up to continue.', { exact: true }).waitFor();
  await page.locator('.request-dock').getByText(/Response ended · 1 tool failed/).waitFor();
  assert.equal(await page.locator('.todo-dock-list .spin').count(), 0);
  assert.equal(await page.locator('.todo-dock-list').getByText('unfinished', { exact: true }).count(), 1);
  await page.locator('.request-dock .request-working > summary').click();
  await page.locator('.request-dock .tool-card.error').getByText('Failed', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isEnabled(), false);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Continue the unfinished tasks');
  assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isEnabled(), true);

  f.state.status.ses_history = { type: 'busy' };
  delete f.state.messages.ses_history[1].info.finish;
  delete f.state.messages.ses_history[1].info.time.completed;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('.todo-dock-list .spin').waitFor();
  assert.equal(await page.getByText('Response ended with unfinished tasks. Send a follow-up to continue.', { exact: true }).count(), 0);
  delete f.state.status.ses_history;
  f.state.messages.ses_history[1].info.finish = 'stop';
  f.state.messages.ses_history[1].info.time.completed = Date.now();
  f.state.messages.ses_history[1].parts[0].state.metadata.exit = 0;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('.request-dock').getByText(/Response ended · Tasks unfinished/).waitFor();
  assert.deepEqual(f.state.todos.ses_history, todos, 'presentation never rewrites native task records');

  await f.store.update('settings', s => ({ ...s, appearance: { ...s.appearance, todoLayout: 'inline' } }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('button', { name: 'tasks', exact: true }).click();
  await page.locator('.work-details').getByText('unfinished', { exact: true }).waitFor();
  await page.locator('.work-details').getByText('Response ended with unfinished tasks. Send a follow-up to continue.', { exact: true }).waitFor();
  console.log('PASS command failure, unfinished tasks, idle/busy transition, both task placements, sender remains usable');
} finally { await browser.close(); await f.close(); }
