// Suggested shared MCP configurations. OpenCode remains the connection runtime;
// these are generic setup defaults, not identity-specific tool assignments.
export const mcpCatalog = [
  { id: 'playwright', name: 'Playwright', kind: 'local', cost: 'Free · runs locally', dependency: 'Node.js/npm; browser runtime may need setup', command: ['npx', '-y', '@playwright/mcp@latest'] },
  { id: 'fetch', name: 'Fetch', kind: 'local', cost: 'Free · runs locally', dependency: 'Python and uvx (uv)', command: ['uvx', 'mcp-server-fetch'] },
  { id: 'sequential-thinking', name: 'Sequential Thinking', kind: 'local', cost: 'Free · runs locally', dependency: 'Node.js/npm', command: ['npx', '-y', '@modelcontextprotocol/server-sequential-thinking'] },
  { id: 'context7', name: 'Context7', kind: 'remote', cost: 'External service · free use; optional API key for higher limits', dependency: 'HTTPS connection; optional Context7 API key', url: 'https://mcp.context7.com/mcp', header: 'Authorization', value: 'Bearer {env:CONTEXT7_API_KEY}' },
  { id: 'jev', name: 'JEV', kind: 'local', provider: 'External TypeSafe API · community MCP adapter', cost: 'External service · usage-priced; check current TypeSafe account pricing', dependency: 'Node.js 20.12+; JEV_API_KEY host environment variable', environment: { TYPESAFE_API_KEY: '{env:JEV_API_KEY}' }, command: ['npx', '-y', 'jev-mcp@0.5.1'] },
];

export function mcpPreset(id) { return mcpCatalog.find(row => row.id === id) ?? null; }
