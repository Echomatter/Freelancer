import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { settingsGroups, settingsPages, settingsPage, settingsPageForTitle } from '../src/settings-catalog.mjs';
import { registrationLabel, serviceLabel, skillLabel, toolLabel, toolReason } from '../src/capability-presentation.mjs';

const original = {
  project: ['files', 'search', 'goals', 'sessions', 'delegation', 'github'],
  application: ['agents', 'models', 'usage', 'providers', 'appearance', 'remote-access', 'schedules', 'search', 'content-storage', 'file-access', 'capabilities'],
};
for (const [scope, routes] of Object.entries(original)) test(`${scope} menu preserves every route exactly once`, () => {
  const items = settingsGroups[scope].flatMap(group => group.items);
  assert.deepEqual([...items].sort(), [...routes].sort());
  assert.equal(new Set(items).size, items.length);
  for (const id of items) {
    const page = settingsPage(scope, id);
    assert.ok(page?.title && page?.description && page?.kind && page?.icon);
    assert.ok(['wide', 'form'].includes(page.layout));
    assert.equal(settingsPageForTitle(page.title), page);
  }
});
test('catalog is complete, scope-aware and presentation-only', () => {
  assert.equal(settingsPages.length, 17);
  assert.equal(new Set(settingsPages.map(page => `${page.scope}/${page.id}`)).size, 17);
  assert.equal(settingsPage('project', 'search').title, 'Search project content');
  assert.equal(settingsPage('application', 'search').title, 'Search all content');
  assert.match(settingsPage('application', 'agents').description, /shared across all projects/);
  assert.equal(settingsPageForTitle('Edit agent').layout, 'form');
  assert.equal(settingsPageForTitle('New agent').id, 'agents');
  assert.equal(settingsPageForTitle('Unrelated chat heading'), undefined);
  assert.equal(settingsPage('project', 'missing'), undefined);
});
test('registration never claims successful execution', () => {
  assert.equal(registrationLabel(true), 'Registered');
  assert.equal(registrationLabel(false), 'Not registered');
  assert.equal(registrationLabel(null), 'Unknown');
  assert.equal(registrationLabel(undefined), 'Unknown');
  const registered = { discovered: true, unavailableReason: 'Choose a model to inspect its tool exposure.' };
  assert.equal(toolReason(registered), null);
  assert.equal(toolReason({ ...registered, nativePermission: 'deny', unavailableReason: 'Native permission denies this tool.' }), 'Native permission denies this tool.');
  assert.equal(toolReason({ ...registered, discovered: null, unavailableReason: 'Inspection unavailable.' }), 'Inspection unavailable.');
  assert.equal(toolReason({ ...registered, applicationAccess: 'blocked', unavailableReason: 'Use delegate.' }), 'Use delegate.');
});
test('model-specific tool exposure is reported without implying model incompatibility', () => {
  assert.equal(toolLabel({ discovered: true, modelExposure: false, configured: true, nativePermission: 'allow' }), 'Not exposed here');
});
test('missing skills, failed probes and MCP auth remain distinct', () => {
  assert.equal(skillLabel({ discovered: false, dependency: 'missing' }, { state: 'unavailable' }), 'Missing file');
  assert.equal(skillLabel({ discovered: false }, { state: 'unavailable' }), 'Unknown');
  assert.equal(skillLabel({ discovered: false }, { state: 'observed' }), 'Not found');
  assert.equal(skillLabel({ discovered: true }, { state: 'observed' }), 'Found');
  assert.equal(serviceLabel('needs_auth'), 'Needs authentication');
  assert.equal(serviceLabel('needs_client_registration'), 'Needs setup');
  assert.equal(serviceLabel('connected'), 'Available');
  assert.equal(serviceLabel('something-new'), 'Unknown');
});
test('new settings styles use only established semantic color tokens', async () => {
  const allowed = new Set(['accent', 'muted', 'text', 'line', 'paper', 'hover', 'danger', 'panel', 'radius', 'settings-gap', 'settings-panel-padding']);
  for (const name of ['settings-ux.css', 'capabilities.css']) {
    const css = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i);
    for (const [, token] of css.matchAll(/var\(--([\w-]+)/g)) assert.ok(allowed.has(token), `${name}: ${token}`);
    assert.doesNotMatch(css, /var\(--border\)/);
  }
});
