import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { composerFixture } from './fixtures/composer-workspace.mjs';
import { test, expect } from './support/browser-test.mjs';

test('long chat stays responsive while another chat streams', { tag: ['@app', '@chat'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(composerFixture());
  f.state.todos.ses_history = [];
  f.state.messages.ses_history = Array.from({ length: 250 }, (_, i) => [
    { info: { id: `u${i}`, role: 'user' }, parts: [{ type: 'text', text: `Request ${i + 1}` }] },
    { info: { id: `a${i}`, role: 'assistant', parentID: `u${i}`, providerID: 'opencode', modelID: 'free' },
      parts: [{ type: 'text', text: `Response ${i + 1}\n\n` + 'A completed response with **formatted content** and a [reference](https://example.com).\n\n'.repeat(12) }] },
  ]).flat();
  const events = [];
  f.host.events = async function* (_, signal) {
    while (!signal.aborted) {
      if (events.length) yield events.splice(0).map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
      try { await delay(30, undefined, { signal }); } catch { return; }
    }
  };
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  let reads = 0, bootstraps = 0;
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/bootstrap') bootstraps++;
    if (url.pathname === '/api/chat' && url.searchParams.get('session') === 'ses_history' && !url.searchParams.has('preview')) reads++;
  });
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
  await expect(page.locator('.request-group')).toHaveCount(250);
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(input).toBeEnabled();
  await expect(page.locator('.conversation-rail .help-hint')).toHaveCount(0);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  };
  const before = await metrics(), initialReads = reads, initialBootstraps = bootstraps;
  for (let i = 0; i < 30; i++) events.push({ type: 'message.part.updated', properties: { part: { sessionID: 'ses_other' } } });
  await input.fill('A draft that must remain responsive and preserved.');
  // Let the 500ms invalidation window elapse; unrelated text must do no work.
  await delay(800);
  expect(reads).toBe(initialReads);
  expect(bootstraps).toBe(initialBootstraps);
  await expect(input).toHaveValue('A draft that must remain responsive and preserved.');
  await page.evaluate(async () => {
    const scroll = document.querySelector('.chat-scroll');
    // Leaving the bottom reveals Jump to latest and changes scroll extent once.
    // Measure the subsequent steady scroll, after that real layout change.
    scroll.scrollTop -= 200;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.anchorReads = 0;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('request-group')) window.anchorReads++;
      return original.call(this);
    };
    for (let i = 0; i < 20; i++) {
      scroll.scrollTop -= 90;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    Element.prototype.getBoundingClientRect = original;
  });
  const scrollAnchorReads = await page.evaluate(() => window.anchorReads);
  // Revealing the sticky latest-action/composer can change the scroll extent
  // once. Twenty scroll steps must not each remeasure all 250 turns.
  expect(scrollAnchorReads).toBeLessThanOrEqual(250);
  for (let i = 0; i < 8; i++) {
    f.state.messages.ses_history.at(-1).parts[0].text = `Streaming update ${i}`;
    events.push({ type: 'message.part.updated', properties: { part: { sessionID: 'ses_history' } } });
    await expect(page.locator('.request-group').last()).toContainText(`Streaming update ${i}`);
  }
  expect(bootstraps).toBe(initialBootstraps);
  await expect(input).toHaveValue('A draft that must remain responsive and preserved.');
  const after = await metrics();
  expect(after.Nodes).toBeLessThan(before.Nodes + 200);
  expect(after.JSHeapUsedSize - before.JSHeapUsedSize).toBeLessThan(12 * 1024 * 1024);
  await mkdir('artifacts/performance', { recursive: true });
  await writeFile('artifacts/performance/chat.json', JSON.stringify({ turns: 250, unrelatedEvents: 30, selectedUpdates: 8,
    unrelatedTranscriptReads: 0, streamingBootstrapReads: bootstraps - initialBootstraps, scrollAnchorReads,
    before, after, taskSeconds: after.TaskDuration - before.TaskDuration, simulatedProvider: true }, null, 2));
  await page.screenshot({ path: 'artifacts/performance/long-chat.png' });
});
