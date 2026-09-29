import { test, expect } from './support/browser-test.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

test('agent panels retain readable identities, statuses and expanded tools at every width', { tag: ['@app', '@chat'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  const name = 'EngineerForAnUnbrokenAndVeryLongProjectName'.repeat(3);
  const model = `opencode/${'long-model-identifier-'.repeat(8)}`;
  const path = `src/${'unbroken-file-name'.repeat(20)}.tsx`;
  const nativeChat = f.app.chat.bind(f.app);
  const phases = ['selection_required', 'working', 'completed', 'failed', 'awaiting_paid_permission', 'delegation_unavailable'];
  f.app.chat = async (...args) => ({ ...await nativeChat(...args), activity: phases.map((phase, i) => ({
    id: `activity-${i}`, agentName: `${name} ${i}`, selected: model, phase, completedTools: 12345,
    ...(i > 0 && i < 5 ? { child: i === 1 ? 'ses_worker' : `ses_worker_${i}` } : {}),
    raw: { routing_diagnostics: { reasons: ['unavailable-model-with-long-identifier-'.repeat(8)] } },
  })) });
  await f.store.update('settings', settings => ({ ...settings, appearance: { ...settings.appearance, panelWidths: { navigation: 244, details: 260 } } }));
  f.state.messages.ses_history = [
    { info: { id: 'request', role: 'user' }, parts: [{ type: 'text', text: 'Inspect the worker states' }] },
    { info: { id: 'reply', role: 'assistant' }, parts: [
      { id: 'dispatch', callID: 'dispatch', type: 'tool', tool: 'delegate', state: { status: 'completed', input: { agent: 'engineer' }, metadata: { sessionId: 'ses_worker', agentName: name, selected_model: model, freelancer_status: 'completed' } } },
      // A continuation receives its metadata after dispatch. The same worker
      // must keep its existing name/model while that update is in flight.
      { id: 'continue', callID: 'continue', type: 'tool', tool: 'delegate', state: { status: 'running', input: { worker: 'ses_worker', task: 'Check one more edge case' }, metadata: {} } },
      ...['completed', 'failed'].map((status, i) => ({ id: `worker-${status}`, type: 'tool', tool: 'delegate', state: { status: 'completed', input: { agent: 'engineer' }, metadata: { sessionId: `ses_${status}`, agentName: `${name} ${i}`, selected_model: model, freelancer_status: status } } })),
      { id: 'read', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: path }, output: 'UNBROKEN_TOOL_OUTPUT'.repeat(80) } },
      { id: 'catalog', type: 'tool', tool: 'delegate', state: { status: 'completed', input: {}, output: JSON.stringify({ status: 'catalog', agents: [{ id: 'engineer', name }] }), metadata: { freelancer_status: 'catalog' } } },
      { id: 'refusal', type: 'tool', tool: 'delegate', state: { status: 'completed', title: 'Waiting for worker', input: { worker: 'ses_worker', task: 'Continue again' }, output: JSON.stringify({ status: 'conflict', reason: 'This worker is already busy. Wait before continuing it.' }), metadata: { freelancer_status: 'conflict' } } },
    ] },
  ];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let releaseChat;
  const chatGate = new Promise(resolve => { releaseChat = resolve; });
  try {
    await page.goto(f.url);
    await page.route('**/api/chat**', async route => { await chatGate; await route.continue(); });
    await page.locator('.chat-navigation').getByRole('button', { name: 'Chats', exact: true }).click();
    await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
    await expect(page.locator('.chat-loading-stage')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.chat-loading-stage')).toBeVisible();
    expect(await page.locator('.chat-loading-stage').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    releaseChat();
    await expect(page.locator('.chat-loading-stage')).toHaveCount(0);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const details = page.locator('.work-details');
    await expect(details.locator('.activity-detail-card')).toHaveCount(phases.length);
    for (const width of [390, 760, 1440]) {
      await test.step(`Details cards fit at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 });
        for (const text of ['Choosing a model', 'Working', 'Finished', 'Stopped', 'Needs your approval', 'Route unavailable']) {
          await expect(details.getByText(text, { exact: true })).toBeVisible();
        }
        const overflow = await details.evaluate(root => [...root.querySelectorAll('.activity-detail-card, .activity-detail-toggle, .activity-detail-title, .activity-detail-status, .activity-detail-model, .activity-route-note')]
          .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className));
        expect(overflow, 'Activity contents fit their grid and flex containers').toEqual([]);
        expect(await details.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await expect(details.locator('.activity-detail-title strong').first()).toHaveText(`${name} 0`);
      });
    }
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const work = page.locator('.request-working').last();
    await expect(work).not.toHaveAttribute('open');
    await work.locator('summary').first().click();
    await expect(work.locator('.agent-card')).toHaveCount(3);
    await expect(work.getByRole('button', { name: `Agent working: ${name} · ${model} · Open conversation`, exact: true })).toBeVisible();
    const catalog = work.locator('.tool-card').filter({ hasText: 'Inspect agent catalog' });
    await expect(catalog).not.toHaveAttribute('open');
    await catalog.locator('summary').click();
    await expect(catalog.locator('pre')).toContainText('"engineer"');
    await catalog.locator('summary').click();
    const refusal = work.locator('.tool-card').filter({ hasText: 'Waiting for worker' });
    await refusal.locator('summary').click();
    await expect(refusal.locator('pre')).toContainText('This worker is already busy. Wait before continuing it.');
    const tool = work.locator('.tool-card').filter({ hasText: `Read ${path.slice(4)}` });
    await expect(tool).not.toHaveAttribute('open');
    await tool.locator('summary').click();
    await expect(tool.getByText(path, { exact: true })).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await work.evaluate(root => [...root.querySelectorAll('.agent-card, .agent-card-copy, .tool-card, .tool-card summary, .tool-card > p')]
        .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className || node.tagName));
      expect(overflow, `Expanded worker/tool cards fit at ${width}px`).toEqual([]);
      expect(await tool.locator('pre').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
      expect(await tool.locator('pre').evaluate(node => getComputedStyle(node).overflowX)).toBe('auto');
    }
    await tool.locator('summary').click();
    await expect(tool.locator('pre')).toHaveCount(0);
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    await details.getByRole('tab', { name: 'changes', exact: true }).click();
    await expect(details).toBeVisible();
    await details.getByRole('tab', { name: 'activity', exact: true }).click();
    await details.locator('.activity-summary-button').filter({ hasText: `${name} 1` }).click();
    await expect(page.locator('.topbar').getByText('Linked worker', { exact: true })).toBeVisible();
    await expect(details).toHaveCount(0);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const topbar = page.locator('.topbar');
      const title = topbar.getByText('Linked worker', { exact: true });
      await expect(title).toBeVisible();
      await expect(title).toHaveAttribute('title', 'Linked worker');
      for (const name of ['Back to parent chat', 'Details']) {
        const control = topbar.getByRole('button', { name, exact: true });
        await expect(control).toBeVisible();
        await expect(control).toHaveAttribute('title', name);
        await expect(control.locator('svg')).toBeVisible();
        await expect(control.locator('span')).toBeHidden();
      }
      const geometry = await topbar.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const title = node.querySelector('strong').getBoundingClientRect();
        const controls = [...node.querySelectorAll('.topbar-right button')].map(button => {
          const box = button.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, overflows: button.scrollWidth > button.clientWidth + 1 };
        });
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, titleWidth: title.width, titleRight: title.right, controls, overflows: node.scrollWidth > node.clientWidth + 1 };
      });
      expect(geometry.titleWidth, `Child title retains readable space at ${width}px`).toBeGreaterThanOrEqual(80);
      expect(geometry.titleRight).toBeLessThanOrEqual(geometry.controls[0].left - 1);
      expect(geometry.overflows).toBe(false);
      for (const control of geometry.controls) {
        expect(control.width).toBeGreaterThanOrEqual(32);
        expect(control.height).toBeGreaterThanOrEqual(36);
        expect(control.left).toBeGreaterThanOrEqual(geometry.left);
        expect(control.right).toBeLessThanOrEqual(geometry.right);
        expect(control.top).toBeGreaterThanOrEqual(geometry.top);
        expect(control.bottom).toBeLessThanOrEqual(geometry.bottom);
        expect(control.overflows).toBe(false);
      }
    }
    await page.getByRole('button', { name: 'Back to parent chat', exact: true }).click();
    await expect(page.locator('.topbar').getByText('Important conversation', { exact: true })).toBeVisible();
    await expect(page.locator('.chat-transcript').getByText('Inspect the worker states', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to parent chat', exact: true })).toHaveCount(0);
    await expect(details).toHaveCount(0);
  } finally { releaseChat(); await browser.close(); }
});
