import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { readJsonBody, bodyLimit } from '../server/http-body.mjs';
import { startServer } from '../server/http.mjs';

const input = (text, headers = {}) => Object.assign(Readable.from([Buffer.from(text)]), { method: 'POST', headers });
test('JSON bodies enforce byte limits, object shape and the attachment allowance', async () => {
  for (const text of ['{broken', 'null', '[]', '42', '"text"'])
    await assert.rejects(readJsonBody(input(text), '/api/settings'), { status: 400, code: 'INVALID_JSON' });
  const body = { text: 'é'.repeat(600_000) }, text = JSON.stringify(body);
  await assert.rejects(readJsonBody(input(text), '/api/settings'), { status: 413, code: 'BODY_TOO_LARGE' });
  assert.deepEqual(await readJsonBody(input(text), '/api/send'), body);
  assert.deepEqual(await readJsonBody(input(''), '/api/settings'), {});
});

test('oversized fixed and chunked requests return readable JSON and leave the server usable', async t => {
  const web = await startServer({ application: { bootstrap: async () => ({ ready: true }) }, assets: process.cwd() });
  t.after(() => web.close());
  const headers = { 'X-Freelancer-Client': 'webpage', 'Content-Type': 'application/json' };
  for (const chunked of [false, true]) {
    const payload = JSON.stringify({ text: 'x'.repeat(bodyLimit('/api/settings')) });
    const result = await new Promise((resolve, reject) => {
      const req = http.request(web.url + '/api/settings', { method: 'POST', headers: {
        ...headers, ...(chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(payload) }),
      } }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(payload);
    });
    assert.equal(result.status, 413);
    assert.equal(result.body.code, 'BODY_TOO_LARGE');
    assert.match(result.body.error, /1 MB/);
  }
  assert.deepEqual(await (await fetch(web.url + '/api/bootstrap', { headers })).json(), { ready: true });
});

test('response serialization errors cannot send a truncated successful JSON response', async t => {
  const web = await startServer({ application: { bootstrap: async () => ({ unsupported: 1n }) }, assets: process.cwd() });
  t.after(() => web.close());
  const response = await fetch(web.url + '/api/bootstrap', { headers: { 'X-Freelancer-Client': 'webpage' } });
  assert.equal(response.ok, false);
  assert.equal(typeof (await response.json()).error, 'string');
});
