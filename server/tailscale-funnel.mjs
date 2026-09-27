import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { access } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
export const TAILSCALE_FUNNEL_PORTS = Object.freeze([443, 8443, 10000]);

async function executablePath() {
  if (process.platform === 'win32') {
    const root = process.env.ProgramW6432 || process.env.ProgramFiles;
    if (root) {
      const candidate = path.join(root, 'Tailscale', 'tailscale.exe');
      try { await access(candidate); return candidate; } catch { /* use PATH below */ }
    }
    return 'tailscale.exe';
  }
  return 'tailscale';
}

async function runTailscale(args, timeout = 15000) {
  const file = await executablePath();
  try {
    return await execFileAsync(file, args, {
      windowsHide: true,
      timeout,
      maxBuffer: 256 * 1024,
      encoding: 'utf8',
    });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message || 'Tailscale command failed').trim();
    throw Error(detail.slice(0, 1200));
  }
}

function configurationNodes(value, found = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return found;
  if (value.Web && typeof value.Web === 'object') found.push(value);
  for (const child of Object.values(value)) configurationNodes(child, found);
  return found;
}

export function parseTailscaleFunnelStatus(text, target) {
  let value;
  try { value = JSON.parse(text); } catch { throw Error('Tailscale returned an unreadable Funnel status.'); }
  const routes = [], occupiedPorts = new Set();
  for (const config of configurationNodes(value)) {
    const allow = config.AllowFunnel ?? {};
    for (const port of Object.keys(config.TCP ?? {})) if (/^\d+$/.test(port)) occupiedPorts.add(Number(port));
    for (const [authority, service] of Object.entries(config.Web)) {
      let url;
      try { url = new URL(`https://${authority}`); } catch { continue; }
      const port = Number(url.port || 443);
      const handlers = Object.entries(service?.Handlers ?? {});
      const root = handlers.find(([route]) => route === '/')?.[1];
      routes.push({
        authority,
        port,
        url: url.origin,
        target: root?.Proxy ?? '',
        handlerCount: handlers.length,
        funnel: allow[authority] === true,
      });
    }
  }
  const unique = [...new Map(routes.map(route => [`${route.authority}|${route.target}|${route.funnel}`, route])).values()];
  return { available: true, active: unique.some(route => route.target === target && route.funnel), routes: unique, occupiedPorts: [...occupiedPorts] };
}

export function createTailscaleFunnel({ run = runTailscale, localPort = 58635 } = {}) {
  const target = `http://127.0.0.1:${localPort}`;

  async function inspect() {
    const result = await run(['funnel', 'status', '--json']);
    const status = parseTailscaleFunnelStatus(result.stdout ?? String(result), target);
    return { ...status, target };
  }

  async function enable(port) {
    if (!TAILSCALE_FUNNEL_PORTS.includes(port)) throw Error('Choose a supported Tailscale HTTPS port.');
    let current = await inspect();
    const occupied = current.routes.filter(route => route.port === port);
    const own = occupied.length === 1 && occupied[0].funnel && occupied[0].target === target && occupied[0].handlerCount === 1
      ? occupied[0] : null;
    if (own) return { url: own.url, created: false };
    if (occupied.length || current.occupiedPorts.includes(port)) throw Error(`Tailscale HTTPS port ${port} already serves another route. Choose a free Funnel port.`);

    try { await run(['funnel', `--https=${port}`, '--bg', target], 30000); }
    catch (error) {
      const afterFailure = await inspect().catch(() => null);
      const partial = afterFailure?.routes.filter(route => route.port === port) ?? [];
      if (partial.length && partial.every(route => route.target === target && route.funnel && route.handlerCount === 1))
        await run(['funnel', `--https=${port}`, 'off'], 15000).catch(() => {});
      throw error;
    }
    current = await inspect();
    const created = current.routes.find(route => route.port === port && route.authority &&
      route.funnel && route.target === target && route.handlerCount === 1);
    if (created) return { url: created.url, created: true };

    // The CLI may have partially updated its routing table. Remove only the
    // selected port after proving its complete configuration still points to
    // this app and contains no other handler.
    const partial = current.routes.filter(route => route.port === port);
    if (partial.length && partial.every(route => route.target === target && route.funnel && route.handlerCount === 1)) {
      await run(['funnel', `--https=${port}`, 'off'], 15000).catch(() => {});
    }
    throw Error('Tailscale did not confirm a public HTTPS route to Freelancer. Check the Funnel status and access policy, then try again.');
  }

  async function disable(port) {
    if (!TAILSCALE_FUNNEL_PORTS.includes(port)) throw Error('Choose a supported Tailscale HTTPS port.');
    const current = await inspect();
    const matchingPort = current.routes.filter(route => route.port === port);
    if (!matchingPort.length) return;
    if (matchingPort.length !== 1 || matchingPort.some(route => route.target !== target || !route.funnel || route.handlerCount !== 1))
      throw Error(`Tailscale HTTPS port ${port} now contains another route. It was left unchanged.`);
    await run(['funnel', `--https=${port}`, 'off'], 15000);
    const after = await inspect();
    if (after.routes.some(route => route.port === port) || after.occupiedPorts.includes(port))
      throw Error(`Tailscale still reports a route on HTTPS port ${port}. Check Funnel status before retrying.`);
  }

  return { target, inspect, enable, disable };
}
