import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { test, expect } from './support/browser-test.mjs';

test('chat-dock', { tag: ['@presentation', '@chat'] }, async ({ appBrowser: browser, own }) => {
  const vite = await own(createServer({ root: fileURLToPath(new URL('../', import.meta.url)), optimizeDeps: { entries: ['tests/fixtures/chat-ui.html'] }, server: { host: '127.0.0.1', port: 0 } }));
  await vite.listen();
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  await page.goto(new URL('/tests/fixtures/chat-ui.html', vite.resolvedUrls.local[0]).href);
  const scroll = page.locator('.chat-scroll'), dock = page.locator('.request-dock');
  await test.step('Current-turn tools stay docked while the transcript scrolls', async () => {
    await expect(dock).toContainText('Read example-11.ts');
    await expect(dock).toContainText('Current turn');
    await expect(page.locator('.chat-transcript .request-working, .chat-transcript .tool-card')).toHaveCount(0);
    await expect(page.locator('.request-marker')).toHaveCount(12);
    const top = (await dock.boundingBox()).y;
    await scroll.evaluate(el => { el.scrollTop = 0; });
    await expect(dock).toContainText('Read example-11.ts');
    assert.equal((await dock.boundingBox()).y, top);
  });
  await test.step('A slim marker opens earlier tools without jumping the conversation', async () => {
    const marker = page.getByRole('button', { name: 'Open tools for turn 6', exact: true });
    await marker.scrollIntoViewIfNeeded();
    const before = await scroll.evaluate(el => el.scrollTop);
    await marker.click();
    await expect(dock).toContainText('Reviewing turn 6');
    await expect(dock.locator('.request-working')).toHaveAttribute('open');
    await expect(dock.locator('.agent-card')).toHaveCount(1);
    await expect(dock.locator('.agent-card')).toContainText('opencode/free');
    await dock.locator('.tool-card summary').last().click();
    const body = dock.locator('.request-working-body');
    const sizes = await body.evaluate(el => ({ scroll: el.scrollHeight, height: el.clientHeight }));
    assert.ok(sizes.scroll > sizes.height, 'tool output has a bounded independent scroll area');
    const afterOpen = await scroll.evaluate(el => el.scrollTop);
    // Shrinking the viewport may clamp the old offset, but never scrolls to a source card.
    assert.ok(Math.abs(afterOpen - before) < 3);
    await body.evaluate(el => { el.scrollTop = 110; });
    assert.equal(await scroll.evaluate(el => el.scrollTop), afterOpen);
    await scroll.evaluate(el => { el.scrollTop += 70; });
    await expect(dock).toContainText('Reviewing turn 6');
    await expect(dock.locator('.request-working')).toHaveAttribute('open');
    await page.getByRole('button', { name: 'Back to current turn' }).click();
    await expect(dock).toContainText('Read example-11.ts');
    await expect(dock.locator('.request-working')).not.toHaveAttribute('open');
  });
  await test.step('Streamed tools update the same dock and preserve its open state', async () => {
    await dock.locator('summary').first().click();
    await page.getByRole('button', { name: 'Append tool', exact: true }).click();
    await expect(dock.locator('.tool-card summary').filter({ hasText: 'Read live-update.ts' })).toBeVisible();
    await expect(dock.locator('.request-working')).toHaveAttribute('open');
    await page.getByRole('button', { name: 'Append delegation handoff' }).click();
    await expect(page.locator('.handoff-card')).toBeVisible();
    await expect(page.locator('.chat-view')).toHaveCount(1);
  });
  await test.step('First-turn tools fit a short phone viewport', async () => {
    await page.setViewportSize({ width: 430, height: 580 });
    await page.getByRole('button', { name: 'Show first tool' }).click();
    await expect(dock).toContainText('Read first.ts');
    await expect(dock).toContainText('Current turn');
    await dock.locator('summary').first().click();
    await dock.locator('.tool-card summary').first().click();
    const rect = await dock.boundingBox(), composer = await page.locator('.composer').boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= 430);
    assert.ok(rect.y + rect.height <= composer.y, 'tools never cover the composer');
    assert.ok((await page.getByRole('button', { name: 'Open tools for turn 1', exact: true }).boundingBox()).height <= 40);
    await mkdir('artifacts/composer', { recursive: true });
    await page.screenshot({ path: 'artifacts/composer/phone-tools.png' });
  });
});
