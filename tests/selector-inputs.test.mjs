import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBridge, selectorArguments } from '../backend/tools/runtime/bridge.mjs';

test('selector retains authoritative inputs when legacy role state is removed', () => {
  const source = readFileSync(new URL('../backend/scripts/select-model.ps1', import.meta.url), 'utf8');
  for (const [variable, input] of [['policy', 'policyPath'], ['roster', 'rosterPath'], ['ev', 'evidencePath']]) {
    assert.match(source, new RegExp(`\\$${variable} = Get-Content -LiteralPath \\$${input} -Raw -Encoding UTF8 \\| ConvertFrom-Json`));
  }
  assert.doesNotMatch(source, /\$statePath\s*=/);
});

test('captured native models reach the selector, including a paid route absent from the researched roster', async t => {
  const args = { mode: 'review', taskTypes: ['code_review'], selectedModel: 'openai/gpt-6-luna',
    runtimeModels: ['openai/gpt-6-luna'], hostAssessment: true };
  const cli = selectorArguments(args, 'select-model.ps1');
  assert.deepEqual(cli.slice(cli.indexOf('-RuntimeModels'), cli.indexOf('-RuntimeModels') + 2), ['-RuntimeModels', 'openai/gpt-6-luna']);
  const preferenceArgs = selectorArguments({ ...args, costPreference: 'any' }, 'select-model.ps1');
  assert.deepEqual(preferenceArgs.slice(preferenceArgs.indexOf('-CostPreference'), preferenceArgs.indexOf('-CostPreference') + 2), ['-CostPreference', 'any']);
  if (process.platform !== 'win32') return t.skip('Windows PowerShell selector smoke');
  const result = await createBridge(fileURLToPath(new URL('../backend/', import.meta.url))).select(args, {});
  assert.equal(result.selected_model, 'openai/gpt-6-luna');
  assert.equal(result.surface, 'openai-oauth');
  assert.equal(result.adequacy, 'host_assessment_required');
  assert.match(result.reason_codes.join(' '), /incomplete capability evidence/);
  const paidOnly = await createBridge(fileURLToPath(new URL('../backend/', import.meta.url))).select({
    mode: 'review', taskTypes: ['code_review'], runtimeModels: ['openai/gpt-6-luna', 'opencode/muse-spark-1.3-contributor-free'],
    hostAssessment: true, costPreference: 'paid-only',
  }, {});
  assert.equal(paidOnly.selected_model, 'openai/gpt-6-luna');
  assert.ok(paidOnly.filtered_out.some(row => row.id === 'opencode/muse-spark-1.3-contributor-free' && /subscription_only/.test(row.reason)));
});
