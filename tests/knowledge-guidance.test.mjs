import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guidance = readFileSync(new URL('../backend/skills/remember/SKILL.md', import.meta.url), 'utf8');
const plugin = readFileSync(new URL('../backend/opencode/plugins/knowledge.ts', import.meta.url), 'utf8');

test('remember guidance uses existing shared native knowledge operations without a Memory connection prerequisite', () => {
  assert.match(guidance, /^description:.*shared knowledge tool\./m);
  assert.match(guidance, /`knowledge` is the tool/);
  assert.match(guidance, /External Memory MCP is unnecessary/);
  assert.doesNotMatch(guidance, /Consider the shared Memory MCP|persistence is independent/);
  const schema = plugin.match(/operation:\s*tool\.schema\.enum\(\[([^\]]+)\]\)/)?.[1];
  assert.ok(schema, 'native operation schema must remain discoverable');
  const operations = new Set([...schema.matchAll(/'([^']+)'/g)].map(match => match[1]));
  for (const operation of ['query', 'read', 'remember', 'revise', 'claim', 'correct-claim'])
    assert.ok(operations.has(operation), `guidance operation ${operation} must exist in the native schema`);
  assert.match(guidance, /domain `memories` or `facts`/);
  assert.match(guidance, /Queries default globally/);
});

test('remember guidance preserves shared access, optional native connections and mutation authority', () => {
  assert.match(guidance, /this optional skill/);
  assert.match(guidance, /within user\/native permissions/);
  assert.match(guidance, /native-owned service/);
  assert.match(guidance, /Skills grant no authority or tool gate/);
  assert.match(plugin, /Mutations retain native permission/);
});

test('remember guidance distinguishes retained historical evidence and failed saves from verified current facts', () => {
  assert.match(guidance, /Verify current\s+behavior against source or native receipts/);
  assert.match(guidance, /Read exact revisions\/evidence/);
  assert.match(guidance, /Partial, metadata-only, disputed or stale content stays explicit/);
  assert.match(guidance, /A pin retains content; it proves no\s+truth or permission/);
  assert.match(guidance, /Do not automatically mirror chats/);
  assert.match(guidance, /Structured model\s+outcomes remain authoritative/);
  assert.match(guidance, /Missing memory does not block repository work/);
  assert.match(guidance, /report failed saves honestly/);
});
