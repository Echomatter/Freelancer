import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { composerFixture } from './fixtures/composer-workspace.mjs';
import { test, expect } from './support/browser-test.mjs';

test('composer: symmetric controls, one menu, collapsible context and tools', { tag: ['@app', '@chat'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(composerFixture());
  f.state.messages.ses_history.at(-1).parts.unshift({ id: 'worker-route', type: 'tool', tool: 'delegate', state: {
    status: 'completed', input: { agentID: 'engineer' },
    output: JSON.stringify({ status: 'no_qualified_route', result: `No route ${'X'.repeat(600)}` }),
    metadata: { freelancer_status: 'no_qualified_route', agentName: `Engineer ${'Y'.repeat(240)}` },
  } });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const options = page.getByRole('button', { name: 'Message options', exact: true });
  const menu = page.getByRole('region', { name: 'Message options', exact: true });
  await input.fill('Keep this draft while I adjust the controls.');
  await test.step('One click exposes every message option; Escape returns focus', async () => {
    const left = await options.boundingBox(), right = await page.locator('.sender-main').boundingBox();
    assert.equal(left.width, right.width); assert.equal(left.height, right.height);
    assert.ok(left.width >= 44);
    await options.click();
    for (const name of ['Agent', 'Parent model', 'Intelligence'])
      await expect(menu.getByRole('combobox', { name, exact: true })).toBeVisible();
    await expect(menu.getByRole('combobox', { name: 'Workflow', exact: true })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: /Attach files/ })).toBeFocused();
    await menu.getByRole('combobox', { name: 'Intelligence', exact: true }).selectOption('high');
    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(options).toBeFocused();
    await expect(input).toHaveValue('Keep this draft while I adjust the controls.');
  });
  await test.step('Files and tasks collapse independently without losing their state', async () => {
    await options.click();
    const chooser = page.waitForEvent('filechooser');
    await menu.getByRole('button', { name: /Attach files/ }).click();
    await (await chooser).setFiles({ name: 'layout-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep every option available.') });
    const files = page.locator('.work-card').filter({ has: page.getByRole('button', { name: /Attachments · 1/ }) });
    await expect(files.getByRole('button', { name: 'Remove layout-notes.txt' })).toBeVisible();
    await files.locator('.work-card-toggle').click();
    await expect(files.getByRole('button', { name: 'Remove layout-notes.txt' })).toHaveCount(0);
    await files.locator('.work-card-toggle').click();
    await expect(files.getByRole('button', { name: 'Remove layout-notes.txt' })).toBeVisible();
    const tasks = page.locator('.work-card').filter({ has: page.getByRole('button', { name: /Tasks · 1\/3 complete/ }) });
    await expect(tasks.locator('.work-card-toggle')).toHaveAttribute('aria-expanded', 'false');
    await tasks.locator('.work-card-toggle').click();
    await expect(tasks.locator('.todo')).toHaveCount(3);
    await tasks.locator('.work-card-toggle').click();
    await expect(files.getByRole('button', { name: 'Remove layout-notes.txt' })).toBeVisible();
  });
  await test.step('Only the dock contains tools; markers open the requested turn', async () => {
    const dock = page.locator('.request-dock');
    await expect(page.locator('.chat-transcript .tool-card')).toHaveCount(0);
    await expect(dock).toContainText('Read composer.css');
    await page.getByRole('button', { name: 'Open tools for turn 1', exact: true }).click();
    await expect(dock).toContainText('Reviewing turn 1');
    await expect(dock).toContainText('Read Chat.tsx');
    await page.getByRole('button', { name: 'Back to current turn' }).click();
    await expect(dock).toContainText('Read composer.css');
    const outlines = await page.locator('.nav-accordion-trigger > svg:first-child').evaluateAll(icons => icons.map(el => ({ width: getComputedStyle(el).borderTopWidth, color: getComputedStyle(el).borderTopColor })));
    assert.ok(outlines.length === 2 && outlines.every(style => style.width === '1px' && style.color === outlines[0].color));
  });
  await mkdir('artifacts/composer', { recursive: true });
  await page.screenshot({ path: 'artifacts/composer/desktop.png' });
  await options.click();
  await page.screenshot({ path: 'artifacts/composer/desktop-menu.png' });
  await test.step('Phone controls and menu fit, and multiline typing stays bounded', async () => {
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 430, height: 780 });
    await expect(input).not.toHaveAttribute('placeholder');
    await expect(input).toHaveAttribute('enterkeyhint', 'send');
    await input.fill('A longer message\n'.repeat(16));
    const inputRect = await input.boundingBox();
    assert.ok(inputRect.height > 44 && inputRect.height <= 240);
    assert.equal(await input.evaluate(el => getComputedStyle(el).fontSize), '16px');
    await expect(page.locator('.composer-context')).toHaveCount(0);
    expect(await page.locator('.composer').evaluate(el => getComputedStyle(el).borderBottomWidth)).toBe('1px');
    const currentWork = page.locator('.request-dock .request-working');
    if (await currentWork.getAttribute('open') === null) await currentWork.locator('summary').first().click();
    const routeCard = page.locator('.agent-route-unavailable'), routeRect = await routeCard.boundingBox();
    const viewRect = await page.locator('.chat-view').boundingBox();
    assert.ok(routeRect.x >= viewRect.x && routeRect.x + routeRect.width <= viewRect.x + viewRect.width, 'long worker failures stay inside the chat');
    await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.className = 'error-banner overflow-probe'; banner.setAttribute('role', 'alert');
      banner.append(`${'unbroken-provider-error'.repeat(120)}`);
      const dismiss = document.createElement('button'); dismiss.textContent = 'Close'; banner.append(dismiss);
      document.querySelector('.main')?.prepend(banner);
    });
    const errorRect = await page.locator('.overflow-probe').boundingBox();
    assert.ok(errorRect.x >= 0 && errorRect.x + errorRect.width <= 430, 'large errors stay inside the viewport');
    assert.ok(await page.locator('.overflow-probe button').isVisible(), 'large errors keep their action visible');
    await page.locator('.overflow-probe').evaluate(el => el.remove());
    await options.click();
    const rect = await menu.boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 430 && rect.y >= 0);
    await expect(menu.getByRole('combobox', { name: 'Parent model', exact: true })).toBeVisible();
    assert.equal(await menu.getByRole('combobox', { name: 'Parent model', exact: true }).evaluate(el => getComputedStyle(el).fontSize), '16px');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: 'artifacts/composer/phone-menu.png' });
    await page.keyboard.press('Escape');
    await input.fill('Keep the mobile draft.');
    await page.screenshot({ path: 'artifacts/composer/phone.png' });
    await expect(input).toHaveValue('Keep the mobile draft.');
  });
  await test.step('Short screens keep menu controls clickable above an expanded dock', async () => {
    await page.setViewportSize({ width: 430, height: 520 });
    const dock = page.locator('.request-dock .request-working');
    if (await dock.getAttribute('open') === null) await dock.locator('summary').first().click();
    await options.click();
    const rect = await menu.boundingBox();
    assert.ok(rect.y >= 0 && rect.y + rect.height <= 520, 'the complete panel fits in the viewport');
    const attach = menu.getByRole('button', { name: /Attach files/ });
    assert.ok(await attach.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }), 'the menu is not clipped by the transcript or covered by the dock');
    await menu.getByRole('combobox', { name: 'Intelligence', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('button', { name: /^Help:/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).not.toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Keep the mobile draft.');
    await options.click();
    await input.click();
    await expect(menu).not.toBeVisible();
    await expect(input).toHaveValue('Keep the mobile draft.');
    await options.click();
    await page.screenshot({ path: 'artifacts/composer/short-phone-menu.png' });
  });
  await test.step('An invalid attachment opens its collapsed card and preserves existing files', async () => {
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 960 });
    const files = page.locator('.work-card').filter({ has: page.getByRole('button', { name: /Attachments · 1/ }) });
    await files.locator('.work-card-toggle').click();
    await options.click();
    const chooser = page.waitForEvent('filechooser');
    await menu.getByRole('button', { name: /Attach files/ }).click();
    await (await chooser).setFiles(Array.from({ length: 4 }, (_, i) => ({ name: `extra-${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Extra file') })));
    await expect(files.locator('.work-card-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(files.getByRole('alert')).toContainText('Add up to 4 files');
    await expect(files.getByRole('button', { name: 'Remove layout-notes.txt' })).toBeVisible();
    await expect(input).toHaveValue('Keep the mobile draft.');
  });
});
