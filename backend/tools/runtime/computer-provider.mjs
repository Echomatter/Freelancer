import path from 'node:path';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { classifyComputerService, declaredComputerCapabilities, resolveMcpEnvironment } from './computer-use.mjs';

const unbox = value => value?.data ?? value;
function nodeCli(command, args) {
  if (process.platform !== 'win32' || !/^(?:npx|npm)(?:\.cmd)?$/i.test(command)) return { command, args };
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', `${command.toLowerCase().startsWith('npx') ? 'npx' : 'npm'}-cli.js`);
  if (!existsSync(cli)) return { command, args };
  return { command: process.execPath, args: [cli, ...args.slice(1)] };
}

function installedWindowsProvider(command) {
  if (process.platform !== 'win32' || !/^cua-driver(?:\.exe)?$/i.test(command)) return command;
  const installed = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe');
  return existsSync(installed) ? installed : command;
}

export function createComputerProviderManager({ client, directory, clientFactory } = {}) {
  const active = new Map();
  const makeClient = clientFactory ?? (() => new Client({ name: 'freelancer-computer-use', version: '1.0.0' }));

  async function configurations() {
    const raw = unbox(await client.config.get({ query: { directory } }));
    if (!raw || typeof raw !== 'object' || !raw.mcp || typeof raw.mcp !== 'object') return [];
    return Object.entries(raw.mcp).flatMap(([name, row]) => {
      const kind = classifyComputerService(name, row);
      if (!kind || row?.enabled === false || row?.type !== 'local' || !Array.isArray(row.command) || !row.command.length) return [];
      if (row.command.some(value => typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value))) return [];
      return [{ name, kind, command: row.command[0], args: row.command.slice(1), environment: row.environment ?? {} }];
    });
  }

  async function connect(config, signal) {
    const key = `${directory ?? ''}\0${config.name}`;
    const prior = active.get(key);
    if (prior?.health === 'connected') { prior.lastUsedAt = Date.now(); return prior; }
    if (prior?.promise) return prior.promise;
    const entry = { name: config.name, kind: config.kind, type: config.kind === 'cua-driver' ? 'desktop' : 'browser', health: 'connecting', lastUsedAt: Date.now() };
    entry.promise = (async () => {
      let connection;
      try {
        const mcpClient = makeClient();
        const executable = nodeCli(installedWindowsProvider(config.command), config.args);
        if (/\.(?:cmd|bat)$/i.test(executable.command)) throw Error('Windows command shims are not accepted by the computer provider adapter; configure a native executable.');
        const transport = new StdioClientTransport({ command: executable.command, args: executable.args,
          env: { ...getDefaultEnvironment(), ...resolveMcpEnvironment(config.environment) }, cwd: directory, stderr: 'ignore', maxBufferSize: 8 * 1024 * 1024 });
        connection = { client: mcpClient, transport, close: async () => { await mcpClient.close().catch(() => {}); } };
        await mcpClient.connect(transport, { signal, timeout: 15_000 });
        const observed = await mcpClient.listTools({}, { signal, timeout: 15_000 });
        entry.tools = observed.tools ?? [];
        entry.capabilities = declaredComputerCapabilities(entry.kind, entry.tools);
        entry.health = entry.tools.length ? 'connected' : 'unavailable';
        entry.callTool = (params, options) => mcpClient.callTool(params, undefined, options);
        entry.close = connection.close;
        entry.client = undefined;
        return entry;
      } catch {
        await connection?.close?.();
        entry.tools = [];
        entry.capabilities = declaredComputerCapabilities(entry.kind, null);
        entry.health = 'unavailable';
        entry.close = async () => {};
        return entry;
      } finally { entry.promise = undefined; }
    })();
    active.set(key, entry);
    return entry.promise;
  }

  async function listProviders(signal) {
    let configs;
    try { configs = await configurations(); }
    catch { return []; }
    const connected = await Promise.all(configs.map(config => connect(config, signal)));
    return connected;
  }

  async function close() {
    const rows = [...active.values()]; active.clear();
    await Promise.allSettled(rows.map(row => row.close?.()));
  }
  return { listProviders, close };
}
