import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { composerFixture } from './fixtures/composer-workspace.mjs';
import { test, expect } from './support/browser-test.mjs';

function turns(count = 16) {
  return Array.from({ length: count }, (_, i) => [
    { info: { id: `u${i}`, role: 'user', time: { created: 1000 + i * 20000 } }, parts: [{ type: 'text', text: `Turn ${i + 1}: refine the application layout.` }] },
    { info: { id: `a${i}`, role: 'assistant', parentID: `u${i}`, providerID: 'opencode', modelID: 'free', finish: 'stop', time: { created: 2000 + i * 20000, completed: 11000 + i * 20000 }, tokens: { input: 5000, output: 1000, cache: { read: 10000, write: 0 } } }, parts: [
      ...(i === 2 ? [] : [{ id: `tool${i}`, type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: `src/turn-${i + 1}.tsx` }, output: 'The component uses a shared outline and palette.\n'.repeat(30) } }]),
      { type: 'text', text: `The layout for turn ${i + 1} is ready to inspect.\n\n` + 'Conversation text remains in its own scroll area. '.repeat(i % 3 === 0 ? 65 : 8) },
    ] },
  ]).flat();
}
async function open(page, f) {
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
  await expect(page.locator('.conversation-rail')).toBeVisible();
}
async function dragThumb(page, position, cancel = false) {
  const thumb = await page.getByRole('scrollbar', { name: 'Scroll conversation' }).boundingBox();
  const track = await page.locator('.conversation-rail-track').boundingBox();
  const x = thumb.x + 3, y = thumb.y + thumb.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x, track.y + track.height * position, { steps: 12 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

test('conversation rail: turn tools, statistics, scroll gestures, resize, and streaming', { tag: ['@app', '@chat'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(composerFixture()); f.state.messages.ses_history = turns(); f.state.todos.ses_history = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } }); await open(page, f);
  const rail = page.locator('.conversation-rail'), scroll = page.locator('.chat-scroll'), dock = page.locator('.request-dock');
  const bubble = n => page.getByRole('button', { name: `Jump to turn ${n}`, exact: true });
  const offset = () => scroll.evaluate(el => el.scrollTop);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Preserve this draft');
  await test.step('One edge and turn-aware tools, including turns without tools', async () => {
    await expect(rail.locator('.conversation-rail-turn')).toHaveCount(16);
    await expect(rail).toHaveAttribute('data-context-level', '25');
    assert.equal(await scroll.evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');
    const r = await rail.boundingBox(), s = await scroll.boundingBox();
    assert.ok(Math.abs(s.x + s.width - r.x) < 2); assert.ok(Math.abs(r.y + r.height - 940) < 2);
    await bubble(6).hover();
    await expect(page.getByRole('tooltip')).toContainText('Turn 6');
    await expect(page.getByRole('tooltip')).toContainText('15K');
    await expect(page.getByRole('tooltip')).toContainText('10s');
    await page.getByRole('tooltip').hover(); await expect(page.getByRole('tooltip')).toContainText('Turn 6');
    await bubble(6).click();
    await expect(dock).toContainText('Reviewing turn 6'); await expect(dock).toContainText('Read turn-6.tsx');
    await expect(dock.locator('.request-working')).toHaveAttribute('open');
    await expect.poll(async () => Math.abs((await page.getByRole('region', { name: 'Request 6', exact: true }).boundingBox()).y - (await scroll.boundingBox()).y - 12)).toBeLessThan(2);
    await bubble(3).click(); await expect(dock).toContainText('No tools recorded for this turn');
    await bubble(6).click(); const before = await offset();
    await scroll.evaluate(el => { el.scrollTop += 120; }); await expect(dock).toContainText('Reviewing turn 6');
    assert.ok(await offset() > before);
  });
  await test.step('Keyboard turn navigation and scrollbar navigation stay separate', async () => {
    await bubble(6).focus(); await page.keyboard.press('ArrowDown'); await expect(bubble(7)).toBeFocused();
    await page.keyboard.press('Enter'); await expect(dock).toContainText('Reviewing turn 7');
    await page.keyboard.press('Home'); await expect(bubble(1)).toBeFocused();
    await page.keyboard.press('End'); await expect(bubble(16)).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
    const thumb = page.getByRole('scrollbar', { name: 'Scroll conversation' });
    await thumb.focus(); await page.keyboard.press('Home'); await expect.poll(offset).toBe(0);
    await page.keyboard.press('PageDown'); assert.ok(await offset() > 100);
    await page.keyboard.press('End'); await expect(thumb).toHaveAttribute('aria-valuenow', '100');
    await expect(dock).toContainText('Reviewing turn 7');
  });
  await test.step('Thumb drag and Escape never resize Details or overwrite a draft', async () => {
    await page.getByRole('button', { name: 'Details', exact: true }).click();
    const width = () => page.locator('.work-details').evaluate(el => el.getBoundingClientRect().width);
    const original = await width();
    const track = await page.locator('.conversation-rail-track').boundingBox();
    await page.mouse.click(track.x + 2, track.y + track.height * .62);
    await expect.poll(async () => Number(await page.getByRole('scrollbar').getAttribute('aria-valuenow'))).toBeGreaterThan(50);
    assert.equal(await width(), original, 'track seeking does not resize Details');
    const detailsControl = page.getByRole('button', { name: 'Details', exact: true });
    await expect(detailsControl.locator('svg')).toBeHidden();
    await expect(detailsControl.locator('span')).toHaveText('Details');
    await expect(detailsControl.locator('span')).toBeVisible();
    await dragThumb(page, .2);
    await expect.poll(() => page.getByRole('scrollbar').getAttribute('aria-valuenow')).not.toBe('100');
    assert.equal(await width(), original); const before = await offset();
    await dragThumb(page, .8, true); await expect.poll(offset).toBe(before);
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('conversation-scrolling')), false);
    const separator = page.getByRole('separator', { name: 'Details width' }); const b = await separator.boundingBox();
    await page.mouse.move(b.x + 3, b.y + 140); await page.mouse.down();
    await page.mouse.move(b.x - 67, b.y + 140, { steps: 10 }); await page.mouse.up();
    await expect.poll(width).toBe(original + 70);
    await expect(separator).toHaveAttribute('aria-disabled', 'false');
    assert.equal(await offset(), before);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Preserve this draft');
  });
  await test.step('Streaming updates context color without stealing the selected turn', async () => {
    await bubble(6).click(); await page.mouse.move(500, 100); const before = await offset();
    const color = () => rail.locator('.conversation-rail-line').evaluate(el => getComputedStyle(el).backgroundColor);
    const initialColor = await color();
    f.state.messages.ses_history.at(-1).info.tokens.input = 45000;
    f.state.messages.ses_history.at(-1).parts.push({ type: 'text', text: 'New streamed content. '.repeat(100) });
    await expect(rail).toHaveAttribute('data-context-level', '88');
    await expect(dock).toContainText('Reviewing turn 6'); assert.ok(Math.abs(await offset() - before) < 3);
    await expect.poll(color).not.toBe(initialColor);
    await mkdir('artifacts/conversation-rail', { recursive: true });
    await bubble(6).hover(); await page.screenshot({ path: 'artifacts/conversation-rail/desktop.png' });
  });
  await test.step('Header stays clear and native settings persist', async () => {
    await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Project settings', exact: true }).click();
    await page.getByRole('button', { name: 'Session defaults', exact: true }).click();
    const checkbox = page.getByRole('checkbox', { name: 'Automatic compaction' });
    await expect(checkbox).toBeChecked(); await checkbox.uncheck();
    await page.getByRole('button', { name: 'Save context settings' }).click();
    await expect(page.getByText('Saved for this project', { exact: true })).toBeVisible();
    assert.equal((await f.store.read('settings')).contextSettings[f.project.id].autoCompact, false);
    await page.getByRole('button', { name: 'Help: Automatic context compaction' }).hover();
    await expect(page.getByRole('tooltip')).toContainText('OpenCode owns');
    await page.screenshot({ path: 'artifacts/conversation-rail/context-settings.png' });
    await page.reload();
    await page.getByRole('button', { name: 'Project settings', exact: true }).click();
    await page.getByRole('button', { name: 'Session defaults', exact: true }).click();
    await expect(checkbox).not.toBeChecked();
    f.state.status.ses_history = { type: 'busy' }; await checkbox.check();
    await page.getByRole('button', { name: 'Save context settings' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'running chats' })).toBeVisible();
    assert.equal((await f.store.read('settings')).contextSettings[f.project.id].autoCompact, false);
    f.state.status = {};
  });
});

test('conversation rail: dense history, touch, reduced motion, and short phone viewport', { tag: ['@app', '@chat'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(composerFixture()); f.state.messages.ses_history = turns(120); f.state.todos.ses_history = [];
  const page = await browser.newPage({ viewport: { width: 430, height: 650 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' }); await open(page, f);
  const rail = page.locator('.conversation-rail'), dots = rail.locator('.conversation-rail-turn'), dock = page.locator('.request-dock');
  await expect(dots).toHaveCount(120);
  await dots.first().focus(); await page.keyboard.press('End'); await expect(dots.last()).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await expect(dock).toContainText('Reviewing turn 1');
  const positions = await dots.evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return [r.y, r.height]; }));
  assert.ok(positions.every((p, i) => !i || p[0] >= positions[i - 1][0] + positions[i - 1][1] - .1), 'dense hit targets remain distinct');
  assert.equal(await page.locator('.conversation-rail-thumb > span').evaluate(el => getComputedStyle(el, '::after').animationName), 'none');
  // Native touch events exercise pointer capture, including touch cancellation.
  const client = await page.context().newCDPSession(page);
  const thumb = await page.getByRole('scrollbar').boundingBox(), track = await page.locator('.conversation-rail-track').boundingBox();
  const x = thumb.x + 3, y = thumb.y + thumb.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: track.y + track.height * .7 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.getByRole('scrollbar').getAttribute('aria-valuenow')).not.toBe('0');
  await expect(dock).toContainText('Reviewing turn 1');
  const beforeCancel = await page.locator('.chat-scroll').evaluate(el => el.scrollTop);
  const movedThumb = await page.getByRole('scrollbar').boundingBox();
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: movedThumb.x + 3, y: movedThumb.y + movedThumb.height / 2 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: movedThumb.x + 3, y: track.y + track.height * .25 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect.poll(() => page.locator('.chat-scroll').evaluate(el => el.scrollTop)).toBe(beforeCancel);
  assert.equal(await page.locator('html').evaluate(el => el.classList.contains('conversation-scrolling')), false);
  const r = await rail.boundingBox(), composer = await page.locator('.composer').boundingBox(), d = await dock.boundingBox();
  assert.ok(r.x + r.width <= 431); assert.ok(composer.x + composer.width <= r.x);
  assert.ok(d.y + d.height <= composer.y); assert.equal(await page.getByRole('separator', { name: 'Details width' }).count(), 0);
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const detail = await page.locator('.work-details').boundingBox();
  assert.ok(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.work-details') !== null, { x: detail.x + detail.width - 8, y: detail.y + 150 }), 'Details overlay sits above rail on phones');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.setViewportSize({ width: 430, height: 580 });
  await mkdir('artifacts/conversation-rail', { recursive: true });
  await page.screenshot({ path: 'artifacts/conversation-rail/phone.png' });
});
