import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('chat-tweaks', { tag: ["@app","@chat"] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  const nativeChat = f.app.chat.bind(f.app);
  f.app.chat = async (...args) => ({ ...await nativeChat(...args), activity: [
    { id: 'old', agentName: 'Older agent', child: 'ses_old', phase: 'completed', completedTools: 1, raw: { created_at: '2026-09-20T18:00:00Z' } },
    { id: 'new', agentName: 'Newest agent', child: 'ses_worker', phase: 'working', completedTools: 2, raw: { created_at: '2026-09-20T20:00:00Z' } },
    { id: 'middle', agentName: 'Middle agent', child: 'ses_middle', phase: 'completed', completedTools: 1, raw: { created_at: '2026-09-20T19:00:00Z' } },
  ] });
  f.state.messages.ses_history = [
    // Handoffs are response/activity cards belonging to an existing parent
    // request; they are not standalone user turns.
    { info: { id: 'msg_original', role: 'user' }, parts: [{ id: 'prt_original', type: 'text', text: 'Continue the original review task' }] },
    { info: { id: 'msg_handoff', role: 'user' }, parts: [{ type: 'text', text: '[Freelancer Delegate handoff abc123]\nUser concern:\nCheck this independently' }] },
    { info: { id: 'msg_user', role: 'user' }, parts: [{ id: 'prt_user', type: 'text', text: 'Review the work' }] },
    { info: { id: 'msg_parent', role: 'assistant' }, parts: [{ id: 'prt_agent', type: 'tool', tool: 'delegate',
      state: { status: 'completed', input: { agentID: 'engineer', prompt: 'PRIVATE_HANDOFF_ARGUMENT' }, output: 'PRIVATE_CHILD_OUTPUT', metadata: { sessionId: 'ses_worker', agentName: 'Engineer' } } }] },
  ];
  f.state.messages.ses_worker = [
    { info: { id: 'msg_worker_user', role: 'user' }, parts: [{ id: 'prt_worker_user', type: 'text', text: 'Inspect the code' }] },
    { info: { id: 'msg_worker_reply', role: 'assistant' }, parts: [
      { id: 'prt_reason', type: 'reasoning', text: 'Read the relevant file first.' },
      { id: 'prt_command', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'sample.ts' }, output: 'File contents' } },
    ] },
    { info: { id: 'worker-report', role: 'assistant', finish: 'stop', time: { completed: 1 } }, parts: [{ type: 'text', text: 'Report outcome for inspection' }] },
  ];

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
    const cover = page.locator('.chat-loading-stage');
    await cover.waitFor({ state: 'visible' });
    const coverBox = await cover.boundingBox(), layoutBox = await page.locator('.conversation-layout').boundingBox();
    assert.ok(coverBox && layoutBox && Math.abs(coverBox.x - layoutBox.x) < 2 &&
      Math.abs(coverBox.width - layoutBox.width) < 2 && Math.abs(coverBox.height - layoutBox.height) < 2,
    'one loading stage fills the conversation and Details area');
    assert.equal(await page.locator('.composer').count(), 0, 'composer is absent during loading');
    releaseChat();
    await cover.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => {
      const input = document.querySelector('.composer textarea');
      return input && !input.disabled;
    });
    await test.step('Inspect a collapsed handoff and navigate directly from sorted activity', async () => {
      const handoff = page.locator('.handoff-card').filter({ hasText: 'Check this independently' });
      await expect(handoff).not.toHaveAttribute('open');
      await handoff.locator('summary').click();
      await expect(handoff.getByText('Check this independently', { exact: true })).toBeVisible();
      await handoff.locator('summary').click();
      await page.getByRole('button', { name: /^Agents / }).click();
      const details = page.locator('.chat-tool-overlay');
      await details.getByRole('button', { name: /This chat/ }).click();
      await expect(details.locator('.agent-status-card .agent-card-copy strong')).toHaveText(['Newest agent', 'Middle agent', 'Older agent']);
      await expect(details.locator('.agent-status-card').first()).toContainText('2 actions');
      await expect(details.locator('.agent-status-card').first()).toContainText('Working');
      await expect(details.locator('.activity-detail-body')).toHaveCount(0);
      await expect(details.locator('.handoff-card')).toHaveCount(0, 'agent overview stays collapsed to summary cards');
      await page.getByRole('button', { name: /^Agents / }).click();
    });
    await page.locator('.chat-toolbar-tabs button').filter({ hasText: 'Commands' }).click();
    await expect(page.getByText(/PRIVATE_HANDOFF_ARGUMENT|PRIVATE_CHILD_OUTPUT/)).toHaveCount(0);
    await page.locator('.chat-toolbar-tabs button').filter({ hasText: 'Commands' }).click();
    await page.getByRole('button', { name: /^Agents / }).click();
    const currentAgents = page.locator('.chat-tool-overlay');
    const completedWorker = currentAgents.locator('.agent-status-card').filter({ hasText: 'Newest agent' }).first();
    await expect(completedWorker).toContainText('Working');
    await completedWorker.click();
    const assignment = page.locator('.handoff-card').filter({ hasText: 'Inspect the code' });
    await expect(assignment).not.toHaveAttribute('open');
    await assignment.locator('summary').click();
    await expect(assignment.getByText('Inspect the code', { exact: true })).toBeVisible();
    await assignment.locator('summary').click();
    await page.locator('.chat-toolbar-tabs button').filter({ hasText: 'Commands' }).click();
    const work = page.locator('.chat-tool-overlay');
    const prose = page.locator('.message.assistant').filter({ hasText: 'Read the relevant file first.' });
    await prose.getByText('Read the relevant file first.').waitFor();
    assert.equal(await work.getByText('Read the relevant file first.').count(), 0,
      'reasoning prose stays with the assistant response');
    assert.equal(await work.locator('details.reasoning').count(), 0);
    assert.equal(await work.locator('.tool-card').count(), 1,
      'the work card contains the tool call');
    await expect(work.getByText('File contents', { exact: true })).toHaveCount(0);
    await work.locator('.tool-card summary').click();
    await expect(work.getByText('File contents', { exact: true })).toBeVisible();
    const report = page.locator('.handoff-card').filter({ hasText: 'Report outcome for inspection' });
    await expect(report).not.toHaveAttribute('open');
    await report.locator('summary').click();
    await expect(report.getByText('Report outcome for inspection', { exact: true })).toBeVisible();
    console.log('PASS usage below settings; reasoning prose stays in chat and tool calls stay in work card');
  } finally { releaseChat?.(); await browser.close(); await f.close(); }
});
