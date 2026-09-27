import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { test, expect } from './support/browser-test.mjs';

test('browser-capabilities', { tag: ["@capability"] }, async ({ appBrowser: browser, own }) => {
  const source = await readFile(new URL('../src/browser-capabilities.mjs', import.meta.url));
  const server = http.createServer((req, res) => {
    if (req.url === '/capabilities.mjs') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(source); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<textarea id="draft">Preserve this draft</textarea><button id="copy">Copy</button><output></output>
      <script type="module">
        import { clientID, copyText } from './capabilities.mjs';
        document.querySelector('#copy').onclick = async () => {
          const draft = document.querySelector('#draft'); draft.focus(); draft.setSelectionRange(2, 5);
          try { await copyText('Copied response'); document.querySelector('output').textContent = clientID(); }
          catch (error) { document.querySelector('output').textContent = error.message; }
        };
      </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined });
      Object.defineProperty(navigator, 'clipboard', { value: undefined });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.waitForFunction(() => /^[0-9a-f-]{36}$/.test(document.querySelector('output').textContent));
    assert.deepEqual(await page.locator('#draft').evaluate(el => ({ value: el.value,
      focused: document.activeElement === el, start: el.selectionStart, end: el.selectionEnd })),
      { value: 'Preserve this draft', focused: true, start: 2, end: 5 });
    assert.equal(await page.locator('textarea').count(), 1, 'temporary copy control is removed');
    console.log('PASS HTTP-compatible request IDs and clipboard fallback preserve draft focus and selection');
  } finally {
    await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
});
