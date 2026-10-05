import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createComputerProviderManager } from '../backend/tools/runtime/computer-provider.mjs';
import { createComputerUse } from '../backend/tools/runtime/computer-use.mjs';

if (process.platform !== 'win32') throw Error('This real-browser smoke is currently supported on Windows.');
const chromeCandidates = [
  path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];
const chrome = chromeCandidates.find(candidate => existsSync(candidate));
if (!chrome) throw Error('Google Chrome was not found in its standard Windows installation folders.');
const cuaDriver = process.env.CUA_DRIVER_PATH
  ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Cua', 'cua-driver', 'bin', 'cua-driver.exe');
if (!existsSync(cuaDriver)) throw Error('Cua Driver was not found. Set CUA_DRIVER_PATH to its installed executable.');

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'freelancer-computer-smoke-'));
const profile = path.join(tempRoot, 'chrome-profile');
const debugPort = 9223;
const pageHTML = '<!doctype html><title>Freelancer Computer Use Smoke</title><button id="action" onclick="document.querySelector(\'#result\').textContent=\'clicked\'">Click</button><p id="result">waiting</p>';
const http = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(pageHTML);
});
await new Promise((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', resolve); });
const address = http.address();
const pageURL = `http://127.0.0.1:${address.port}/`;
const browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, pageURL],
{ windowsHide: true, stdio: 'ignore' });
let manager;
try {
  const readyUntil = Date.now() + 20_000;
  while (Date.now() < readyUntil) {
    browser.exitCode !== null && (() => { throw Error(`Chrome exited with code ${browser.exitCode}.`); })();
    try { const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const chromeReady = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.ok).catch(() => false);
  assert.equal(chromeReady, true, 'disposable Chrome must publish its local CDP endpoint');

  const name = 'browser-harness';
  const command = process.env.COMPUTER_BROWSER_COMMAND || 'uvx';
  const args = process.env.COMPUTER_BROWSER_ARGS ? JSON.parse(process.env.COMPUTER_BROWSER_ARGS)
    : ['--from', 'browser-harness[mcp]', 'browser-harness-mcp'];
  manager = createComputerProviderManager({ directory: process.cwd(), client: { config: { get: async () => ({
    data: { mcp: {
      [name]: { type: 'local', command: [command, ...args], enabled: true },
      'cua-driver': { type: 'local', command: [cuaDriver, 'mcp'], enabled: true },
    } },
  }) } } });
  const computer = createComputerUse({ listProviders: manager.listProviders,
    captureImage: async image => ({ filename: 'provider-screenshot', mime: image.mimeType, bytes: Buffer.from(image.data, 'base64').length }) });
  const context = { sessionID: `computer-smoke-${process.pid}` };
  const providers = await manager.listProviders();
  assert.ok(providers.some(provider => provider.kind === 'browser-harness' && provider.health === 'connected'), 'Browser Harness MCP must initialize and expose operations');
  const observed = await computer.execute({ operation: 'observe', targetType: 'browser' }, context);
  const navigated = await computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    action: 'navigate', url: pageURL }, context);
  const state = await computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    action: 'javascript', code: 'document.querySelector("#result").textContent' }, context);
  const clicked = await computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    action: 'click', parametersJson: JSON.stringify({ selector: '#action' }) }, context);
  const verified = await computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    action: 'javascript', code: 'document.querySelector("#result").textContent' }, context);
  assert.match(JSON.stringify(state.result), /waiting/);
  assert.match(JSON.stringify(verified.result), /clicked/);
  const capture = await computer.execute({ operation: 'capture', targetType: 'browser', sessionID: observed.sessionID }, context);
  assert.ok(capture.attachments?.length, 'capture should return a screenshot attachment');
  const desktopInventory = await computer.execute({ operation: 'observe', targetType: 'desktop', sessionID: observed.sessionID }, context);
  assert.equal(desktopInventory.sessionID, observed.sessionID, 'browser and desktop bindings must share one Freelancer session');
  const cua = providers.find(provider => provider.kind === 'cua-driver');
  assert.equal(cua?.health, 'connected', 'Cua Driver must connect through local MCP stdio');
  const decode = result => result.structuredContent ?? JSON.parse(result.content?.find(row => row.type === 'text')?.text ?? '{}');
  const appData = decode(await cua.callTool({ name: 'list_apps', arguments: { session: observed.sessionID } }, { timeout: 15_000 }));
  const calculatorApp = (appData.apps ?? []).find(row => /calculator/i.test(row.name ?? '') && row.launch_path);
  assert.ok(calculatorApp, 'Windows Calculator must be present in the CUA app catalog');
  let windowData = decode(await cua.callTool({ name: 'list_windows', arguments: { session: observed.sessionID } }, { timeout: 15_000 }));
  let calculator = (windowData.windows ?? []).find(row => /calculator/i.test(row.title ?? row.app_name ?? ''));
  let launch;
  if (!calculator) {
    launch = await computer.execute({ operation: 'execute', targetType: 'desktop', sessionID: observed.sessionID,
      action: 'launch', parametersJson: JSON.stringify({ app: calculatorApp.name, launchPath: calculatorApp.launch_path }) }, context);
    windowData = decode(await cua.callTool({ name: 'list_windows', arguments: { session: observed.sessionID } }, { timeout: 15_000 }));
    calculator = (windowData.windows ?? []).find(row => /calculator/i.test(row.title ?? row.app_name ?? ''));
  }
  assert.ok(calculator?.pid && calculator?.window_id, 'Calculator must have an observed process and window identity');
  const desktop = await computer.execute({ operation: 'observe', targetType: 'desktop', sessionID: observed.sessionID,
    targetID: String(calculator.window_id), processID: calculator.pid }, context);
  assert.match(JSON.stringify(desktop.result), /calculator/i, 'targeted CUA UIA observation must identify Calculator');
  const desktopCapture = await computer.execute({ operation: 'capture', targetType: 'desktop', sessionID: observed.sessionID,
    targetID: String(calculator.window_id), processID: calculator.pid }, context);
  assert.ok(desktopCapture.attachments?.length, 'desktop capture should return screenshot evidence');
  const browserAfterDesktop = await computer.execute({ operation: 'execute', targetType: 'browser', sessionID: observed.sessionID,
    action: 'javascript', code: 'document.querySelector("#result").textContent' }, context);
  assert.match(JSON.stringify(browserAfterDesktop.result), /clicked/, 'browser binding must remain usable after desktop observation');
  const ended = await computer.execute({ operation: 'end_session', sessionID: observed.sessionID }, context);
  console.log(JSON.stringify({
    verified: ['Real Chrome CDP navigation, JavaScript inspection, click, visible-state verification and capture',
      'same Freelancer session continued to a targeted CUA Calculator UIA observation and capture',
      'browser state remained usable after desktop observation', ended.status],
    providerHealth: providers.find(provider => provider.kind === 'browser-harness')?.health,
    providers: providers.map(provider => ({ kind: provider.kind, health: provider.health, advertisedToolCount: provider.tools.length })),
    sessionID: observed.sessionID,
    operations: [navigated.operation, clicked.operation, 'verified-browser-state', capture.operation, desktopInventory.operation,
      launch?.action ?? 'reused-existing-calculator-window', desktop.operation, desktopCapture.operation, 'browser-reverified-after-desktop'],
    returnedEvidenceChars: [observed, navigated, state, clicked, verified, capture, desktopInventory, desktop, desktopCapture, browserAfterDesktop]
      .reduce((sum, row) => sum + JSON.stringify(row).length, 0),
    nativeOpenCodePermissionDecision: 'not-run; adapter smoke used its allowed test callback',
    modelInference: 'not-run',
  }, null, 2));
} finally {
  await manager?.close();
  if (browser.exitCode === null) {
    browser.kill();
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
  }
  await new Promise(resolve => http.close(resolve));
  const resolvedTemp = path.resolve(tempRoot), resolvedParent = path.resolve(os.tmpdir());
  if (!resolvedTemp.startsWith(resolvedParent + path.sep) || !path.basename(resolvedTemp).startsWith('freelancer-computer-smoke-'))
    throw Error('Refusing to remove a computer-smoke directory outside its generated temp root.');
  await rm(resolvedTemp, { recursive: true, force: true });
}
