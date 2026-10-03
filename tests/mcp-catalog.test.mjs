import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpCatalog, mcpPreset } from '../src/mcp-catalog.mjs';
import { serviceLabel } from '../src/capability-presentation.mjs';

test('five shared MCP templates use one generic native-configuration schema', () => {
  assert.deepEqual(mcpCatalog.map(row => row.id), ['playwright', 'fetch', 'sequential-thinking', 'context7', 'jev']);
  for (const row of mcpCatalog) {
    assert.ok(row.name && row.cost);
    assert.equal(row.kind === 'local' ? Array.isArray(row.command) : typeof row.url === 'string', true);
  }
  assert.equal(mcpCatalog.filter(row => row.kind === 'local').length, 4);
  assert.equal(mcpCatalog.filter(row => row.kind === 'remote').length, 1);
  assert.equal(mcpPreset('unknown'), null);
  assert.deepEqual(mcpPreset('jev').command, ['npx', '-y', 'jev-mcp@0.5.1']);
  assert.deepEqual(mcpPreset('jev').environment, { TYPESAFE_API_KEY: '{env:JEV_API_KEY}' });
  assert.equal(mcpPreset('memory'), null, 'internal knowledge does not suggest a second memory store');
  assert.doesNotMatch(JSON.stringify(mcpCatalog), /Bearer (?!\{env:)[^" ]+/);
});

test('native lifecycle states map to distinct user-facing service states', () => {
  for (const [state, label] of [
    ['connected', 'Available'], ['disabled', 'Disabled'], ['needs_auth', 'Needs authentication'],
    ['needs_client_registration', 'Needs setup'], ['failed', 'Error'], ['unavailable', 'Unavailable'], ['unverified', 'Unknown'],
  ]) assert.equal(serviceLabel(state), label);
});
