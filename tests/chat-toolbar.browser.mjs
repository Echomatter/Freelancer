import { test, expect } from './support/browser-test.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

test('Commands excludes native recap blocks and tasks while the transcript and composer retain them', { tag: ['@app', '@chat'] }, async ({ appBrowser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  await f.store.update('settings', value => ({ ...value, appearance: { ...value.appearance, todoLayout: 'inline' } }));
  f.state.messages.ses_history = [
    { info: { id: 'request', role: 'user' }, parts: [{ type: 'text', text: 'Review the Alpha Packer project.' }] },
    { info: { id: 'recap', parentID: 'request', role: 'assistant', summary: true }, parts: [{ type: 'text', text: '## Objective\nKeep the full Alpha Packer review summary available.' }] },
    { info: { id: 'reply', parentID: 'request', role: 'assistant' }, parts: [
      { id: 'read', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'project.py' }, output: 'Read the project source.' } },
      { id: 'response', type: 'text', text: 'The review response stays in the transcript.' },
    ] },
  ];
  f.state.todos.ses_history = [{ id: 'review-task', content: 'Review the packaging workflow', status: 'pending' }];
  const page = await appBrowser.newPage({ viewport: { width: 1440, height: 960 } });
  try {
    await page.goto(f.url);
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
    const recap = page.locator('.chat-transcript .reasoning').filter({ hasText: 'Conversation recap' });
    await expect(recap).toHaveCount(1);
    await recap.locator('summary').click();
    await expect(recap).toContainText('Keep the full Alpha Packer review summary available.');
    await expect(page.locator('.chat-transcript')).toContainText('The review response stays in the transcript.');
    const tasks = page.locator('.composer-cards .work-card').filter({ hasText: 'Tasks' });
    await expect(tasks).toHaveCount(1);
    await tasks.locator('.work-card-toggle').click();
    await expect(tasks).toContainText('Review the packaging workflow');
    await page.getByRole('button', { name: /^Commands / }).click();
    const commands = page.getByRole('region', { name: 'Commands view', exact: true });
    await expect(commands.locator('.tool-card')).toHaveCount(1);
    await expect(commands.locator('.reasoning, .todo')).toHaveCount(0);
    await expect(commands).not.toContainText('Keep the full Alpha Packer review summary available.');
    await expect(commands).not.toContainText('The review response stays in the transcript.');
    await expect(commands).not.toContainText('Review the packaging workflow');
    await expect(commands).not.toContainText('Response ended');
    await commands.locator('.tool-card summary').click();
    await expect(commands).toContainText('Read the project source.');
    await page.screenshot({ path: 'artifacts/commands-only-transcript.png' });
  } finally { await appBrowser.close(); }
});

test('one chat toolbar overlays commands, agents, models and goal handoffs at desktop and phone widths', { tag: ['@app', '@chat'] }, async ({ appBrowser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  const goal = await f.goals.create(f.project.id, { id: 'toolbar_goal_0001', title: 'Verify the workspace', objective: 'Keep the plan and inspect handoffs.', settings: { model: 'opencode/free' } });
  await f.goals.start(f.project.id, goal.id); await f.sender.tick();
  const user = f.state.messages[goal.session][0];
  f.state.messages[goal.session].push({ info: { id: 'reply', parentID: user.info.id, role: 'assistant', agent: 'engineer', providerID: 'opencode', modelID: 'free', time: { created: Date.now() } }, parts: [
    { id: 'text', type: 'text', text: 'Reviewing the database migration and preserving the plan.' },
    { id: 'read', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'server/store.mjs' }, output: 'Verified persistent data.' } },
    { id: 'working', type: 'tool', tool: 'bash', state: { status: 'running', input: { description: 'Validate migration' } } },
    { id: 'worker', type: 'tool', tool: 'delegate', state: { status: 'completed', input: { agentID: 'engineer', task: 'Inspect first turn migration' }, output: JSON.stringify({ worker_result: { summary: 'First turn findings preserved', validationStatus: 'unverified', evidence: ['Read migration source'] } }), metadata: { sessionId: 'ses_worker', agentName: 'Engineer', freelancer_status: 'completed', selected_model: 'opencode/free' } } },
  ] });
  const native = f.app.chat.bind(f.app);
  let workerPhase = 'tool';
  f.app.chat = async (...args) => ({ ...await native(...args), activity: [{ id: 'worker', child: 'ses_worker', agentName: 'Engineer', phase: workerPhase, tool: 'read', subject: 'migration.mjs', elapsedMs: 12000, selected: 'opencode/free', completedTools: 2 }] });
  await f.store.update('goals', d => ({ ...d, records: { ...d.records, [goal.id]: { ...d.records[goal.id], events: [{ at: Date.now(), kind: 'model', detail: 'opencode/limited → opencode/free' }] } } }));
  const page = await appBrowser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('**/api/index/jobs', route => route.fulfill({ json: { job: null } }));
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: goal.title }).click();
  await expect(page.locator('.chat-toolbar-tabs button')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Details', exact: true })).toHaveCount(0);
  await expect(page.locator('.workspace-breadcrumb')).toHaveCount(0);
  for (const section of ['Commands', 'Agents', 'Goals']) await expect(page.getByRole('button', { name: new RegExp(`^${section} `) }).locator('.tool-working')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Models / }).locator('.tool-working')).toHaveCount(0);
  await expect(page.locator('.chat-transcript .agent-card, .chat-transcript .handoff-card')).toHaveCount(0);
  for (const section of ['agents', 'models', 'goals']) await expect(page.getByRole('button', { name: `Open ${section} for turn 1`, exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this draft while inspecting');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 800 && await page.getByRole('button', { name: 'Hide navigation', exact: true }).isVisible()) await page.getByRole('button', { name: 'Hide navigation', exact: true }).click();
    const transcript = await page.locator('.chat-scroll').boundingBox();
    const sizes = await page.locator('.chat-toolbar-tabs button').evaluateAll(buttons => buttons.map(b => b.getBoundingClientRect().width));
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(1);
    const topbar = await page.locator('.topbar').boundingBox();
    expect(topbar.height).toBeLessThan(55);
    const refresh = await page.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
    const tab = await page.locator('.chat-toolbar-tabs button').first().boundingBox();
    const toggle = await page.locator('.navigation-layout-toggle').boundingBox();
    expect(toggle.x + toggle.width).toBeLessThanOrEqual(tab.x);
    expect(Math.abs((refresh.y + refresh.height / 2) - (tab.y + tab.height / 2))).toBeLessThan(2);
    expect((await page.getByLabel('Turn 1 activity', { exact: true }).boundingBox()).height).toBeLessThan(100);
    expect((await page.getByRole('button', { name: 'Open agents for turn 1', exact: true }).boundingBox()).height).toBeLessThan(30);
    // A collapsed navigation rail leaves less space than the viewport width.
    // Check each visible label, icon and stat stays inside its own equal tab.
    expect(await page.locator('.chat-toolbar-tabs button').evaluateAll(buttons => buttons.every(button => {
      const bounds = button.getBoundingClientRect();
      return [...button.children].every(child => { const box = child.getBoundingClientRect(); return !box.width || (box.left >= bounds.left && box.right <= bounds.right); });
    }))).toBe(true);
    for (const section of ['Commands', 'Agents', 'Models', 'Goals']) {
      await page.locator('.chat-toolbar-tabs button').filter({ hasText: section }).click();
      const panel = page.getByRole('region', { name: `${section} view`, exact: true });
      await expect(panel).toBeVisible();
      await expect(page.locator('.chat-tool-overlay')).toHaveCount(1);
      const rect = await panel.boundingBox(), header = await page.locator('.topbar').boundingBox();
      expect(Math.abs(rect.y - header.y - header.height)).toBeLessThan(2);
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect((await page.locator('.chat-scroll').boundingBox()).y).toEqual(transcript.y);
      if (section === 'Commands') {
        await expect(panel.locator('.agent-card, .agent-turn-entry')).toHaveCount(0);
        await panel.locator('.tool-card').filter({ hasText: 'Read store.mjs' }).locator('summary').click();
        await expect(panel).toContainText('Verified persistent data.');
      } else if (section === 'Agents') {
        const worker = panel.locator('.agent-turn-entry');
        await expect(worker).toContainText('Engineer');
        await expect(worker.locator('.agent-status-card')).toBeVisible();
        await expect(worker).toContainText('Working');
        await expect(worker).toContainText('read · migration.mjs');
        await expect(worker).toContainText('2 actions · 12s');
        await expect(worker.locator('.handoff-card, .agent-turn-report')).toHaveCount(0);
      }
      else if (section === 'Models') { await expect(panel).toContainText('opencode/free'); await expect(panel.getByRole('region', { name: 'Work by models' })).toBeVisible(); }
      else await expect(panel).toContainText('opencode/limited → opencode/free');
      await page.screenshot({ path: `artifacts/toolbar-${section.toLowerCase()}-${width}.png` });
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.chat-tool-overlay')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this draft while inspecting');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  workerPhase = 'completed';
  f.state.messages[goal.session].push(
    { info: { id: 'later_user', role: 'user', time: { created: Date.now() + 1000 } }, parts: [{ type: 'text', text: 'A separate second turn' }] },
    { info: { id: 'later_reply', role: 'assistant', parentID: 'later_user', providerID: 'opencode', modelID: 'second-model', time: { created: Date.now() + 1001 } }, parts: [{ type: 'text', text: 'Second turn response' }] },
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open models for turn 2', exact: true })).toBeVisible();
  for (const section of ['agents', 'models', 'goals']) {
    await page.getByRole('button', { name: `Open ${section} for turn 1`, exact: true }).click();
    const panel = page.getByRole('region', { name: `${section[0].toUpperCase() + section.slice(1)} view`, exact: true });
    await expect(panel).toContainText('Reviewing turn 1');
    await expect(page.locator('.chat-toolbar-tabs .tool-working')).toHaveCount(0);
    if (section !== 'Models') await expect(panel).not.toContainText('second-model');
    if (section === 'agents') await expect(panel).toContainText('Engineer');
    if (section === 'models') await expect(panel).toContainText('opencode/free');
    if (section === 'goals') await expect(panel).toContainText('Model handoff');
    await page.getByRole('button', { name: 'Close chat tools', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Open models for turn 2', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Models view', exact: true })).toContainText('second-model');
  f.app.chat = async (...args) => ({ ...await native(...args), activity: [
    { id: 'older', child: 'ses_worker', requestID: user.info.id, agentName: 'Earlier engineer', phase: 'completed', raw: { created_at: '2026-10-01T01:00:00Z' } },
    { id: 'newer', child: 'ses_new_worker', requestID: 'later_user', agentName: 'Latest engineer', phase: 'working', raw: { created_at: '2026-10-01T02:00:00Z' } },
  ] });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.locator('.chat-toolbar-tabs button').filter({ hasText: 'Agents' }).click();
  const agents = page.getByRole('region', { name: 'Agents view', exact: true });
  await expect(agents.getByRole('button', { name: 'This turn (1)', exact: true })).toBeVisible();
  await expect(agents.locator('.agent-status-card')).toHaveCount(1);
  await agents.getByRole('button', { name: 'This chat (2)', exact: true }).click();
  await expect(agents.locator('.agent-status-card')).toHaveCount(2);
  await expect(agents.locator('.agent-status-card').first()).toContainText('Latest engineer');
  await expect(agents.locator('.agent-status-card').last()).toContainText('Earlier engineer');
});
