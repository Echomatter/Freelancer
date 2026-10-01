import { test, expect } from './support/browser-test.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

test('model chart, agent chat reports and project file diffs stay separate and fit mobile', { tag: ['@app', '@chat'] }, async ({ appBrowser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  f.state.messages.ses_history = [
    { info: { id: 'request', role: 'user' }, parts: [{ type: 'text', text: 'Review the implementation' }] },
    { info: { id: 'reply', parentID: 'request', role: 'assistant', providerID: 'opencode', modelID: 'free' }, parts: [
      { id: 'edit', type: 'tool', tool: 'edit', state: { status: 'completed', input: { filePath: 'source.txt' }, output: 'Updated source.', metadata: { diff: '--- a/source.txt\n+++ b/source.txt\n-old\n+new' } } },
      { id: 'worker', type: 'tool', tool: 'delegate', state: { status: 'completed', input: { agent: 'engineer', task: 'Inspect source' }, metadata: { sessionId: 'ses_worker', agentName: 'Engineer', selected_model: 'opencode/free', freelancer_status: 'completed' } } },
    ] },
  ];
  f.state.messages.ses_worker = [
    { info: { id: 'worker-request', role: 'user' }, parts: [{ type: 'text', text: 'Inspect source and report the edge cases' }] },
    { info: { id: 'worker-steer', role: 'user' }, parts: [{ type: 'text', text: '[Freelancer Steer handoff abc123]\nInclude the missing edge case' }] },
    { info: { id: 'worker-reply', parentID: 'worker-request', role: 'assistant', time: { completed: 10 }, finish: 'stop' }, parts: [{ type: 'text', text: 'Agent report: source edge cases verified.' }] },
  ];
  const bootstrap = f.app.bootstrap.bind(f.app);
  f.app.bootstrap = async (...args) => {
    const data = await bootstrap(...args);
    data.costs.contributions.chats = [{ sessionID: 'ses_history', month: '2026-09', models: { hasActivity: true, partial: true, rows: [
      { id: 'opencode/free', name: 'Free model', providerID: 'opencode', sharePercent: 70 },
      { id: 'openai/model', name: 'Other model', providerID: 'openai', sharePercent: 30, partial: true },
    ] } }];
    return data;
  };
  const page = await appBrowser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Preserved draft');
  await page.getByRole('button', { name: /^Commands / }).click();
  await page.locator('.tool-card summary').click();
  await expect(page.getByRole('region', { name: 'Commands view' })).toContainText('Updated source.');
  await expect(page.locator('.chat-tool-overlay .diff, .chat-tool-overlay .file-diff')).toHaveCount(0);
  await page.getByRole('button', { name: /^Models / }).click();
  const chart = page.getByRole('region', { name: 'Work by models', exact: true });
  await expect(chart).toContainText('70%');
  await expect(chart).toContainText('30%');
  await expect(chart).toContainText('Some activity is unavailable');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(chart).toBeVisible();
    expect(await chart.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  }
  await page.getByRole('button', { name: /^Agents / }).click();
  const agents = page.getByRole('region', { name: 'Agents view' });
  await expect(agents.locator('.agent-status-card')).toContainText('Finished');
  await expect(agents.locator('.handoff-card, .agent-turn-report')).toHaveCount(0);
  await agents.getByRole('button', { name: /Engineer.*Open conversation/ }).click();
  await page.locator('.chat-transcript .assignment-card summary').click();
  await expect(page.locator('.chat-transcript').getByText('Inspect source and report the edge cases', { exact: true })).toBeVisible();
  await page.locator('.chat-transcript summary').filter({ hasText: 'Steer request' }).click();
  await expect(page.locator('.chat-transcript').getByText('Include the missing edge case', { exact: true })).toBeVisible();
  await page.locator('.chat-transcript summary').filter({ hasText: 'Handoff · Agent report' }).click();
  await expect(page.locator('.chat-transcript').getByText('Agent report: source edge cases verified.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Agents / }).click();
  await page.getByRole('button', { name: 'Back to parent chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Preserved draft');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Models / }).click();
  await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  const changes = page.getByRole('region', { name: 'File changes' });
  await expect(changes).toContainText('Important conversation');
  await changes.locator('summary').filter({ hasText: 'source.txt' }).click();
  await expect(changes.locator('.diff')).toContainText('+new');
  await expect(changes).toContainText('Chat record');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/project-file-diffs-${width}.png` });
  }
});
