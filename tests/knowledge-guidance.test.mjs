import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guidance = readFileSync(new URL('../backend/skills/remember/SKILL.md', import.meta.url), 'utf8');
const plugin = readFileSync(new URL('../backend/opencode/plugins/knowledge.ts', import.meta.url), 'utf8');

test('remember guidance uses existing shared native knowledge operations without a Memory connection prerequisite', () => {
  assert.match(guidance, /^description:.*shared native knowledge tool\./m);
  assert.match(guidance, /Consider the shared `knowledge` tool/);
  assert.match(guidance, /requires no separate Memory connection/);
  assert.doesNotMatch(guidance, /Consider the shared Memory MCP|persistence is independent/);
  const schema = plugin.match(/operation:\s*tool\.schema\.enum\(\[([^\]]+)\]\)/)?.[1];
  assert.ok(schema, 'native operation schema must remain discoverable');
  const operations = new Set([...schema.matchAll(/'([^']+)'/g)].map(match => match[1]));
  for (const operation of ['query', 'read', 'remember', 'revise', 'claim', 'correct-claim'])
    assert.ok(operations.has(operation), `guidance operation ${operation} must exist in the native schema`);
  assert.match(guidance, /domain `memories` or `facts`/);
  assert.match(guidance, /global by default; an optional project filter/);
});

test('remember guidance preserves shared access, optional native connections and mutation authority', () => {
  assert.match(guidance, /Every agent and model receives the same shared tools across projects/);
  assert.match(guidance, /Native\s+permissions and explicit user restrictions still control mutations/);
  assert.match(guidance, /optional\s+connected Memory MCP service remains under OpenCode ownership/);
  assert.match(guidance, /does not import, disable or\s+rewrite that service or its configuration/);
  assert.match(guidance, /optional guidance.*does not grant or gate/s);
});

test('remember guidance distinguishes retained historical evidence and failed saves from verified current facts', () => {
  assert.match(guidance, /Verify\s+consequential remembered claims against current source and project state/);
  assert.match(guidance, /exact retained revision and its evidence/);
  assert.match(guidance, /Keep origin, scope and unverified status explicit/);
  assert.match(guidance, /claim or pin does not establish verified truth/);
  assert.match(guidance, /Never\s+automatically mirror chat history/);
  assert.match(guidance, /Structured model\s+outcomes remain authoritative/);
  assert.match(guidance, /retrieval is unavailable,\s+continue with repository evidence/);
  assert.match(guidance, /Report a failed save;\s+do not claim the memory was retained/);
});
