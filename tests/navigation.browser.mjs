import { mkdir } from 'node:fs/promises';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('compact handoff cards and Agents navigate nested workers', { tag: ['@app', '@chat'] }, async ({ appBrowser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  f.state.sessions.push({ id: 'ses_nested', parentID: 'ses_worker', title: 'Nested inspection', directory: f.directory, time: { created: 120, updated: 300 } });
  const transcript = (id, child) => [
    { info: { id: `${id}-user`, role: 'user' }, parts: [{ type: 'text', text: `Inspect ${id}` }] },
    { info: { id: `${id}-reply`, role: 'assistant' }, parts: child ? [{ type: 'tool', tool: 'delegate', state: { status: 'completed', input: { agent: 'researcher', task: `Inspect ${child}` }, output: JSON.stringify({ status: 'completed', agent: { id: 'researcher', name: 'Researcher' } }), metadata: {
      sessionId: child, parentSessionId: id, agentID: 'researcher', agentName: 'Researcher', selected_model: 'opencode/free', task_id: `${id}-${child}`, freelancer_status: 'completed',
      freelancer_activity: { schema_version: 1, agentID: 'researcher', agentName: 'Researcher', child_session: child, selected_model: 'opencode/free', phase: 'completed', completed_tools: 1, updated_at: new Date().toISOString() },
    } } }] : [{ type: 'text', text: 'Inspection complete.' }] },
  ];
  f.state.messages.ses_history = transcript('root', 'ses_worker');
  f.state.messages.ses_worker = transcript('worker', 'ses_nested');
  f.state.messages.ses_nested = transcript('nested');
  const page = await appBrowser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(f.url);
  const chatTranscript = page.locator('.chat-transcript');
  const openWorker = async () => {
    await page.getByRole('button', { name: /^Agents / }).click();
    await page.locator('.chat-tool-overlay .agent-status-card').filter({ hasText: 'Researcher' }).click();
  };
  const parent = async () => {
    await page.getByRole('button', { name: /^Agents / }).click();
    await page.getByRole('button', { name: 'Back to parent chat', exact: true }).click();
  };
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    await openWorker(); await expect(chatTranscript).toContainText('Inspect worker');
    await openWorker(); await expect(chatTranscript).toContainText('Inspect nested');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await parent(); await expect(chatTranscript).toContainText('Inspect worker');
    await parent(); await expect(chatTranscript).toContainText('Inspect root');
  }
  expect(f.calls.filter(call => call.route.endsWith('/abort'))).toHaveLength(0);
});

for (const viewport of [{ width: 390, height: 740 }, { width: 1440, height: 900 }]) {
  test(`compact navigation closes after destinations and preserves non-navigation at ${viewport.width}px`, { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
    const fixture = await own(localDataFixture());
    const nativeRequest = fixture.host.request.bind(fixture.host);
    fixture.host.request = async (route, options) => {
      if (route === '/session/ses_history/fork') {
        const session = { id: 'ses_continued', title: 'Continued conversation', directory: fixture.directory, time: { created: Date.now(), updated: Date.now() } };
        fixture.state.sessions.push(session);
        return session;
      }
      return nativeRequest(route, options);
    };
    const page = await browser.newPage({ viewport });
    await page.goto(fixture.url);
    await expect(page.getByRole('button', { name: 'History project', exact: true })).toBeVisible();
    if (viewport.width > 720) await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
    const sidebar = page.locator('#workspace-navigation');
    const projects = sidebar.locator('.project-navigation .nav-card-trigger');
    const chats = sidebar.getByRole('button', { name: 'Chats', exact: true });
    const application = sidebar.getByRole('button', { name: 'Application settings', exact: true });
    const project = sidebar.getByRole('button', { name: 'Project settings', exact: true });
    const closed = () => expect(sidebar.locator('.nav-card-trigger[aria-expanded="true"]')).toHaveCount(0);
    const visiblePanelFits = async selector => {
      const box = await page.locator(selector).boundingBox();
      expect(box).toBeTruthy();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    };
    await closed();

    // Disclosure buttons expose one labeled destination list without navigating.
    await application.click();
    await expect(application).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar.getByRole('button', { name: 'Appearance', exact: true }).getByText('Appearance', { exact: true })).toBeVisible();
    await visiblePanelFits('#application-settings-links');
    await project.click();
    await expect(application).toHaveAttribute('aria-expanded', 'false');
    await expect(project).toHaveAttribute('aria-expanded', 'true');
    await sidebar.getByRole('button', { name: 'Session defaults', exact: true }).focus();
    await page.keyboard.press('Escape');
    await closed();
    await expect(project).toBeFocused();
    await application.click();
    await page.locator('.topbar').click({ position: { x: 2, y: 2 } });
    await closed();
    await application.click();
    await sidebar.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
    await closed();
    await expect(application).toBeFocused();
    expect(await page.locator('.topbar').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toHaveCount(0);
    await closed();

    // Same-project selection, creation and project management all dismiss flyouts.
    await projects.click();
    await visiblePanelFits('#project-navigation-links');
    const projectSelection = page.waitForResponse(response => new URL(response.url()).pathname === '/api/projects/selection' && response.request().method() === 'PUT');
    await sidebar.locator('.nav-project-select').click();
    await closed();
    await (await projectSelection).finished();
    await expect(page.locator('.chat-loading-stage')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
    await projects.click();
    await sidebar.getByRole('button', { name: 'New project', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Open project', exact: true })).toBeVisible();
    await closed();
    await page.keyboard.press('Escape');
    await expect(projects).toBeFocused();
    await projects.click();
    await sidebar.getByRole('button', { name: 'Manage History project', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Manage project', exact: true })).toBeVisible();
    await closed();
    await page.keyboard.press('Escape');
    await expect(projects).toBeFocused();

    // A management submenu and mutations remain in the chat list. Escape
    // dismisses the child before its parent and restores the matching control.
    await chats.click();
    const manage = sidebar.getByRole('button', { name: 'Manage Important conversation', exact: true });
    await manage.click();
    await expect(chats).toHaveAttribute('aria-expanded', 'true');
    await expect(manage).toHaveAttribute('aria-expanded', 'true');
    await visiblePanelFits('#chat-navigation-links');
    await page.getByRole('button', { name: 'Export', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(manage).toBeFocused();
    await expect(manage).toHaveAttribute('aria-expanded', 'false');
    await expect(chats).toHaveAttribute('aria-expanded', 'true');
    await manage.click();
    await page.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect(chats).toHaveAttribute('aria-expanded', 'true');
    await expect(manage).toBeFocused();
    await manage.click();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    const archive = page.getByRole('dialog', { name: 'Archive “Important conversation”?', exact: true });
    await expect(archive).toBeVisible();
    await archive.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(archive).toHaveCount(0);
    await expect(manage).toBeFocused();
    await expect(chats).toHaveAttribute('aria-expanded', 'true');
    await manage.click();
    await expect(page.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue in new chat', exact: true }).click();
    await closed();
    await chats.click();
    await expect(sidebar.locator('.nav-chat-select').filter({ hasText: 'Continued conversation' })).toHaveAttribute('aria-current', 'page');
    await chats.click();
    await chats.click();
    await sidebar.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
    await closed();
    await chats.click();
    await expect(sidebar.locator('.nav-chat-select').filter({ hasText: 'Important conversation' })).toHaveAttribute('aria-current', 'page');
    await chats.click();
    await chats.click();
    await sidebar.getByRole('button', { name: 'New chat', exact: true }).click();
    await closed();
    await chats.click();
    await expect(sidebar.locator('.nav-chat-select').filter({ hasText: 'New conversation' })).toHaveAttribute('aria-current', 'page');
    await chats.click();

    // Available Usage is another navigation flyout; refresh is not navigation.
    const usage = sidebar.locator('.usage-disclosure');
    await usage.click();
    await sidebar.getByRole('button', { name: 'Refresh usage', exact: true }).click();
    await expect(usage).toHaveAttribute('aria-expanded', 'true');
    await sidebar.getByRole('button', { name: 'Open Available Usage', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Available Usage', exact: true })).toBeVisible();
    await expect(usage).toHaveAttribute('aria-expanded', 'false');
    await expect(usage).toBeFocused();

    // Application Back controls return to the selected chat with closed menus.
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await chats.click();
    await expect(sidebar.locator('.nav-chat-select').filter({ hasText: 'New conversation' })).toHaveAttribute('aria-current', 'page');
    await chats.click();
    await application.click();
    await sidebar.getByRole('button', { name: 'Search all content', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Search all content', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Manage chats', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Manage chats', exact: true })).toBeVisible();
    await closed();
    await application.click();
    await sidebar.getByRole('button', { name: 'Models', exact: true }).focus();
    await page.keyboard.press('Escape');
    await closed();
    await expect(application).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Manage chats', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to search', exact: true }).click();
    await chats.click();
    await expect(sidebar.locator('.nav-chat-select').filter({ hasText: 'New conversation' })).toHaveAttribute('aria-current', 'page');
    await chats.click();
    if (viewport.width <= 720) {
      await chats.click();
      await page.getByRole('button', { name: 'Hide navigation', exact: true }).click();
      await expect(sidebar).toBeHidden();
      await page.getByRole('button', { name: 'Show navigation', exact: true }).click();
      await closed();
    }
    await mkdir('artifacts/navigation', { recursive: true });
    await application.click();
    await page.screenshot({ path: `artifacts/navigation/settings-${viewport.width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
