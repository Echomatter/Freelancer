// Stateful native API fixture. It never launches a command, connects externally,
// opens an OAuth browser or performs model inference.
export function attachMcpHost(host, initial = {}) {
  const original = host.request.bind(host);
  const state = { config: { mcp: structuredClone(initial) }, statuses: {}, calls: [], fail: false, dropPatch: false, disposeFails: false };
  host.request = async (route, options = {}) => {
    if (route === '/global/config' || route === '/mcp' || route.startsWith('/mcp/') || route === '/global/dispose') {
      state.calls.push({ route, options: { ...options, signal: undefined } });
      if (state.fail) throw Error('private-token: do-not-forward');
      if (route === '/global/config') {
        if (options.method === 'PATCH' && !state.dropPatch) {
          for (const [name, config] of Object.entries(options.body.mcp))
            state.config.mcp[name] = { ...state.config.mcp[name], ...structuredClone(config) };
        }
        return structuredClone(state.config);
      }
      if (route === '/global/dispose') {
        if (state.disposeFails) throw Error('private runtime detail');
        return true;
      }
      if (route === '/mcp') return Object.fromEntries(Object.entries(state.config.mcp).map(([name, config]) => [name,
        { status: config.enabled === false ? 'disabled' : state.statuses[name] ?? (config.type === 'remote' && config.oauth !== false ? 'needs_auth' : 'connected') }]));
      const match = route.match(/^\/mcp\/([^/]+)\/(connect|auth\/authenticate|auth)$/);
      if (match) {
        state.statuses[decodeURIComponent(match[1])] = match[2] === 'auth' ? 'needs_auth' : 'connected';
        return true;
      }
      throw Error(`Unexpected fixture MCP path: ${route}`);
    }
    return original(route, options);
  };
  return state;
}
