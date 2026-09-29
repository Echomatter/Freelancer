import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('stalled project reads recover without stopping native work', { tag: ['@app', '@chat'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  const directory = path.join(f.root, 'second-project');
  await mkdir(directory);
  const second = { id: 'second_project', name: 'Second project', directory };
  await f.store.update('settings', s => ({ ...s, projects: [f.project, second] }));
  f.state.status.ses_history = { type: 'busy' };
  f.state.messages.ses_history = [
    { info: { id: 'live-user', role: 'user' }, parts: [{ type: 'text', text: 'Keep this work running' }] },
  ];
  const events = [];
  f.host.events = async function* (_, signal) {
    while (!signal.aborted) {
      if (events.length) yield events.splice(0).map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
      try { await delay(30, undefined, { signal }); } catch { return; }
    }
  };
  const page = await browser.newPage();
  await page.goto(f.url);
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
  await expect(page.getByText('Keep this work running', { exact: true })).toBeVisible();
  const projects = page.locator('.project-navigation');
  await projects.locator('.nav-card-trigger').click();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let block = true;
  await page.route('**/api/bootstrap?**', async route => {
    if (block && new URL(route.request().url()).searchParams.get('project') === second.id) await held;
    await route.continue().catch(() => {});
  });
  try {
    await projects.getByRole('button', { name: 'Second project', exact: true }).click();
    await expect(page.locator('.chat-loading-stage')).toContainText('Opening Second project');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    f.state.messages.ses_history.push({ info: { id: 'live-assistant', role: 'assistant', parentID: 'live-user' },
      parts: [{ type: 'text', text: 'Live update during project opening' }] });
    events.push({ type: 'message.part.updated', properties: { part: { sessionID: 'ses_history' } } });
    // Exercise the real browser deadline, including a request that never answers.
    await expect(page.getByRole('alert').filter({ hasText: 'Loading took too long' })).toBeVisible({ timeout: 35000 });
    await expect(page.locator('.chat-loading-stage')).toHaveCount(0);
    await expect(page.getByText('Live update during project opening', { exact: true })).toBeVisible();
    await expect(projects.getByRole('button', { name: 'Second project', exact: true })).toBeEnabled();
    expect(f.state.status.ses_history.type).toBe('busy');
    block = false;
    release();
    await projects.getByRole('button', { name: 'Second project', exact: true }).click();
    await expect(projects.locator('.nav-card-trigger')).toHaveAccessibleName('Second project');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(f.state.status.ses_history.type).toBe('busy');
  } finally { release(); }
});
