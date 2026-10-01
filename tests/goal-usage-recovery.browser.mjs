import { test, expect } from './support/browser-test.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { usageFixture } from './fixtures/usage-app.mjs';

test('goal overlay resumes a settled interruption and keeps a long objective behind disclosure', { tag: ['@app', '@chat'] }, async ({ appBrowser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  const goal = await f.goals.create(f.project.id, { id: 'goal_recovery_ui_01', title: 'Continue the saved plan', objective: 'Preserve and verify the plan. '.repeat(4000), settings: { model: 'opencode/free' } });
  await f.goals.start(f.project.id, goal.id); await f.sender.tick();
  f.state.messages[goal.session][0].info.time.created -= 4000;
  delete f.state.status[goal.session]; await f.sender.tick();
  await f.store.update('goals', d => ({ ...d, records: { ...d.records, [goal.id]: { ...d.records[goal.id], status: 'paused', reason: 'Server restarted. Resume the saved work.' } } }));
  const page = await appBrowser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: goal.title }).click();
  await page.getByRole('button', { name: /^Goals / }).click();
  const pane = page.getByRole('region', { name: 'Goals view', exact: true });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(pane.getByRole('button', { name: 'Resume goal', exact: true })).toBeVisible();
    await expect(pane.getByRole('region', { name: 'Goal objective', exact: true })).not.toBeVisible();
    await pane.getByText('Objective', { exact: true }).click();
    const objective = pane.getByRole('region', { name: 'Goal objective', exact: true });
    expect((await objective.boundingBox()).height).toBeLessThanOrEqual(220);
    expect(await objective.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await pane.getByText('Objective', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/goal-card-${width}.png` });
  }
  await pane.getByRole('button', { name: 'Resume goal', exact: true }).click();
  await expect(pane.getByRole('region', { name: 'Current goal', exact: true })).toContainText('Running');
  await f.sender.tick();
  expect(f.calls.filter(c => c.route.endsWith('prompt_async'))).toHaveLength(2);
  expect((await f.goals.list(f.project.id))[0].session).toBe(goal.session);
});

test('one expired provider reports its own reconnect action while other usage remains connected', { tag: ['@app'] }, async ({ appBrowser, own }) => {
  const f = await own(usageFixture());
  f.raw().surfaces['openai-oauth'].telemetry = { status: 'auth-failed', source: 'sanitized-test', as_of: new Date().toISOString() };
  const page = await appBrowser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(f.url);
  await page.getByRole('button', { name: /Show provider availability/ }).click();
  const usage = page.getByRole('region', { name: 'Available usage', exact: true });
  await expect(usage).toContainText('OpenAI: Reconnect to refresh usage');
  await expect(usage.locator('.usage-provider-row').filter({ hasText: 'GitHub Copilot' })).toContainText('60%');
  await expect(usage.getByText('Refresh failed', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/usage-provider-reconnect.png' });
  await usage.getByRole('button', { name: 'Reconnect provider', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Providers', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'OpenAI settings', exact: true }).getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
});
