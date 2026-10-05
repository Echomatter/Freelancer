import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const COMPUTER_OPERATIONS = Object.freeze(['status', 'observe', 'execute', 'capture', 'wait', 'end_session']);
export const COMPUTER_TARGETS = Object.freeze(['browser', 'desktop']);
export const COMPUTER_ACTIONS = Object.freeze(['navigate', 'click', 'double_click', 'right_click', 'drag', 'hover', 'type', 'fill', 'press', 'scroll', 'launch', 'focus', 'close', 'select', 'upload', 'javascript', 'verify']);
export const COMPUTER_OUTPUT_LIMIT = 40_000;
const SESSION_TTL_MS = 30 * 60_000;
const SESSION_LIMIT = 64;

const browserTools = Object.freeze({
  observe: ['browser_page_info', 'browser_current_tab', 'browser_snapshot', 'browser_get_state', 'get_browser_state'],
  capture: ['browser_screenshot', 'browser_take_screenshot'],
  wait: ['browser_wait_for_load', 'browser_wait', 'browser_wait_for'],
  navigate: ['browser_goto', 'browser_navigate'],
  launch: ['browser_prepare'],
  click: ['browser_click'], double_click: ['browser_pointer'], right_click: ['browser_pointer'],
  hover: ['browser_pointer', 'browser_hover'], drag: ['browser_pointer'],
  type: ['browser_type'], fill: ['browser_fill', 'browser_fill_form'],
  press: ['browser_press', 'browser_press_key'], scroll: ['browser_scroll', 'browser_pointer'],
  javascript: ['browser_js', 'browser_cdp'], upload: ['browser_upload_file', 'browser_set_input_files'],
  close: ['browser_close_tab', 'browser_close'], select: ['browser_switch_tab'],
});
const desktopTools = Object.freeze({
  observe: ['get_window_state', 'get_accessibility_tree', 'get_desktop_state', 'list_windows', 'list_apps'],
  capture: ['get_window_state', 'get_desktop_state', 'screenshot', 'capture_screenshot'], wait: ['wait', 'wait_for'],
  launch: ['launch_app'], focus: ['focus_window', 'bring_to_front'],
  click: ['click', 'invoke'], double_click: ['double_click'], right_click: ['right_click'], drag: ['drag'],
  type: ['type_text', 'set_value'], fill: ['set_value', 'type_text'],
  press: ['press_key', 'hotkey'], scroll: ['scroll'], select: ['select_item'], verify: ['verify_state'],
});
const toolMap = { browser: browserTools, desktop: desktopTools };
const providerLabel = kind => kind === 'browser' ? 'browser' : 'desktop';

export function classifyComputerService(name, row = {}) {
  const identity = `${name} ${(row.command ?? []).join(' ')}`.toLowerCase();
  if (/browser[-_ ]?harness|browser-harness-mcp/.test(identity)) return 'browser-harness';
  if (/playwright|@playwright\/mcp/.test(identity)) return 'playwright';
  if (/cua[-_ ]?driver|cua-driver/.test(identity)) return 'cua-driver';
  return null;
}

export function resolveMcpEnvironment(source = {}, base = process.env) {
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue;
    output[key] = value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => base[name] ?? '');
  }
  return output;
}

export function declaredComputerCapabilities(kind, tools) {
  if (!Array.isArray(tools)) return { ...Object.fromEntries(['browser', 'desktop', 'structuredControls', 'dom', 'screenshots', 'fileTransfer', 'clipboard', 'nativeWindows'].map(key => [key, null])), operations: null };
  const names = new Set(tools.map(row => row?.name).filter(value => typeof value === 'string'));
  const has = candidates => candidates.some(name => names.has(name));
  const browser = [...names].some(name => name.startsWith('browser_') || name === 'get_browser_state');
  const desktop = ['get_window_state', 'get_desktop_state', 'list_windows', 'list_apps'].some(name => names.has(name));
  const operations = {};
  for (const target of COMPUTER_TARGETS) {
    operations[target] = Object.entries(toolMap[target]).flatMap(([operation, candidates]) => {
      const available = has(candidates) || (target === 'browser' && operation === 'observe' && kind === 'cua-driver' && names.has('list_windows'));
      return available ? [operation] : [];
    });
  }
  for (const target of COMPUTER_TARGETS) if (operations[target].includes('observe')) operations[target].push('wait');
  return {
    browser, desktop,
    structuredControls: names.has('get_window_state') || tools.some(row => /accessibility|control tree|uia/i.test(row?.description ?? '')),
    dom: names.has('browser_snapshot') || names.has('browser_js') || names.has('browser_cdp') || names.has('get_browser_state'),
    screenshots: names.has('get_window_state') || names.has('get_desktop_state') || has([...browserTools.capture, ...desktopTools.capture]),
    fileTransfer: names.has('browser_upload_file') || names.has('browser_set_input_files') || names.has('browser_download_file') || names.has('upload_file') || names.has('download_file'),
    clipboard: names.has('clipboard_read') || names.has('clipboard_write') || names.has('get_clipboard') || names.has('set_clipboard'),
    nativeWindows: kind === 'cua-driver' ? desktop : null,
    operations,
  };
}

export function selectComputerProvider(candidates, { targetType, operation = 'observe', action } = {}) {
  if (!COMPUTER_TARGETS.includes(targetType)) throw Error('Choose a browser or desktop target.');
  const requiredTool = operation === 'execute' ? action : operation;
  const matches = (candidates ?? []).filter(provider => provider?.health === 'connected'
    && provider.capabilities?.[targetType] === true
    && Array.isArray(provider.tools)
    && ((toolMap[targetType]?.[requiredTool] ?? []).some(name => provider.tools.some(row => row?.name === name))
      || (targetType === 'browser' && operation === 'observe' && provider.kind === 'cua-driver' && provider.tools.some(row => row?.name === 'list_windows'))
      || (operation === 'wait' && (toolMap[targetType]?.observe ?? []).some(name => provider.tools.some(row => row?.name === name)))));
  const score = provider => (provider.capabilities?.screenshots === true ? 1 : 0)
    + (targetType === 'browser' && provider.capabilities?.dom === true ? 4 : 0)
    + (targetType === 'desktop' && provider.capabilities?.structuredControls === true ? 4 : 0)
    + (operation === 'execute' && action === 'upload' && provider.capabilities?.fileTransfer === true ? 3 : 0);
  matches.sort((left, right) => score(right) - score(left)); // Stable ties retain native connection order.
  if (!matches.length) throw Object.assign(Error(`No connected provider has observed support for ${targetType} ${requiredTool}.`), { code: 'provider_unavailable' });
  return matches[0];
}

function schemaProperties(tool) {
  return tool?.inputSchema?.properties && typeof tool.inputSchema.properties === 'object' ? tool.inputSchema.properties : {};
}

function providerArguments(tool, request, parameters = {}) {
  const properties = schemaProperties(tool), keys = Object.keys(properties), args = {};
  const offer = (value, ...names) => {
    for (const name of names) if (keys.includes(name) && value !== undefined) { args[name] = value; return; }
  };
  const target = request.targetID;
  const kind = request.targetType;
  const processID = request.processID === undefined ? undefined : Number(request.processID);
  const nativeWindowID = typeof target === 'number' ? target : typeof target === 'string' && /^\d+$/.test(target) ? Number(target) : target;
  if (request.providerKind === 'cua-driver') {
    if (kind === 'browser') {
      offer(parameters.browserTargetID ?? request.browserTargetID, 'target_id');
      offer(parameters.tabID ?? request.tabID, 'tab_id');
      offer(parameters.elementToken, 'ref');
      offer(nativeWindowID, 'window_id', 'windowId');
    } else offer(nativeWindowID, 'window_id', 'windowId');
  } else offer(target, 'tabId', 'tab_id', 'targetId', 'target_id', 'window_id', 'windowId');
  offer(processID, 'pid', 'process_id', 'processId');
  offer(request.url ?? parameters.url, 'url', 'href');
  offer(request.code, 'code', 'script', 'javascript', 'expression');
  if (!(request.providerKind === 'cua-driver' && kind === 'browser')) offer(parameters.selector ?? target, 'selector', 'ref', 'element', 'locator');
  offer(parameters.text, 'text', 'value', 'content');
  offer(parameters.key, 'key', 'keys', 'shortcut');
  offer(parameters.action ?? request.action, 'action');
  offer(parameters.direction, 'direction', 'axis');
  offer(parameters.amount, 'amount', 'delta', 'steps');
  offer(parameters.deltaX, 'delta_x'); offer(parameters.deltaY, 'delta_y');
  offer(parameters.destinationRef, 'destination_ref'); offer(parameters.toX, 'to_x'); offer(parameters.toY, 'to_y');
  offer(parameters.x, 'x'); offer(parameters.y, 'y');
  offer(parameters.elementToken, 'element_token', 'elementToken');
  offer(parameters.elementIndex, 'element_index', 'elementIndex');
  offer(parameters.expect, 'expect', 'expected', 'condition');
  offer(parameters.filePath, 'file_path', 'filePath', 'path');
  offer(parameters.files ?? (parameters.filePath ? [parameters.filePath] : undefined), 'files');
  offer(parameters.app, 'path');
  offer(parameters.launchPath, 'launch_path'); offer(parameters.aumid, 'aumid');
  offer(parameters.bundleID, 'bundle_id');
  offer(parameters.profile, 'profile'); offer(parameters.strategy, 'strategy'); offer(parameters.allowLaunch, 'allow_launch');
  offer(parameters.app, 'app', 'application', 'name');
  offer(request.timeoutMs, 'timeout_ms', 'timeoutMs', 'timeout', 'ms');
  offer(request.sessionID, 'session', 'session_id', 'sessionID');
  if (kind === 'browser' && parameters.tabID !== undefined) offer(parameters.tabID, 'tabId', 'tab_id');
  if (request.providerKind === 'cua-driver' && tool?.name === 'get_window_state') {
    const detail = request.operation === 'capture' ? 'visual' : request.detail ?? 'summary';
    offer(parameters.query, 'query');
    offer(parameters.maxElements ?? (detail === 'controls' ? 500 : 64), 'max_elements');
    offer(parameters.maxDepth ?? (detail === 'controls' ? 18 : 8), 'max_depth');
    offer(detail !== 'visual', 'include_accessibility_tree');
    offer(detail === 'visual', 'include_screenshot');
  }
  return args;
}

function toolFor(provider, operation, action, targetType = provider.type) {
  const names = toolMap[targetType]?.[operation === 'execute' ? action : operation] ?? [];
  return names.map(name => provider.tools.find(row => row?.name === name)).find(Boolean) ?? null;
}

function observationTarget(value) {
  const queue = [value];
  while (queue.length) {
    const row = queue.shift();
    if (!row || typeof row !== 'object') continue;
    if (row.window_id !== undefined || row.windowId !== undefined || row.pid !== undefined || row.process_id !== undefined) return row;
    for (const child of Object.values(row)) if (child && typeof child === 'object') queue.push(child);
  }
  return null;
}

function browserTargetIdentity(value) {
  const queue = [value];
  while (queue.length) {
    const row = queue.shift();
    if (!row || typeof row !== 'object') continue;
    if (typeof row.target_id === 'string' && typeof row.tab_id === 'string') return { targetID: row.target_id, tabID: row.tab_id };
    for (const child of Object.values(row)) if (child && typeof child === 'object') queue.push(child);
  }
  return null;
}

function normalizedContent(result, maxChars = COMPUTER_OUTPUT_LIMIT, { compactUIA = false } = {}) {
  const text = (result?.content ?? []).filter(row => row?.type === 'text' && typeof row.text === 'string').map(row => row.text).join('\n');
  const images = (result?.content ?? []).filter(row => row?.type === 'image' && typeof row.data === 'string').map(row => ({ mimeType: row.mimeType ?? 'image/png', data: row.data }));
  const structured = result?.structuredContent;
  const compactStructured = compactUIA && structured && Array.isArray(structured.elements)
    ? Object.fromEntries(Object.entries(structured).filter(([key]) => key !== 'tree_markdown')) : structured;
  let output = result?.structuredContent === undefined
    ? text || (result?.isError ? 'Provider returned an error without detail.' : 'Provider completed without text output.')
    : JSON.stringify(compactStructured);
  let truncated = false;
  if (output.length > maxChars) { output = output.slice(0, maxChars); truncated = true; }
  let value = result?.structuredContent !== undefined && !truncated ? compactStructured : output;
  if (result?.structuredContent === undefined) { try { value = JSON.parse(output); } catch {} }
  if (result?.isError) {
    const detail = text || (typeof value === 'string' ? value : JSON.stringify(value));
    const message = detail || 'Computer provider returned an error without detail.';
    const code = result?.structuredContent?.code === 'permission_required' || /permission required|awaiting.*approval|user approval/i.test(message) ? 'permission_required'
      : /stale|invalidated|expired.*(?:ref|element|snapshot)|(?:ref|element|snapshot).*(?:stale|invalidated|expired)/i.test(message) ? 'stale_target'
        : /permission|authorization|consent/i.test(message) ? 'permission_denied'
          : /unsupported|not supported|capability/i.test(message) ? 'capability_unavailable' : result?.structuredContent?.code ?? 'provider_error';
    throw Object.assign(Error(message), { code });
  }
  return { value, images, truncated };
}

function imagePath(value) {
  const queue = [[value, '']];
  while (queue.length) {
    const [row, key] = queue.shift();
    if (typeof row === 'string' && /screenshot|image|capture|^path$/i.test(key) && /\.(?:png|jpe?g|webp)$/i.test(row)) return row;
    if (row && typeof row === 'object') for (const [name, child] of Object.entries(row)) queue.push([child, name]);
  }
  return null;
}

export function createComputerUse({ listProviders, clock = () => Date.now(), uuid = randomUUID, captureImage, authorizeProvider } = {}) {
  const sessions = new Map();
  const cleanup = () => {
    for (const [id, row] of sessions) if (clock() - row.touchedAt > SESSION_TTL_MS) sessions.delete(id);
    while (sessions.size > SESSION_LIMIT) sessions.delete(sessions.keys().next().value);
  };
  return {
    async execute(request, context = {}) {
      cleanup();
      if (!COMPUTER_OPERATIONS.includes(request.operation)) throw Error('Choose a supported computer operation.');
      if (request.operation === 'status') {
        const providers = await listProviders(context.abort);
        return { status: providers.some(row => row.health === 'connected') ? 'observed' : 'unavailable',
          note: providers.length ? undefined : 'No supported local computer provider is configured.',
          providers: providers.map(row => ({ name: row.name, kind: row.kind, type: row.type,
            health: row.health, capabilities: row.capabilities })) };
      }
      if (request.operation === 'end_session') {
        const session = sessions.get(request.sessionID);
        if (!session || session.owner !== context.sessionID) throw Object.assign(Error('Computer session was not found for this conversation.'), { code: 'stale_session' });
        const providers = [...new Set(Object.values(session.targets ?? {}).map(target => target.provider).filter(Boolean))];
        for (const provider of providers) {
          const endTool = provider.tools?.find(row => row?.name === 'end_session');
          if (!endTool) continue;
          if (authorizeProvider) await authorizeProvider({ toolName: `${provider.name}_${endTool.name}`,
            targetID: undefined, targetType: 'session', operation: 'end_session', arguments: { session: session.id } }, context);
          await provider.callTool({ name: endTool.name, arguments: { session: session.id } }, { signal: context.abort, timeout: 15_000 });
        }
        sessions.delete(request.sessionID);
        return { status: 'ended', sessionID: request.sessionID };
      }
      if (!COMPUTER_TARGETS.includes(request.targetType)) throw Error('Choose a browser or desktop target.');
      if (request.operation === 'execute' && !COMPUTER_ACTIONS.includes(request.action)) throw Error('Choose a supported computer action.');
      if (request.operation === 'execute' && request.targetType === 'browser' && request.action === 'javascript' && (typeof request.code !== 'string' || !request.code.trim())) throw Error('Browser JavaScript execution requires code.');
      if (request.operation === 'execute' && request.action === 'navigate' && !(request.url || request.parametersJson)) throw Error('Navigation requires a URL.');
      if (request.timeoutMs !== undefined && (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 30_000)) throw Error('timeoutMs must be between 1 and 30000.');
      let session = request.sessionID ? sessions.get(request.sessionID) : null;
      if (session && session.owner !== context.sessionID) throw Object.assign(Error('Computer session belongs to another conversation.'), { code: 'stale_session' });
      if (request.sessionID && !session) throw Object.assign(Error('Computer session is stale or expired. Observe a target to start a new session.'), { code: 'stale_session' });
      if (request.operation !== 'observe' && !session) throw Object.assign(Error('Observe the target first and pass the returned sessionID before acting.'), { code: 'stale_session' });
      if (session && !session.targets) session.targets = Object.create(null); // Upgrade sessions created by the earlier single-target contract.
      let targetState = session?.targets?.[request.targetType] ?? null;
      if (request.operation === 'observe') {
        const providers = await listProviders(context.abort);
        const selected = selectComputerProvider(providers, { targetType: request.targetType, operation: request.operation, action: request.action });
        session ??= { id: uuid(), owner: context.sessionID, targets: Object.create(null), touchedAt: clock() };
        if (!sessions.has(session.id)) sessions.set(session.id, session);
        targetState ??= { targetType: request.targetType, provider: selected, targetID: null, processID: null,
          browserTargetID: null, tabID: null };
        if (targetState.provider !== selected) Object.assign(targetState, { provider: selected, targetID: null, processID: null,
          browserTargetID: null, tabID: null });
        session.targets[request.targetType] = targetState;
      }
      if (!session) throw Error('Computer session could not be established.');
      if (!targetState) throw Object.assign(Error(`Observe the ${request.targetType} target in this computer session before acting.`), { code: 'stale_target' });
      if (request.targetID !== undefined && targetState.targetID && request.targetID !== targetState.targetID && request.operation !== 'observe')
        throw Object.assign(Error('Target identity changed since the last observation. Observe again before acting.'), { code: 'stale_target' });
      if (request.processID !== undefined && targetState.processID !== null && Number(request.processID) !== Number(targetState.processID) && request.operation !== 'observe')
        throw Object.assign(Error('Process identity changed since the last observation. Observe the selected process again before acting.'), { code: 'stale_target' });
      const operation = request.operation;
      const method = operation === 'execute' ? request.action : operation;
      if (operation !== 'observe' && targetState.provider.kind === 'cua-driver' && method !== 'launch'
        && (request.targetType === 'desktop' && (!targetState.targetID || !targetState.processID)
          || request.targetType === 'browser' && (!targetState.browserTargetID || !targetState.tabID)))
        throw Object.assign(Error('Choose an exact observed CUA window or browser tab before acting; inventory observations do not bind an arbitrary target.'), { code: 'stale_target' });
      let providerTool = toolFor(targetState.provider, operation, request.action, request.targetType)
        ?? (operation === 'wait' ? toolFor(targetState.provider, 'observe', undefined, request.targetType) : null);
      if (operation === 'observe' && request.targetType === 'browser' && targetState.provider.kind === 'cua-driver' && (!request.targetID || !request.processID)) {
        providerTool = targetState.provider.tools.find(row => row?.name === 'list_windows') ?? providerTool;
      }
      if (operation === 'observe' && request.targetType === 'desktop' && (!request.targetID || !request.processID)) {
        providerTool = ['list_windows', 'get_desktop_state', 'list_apps'].map(name => targetState.provider.tools.find(row => row?.name === name)).find(Boolean) ?? providerTool;
      }
      if (!providerTool) throw Object.assign(Error(`Selected provider does not expose a verified ${request.targetType} ${method} operation.`), { code: 'capability_unavailable' });
      let parameters = {};
      if (request.parametersJson !== undefined) {
        try { parameters = JSON.parse(request.parametersJson); } catch { throw Error('parametersJson must be valid JSON.'); }
        if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw Error('parametersJson must contain a JSON object.');
      }
      if (request.operation !== 'observe' && request.targetType === 'browser' && targetState.provider.kind === 'cua-driver'
        && ((parameters.browserTargetID !== undefined && parameters.browserTargetID !== targetState.browserTargetID)
          || (parameters.tabID !== undefined && parameters.tabID !== targetState.tabID)))
        throw Object.assign(Error('Browser target or tab identity changed since the last observation. Observe the selected tab again before acting.'), { code: 'stale_target' });
      const toolArgs = providerArguments(providerTool, { ...request, providerKind: targetState.provider.kind,
        targetID: request.targetID ?? targetState.targetID, processID: request.processID ?? targetState.processID,
        sessionID: session.id, browserTargetID: targetState.browserTargetID, tabID: targetState.tabID }, parameters);
      context.abort?.throwIfAborted?.();
      if (authorizeProvider) await authorizeProvider({ toolName: `${targetState.provider.name}_${providerTool.name}`,
        targetID: request.targetID ?? targetState.targetID, targetType: request.targetType, operation, arguments: toolArgs }, context);
      if (operation === 'wait' && !toolMap[request.targetType]?.wait?.some(name => name === providerTool.name)) {
        const delay = Math.max(0, Math.min(Number(parameters.durationMs ?? 1000), 30_000));
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          const abort = () => { clearTimeout(timer); reject(context.abort.reason ?? new DOMException('Computer wait cancelled.', 'AbortError')); };
          if (context.abort?.aborted) abort(); else context.abort?.addEventListener('abort', abort, { once: true });
        });
      }
      if (providerTool.name === 'browser_click' && parameters.selector && schemaProperties(providerTool).x && schemaProperties(providerTool).y
        && (toolArgs.x === undefined || toolArgs.y === undefined)) {
        const evaluator = targetState.provider.tools.find(row => row?.name === 'browser_js');
        if (!evaluator) throw Object.assign(Error('The browser provider requires coordinates and cannot resolve the requested selector.'), { code: 'capability_unavailable' });
        const expression = `(() => { const element = document.querySelector(${JSON.stringify(parameters.selector)}); if (!element) throw new Error('Selector not found'); const rect = element.getBoundingClientRect(); return JSON.stringify({x:rect.left+rect.width/2,y:rect.top+rect.height/2}); })()`;
        const evaluationArgs = providerArguments(evaluator, { ...request, providerKind: targetState.provider.kind, code: expression }, {});
        const evaluation = normalizedContent(await targetState.provider.callTool({ name: evaluator.name, arguments: evaluationArgs },
          { signal: context.abort, timeout: request.timeoutMs ?? 15_000 }));
        let point = evaluation.value;
        if (typeof point === 'string') { try { point = JSON.parse(point); } catch {} }
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) throw Object.assign(Error('The browser provider did not return valid coordinates for the observed selector.'), { code: 'invalid_target' });
        toolArgs.x = Math.round(point.x); toolArgs.y = Math.round(point.y);
      }
      const raw = await targetState.provider.callTool({ name: providerTool.name, arguments: toolArgs }, { signal: context.abort, timeout: request.timeoutMs ?? 15_000 });
      const output = normalizedContent(raw, COMPUTER_OUTPUT_LIMIT,
        { compactUIA: targetState.provider.kind === 'cua-driver' && providerTool.name === 'get_window_state' });
      if (operation === 'observe') {
        const identity = ['list_windows', 'list_apps'].includes(providerTool.name) ? null : observationTarget(output.value);
        const observedTarget = identity?.window_id ?? identity?.windowId;
        targetState.targetID = request.targetID ?? (observedTarget === undefined ? targetState.targetID : String(observedTarget));
        targetState.processID = request.processID ?? identity?.pid ?? identity?.process_id ?? targetState.processID;
        if (request.targetType === 'browser' && targetState.provider.kind === 'cua-driver') {
          const browserIdentity = browserTargetIdentity(output.value);
          if (browserIdentity) { targetState.browserTargetID = browserIdentity.targetID; targetState.tabID = browserIdentity.tabID; }
        }
      }
      if (request.targetID !== undefined) targetState.targetID = request.targetID;
      if (request.processID !== undefined) targetState.processID = request.processID;
      session.touchedAt = clock();
      let attachments = [];
      if (captureImage) {
        const imagePayloads = [...output.images];
        if (operation === 'capture') {
          const file = imagePath(output.value);
          if (file) {
            const resolved = path.resolve(file);
            const details = await stat(resolved).catch(() => null);
            if (details?.isFile() && details.size > 0 && details.size <= 8 * 1024 * 1024) {
              const ext = path.extname(resolved).toLowerCase();
              const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              imagePayloads.push({ mimeType, data: (await readFile(resolved)).toString('base64') });
            }
          }
        }
        attachments = await Promise.all(imagePayloads.map(image => captureImage(image, { sessionID: session.id, ownerSessionID: context.sessionID })));
      }
      const response = {
        status: 'executed', operation, action: operation === 'execute' ? request.action : undefined,
        targetType: providerLabel(request.targetType), target: targetState.targetID ?? null,
        providerKind: targetState.provider.kind,
        ...(targetState.browserTargetID && targetState.tabID ? { browserTarget: { targetID: targetState.browserTargetID, tabID: targetState.tabID } } : {}),
        sessionID: session.id, observedAt: clock(), result: output.value,
        truncated: output.truncated, verification: operation === 'observe' || operation === 'capture' ? 'observed' : 'not_verified',
        evidence: {
          action: operation === 'execute' ? { status: 'completed', name: request.action } : { status: 'not_applicable' },
          state: operation === 'observe' || operation === 'capture'
            ? { status: 'observed', kind: operation === 'capture' ? 'visual' : request.detail === 'controls' ? 'structured_controls' : 'provider_state' }
            : { status: 'not_observed' },
          outcome: { status: 'not_verified' },
        },
        ...(attachments.length ? { captures: attachments.map(({ filename, mime, url }) => ({ filename, mime, url })) } : {}),
      };
      return { ...response, attachments };
    },
    close: async () => {
      const rows = [...sessions.values()]; sessions.clear();
      const providers = [...new Set(rows.flatMap(row => Object.values(row.targets ?? {}).map(target => target.provider).filter(Boolean)))];
      await Promise.allSettled(providers.map(provider => provider.close?.()));
    },
  };
}
