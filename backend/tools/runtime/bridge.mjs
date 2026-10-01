import { readRuntimeText as readFile,writeState } from './state-database.mjs';
// PowerShell supplies eligibility, evidence and cost calculations to the host.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export function runProcess(file, args, { cwd, signal, timeoutMs = 15000, errorOutput = false } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Cancelled before process start')); return; }
    const child = spawn(file, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', diagnostics = '', length = 0, settled = false;
    const fail = error => { if (!settled) { settled = true; cleanup(); child.kill(); reject(error); } };
    const abort = () => fail(new Error('Process cancelled'));
    const timer = setTimeout(() => fail(new Error('Auxiliary process timed out')), timeoutMs);
    function cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    child.stdout.on('data', chunk => {
      if (settled) return;
      length += chunk.length;
      if (length > 4 * 1024 * 1024) fail(new Error('Auxiliary output limit reached'));
      else output += chunk.toString();
    });
    // Account/config helpers suppress stderr; local indexer diagnostics are opt-in
    // and bounded even when a rebuild prints progress for thousands of sources.
    if (errorOutput) child.stderr.on('data', chunk => {
      if (!settled) diagnostics = (diagnostics + chunk.toString()).slice(-16384);
    });
    else child.stderr.resume();
    child.on('error', fail);
    child.on('close', code => {
      if (settled) return;
      settled = true; cleanup();
      if (code !== 0) reject(new Error(diagnostics.trim() || `Auxiliary process exited ${code}`)); else resolve(output.trim());
    });
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export function selectorArguments(args, script) {
  // The selector only accepts fixed Build work mode (policy 6). Legacy
  // captured modes survive only as task-type evidence, never as -WorkMode,
  // or every legacy plan/explore/review assignment fails validation.
  const mode = args.mode ?? 'build';
  const result = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-WorkMode', 'build',
    '-TaskType', (args.taskTypes?.length ? args.taskTypes : [mode === 'explore' ? 'research' : mode === 'plan' ? 'architecture' : mode === 'review' ? 'code_review' : 'bounded_feature']).join(',')];
  for (const [arg, key] of Object.entries({ needsWrites: 'NeedsWrites', needsTerminal: 'NeedsTerminal', needsWeb: 'NeedsWeb',
    needsDeepReasoning: 'NeedsDeepReasoning', highConsequenceIfWrong: 'HighConsequence', needsModelDiversity: 'NeedsModelDiversity', freeOnly: 'FreeOnly', hostAssessment: 'HostAssessment' })) {
    if (args[arg]) result.push(`-${key}`, 'true');
  }
  for (const [arg, key] of Object.entries({ minimumContext: 'NeedsLargeContextTokens', currentModel: 'CurrentModel', excludeModel: 'ExcludeModel',
    expectedInputTokens: 'ExpectedInputTokens', expectedOutputTokens: 'ExpectedOutputTokens', expectedCacheReadTokens: 'ExpectedCacheReadTokens', preferredCostClass: 'PreferredCostClass', costPreference: 'CostPreference', reviewMode: 'ReviewMode', selectedModel: 'SelectedModel' })) {
    if (args[arg] !== undefined && args[arg] !== '') result.push(`-${key}`, String(args[arg]));
  }
  if (args.runtimeModels?.length) result.push('-RuntimeModels', args.runtimeModels.join(','));
  if (args.rejected?.length) result.push('-ExcludedModels', args.rejected.join(','));
  if (args.excludeModels?.length) result.push('-DiversityModels', args.excludeModels.join(','));
  return result;
}
export function createBridge(toolkitRoot) {
  let refresh;
  const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const invoke = (name, args, ctx, timeoutMs) => runProcess(ps,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(toolkitRoot, 'scripts', name), ...args],
    { cwd: toolkitRoot, signal: ctx?.abort || ctx?.signal, timeoutMs });
  return {
    async select(args, ctx) {
      const raw = await runProcess(ps, selectorArguments(args, path.join(toolkitRoot, 'scripts', 'select-model.ps1')),
        { cwd: toolkitRoot, signal: ctx.abort, timeoutMs: 15000 });
      return JSON.parse(raw.replace(/^\uFEFF/, ''));
    },
    async beforeSelect(ctx) {
      try {
        const file = path.join(toolkitRoot, '.state', 'quota-state.json');
        const cached = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
        if (Date.now() - Date.parse(cached.generated_at) < 120000) return;
      } catch {}
      if (!refresh) refresh = invoke('refresh-quota.ps1', ['-ToolkitRoot', toolkitRoot], ctx, 12000)
        .catch(() => {}).finally(() => { refresh = undefined; });
      await refresh;
    },
    async record(receipt) {
      // The execution receipt is already durable. Only operational failures are
      // promoted here; task correctness remains pending until validation.
      const a = receipt.attempts.at(-1);
      let recordingError;
      if (a?.status === 'failed') {
        try { await invoke('record-task-outcome.ps1', ['-TaskId', receipt.task_id, '-Repo', receipt.directory,
          '-TaskType', (receipt.task_types?.length ? receipt.task_types : [receipt.mode ?? 'bounded_feature']).join(','), '-Operational'], {}, 15000); }
        catch (error) { recordingError = error; }
      }
      if (!a || a.status !== 'failed' || !['quota', 'auth', 'throttle', 'provider', 'model'].includes(a.failure)) {
        if (recordingError) throw recordingError;
        return;
      }
      const pool = a.failure === 'quota' && ['opencode-go', 'opencode-free'].includes(a.surface);
      const key = pool ? a.surface : a.selected_model;
      const dir = path.join(toolkitRoot, '.state', 'delegation', 'blocks');
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, createHash('sha256').update(key).digest('hex') + '.json');
      const state = { scope: pool ? 'surface' : 'model', key, surface: a.surface, reason: a.failure,
        recorded_at: a.completed_at, reset_at: null,
        retry_after: ['throttle', 'provider'].includes(a.failure) ? new Date(Date.now() + 120000).toISOString() : null,
        task_id: receipt.task_id };
      writeState(file, state);
      if (recordingError) throw recordingError;
    },
  };
}
