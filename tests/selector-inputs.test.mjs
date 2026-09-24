import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('selector retains authoritative inputs when legacy role state is removed', () => {
  const source = readFileSync(new URL('../backend/scripts/select-model.ps1', import.meta.url), 'utf8');
  for (const [variable, input] of [['policy', 'policyPath'], ['roster', 'rosterPath'], ['ev', 'evidencePath']]) {
    assert.match(source, new RegExp(`\\$${variable} = Get-Content -LiteralPath \\$${input} -Raw -Encoding UTF8 \\| ConvertFrom-Json`));
  }
  assert.doesNotMatch(source, /\$statePath\s*=/);
});
