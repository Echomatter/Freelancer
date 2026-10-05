import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'computer-provider-fixture', version: '1.0.0' });
server.tool('browser_page_info', 'Return the current page state.', {}, async () => ({ content: [{ type: 'text', text: JSON.stringify({ url: 'http://127.0.0.1/fixture', title: 'Fixture', text: 'ready' }) }] }));
server.tool('browser_goto', 'Navigate to a URL.', { url: z.string() }, async ({ url }) => ({ content: [{ type: 'text', text: JSON.stringify({ url, navigated: true }) }] }));
server.tool('browser_screenshot', 'Capture a screenshot.', {}, async () => ({ content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('fixture-image').toString('base64') }] }));
await server.connect(new StdioServerTransport());
