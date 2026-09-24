// Shared quota collector for the single web/Tauri application; no second server.
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { usageView } from '../../../shared/usage.mjs';

async function json(file, fallback) {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Invalid local data: ${path.basename(file)}`);
  }
}
export async function snapshot(root, now = Date.now()) {
  const dataRoot = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const auth = await json(path.join(dataRoot, 'opencode', 'auth.json'), {});
  const mapping = { openai: 'openai-oauth', 'github-copilot': 'github-copilot-oauth', 'opencode-go': 'opencode-go', opencode: 'opencode-free' };
  const installed = Object.keys(auth).map(id => mapping[id] || id);
  installed.push('opencode-free');
  return usageView(await json(path.join(root, '.state', 'quota-state.json'), {}), installed,
    await json(path.join(root, '.state', 'usage-page-checks.json'), {}), now);
}
export function refreshQuota(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'refresh-quota.ps1'), '-ToolkitRoot', root],
      { cwd: root, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Usage refresh timed out; previous observations retained.')); }, 25000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Usage collector could not start.')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Usage refresh failed; previous observations retained.')); });
  });
}
