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
    id: `activity-${i}`, requestID: 'request', agentName: `${name} ${i}`, selected: model, phase, completedTools: 12345,
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
    await page.getByRole('button', { name: /^Agents / }).click();
    const details = page.locator('.chat-tool-overlay');
    await expect(details.locator('.agent-status-card')).toHaveCount(phases.length + 3);
    for (const width of [390, 760, 1440]) {
      await test.step(`Details cards fit at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 });
        for (const text of ['Choosing a model', 'Working', 'Finished', 'Stopped', 'Needs your approval', 'Route unavailable']) {
          await expect(details.getByText(text, { exact: true }).first()).toBeVisible();
        }
        const overflow = await details.evaluate(root => [...root.querySelectorAll('.agent-status-card, .agent-card-copy, .agent-status-label')]
          .filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className));
        expect(overflow, 'Activity contents fit their grid and flex containers').toEqual([]);
        expect(await details.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await expect(details.locator('.agent-card-copy strong').first()).toHaveText(`${name} 0`);
      });
    }
    const work = page.locator('.chat-tool-overlay');
    await expect(work.locator('.agent-card')).toHaveCount(phases.length + 3);
    await expect(work.locator('.handoff-card, .agent-turn-report')).toHaveCount(0);
    await expect(work).toContainText('Inspect agent catalog');
    await expect(work).toContainText('This worker is already busy. Wait before continuing it.');
    await page.getByRole('button', { name: /^Commands / }).click();
    await expect(work.locator('.agent-card, .activity-detail-card')).toHaveCount(0);
    await expect(work).not.toContainText('Inspect agent catalog');
    await expect(work).not.toContainText('Waiting for worker');
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
    await page.getByRole('button', { name: /^Agents / }).click();
    await details.getByRole('button', { name: `${name} 1 · Working · Open conversation`, exact: true }).click();
    await expect(page.locator('.chat-tool-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: /^Agents / }).click();
    await page.getByRole('button', { name: 'Back to parent chat', exact: true }).click();
    await expect(page.locator('.chat-transcript').getByText('Inspect the worker states', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to parent chat', exact: true })).toHaveCount(0);
    await expect(details).toHaveCount(0);
  } finally { releaseChat(); await browser.close(); }
});
