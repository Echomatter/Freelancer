import { readStateText as readFile } from '../backend/tools/runtime/state-database.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../server/http.mjs';
import { createRemoteAccess } from '../server/remote-access.mjs';

async function unusedLoopbackPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const headers = { 'X-Freelancer-Client': 'webpage', 'Content-Type': 'application/json' };
const call = (url, route, body, method = body ? 'POST' : 'GET', extra = {}) => fetch(`${url}/api/${route}`, {
  method, headers: { ...headers, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const callWithHost = (url, route, body, method, extra, host) => new Promise((resolve, reject) => {
  const endpoint = new URL(url), chunks = [];
  const request = http.request({
    agent: false,
    hostname: endpoint.hostname, port: endpoint.port, path: `/api/${route}`, method,
    headers: { ...headers, ...extra, host },
  }, response => {
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      resolve({
        status: response.statusCode,
        headers: { get: name => {
          const value = response.headers[name.toLowerCase()] ?? null;
          return Array.isArray(value) ? value.join(', ') : value;
        } },
        json: async () => JSON.parse(text),
        clone: () => ({ text: async () => text }),
      });
    });
  });
  request.on('error', reject);
  if (body) request.write(JSON.stringify(body));
  request.end();
});

test('public web listener requires a verified device and Secure pairing, and stays loopback-only across restart', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-public-web-'));
  const file = path.join(root, 'remote-access.json');
  const webPort = await unusedLoopbackPort();
  const host = 'freelancer.tail.example.ts.net:10000';
  const publicOrigin = `https://${host}`;
  const target = `http://127.0.0.1:${webPort}`;
  let route = false, runtime, remote;
  const funnel = {
    target,
    async inspect() { return { available: true, active: route, occupiedPorts: route ? [10000] : [], routes: route ? [{ authority: host, port: 10000, url: publicOrigin, target, handlerCount: 1, funnel: true }] : [] }; },
    async enable(port) { assert.equal(port, 10000); const created = !route; route = true; return { url: publicOrigin, created }; },
    async disable(port) { assert.equal(port, 10000); route = false; },
  };
  const application = {
    bootstrap: async project => ({ ready: true, project }),
    events: async function* (_project, signal) {
      yield 'data: ready\n\n';
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    },
  };
  const start = async () => {
    remote = await createRemoteAccess({ file, addresses: () => [], webPort, funnel });
    runtime = await startServer({ application, remoteAccess: remote });
  };
  t.after(async () => { await runtime?.close(); await rm(root, { recursive: true, force: true }); });
  await start();

  const configured = await call(runtime.url, 'remote-access/web', { enabled: true, port: 10000 }, 'PUT');
  assert.equal(configured.status, 200);
  const info = await configured.json();
  assert.equal(info.webActive, true);
  assert.equal(info.webUrl, `${publicOrigin}/`);
  assert.equal(info.webLocalPort, webPort);

  const remoteBase = `http://127.0.0.1:${webPort}`;
  const publicCall = (route, body, method = body ? 'POST' : 'GET', extra = {}) => {
    const { Host: selectedHost = host, ...requestHeaders } = extra;
    return callWithHost(remoteBase, route, body, method, requestHeaders, selectedHost);
  };
  const unpaired = await publicCall('bootstrap', undefined, 'GET', { Origin: publicOrigin });
  assert.equal(unpaired.status, 403, 'public APIs stay closed before pairing');
  assert.equal(unpaired.headers.get('strict-transport-security'), 'max-age=31536000');

  const pairingResponse = await call(runtime.url, 'remote-access/pairing', { transport: 'web' });
  assert.equal(pairingResponse.status, 200);
  const pairing = await pairingResponse.json();
  assert.equal(new URL(pairing.url).origin, publicOrigin);
  const token = new URLSearchParams(new URL(pairing.url).hash.slice(1)).get('pair');
  await assert.rejects(remote.pair({ token, name: 'Wrong route' }, 'lan'), /expired or was already used/);

  const paired = await publicCall('access/pair', { token, name: 'Web browser' }, 'POST', { Origin: publicOrigin });
  assert.equal(paired.status, 200, await paired.clone().text());
  const setCookie = paired.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Path=\/api; Max-Age=7776000; Secure/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await publicCall('bootstrap', undefined, 'GET', { Origin: publicOrigin, Cookie: cookie })).status, 200);
  assert.equal((await publicCall('remote-access', undefined, 'GET', { Origin: publicOrigin, Cookie: cookie })).status, 403,
    'paired browsers cannot manage pairing or device credentials');
  assert.equal((await publicCall('bootstrap', undefined, 'GET', {
    Origin: publicOrigin, Cookie: cookie, Host: new URL(runtime.url).host,
  })).status, 403, 'a forged local desktop Host cannot bypass the public listener gate');
  assert.equal((await publicCall('bootstrap', undefined, 'GET', { Origin: 'https://attacker.example', Cookie: cookie })).status, 403,
    'cross-origin requests are rejected');

  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(!JSON.stringify(saved).includes(token));
  assert.ok(!JSON.stringify(saved).includes(cookie.split('=')[1]));

  await runtime.close();
  await start();
  assert.equal(remote.webOrigin, publicOrigin, 'the exact Funnel URL survives a server restart');
  assert.equal((await publicCall('bootstrap', undefined, 'GET', { Origin: publicOrigin, Cookie: cookie })).status, 200,
    'a remembered browser remains trusted after restart');

  const device = (await (await call(runtime.url, 'remote-access')).json()).devices[0];
  assert.equal((await call(runtime.url, 'remote-access/devices', { id: device.id }, 'DELETE')).status, 200);
  assert.equal((await publicCall('bootstrap', undefined, 'GET', { Origin: publicOrigin, Cookie: cookie })).status, 403,
    'revoking a device immediately closes its public access');

  const disabled = await call(runtime.url, 'remote-access/web', { enabled: false, port: 10000 }, 'PUT');
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).webActive, false);
  assert.equal(route, false);
  await assert.rejects(fetch(`${remoteBase}/api/bootstrap`, { headers: { Host: host } }), /fetch failed/);
});
