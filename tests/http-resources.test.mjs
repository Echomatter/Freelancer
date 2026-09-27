import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/http.mjs';

test('only content-hashed build assets receive immutable caching', async t => {
  const assets = await mkdtemp(path.join(tmpdir(), 'freelancer-assets-'));
  t.after(() => rm(assets, { recursive: true, force: true }));
  await mkdir(path.join(assets, 'assets'));
  for (const [name, content] of Object.entries({
    'index.html': '<html><body>Freelancer</body></html>',
    'assets/index-1234abcd.js': 'export const ready = true;',
    'assets/index-1234abcd.css': 'body { color: black; }',
    'assets/plain.js': 'plain',
  })) await writeFile(path.join(assets, name), content);
  const runtime = await startServer({ application: {}, assets });
  t.after(() => runtime.close());
  for (const name of ['assets/index-1234abcd.js', 'assets/index-1234abcd.css']) {
    const response = await fetch(`${runtime.url}/${name}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    await response.text();
  }
  for (const name of ['', 'assets/plain.js', 'assets/missing-1234abcd.js']) {
    const response = await fetch(`${runtime.url}/${name}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.text();
  }
});

test('SSE disconnect settles a pending drain wait and releases its iterator', async t => {
  let released;
  const cleanup = new Promise(resolve => { released = resolve; });
  const originalWrite = http.ServerResponse.prototype.write;
  // Deterministically enter backpressure without relying on OS socket buffer size.
  t.mock.method(http.ServerResponse.prototype, 'write', function (...args) {
    const result = originalWrite.apply(this, args);
    return this.getHeader('Content-Type') === 'text/event-stream' ? false : result;
  });
  const runtime = await startServer({ assets: '.', application: {
    async events() {
      return (async function* () {
        try { yield 'data: ready\n\n'; yield 'data: unexpected\n\n'; }
        finally { released(); }
      })();
    },
  } });
  t.after(() => runtime.close());
  await new Promise((resolve, reject) => {
    const req = http.get(`${runtime.url}/api/events?project=p`, {
      headers: { 'X-Freelancer-Client': 'webpage' },
    }, res => { res.once('data', () => { res.destroy(); resolve(); }); });
    req.on('error', reject);
  });
  let timer;
  try {
    await Promise.race([cleanup, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('SSE iterator stayed suspended after disconnect')), 2000);
    })]);
  } finally { clearTimeout(timer); }
});
