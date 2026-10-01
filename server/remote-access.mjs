import { createHash,randomBytes,timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import QRCode from 'qrcode';
import { readStateText as readFile,writeState } from '../backend/tools/runtime/state-database.mjs';
import { localLanAddresses } from './lan.mjs';
import { createTailscaleFunnel,TAILSCALE_FUNNEL_PORTS } from './tailscale-funnel.mjs';

export const WEB_ACCESS_FALLBACK_PORT = 58635;
const secret = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const closeListener = listener => listener && new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); });
const defaultWeb = () => ({ enabled: false, port: 10000, localPort: null });

// Separate from bootstrap/settings exports: only credential hashes are saved.
export async function createRemoteAccess({ file, addresses = localLanAddresses, now = Date.now, funnel: suppliedFunnel, webPort = 0 } = {}) {
  let state = { version: 1, instance: randomBytes(12).toString('hex'), enabled: false, host: '', port: 58634, trustDays: 90, devices: [], web: defaultWeb() };
  if (file) {
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved.version !== 1 || !/^[a-f0-9]{24}$/.test(saved.instance) || !Array.isArray(saved.devices)) throw Error('Invalid remote access settings');
      state = { ...state, ...saved, web: { ...defaultWeb(), ...(saved.web ?? {}) } };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  let funnel = suppliedFunnel ?? createTailscaleFunnel({ localPort: state.web.localPort || WEB_ACCESS_FALLBACK_PORT });
  let listener, publicListener, activeWebPort = 0, origin = '', webOrigin = '', handler, webHandler, error = '', webError = '', pairing, queue = Promise.resolve();
  let funnelInfo = { available: false, active: false, routes: [], error: 'Tailscale status has not been checked.' };
  const streams = new Map();
  const cookieName = `freelancer_device_${state.instance}`;
  const serial = fn => { const work = queue.catch(() => {}).then(fn); queue = work; return work; };
  async function save(next) {
    if (file) {
      writeState(file, next);
    }
    state = next;
  }
  function status() {
    const webRoute = funnelInfo.routes?.some(row => row.port === state.web.port && row.target === funnel.target && row.funnel && row.url === webOrigin) ?? false;
    return {
      enabled: state.enabled, active: !!origin, host: state.host, port: state.port, trustDays: state.trustDays,
      addresses: addresses(), url: origin ? `${origin}/` : '', error,
      webEnabled: state.web.enabled, webActive: !!webOrigin && webRoute, webPort: state.web.port,
      webUrl: webOrigin ? `${webOrigin}/` : '', webLocalPort: activeWebPort || state.web.localPort || null, funnelAvailable: funnelInfo.available,
      webError: webError || funnelInfo.error || '', funnelPorts: TAILSCALE_FUNNEL_PORTS,
      devices: state.devices.filter(d => d.expiresAt > now()).map(({ digest, ...device }) => device),
    };
  }
  function disconnect(id) {
    for (const response of streams.get(id) ?? []) response.destroy();
    streams.delete(id);
  }
  async function bind(config, requestHandler = handler) {
    if (!addresses().includes(config.host)) fail('Choose an available private network address.');
    const next = http.createServer(requestHandler);
    next.requestTimeout = 30000; next.headersTimeout = 10000;
    try {
      await new Promise((resolve, reject) => { next.once('error', reject); next.listen(config.port, config.host, resolve); });
    } catch (e) {
      await closeListener(next);
      fail(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Choose another port; Freelancer will keep that port on future restarts.` : `Could not open remote access: ${e.message}`);
    }
    return next;
  }
  async function bindPublic(requestHandler = webHandler) {
    activeWebPort = 0;
    const next = http.createServer(requestHandler);
    next.requestTimeout = 30000; next.headersTimeout = 10000;
    try {
      await new Promise((resolve, reject) => { next.once('error', reject); next.listen(webPort, '127.0.0.1', resolve); });
    } catch (e) {
      await closeListener(next);
      fail(e.code === 'EADDRINUSE' ? `Web access port ${webPort} is already in use. Stop the other local service and restart Freelancer.` : `Could not open web access: ${e.message}`);
    }
    activeWebPort = next.address().port;
    if (!suppliedFunnel) funnel = createTailscaleFunnel({ localPort: activeWebPort });
    return next;
  }
  async function refreshFunnel() {
    try {
      funnelInfo = { ...(await funnel.inspect()), error: '' };
    } catch (e) {
      const message = e.message || 'Tailscale Funnel status is unavailable.';
      funnelInfo = { available: !/not recognized|not found|ENOENT|spawn .* ENOENT/i.test(message), active: false, routes: [], occupiedPorts: [], error: message };
    }
    return funnelInfo;
  }
  return {
    get origin() { return origin; },
    get webOrigin() { return webOrigin; },
    status,
    async start(requestHandler, publicRequestHandler = requestHandler) {
      handler = requestHandler;
      webHandler = publicRequestHandler;
      if (state.enabled) {
        try { listener = await bind(state); origin = `http://${state.host}:${state.port}`; }
        catch (e) { error = e.message; }
      }
      if (state.web.enabled) {
        try {
          if (Number.isInteger(state.web.localPort) && state.web.localPort > 0)
            await funnel.disable(state.web.port);
          publicListener = await bindPublic();
          await save({ ...state, web: { ...state.web, localPort: activeWebPort } });
          const route = await funnel.enable(state.web.port);
          webOrigin = route.url;
        } catch (e) {
          webError = e.message;
          await closeListener(publicListener); publicListener = undefined;
          activeWebPort = 0;
          webOrigin = '';
        }
      } else if (Number.isInteger(state.web.localPort) && state.web.localPort > 0) {
        try { await funnel.disable(state.web.port); webError = ''; }
        catch (e) { webError = e.message; }
      }
      await refreshFunnel();
      if (state.web.enabled && !status().webActive) {
        webError = 'The saved web route could not be verified by Tailscale. Check Funnel status before pairing a device.';
        webOrigin = '';
        await closeListener(publicListener); publicListener = undefined;
      }
    },
    configure: body => serial(async () => {
      if (typeof body.enabled !== 'boolean' || !Number.isInteger(body.port) || body.port < 1024 || body.port > 65535 || ![30, 90, 365].includes(body.trustDays))
        fail('Choose a port from 1024 to 65535 and a supported device trust duration.');
      const next = { ...state, enabled: body.enabled, host: String(body.host ?? ''), port: body.port, trustDays: body.trustDays };
      const changed = next.host !== state.host || next.port !== state.port;
      const replacement = next.enabled && (!listener || changed) ? await bind(next) : undefined;
      try { await save(next); } catch (e) { await closeListener(replacement); throw e; }
      if (!next.enabled || replacement) {
        const previous = listener;
        listener = replacement;
        origin = replacement ? `http://${next.host}:${next.port}` : '';
        await closeListener(previous);
      }
      pairing = undefined; error = '';
      return status();
    }),
    configureWeb: body => serial(async () => {
      if (typeof body.enabled !== 'boolean' || !TAILSCALE_FUNNEL_PORTS.includes(body.port))
        fail('Choose a supported Tailscale HTTPS port.');
      const previousPort = state.web.port;
      if (state.web.enabled && body.enabled && body.port !== previousPort)
        fail('Turn off web access before changing its HTTPS port.');
      const previousState = state;
      const next = { ...state, web: { ...state.web, enabled: body.enabled, port: body.port } };
      if (!body.enabled) {
        // Close the app listener even if the Tailscale daemon is unavailable.
        // A stale Funnel route then reaches no Freelancer service.
        const previousListener = publicListener;
        publicListener = undefined; activeWebPort = 0; webOrigin = ''; pairing = undefined;
        await closeListener(previousListener);
        try { await funnel.disable(previousPort); webError = ''; }
        catch (e) { webError = `Web access is off locally, but Tailscale could not remove its public route: ${e.message}`; }
        await save(next);
        await refreshFunnel();
        return status();
      }

      if (!publicListener && Number.isInteger(state.web.localPort) && state.web.localPort > 0)
        await funnel.disable(state.web.port);
      const previousListener = publicListener;
      let candidate = previousListener;
      if (!candidate) candidate = await bindPublic();
      let route;
      try {
        const connected = { ...next, web: { ...next.web, localPort: activeWebPort } };
        await save(connected);
        route = await funnel.enable(body.port);
      } catch (e) {
        if (!previousState.web.enabled) await save(previousState).catch(() => {});
        if (route?.created) await funnel.disable(body.port).catch(() => {});
        if (!previousListener) { await closeListener(candidate); activeWebPort = 0; }
        throw e;
      }
      publicListener = candidate;
      webOrigin = route.url;
      webError = '';
      if (previousListener && previousPort !== body.port) {
        try { await funnel.disable(previousPort); }
        catch (e) { webError = `New web access is active, but the old Tailscale port was left unchanged: ${e.message}`; }
      }
      await refreshFunnel();
      if (!funnelInfo.routes.some(row => row.port === body.port && row.target === funnel.target && row.funnel && row.url === webOrigin)) {
        webError = 'Freelancer is ready locally, but Tailscale no longer confirms the public route.';
        webOrigin = '';
        await closeListener(publicListener); publicListener = undefined;
        activeWebPort = 0;
      }
      pairing = undefined;
      return status();
    }),
    pairLink: (transport = 'lan') => serial(async () => {
      const selectedOrigin = transport === 'web' ? webOrigin : origin;
      if (!selectedOrigin) fail(transport === 'web' ? 'Enable secure web access before pairing a device.' : 'Enable remote access before pairing a device.');
      if (!['lan', 'web'].includes(transport)) fail('Choose a valid pairing connection.');
      const token = secret(), expiresAt = now() + 5 * 60 * 1000;
      pairing = { digest: hash(token), expiresAt, transport };
      const url = `${selectedOrigin}/#pair=${token}`;
      const png = await QRCode.toBuffer(url, { type: 'png', width: 320, margin: 4, errorCorrectionLevel: 'M' });
      return { url, expiresAt, qr: png.toString('base64'), transport };
    }),
    cancelPairing: () => serial(async () => { pairing = undefined; return { ok: true }; }),
    pair: (body, transport = 'lan') => serial(async () => {
      const selectedOrigin = transport === 'web' ? webOrigin : origin;
      if (!selectedOrigin || !pairing || pairing.transport !== transport || pairing.expiresAt <= now() || typeof body.token !== 'string' || body.token.length !== 43 ||
        !timingSafeEqual(Buffer.from(hash(body.token)), Buffer.from(pairing.digest))) fail('This QR code has expired or was already used. Generate a new code on your computer.', 403);
      const token = secret(), createdAt = now();
      const device = { id: randomBytes(12).toString('hex'), digest: hash(token), name: String(body.name || 'My browser').trim().slice(0, 80) || 'My browser', createdAt, expiresAt: createdAt + state.trustDays * 86400000 };
      const devices = state.devices.filter(d => d.expiresAt > createdAt);
      if (devices.length >= 50) fail('Remove a remembered device before pairing another.');
      await save({ ...state, devices: [...devices, device] });
      pairing = undefined;
      return { cookie: `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${state.trustDays * 86400}${transport === 'web' ? '; Secure' : ''}`, name: device.name, expiresAt: device.expiresAt };
    }),
    authenticate(req, res, transport = 'lan') {
      if (!(transport === 'web' ? webOrigin : origin)) return false;
      const token = String(req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const digest = hash(token);
      const device = state.devices.find(d => d.expiresAt > now() && d.digest === digest);
      if (!device) return false;
      let rows = streams.get(device.id);
      if (!rows) streams.set(device.id, rows = new Set());
      rows.add(res);
      const timer = setTimeout(() => res.destroy(), Math.min(device.expiresAt - now(), 2147483647));
      timer.unref();
      res.once('close', () => { clearTimeout(timer); rows.delete(res); if (!rows.size) streams.delete(device.id); });
      return true;
    },
    revoke: id => serial(async () => {
      if (!state.devices.some(d => d.id === id)) fail('Device not found.', 404);
      await save({ ...state, devices: state.devices.filter(d => d.id !== id) });
      disconnect(id);
      return status();
    }),
    async close() {
      await queue.catch(() => {});
      pairing = undefined; origin = ''; webOrigin = '';
      await closeListener(listener); listener = undefined;
      await closeListener(publicListener); publicListener = undefined; activeWebPort = 0;
      if (Number.isInteger(state.web.localPort) && state.web.localPort > 0)
        await funnel.disable(state.web.port).catch(() => {});
    },
  };
}
