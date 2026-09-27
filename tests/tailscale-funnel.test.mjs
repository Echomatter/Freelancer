import test from 'node:test';
import assert from 'node:assert/strict';
import { createTailscaleFunnel, parseTailscaleFunnelStatus } from '../server/tailscale-funnel.mjs';

const port = 10000;
const target = 'http://127.0.0.1:58635';
const authority = `freelancer.tail.example.ts.net:${port}`;
const routeStatus = (proxy = target, allow = true) => ({
  TCP: { [port]: { HTTPS: true } },
  Web: { [authority]: { Handlers: { '/': { Proxy: proxy } } } },
  AllowFunnel: { [authority]: allow },
});

function fixture(initial = { TCP: {}, Web: {}, AllowFunnel: {} }) {
  let config = structuredClone(initial);
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[0] !== 'funnel') throw Error('Unexpected Tailscale command');
    if (args[1] === 'status') return { stdout: JSON.stringify(config) };
    const selectedPort = Number(args.find(arg => arg.startsWith('--https='))?.slice('--https='.length));
    if (args.at(-1) === 'off') {
      for (const key of Object.keys(config.Web ?? {})) {
        if (Number(new URL(`https://${key}`).port || 443) === selectedPort) {
          delete config.Web[key]; delete config.AllowFunnel[key];
        }
      }
      delete config.TCP[selectedPort];
      return { stdout: '' };
    }
    const upstream = args.find(arg => arg.startsWith('http://'));
    const key = `freelancer.tail.example.ts.net:${selectedPort}`;
    config.TCP[selectedPort] = { HTTPS: true };
    config.Web[key] = { Handlers: { '/': { Proxy: upstream } } };
    config.AllowFunnel[key] = true;
    return { stdout: '' };
  };
  return { calls, run, read: () => config };
}

test('reads and validates only the HTTPS Funnel route to the loopback app listener', () => {
  const status = parseTailscaleFunnelStatus(JSON.stringify({ Foreground: routeStatus() }), target);
  assert.equal(status.available, true);
  assert.equal(status.active, true);
  assert.deepEqual(status.occupiedPorts, [port]);
  assert.deepEqual(status.routes[0], {
    authority,
    port,
    url: `https://${authority}`,
    target,
    handlerCount: 1,
    funnel: true,
  });
});

test('enables, confirms and removes only its reserved single-route Funnel port', async () => {
  const f = fixture();
  const tunnel = createTailscaleFunnel({ run: f.run, localPort: 58635 });
  const enabled = await tunnel.enable(port);
  assert.deepEqual(enabled, { url: `https://${authority}`, created: true });
  assert.equal((await tunnel.inspect()).active, true);
  await tunnel.disable(port);
  assert.equal((await tunnel.inspect()).routes.length, 0);
  assert.deepEqual(f.calls.filter(args => args.at(-1) === 'off'), [['funnel', `--https=${port}`, 'off']]);
  assert.equal(f.calls.some(args => args.includes('reset')), false, 'never clears unrelated Tailscale configuration');
});

test('refuses to replace an occupied HTTPS port or disable a different service', async () => {
  const f = fixture(routeStatus('http://127.0.0.1:9000'));
  const tunnel = createTailscaleFunnel({ run: f.run });
  await assert.rejects(tunnel.enable(port), /already serves another route/);
  await assert.rejects(tunnel.disable(port), /contains another route/);
  assert.equal(f.calls.filter(args => args[1] !== 'status').length, 0);
});

test('refuses an unsupported public port before calling Tailscale', async () => {
  const f = fixture();
  const tunnel = createTailscaleFunnel({ run: f.run });
  await assert.rejects(tunnel.enable(12345), /supported Tailscale HTTPS port/);
  assert.equal(f.calls.length, 0);
});
