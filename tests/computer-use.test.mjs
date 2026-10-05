import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createComputerUse, classifyComputerService, declaredComputerCapabilities, resolveMcpEnvironment, selectComputerProvider } from '../backend/tools/runtime/computer-use.mjs';
import { createComputerProviderManager } from '../backend/tools/runtime/computer-provider.mjs';

const browserTools = [
  { name: 'browser_page_info', inputSchema: { properties: {} } },
  { name: 'browser_goto', inputSchema: { properties: { url: { type: 'string' } } } },
  { name: 'browser_screenshot', inputSchema: { properties: {} } },
];
const browserProvider = { name: 'fixture', kind: 'browser-harness', type: 'browser', health: 'connected', tools: browserTools,
  capabilities: declaredComputerCapabilities('browser-harness', browserTools), calls: [],
  async callTool(params) {
    this.calls.push(params);
    if (params.name === 'browser_page_info') return { content: [{ type: 'text', text: JSON.stringify({ url: 'http://127.0.0.1', title: 'Fixture' }) }] };
    if (params.name === 'browser_goto') return { content: [{ type: 'text', text: JSON.stringify({ url: params.arguments.url, navigated: true }) }] };
    return { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('image').toString('base64') }] };
  } };

test('computer provider selection requires observed capabilities and uses configured order for equal matches', () => {
  const playwright = { ...browserProvider, kind: 'playwright' };
  assert.equal(selectComputerProvider([playwright, browserProvider], { targetType: 'browser', operation: 'observe' }), playwright);
  assert.equal(selectComputerProvider([browserProvider, playwright], { targetType: 'browser', operation: 'observe' }), browserProvider);
  assert.throws(() => selectComputerProvider([{ ...browserProvider, capabilities: { browser: null } }], { targetType: 'browser' }), { code: 'provider_unavailable' });
  assert.throws(() => selectComputerProvider([browserProvider], { targetType: 'desktop' }), { code: 'provider_unavailable' });
});

test('computer capability maps native service names without exposing credentials', () => {
  assert.equal(classifyComputerService('computer-browser-harness'), 'browser-harness');
  assert.equal(classifyComputerService('Cua_Driver'), 'cua-driver');
  assert.equal(classifyComputerService('playwright'), 'playwright');
  assert.equal(classifyComputerService('arbitrary-service'), null);
  assert.deepEqual(resolveMcpEnvironment({ TOKEN: '{env:TEST_COMPUTER_TOKEN}', EMPTY: '{env:MISSING_COMPUTER_TOKEN}' }, { TEST_COMPUTER_TOKEN: 'secret' }), { TOKEN: 'secret', EMPTY: '' });
  const unknown = declaredComputerCapabilities('cua-driver', null);
  assert.equal(unknown.desktop, null);
  assert.equal(unknown.screenshots, null);
});

test('computer sessions require observe, stay conversation scoped, and report actions separately from verification', async () => {
  const computer = createComputerUse({ listProviders: async () => [browserProvider], uuid: () => 'computer-session-1', clock: () => 100 });
  const owner = { sessionID: 'native-session-a' };
  await assert.rejects(computer.execute({ operation: 'execute', targetType: 'browser', action: 'navigate', url: 'http://example.test' }, owner), { code: 'stale_session' });
  const observed = await computer.execute({ operation: 'observe', targetType: 'browser' }, owner);
  assert.equal(observed.status, 'executed');
  assert.equal(observed.sessionID, 'computer-session-1');
  assert.equal(observed.verification, 'observed');
  assert.deepEqual(observed.evidence.state, { status: 'observed', kind: 'provider_state' });
  assert.equal(observed.evidence.outcome.status, 'not_verified');
  await assert.rejects(computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    action: 'navigate', url: 'http://example.test' }, { sessionID: 'native-session-b' }), { code: 'stale_session' });
  const navigated = await computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    action: 'navigate', url: 'http://example.test' }, owner);
  assert.deepEqual(navigated.result, { url: 'http://example.test', navigated: true });
  assert.equal(navigated.verification, 'not_verified');
  assert.deepEqual(navigated.evidence.action, { status: 'completed', name: 'navigate' });
  assert.equal(navigated.evidence.state.status, 'not_observed');
  assert.equal(navigated.evidence.outcome.status, 'not_verified');
  assert.equal(browserProvider.calls.at(-1).name, 'browser_goto');
});

test('one computer session can continue across browser and desktop targets', async () => {
  const desktopTools = [
    { name: 'list_windows', inputSchema: { properties: {} } },
    { name: 'get_window_state', inputSchema: { properties: { pid: {}, window_id: {}, session: {} } } },
  ];
  const desktop = { name: 'fixture-desktop', kind: 'cua-driver', type: 'desktop', health: 'connected', tools: desktopTools,
    capabilities: declaredComputerCapabilities('cua-driver', desktopTools), async callTool() {
      return { structuredContent: { windows: [{ pid: 9, window_id: 51, title: 'Calculator' }] } };
    } };
  const browser = { ...browserProvider, calls: [] };
  const computer = createComputerUse({ listProviders: async () => [desktop, browser], uuid: () => 'shared-session' });
  const owner = { sessionID: 'native-session' };
  const first = await computer.execute({ operation: 'observe', targetType: 'browser' }, owner);
  const next = await computer.execute({ operation: 'observe', targetType: 'desktop', sessionID: first.sessionID,
    targetID: '51', processID: 9 }, owner);
  assert.equal(next.sessionID, first.sessionID);
  assert.equal(next.targetType, 'desktop');
  assert.equal(next.target, '51');
});

test('computer captures image evidence as a managed attachment and rejects changed target identity', async () => {
  const provider = { ...browserProvider, calls: [] };
  const computer = createComputerUse({ listProviders: async () => [provider], uuid: () => 'capture-session',
    captureImage: async image => ({ filename: 'capture.png', mime: image.mimeType, url: `data:${image.mimeType};base64,${image.data}` }) });
  const owner = { sessionID: 'native-session' };
  const observed = await computer.execute({ operation: 'observe', targetType: 'browser', targetID: 'tab-1' }, owner);
  const captured = await computer.execute({ operation: 'capture', targetType: 'browser', sessionID: observed.sessionID }, owner);
  assert.equal(captured.attachments[0].filename, 'capture.png');
  assert.equal(captured.verification, 'observed');
  await assert.rejects(computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    targetID: 'tab-2', action: 'click' }, owner), { code: 'stale_target' });
});

test('computer preserves each selected provider operation permission and stops on native denial', async () => {
  const provider = { ...browserProvider, calls: [] };
  const approvals = [];
  const computer = createComputerUse({ listProviders: async () => [provider], uuid: () => 'permission-session',
    authorizeProvider: async request => { approvals.push(request.toolName); if (request.toolName === 'fixture_browser_goto') throw Error('Native permission denied.'); } });
  const owner = { sessionID: 'native-session' };
  const observed = await computer.execute({ operation: 'observe', targetType: 'browser' }, owner);
  assert.deepEqual(approvals, ['fixture_browser_page_info']);
  const priorCalls = provider.calls.length;
  await assert.rejects(computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    action: 'navigate', url: 'http://example.test' }, owner), /Native permission denied/);
  assert.deepEqual(approvals, ['fixture_browser_page_info', 'fixture_browser_goto']);
  assert.equal(provider.calls.length, priorCalls);
});

test('Cua browser sessions bind window identity and keep element references separate', async () => {
  const calls = [];
  const tools = [
    { name: 'list_windows', inputSchema: { properties: {} } },
    { name: 'get_browser_state', inputSchema: { properties: { pid: {}, window_id: {}, session: {} } } },
    { name: 'browser_click', inputSchema: { properties: { session: {}, target_id: {}, tab_id: {}, ref: {} } } },
  ];
  const provider = { name: 'cua-driver', kind: 'cua-driver', type: 'desktop', health: 'connected', tools,
    capabilities: declaredComputerCapabilities('cua-driver', tools),
    async callTool(request) {
      calls.push(request);
      if (request.name === 'list_windows') return { structuredContent: { windows: [{ pid: 42, window_id: 7 }] } };
      if (request.name === 'get_browser_state') return { structuredContent: { target_id: 'page-3', tab_id: 'tab-5', snapshot_id: 'snapshot-8' } };
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
    } };
  const computer = createComputerUse({ listProviders: async () => [provider], uuid: () => 'cua-session' });
  const owner = { sessionID: 'native-session' };
  const found = await computer.execute({ operation: 'observe', targetType: 'browser' }, owner);
  assert.equal(found.target, null);
  await assert.rejects(computer.execute({ operation: 'execute', targetType: 'browser', sessionID: found.sessionID,
    action: 'navigate', url: 'http://example.test' }, owner), { code: 'stale_target' });
  const observed = await computer.execute({ operation: 'observe', targetType: 'browser', sessionID: found.sessionID,
    targetID: '7', processID: 42 }, owner);
  assert.equal(calls.at(-1).name, 'get_browser_state');
  assert.deepEqual(calls.at(-1).arguments, { pid: 42, window_id: 7, session: 'cua-session' });
  assert.deepEqual(observed.browserTarget, { targetID: 'page-3', tabID: 'tab-5' });
  await assert.rejects(computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    targetID: '7', processID: 42, action: 'click',
    parametersJson: JSON.stringify({ browserTargetID: 'page-other', tabID: 'tab-other', elementToken: 'button-ref-9' }) }, owner), { code: 'stale_target' });
  await computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    targetID: '7', processID: 42, action: 'click', parametersJson: JSON.stringify({ elementToken: 'button-ref-9' }) }, owner);
  assert.deepEqual(calls.at(-1).arguments, { session: 'cua-session', target_id: 'page-3', tab_id: 'tab-5', ref: 'button-ref-9' });
});

test('Cua UIA observations are bounded by default and can request a deeper controls view', async () => {
  const calls = [];
  const tools = [
    { name: 'list_windows', inputSchema: { properties: {} } },
    { name: 'get_window_state', inputSchema: { properties: { pid: {}, window_id: {}, session: {}, max_elements: {}, max_depth: {}, include_accessibility_tree: {}, include_screenshot: {} } } },
  ];
  const provider = { name: 'cua-driver', kind: 'cua-driver', type: 'desktop', health: 'connected', tools,
    capabilities: declaredComputerCapabilities('cua-driver', tools), async callTool(request) {
      calls.push(request);
      return { structuredContent: request.name === 'list_windows' ? { windows: [{ pid: 4, window_id: 6 }] } : { window_title: 'Calculator', elements: [] } };
    } };
  const computer = createComputerUse({ listProviders: async () => [provider], uuid: () => 'bounded-cua-session' });
  const owner = { sessionID: 'native-session' };
  const observed = await computer.execute({ operation: 'observe', targetType: 'desktop' }, owner);
  await computer.execute({ operation: 'observe', targetType: 'desktop', sessionID: observed.sessionID,
    targetID: '6', processID: 4 }, owner);
  assert.deepEqual(calls.at(-1).arguments, { pid: 4, window_id: 6, session: 'bounded-cua-session',
    max_elements: 64, max_depth: 8, include_accessibility_tree: true, include_screenshot: false });
  await computer.execute({ operation: 'observe', targetType: 'desktop', sessionID: observed.sessionID,
    targetID: '6', processID: 4, detail: 'controls' }, owner);
  assert.equal(calls.at(-1).arguments.max_elements, 500);
  assert.equal(calls.at(-1).arguments.max_depth, 18);
  await computer.execute({ operation: 'capture', targetType: 'desktop', sessionID: observed.sessionID,
    targetID: '6', processID: 4 }, owner);
  assert.equal(calls.at(-1).arguments.include_accessibility_tree, false);
  assert.equal(calls.at(-1).arguments.include_screenshot, true);
});

test('Cua invalidated element tokens become stale-target failures', async () => {
  const tools = [
    { name: 'list_windows', inputSchema: { properties: {} } },
    { name: 'get_window_state', inputSchema: { properties: { pid: {}, window_id: {}, session: {} } } },
    { name: 'click', inputSchema: { properties: { pid: {}, window_id: {}, session: {}, element_token: {} } } },
  ];
  const provider = { name: 'cua-driver', kind: 'cua-driver', type: 'desktop', health: 'connected', tools,
    capabilities: declaredComputerCapabilities('cua-driver', tools), async callTool(request) {
      if (request.name === 'list_windows') return { structuredContent: { windows: [{ pid: 4, window_id: 6 }] } };
      if (request.name === 'click') return { isError: true, structuredContent: { code: 'tool_invocation_failed' },
        content: [{ type: 'text', text: 'The element token was invalidated by a newer snapshot.' }] };
      return { structuredContent: { window_title: 'Calculator', elements: [] } };
    } };
  const computer = createComputerUse({ listProviders: async () => [provider], uuid: () => 'stale-ref-session' });
  const owner = { sessionID: 'native-session' };
  const session = await computer.execute({ operation: 'observe', targetType: 'desktop' }, owner);
  await computer.execute({ operation: 'observe', targetType: 'desktop', sessionID: session.sessionID, targetID: '6', processID: 4 }, owner);
  await assert.rejects(computer.execute({ operation: 'execute', targetType: 'desktop', sessionID: session.sessionID,
    targetID: '6', processID: 4, action: 'click', parametersJson: JSON.stringify({ elementToken: 'old-token' }) }, owner), { code: 'stale_target' });
});

test('provider manager connects only named local provider MCPs and normalizes the real stdio contract', async t => {
  const fixture = path.resolve('tests/fixtures/computer-mcp-server.mjs');
  const manager = createComputerProviderManager({ directory: process.cwd(), client: { config: { get: async () => ({ data: { mcp: {
    'browser-harness': { type: 'local', command: [process.execPath, fixture], enabled: true },
    'cua-driver': { type: 'local', command: [process.execPath, fixture], enabled: false },
    'other-service': { type: 'local', command: [process.execPath, fixture], enabled: true },
  } } }) } } });
  t.after(() => manager.close());
  const providers = await manager.listProviders();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].kind, 'browser-harness');
  assert.equal(providers[0].health, 'connected');
  assert.equal(providers[0].capabilities.browser, true);
  assert.equal((await providers[0].callTool({ name: 'browser_page_info', arguments: {} })).content[0].text.includes('fixture'), true);
});
