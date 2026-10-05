import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createComputerProviderManager } from '../backend/tools/runtime/computer-provider.mjs';
import { createComputerUse } from '../backend/tools/runtime/computer-use.mjs';

if (process.platform !== 'win32') throw Error('The Cua Driver smoke requires Windows.');
const driver = process.env.CUA_DRIVER_PATH
  ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe');
if (!existsSync(driver)) throw Error('Cua Driver was not found. Set CUA_DRIVER_PATH to its installed executable.');
const driverVersion = (() => {
  try { return JSON.parse(execFileSync(driver, ['doctor', '--json'], { encoding: 'utf8', windowsHide: true })).build?.version ?? 'unknown'; }
  catch { return 'unknown'; }
})();

const providerName = 'cua-driver';
const manager = createComputerProviderManager({ directory: process.cwd(), client: { config: { get: async () => ({
  data: { mcp: { [providerName]: { type: 'local', command: [driver, 'mcp'], enabled: true } } },
}) } } });
const authorizationChecks = [];
const computer = createComputerUse({ listProviders: manager.listProviders,
  authorizeProvider: async request => { authorizationChecks.push(request.toolName); },
  captureImage: async image => ({ filename: 'cua-smoke.png', mime: image.mimeType, bytes: Buffer.from(image.data, 'base64').length }) });
const context = { sessionID: `cua-driver-smoke-${process.pid}` };
let observed;
try {
  const providers = await manager.listProviders();
  const provider = providers.find(row => row.kind === 'cua-driver');
  assert.equal(provider?.health, 'connected', 'Cua Driver stdio MCP must connect');
  assert.equal(provider.capabilities.nativeWindows, true, 'Windows capability must come from observed tools');
  assert.equal(provider.capabilities.structuredControls, true, 'UIA capability must come from observed tools');
  assert.equal(provider.capabilities.screenshots, true, 'capture capability must come from observed tools');

  observed = await computer.execute({ operation: 'observe', targetType: 'desktop' }, context);
  const installedApps = await provider.callTool({ name: 'list_apps', arguments: { session: observed.sessionID } }, { timeout: 15_000 });
  const appData = installedApps.structuredContent ?? JSON.parse(installedApps.content?.find(row => row.type === 'text')?.text ?? '{}');
  const calculatorApp = (appData.apps ?? []).find(row => /calculator/i.test(row.name ?? '') && row.launch_path);
  assert.ok(calculatorApp, 'Windows Calculator must be present in the CUA app catalog');
  const windows = await provider.callTool({ name: 'list_windows', arguments: { session: observed.sessionID } }, { timeout: 15_000 });
  let windowData = windows.structuredContent ?? JSON.parse(windows.content?.find(row => row.type === 'text')?.text ?? '{}');
  let calculator = (windowData.windows ?? []).find(row => /calculator/i.test(row.title ?? row.app_name ?? ''));
  let launched = { operation: 'reused-existing-calculator-window' };
  if (!calculator) {
    launched = await computer.execute({ operation: 'execute', targetType: 'desktop', sessionID: observed.sessionID,
      action: 'launch', parametersJson: JSON.stringify({ app: calculatorApp.name, launchPath: calculatorApp.launch_path }) }, context);
    assert.equal(launched.status, 'executed');
    const opened = await provider.callTool({ name: 'list_windows', arguments: { session: observed.sessionID } }, { timeout: 15_000 });
    windowData = opened.structuredContent ?? JSON.parse(opened.content?.find(row => row.type === 'text')?.text ?? '{}');
    calculator = (windowData.windows ?? []).find(row => /calculator/i.test(row.title ?? row.app_name ?? ''));
  }
  assert.ok(calculator?.pid && calculator?.window_id, 'Calculator window must appear in observed CUA window inventory');

  const state = await computer.execute({ operation: 'observe', targetType: 'desktop', sessionID: observed.sessionID,
    targetID: String(calculator.window_id), processID: calculator.pid }, context);
  const stateJSON = JSON.stringify(state.result);
  assert.match(stateJSON, /calculator/i, 'UIA window state must identify the Calculator target');
  const uiElementCount = Array.isArray(state.result?.elements) ? state.result.elements.length : null;
  assert.ok(uiElementCount === null || uiElementCount <= 120, 'default CUA UIA observation should remain bounded');
  const capture = await computer.execute({ operation: 'capture', targetType: 'desktop', sessionID: observed.sessionID,
    targetID: String(calculator.window_id), processID: calculator.pid }, context);
  assert.ok(capture.attachments?.some(row => row.bytes > 0), 'window capture should return screenshot evidence');

  console.log(JSON.stringify({
    provider: 'Cua Driver', version: driverVersion,
    providerHealth: provider.health, advertisedToolCount: provider.tools.length,
    verified: ['local CUA MCP connection', 'Windows/UIA/screenshot capability declarations',
      launched.operation === 'execute' ? 'Calculator launch through the Freelancer facade' : 'existing Calculator window reuse',
      'targeted UIA window observation', 'screenshot attachment'],
    target: { app: 'Calculator', pidObserved: true, windowObserved: true },
    observedUIElementCount: uiElementCount,
    providerAuthorizationHooksExercised: authorizationChecks.length,
    nativeOpenCodePermissionDecision: 'not-run; direct adapter smoke used an allowed test callback',
    returnedEvidenceChars: [observed, launched, state, capture].reduce((total, row) => total + JSON.stringify(row).length, 0),
    modelInference: 'not-run',
  }, null, 2));
} finally {
  if (observed?.sessionID) await computer.execute({ operation: 'end_session', sessionID: observed.sessionID }, context).catch(() => {});
  await computer.close();
  await manager.close();
}
