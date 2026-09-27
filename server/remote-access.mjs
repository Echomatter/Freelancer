import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { localLanAddresses } from './lan.mjs';

const secret = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }); };
const closeListener = listener => listener && new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); });

// Separate from bootstrap/settings exports: only credential hashes are saved.
export async function createRemoteAccess({ file, addresses = localLanAddresses, now = Date.now } = {}) {
  let state = { version: 1, instance: randomBytes(12).toString('hex'), enabled: false, host: '', port: 58634, trustDays: 90, devices: [] };
  if (file) {
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved.version !== 1 || !/^[a-f0-9]{24}$/.test(saved.instance) || !Array.isArray(saved.devices)) throw Error('Invalid remote access settings');
      state = saved;
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  let listener, origin = '', handler, error = '', pairing, queue = Promise.resolve();
  const streams = new Map();
  const cookieName = `freelancer_device_${state.instance}`;
  const serial = fn => { const work = queue.catch(() => {}).then(fn); queue = work; return work; };
  async function save(next) {
    if (file) {
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, file);
    }
    state = next;
  }
  function status() {
    return { enabled: state.enabled, active: !!origin, host: state.host, port: state.port, trustDays: state.trustDays,
      addresses: addresses(), url: origin ? `${origin}/` : '', error,
      devices: state.devices.filter(d => d.expiresAt > now()).map(({ digest, ...device }) => device) };
  }
  function disconnect(id) {
    for (const response of streams.get(id) ?? []) response.destroy();
    streams.delete(id);
  }
  async function bind(config) {
    if (!addresses().includes(config.host)) fail('Choose an available private network address.');
    const next = http.createServer(handler);
    next.requestTimeout = 30000; next.headersTimeout = 10000;
    try {
      await new Promise((resolve, reject) => { next.once('error', reject); next.listen(config.port, config.host, resolve); });
    } catch (e) {
      await closeListener(next);
      fail(e.code === 'EADDRINUSE' ? `Port ${config.port} is already in use. Choose another port; Freelancer will keep that port on future restarts.` : `Could not open remote access: ${e.message}`);
    }
    return next;
  }
  return {
    get origin() { return origin; }, status,
    async start(requestHandler) {
      handler = requestHandler;
      if (state.enabled) {
        try { listener = await bind(state); origin = `http://${state.host}:${state.port}`; }
        catch (e) { error = e.message; }
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
    pairLink: () => serial(async () => {
      if (!origin) fail('Enable remote access before pairing a device.');
      const token = secret(), expiresAt = now() + 5 * 60 * 1000;
      pairing = { digest: hash(token), expiresAt };
      const url = `${origin}/#pair=${token}`;
      const png = await QRCode.toBuffer(url, { type: 'png', width: 320, margin: 4, errorCorrectionLevel: 'M' });
      return { url, expiresAt, qr: png.toString('base64') };
    }),
    cancelPairing: () => serial(async () => { pairing = undefined; return { ok: true }; }),
    pair: body => serial(async () => {
      if (!origin || !pairing || pairing.expiresAt <= now() || typeof body.token !== 'string' || body.token.length !== 43 ||
        !timingSafeEqual(Buffer.from(hash(body.token)), Buffer.from(pairing.digest))) fail('This QR code has expired or was already used. Generate a new code on your computer.', 403);
      const token = secret(), createdAt = now();
      const device = { id: randomBytes(12).toString('hex'), digest: hash(token), name: String(body.name || 'My browser').trim().slice(0, 80) || 'My browser', createdAt, expiresAt: createdAt + state.trustDays * 86400000 };
      const devices = state.devices.filter(d => d.expiresAt > createdAt);
      if (devices.length >= 50) fail('Remove a remembered device before pairing another.');
      await save({ ...state, devices: [...devices, device] });
      pairing = undefined;
      return { cookie: `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${state.trustDays * 86400}`, name: device.name, expiresAt: device.expiresAt };
    }),
    authenticate(req, res) {
      if (!origin) return false;
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
    async close() { await queue.catch(() => {}); pairing = undefined; origin = ''; await closeListener(listener); listener = undefined; },
  };
}
