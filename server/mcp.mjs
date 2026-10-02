import { createHash } from 'node:crypto';
import { mcpName, mcpConfig } from '../domain/mcp.mjs';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const revision = config => createHash('sha256').update(JSON.stringify(config.mcp ?? {})).digest('hex');
const conflict = message => Object.assign(Error(message), { status: 409 });
const statuses = new Set(['connected', 'disabled', 'failed', 'error', 'unavailable', 'needs_setup', 'needs_auth', 'needs_client_registration']);
const statusReason = status => ({
  connected: 'OpenCode reports a connected server; a successful model tool call is not verified.',
  failed: 'OpenCode reports a connection failure. Check the command/dependencies or remote URL/credentials, then retry.',
  error: 'OpenCode reported an MCP error. Check native diagnostics and retry.',
  unavailable: 'OpenCode could not inspect this MCP server.',
  needs_setup: 'OpenCode reports that additional server setup is required.',
  needs_auth: 'OpenCode reports that this server needs authentication.',
  needs_client_registration: 'OpenCode reports that OAuth client registration is required.',
  unverified: 'The server is configured, but OpenCode did not report a recognized connection state.',
})[status] ?? 'OpenCode did not provide a connection diagnostic.';

// Uses the app-local native global config. No second MCP client, credential store,
// project selector, tool allowlist or per-persona entitlement is introduced.
export function createMcpConnections({ host, backendRoot, changeConnections }) {
  let active = false;
  async function config() {
    const value = await host.request('/global/config', { signal: AbortSignal.timeout(15000) });
    if (!record(value) || (value.mcp !== undefined && !record(value.mcp))) throw Error('Unsupported native configuration.');
    return value;
  }
  async function read() {
    let saved;
    try { saved = await config(); }
    catch { return { scope: 'platform', state: 'unavailable', services: [], reason: 'Native shared MCP configuration is unavailable. Existing connections were not changed.' }; }
    let observed = null;
    try { const value = await host.request('/mcp', { directory: backendRoot, signal: AbortSignal.timeout(15000) }); if (record(value)) observed = value; } catch {}
    return { scope: 'platform', state: 'observed', revision: revision(saved),
      services: Object.entries(saved.mcp ?? {}).map(([name, row]) => ({ name,
        type: ['local', 'remote'].includes(row?.type) ? row.type : 'inherited',
        enabled: row?.enabled !== false,
        status: row?.enabled === false ? 'disabled' : !observed ? 'unavailable' : statuses.has(observed?.[name]?.status) ? observed[name].status : 'unverified',
        authentication: row?.type === 'remote' && row.oauth !== false ? 'native-oauth' : 'external',
        // Do not forward URLs, commands, environment values, tokens or upstream errors.
        reason: !observed ? 'Connection health could not be observed. Registration is not proof of successful tool use.' :
          statusReason(row?.enabled === false ? 'disabled' : statuses.has(observed?.[name]?.status) ? observed[name].status : 'unverified') })),
      note: 'Shared with every agent, model and project. Native permission decisions and actual model support still apply. A connected service is not proof that a model used its tools.' };
  }
  async function act(input = {}) {
    const { action, name: value, expectedRevision } = input;
    if (!['add', 'enable', 'disable', 'retry', 'authenticate', 'logout'].includes(action)) throw Error('Choose an MCP connection action.');
    if (Object.keys(input).some(key => !['action', 'name', 'config', 'expectedRevision'].includes(key))) throw Error('MCP connections are platform-wide, not agent, model or project assignments.');
    const name = mcpName(value);
    const addition = action === 'add' ? mcpConfig(input.config) : null;
    if (active) throw conflict('A connection change is in progress. Refresh before trying again.');
    active = true;
    let saved = false;
    try {
      await changeConnections(async () => {
        const current = await config();
        if (typeof expectedRevision !== 'string' || expectedRevision !== revision(current)) throw conflict('Connections changed. Refresh before applying this action.');
        const existing = current.mcp?.[name];
        if (addition && existing !== undefined) throw conflict('This service name already exists. Choose a different name.');
        if (!addition && existing === undefined) throw conflict('This service no longer exists. Refresh connections.');
        if (['retry', 'authenticate'].includes(action) && existing.enabled === false) throw Error('Enable this service before connecting.');
        if (['authenticate', 'logout'].includes(action) && (existing.type !== 'remote' || existing.oauth === false)) throw Error('This service does not use native OAuth.');
        if (addition || ['enable', 'disable'].includes(action)) {
          const patch = addition ?? { enabled: action === 'enable' };
          await host.request('/global/config', { method: 'PATCH', body: { mcp: { [name]: patch } } });
          // Read back persisted config; a native HTTP acknowledgement is insufficient.
          const confirmed = (await config()).mcp?.[name];
          if (!record(confirmed) || confirmed.enabled !== patch.enabled || (addition && (confirmed.type !== addition.type || (addition.type === 'local' ? JSON.stringify(confirmed.command) !== JSON.stringify(addition.command) : confirmed.url !== addition.url)))) throw Error('Native configuration was not confirmed.');
          saved = true;
        } else {
          const suffix = action === 'retry' ? 'connect' : action === 'authenticate' ? 'auth/authenticate' : 'auth';
          await host.request(`/mcp/${encodeURIComponent(name)}/${suffix}`, {
            directory: backendRoot, method: action === 'logout' ? 'DELETE' : 'POST',
            signal: AbortSignal.timeout(action === 'authenticate' ? 180000 : 30000) });
        }
      });
      return { saved, action, ...(await read()) };
    } catch (error) {
      if (error.status === 409) throw error;
      if (saved) return { saved: true, action, ...(await read()), activation: 'unverified',
        notice: 'The native configuration was saved, but runtime refresh was not confirmed. Restart Freelancer before relying on the change.' };
      // Native errors may contain URLs or credentials. Never copy them to the UI.
      throw Object.assign(Error('The MCP action was not confirmed. Refresh connection status before retrying; no success is claimed.'), { status: 503 });
    } finally { active = false; }
  }
  return { read, act };
}
