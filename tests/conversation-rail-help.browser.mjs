import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { composerFixture } from './fixtures/composer-workspace.mjs';
import { test, expect } from './support/browser-test.mjs';

for (const [name, viewport, touch] of [
  ['desktop', { width: 1440, height: 940 }, false],
  ['phone', { width: 390, height: 580 }, true],
]) {
  test(`rail help explains navigation and context without changing work (${name})`, { tag: ['@app', '@chat'] }, async ({ appBrowser, own }) => {
    const f = await own(composerFixture());
    f.state.todos.ses_history = [];
    f.state.messages.ses_history = Array.from({ length: 6 }, (_, index) => [
      { info: { id: `help_u${index}`, role: 'user', time: { created: 1000 + index * 20000 } }, parts: [{ type: 'text', text: `Inspect turn ${index + 1}` }] },
      { info: { id: `help_a${index}`, role: 'assistant', parentID: `help_u${index}`, providerID: 'opencode', modelID: 'free', finish: 'stop', time: { created: 2000 + index * 20000, completed: 11000 + index * 20000 }, tokens: { input: 5000, output: 1000, cache: { read: 10000, write: 0 } } }, parts: [{ type: 'text', text: 'Keep the transcript and selected turn intact. '.repeat(80) }] },
    ]).flat();
    const page = await appBrowser.newPage({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
    try {
      await page.goto(f.url);
      await page.getByRole('button', { name: 'Chats', exact: true }).click();
      await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
      const rail = page.locator('.conversation-rail');
      await expect(rail).toBeVisible();
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this unsent draft');
      await page.getByRole('button', { name: 'Jump to turn 2', exact: true }).click();
      await expect(page.locator('.request-dock')).toContainText('Reviewing turn 2');
      const help = page.getByRole('button', { name: 'Help: Navigation and context — Conversation rail', exact: true });
      await help.focus();
      const tip = page.locator('.help-hint-popover');
      await expect(tip).toContainText('Each dot is a turn');
      await expect(tip).toContainText('Drag the pulsing ring');
      await expect(tip).toContainText('not a live estimate of unsent text');
      await expect(tip).toContainText('Arrow keys');
      await expect(page.locator('.conversation-rail-tooltip')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(tip).toHaveCount(0);
      await expect(help).toBeFocused();
      await expect(help).toHaveAttribute('aria-expanded', 'false');
      const before = await page.locator('.chat-scroll').evaluate(el => el.scrollTop);
      if (touch) await help.tap(); else await help.click();
      await expect(tip).toBeVisible();
      const box = await tip.boundingBox(), target = await help.boundingBox();
      assert.ok(target.width >= 24 && target.height >= 24, 'help has its own usable target');
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, 'help fits the viewport');
      await expect(rail).toHaveAttribute('data-context-level', '25');
      await expect(page.locator('.request-dock')).toContainText('Reviewing turn 2');
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this unsent draft');
      assert.equal(await page.locator('.chat-scroll').evaluate(el => el.scrollTop), before);
      assert.equal(await page.locator('html').evaluate(el => el.classList.contains('conversation-scrolling')), false);
      await mkdir('artifacts/conversation-rail', { recursive: true });
      await page.screenshot({ path: `artifacts/conversation-rail/help-${name}.png` });
      await page.keyboard.press('Escape');
      await page.emulateMedia({ forcedColors: 'active' });
      await help.click();
      await expect(tip).toBeVisible();
      await expect(page.getByRole('group', { name: 'Conversation turns', exact: true })).toHaveAttribute('aria-describedby', /.+/);
    } finally {
      await appBrowser.close();
    }
  });
}
