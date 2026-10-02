// Shared native MCP configuration, never an agent/model/project access matrix.
export const mcpName = name => {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(name) ||
      ['__proto__', 'constructor', 'prototype'].includes(name)) throw Error('Use a unique service name containing letters, numbers, hyphens or underscores.');
  return name;
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const stringMap = value => {
  if (!object(value) || Object.keys(value).length > 40) throw Error('Provide a JSON object of string values or native environment-variable references.');
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(key) || typeof entry !== 'string' || entry.length > 8192 || entry.includes('\0'))
      throw Error('Environment and header values must be bounded strings; use native {env:VARIABLE_NAME} references for secrets.');
  }
  return { ...value };
};
export function mcpConfig(input) {
  if (!object(input)) throw Error('Provide a local or remote MCP configuration.');
  const allowed = input.type === 'local' ? ['type', 'command', 'environment', 'enabled', 'timeout']
    : input.type === 'remote' ? ['type', 'url', 'headers', 'oauth', 'enabled', 'timeout'] : [];
  if (!allowed.length || Object.keys(input).some(key => !allowed.includes(key))) throw Error('Only native connection fields are accepted; connections are shared by the whole platform.');
  const result = { type: input.type, enabled: input.enabled ?? true };
  if (typeof result.enabled !== 'boolean') throw Error('Choose whether this service is enabled.');
  if (input.type === 'local') {
    if (!Array.isArray(input.command) || !input.command.length || input.command.length > 60 || input.command.some(s => typeof s !== 'string' || !s.trim() || s.length > 2000 || /[\0\r\n]/.test(s)))
      throw Error('Provide the executable and each argument as separate JSON array entries.');
    result.command = [...input.command];
    if (input.environment !== undefined) result.environment = stringMap(input.environment);
  } else {
    let url;
    try { url = new URL(input.url); } catch { throw Error('Provide a valid MCP server URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || String(input.url).length > 4000)
      throw Error('Use an HTTP(S) URL without embedded credentials or a fragment.');
    result.url = url.href;
    if (input.headers !== undefined) result.headers = stringMap(input.headers);
    // OAuth credentials and callbacks stay with OpenCode. Never copy them into app settings.
    if (input.oauth !== undefined) {
      if (input.oauth !== false) throw Error('Use native automatic OAuth, or false for an API-key service.');
      result.oauth = false;
    }
  }
  if (input.timeout !== undefined) {
    if (!Number.isInteger(input.timeout) || input.timeout < 1000 || input.timeout > 120000) throw Error('Connection timeout must be between 1000 and 120000 milliseconds.');
    result.timeout = input.timeout;
  }
  return result;
}
export function capabilityStatus(row) {
  if (row.applicationAccess === 'blocked') return 'Operation restricted';
  if (row.nativePermission === 'deny' || row.configured === false) return 'Explicitly restricted';
  if (row.discovered === false) return 'Not registered';
  if (row.discovered !== true) return 'Unknown';
  if (row.modelExposure === false) return 'Not exposed by this model';
  if (row.dependency === 'missing' || row.dependency === 'unavailable') return 'Dependency unavailable';
  if (row.nativePermission === 'ask') return 'Permission required';
  if (row.nativePermission === 'conditional') return 'Permission depends on operation';
  if (row.nativePermission !== 'allow') return 'Registered · permission unverified';
  if (row.modelExposure !== true || row.dependency !== 'usable') return 'Registered · use unverified';
  return 'Available';
}
