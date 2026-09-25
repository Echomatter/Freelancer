import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const vite = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await vite.listen();
  const url = new URL('/tests/fixtures/chat-ui.html', vite.resolvedUrls.local[0]).href;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  page.setDefaultTimeout(12000);
  await page.goto(url);
  const scroll = page.locator('.chat-scroll');
  const dock = page.locator('.request-dock');
  const positionCard = async (index, offset = 0) => {
    await scroll.evaluate((element, { index, offset }) => {
      const card = element.querySelectorAll('.request-working[data-request-work-key]')[index];
      element.scrollTop += card.getBoundingClientRect().top - element.getBoundingClientRect().top - offset;
    }, { index, offset });
    await page.waitForTimeout(80);
  };
  await positionCard(5);
  const leftEdge = await page.evaluate(() => {
    const scroll = document.querySelector('.chat-scroll');
    const transcript = document.querySelector('.chat-transcript');
    const dock = document.querySelector('.request-dock');
    return { text: scroll.getBoundingClientRect().left + parseFloat(getComputedStyle(transcript).paddingLeft),
      dock: dock.getBoundingClientRect().left };
  });
  assert.ok(leftEdge.dock <= leftEdge.text - 4, 'the dock covers the transcript text edge');
  assert.match(await dock.locator('.request-working-title').innerText(), /Read example-5\.ts/);
  await dock.locator('summary').first().click();
  const body = dock.locator('.request-working-body');
  assert.equal(await dock.locator('.request-working').evaluate((element) => element.open), true);
  assert.equal(await body.locator('.agent-card').count(), 1, 'callbacks for the same child share one card');
  assert.match(await body.locator('.agent-card').innerText(), /opencode\/free/);
  assert.doesNotMatch(await body.locator('.agent-card').innerText(), /unknown|pending/i);
  await body.locator('.tool-card summary').last().click();
  const placement = await dock.evaluate((element) => ({
    dockTop: element.getBoundingClientRect().top,
    headTop: element.querySelector('.request-working-head').getBoundingClientRect().top,
    bodyTop: element.querySelector('.request-working-body').getBoundingClientRect().top,
  }));
  assert.ok(Math.abs(placement.headTop - placement.dockTop) < 4 && placement.bodyTop > placement.headTop,
    'opening a nested tool keeps the dock header in place');
  const sizes = await body.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
  assert.ok(sizes.scroll > sizes.client, 'expanded work has its own scroll track');
  const chatBefore = await scroll.evaluate((element) => element.scrollTop);
  await body.evaluate((element) => { element.scrollTop = 100; });
  assert.equal(await scroll.evaluate((element) => element.scrollTop), chatBefore, 'scrolling work leaves chat position intact');
  await scroll.evaluate((element) => { element.scrollTop += 85; });
  await page.waitForTimeout(750);
  assert.equal(await dock.locator('.request-working').evaluate((element) => element.open), false, 'downward chat scroll rolls work shut');
  await positionCard(6, 24);
  assert.match(await dock.locator('.request-working-title').innerText(), /Read example-5\.ts/, 'old turn remains docked until the next card arrives');
  assert.ok(await dock.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42) < 0, 'incoming card pushes previous dock upward');
  await positionCard(6);
  assert.match(await dock.locator('.request-working-title').innerText(), /Read example-6\.ts/, 'next card takes the dock');
  await positionCard(6, 24);
  assert.match(await dock.locator('.request-working-title').innerText(), /Read example-5\.ts/, 'reverse scroll restores the previous card');
  await page.setViewportSize({ width: 430, height: 800 });
  await positionCard(6);
  const bounds = await dock.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 430, 'dock fits a narrow chat');
  await page.setViewportSize({ width: 430, height: 500 });
  await positionCard(5);
  await dock.locator('summary').first().click();
  const compactBody = await dock.locator('.request-working-body').boundingBox();
  const compactScroll = await scroll.boundingBox();
  assert.ok(compactBody && compactScroll && compactBody.y + compactBody.height <= compactScroll.y + compactScroll.height + 2,
    'expanded work stays inside a short chat viewport');
  await page.setViewportSize({ width: 1200, height: 850 });
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(750);
  await dock.locator('summary').first().click();
  assert.equal(await dock.locator('.request-working').evaluate((element) => element.open), true);
  await page.getByRole('button', { name: 'Append tool' }).click();
  await dock.locator('.tool-card summary').filter({ hasText: 'Read live-update.ts' }).waitFor();
  assert.equal(await dock.locator('.request-working').evaluate((element) => element.open), true,
    'a streamed tool keeps the work panel open');
  console.log('PASS floating work dock, independent scroll, roll-up, turn handoff in both directions, narrow layout');
} finally {
  await browser?.close();
  await vite.close();
}
