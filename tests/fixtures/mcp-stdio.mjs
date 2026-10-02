// Harmless native-transport fixture; no file writes, network or model inference.
import readline from 'node:readline';
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  const results = {
    initialize: { protocolVersion: request.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'freelancer-smoke', version: '1.0.0' } },
    'tools/list': { tools: [{ name: 'echo', description: 'Return the supplied test text without side effects.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] },
    'tools/call': { content: [{ type: 'text', text: String(request.params?.arguments?.text ?? '') }] },
    ping: {},
  };
  const response = Object.hasOwn(results, request.method) ? { result: results[request.method] }
    : { error: { code: -32601, message: 'Method not found' } };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response }) + '\n');
});
