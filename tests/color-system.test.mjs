import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { colorChannels, contrast, normalizeColor } from '../domain/color.mjs';
import { palettes, paletteCSS, themePalette, resolveTheme, applyTheme } from '../domain/theme.mjs';
import { providerColor, providerDefaults, providerColorPresets, providerID, providerTokens, normalizeProviderPatch, mergeProviderColors } from '../domain/provider-colors.mjs';
import { themeDocument, savedTheme } from '../server/theme.mjs';
import { createApplication } from '../server/application.mjs';
import { createStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';

const headers = { 'X-Freelancer-Client': 'webpage', 'Content-Type': 'application/json' };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-colors-'));
  const store = createStore(root), app = createApplication({ backendRoot: root, store, host: {} });
  const server = await startServer({ application: app, assets: process.cwd() });
  t.after(async () => { await server.sender.close(); server.server.closeAllConnections(); await new Promise(r => server.server.close(r)); await store.flush(); await rm(root, { recursive: true, force: true }); });
  return { root, store, app, ...server };
}

test('palette registry keeps legacy identities and adds bespoke palettes', () => {
  assert.deepEqual(palettes.map(p => p.id), ['light', 'dark', 'sandstone', 'midnight', 'coast', 'lilac', 'ember', 'aurora']);
  assert.equal(themePalette('light').tokens.bg, '#f8f9f6');
  assert.equal(themePalette('dark').tokens.bg, '#171c19');
  assert.equal(new Set(palettes.map(p => p.tokens.bg)).size, 8);
  assert.equal(new Set(palettes.map(p => p.tokens.accent)).size, 8);
  for (const old of [undefined, null, '', 'unknown', 'constructor', '<script>']) assert.equal(resolveTheme(old), 'light');
});
test('every palette defines the same semantic tokens and generated CSS cannot drift', async () => {
  const keys = Object.keys(palettes[0].tokens).sort();
  for (const p of palettes) assert.deepEqual(Object.keys(p.tokens).sort(), keys);
  assert.equal((await readFile(new URL('../src/echoflex/tokens.css', import.meta.url), 'utf8')).replaceAll('\r\n', '\n'), paletteCSS());
  for (const filename of await readdir(new URL('../src/', import.meta.url))) {
    if (!filename.endsWith('.css')) continue;
    const css = await readFile(new URL('../src/' + filename, import.meta.url), 'utf8');
    assert.doesNotMatch(css, /#[a-f\d]{3,8}\b|rgba?\(|hsla?\(/i, `${filename} must use tokens for application colors`);
  }
});
for (const p of palettes) {
  test(`${p.name}: normal text, state text, primary buttons and focus have tested contrast`, () => {
    const t = p.tokens, surfaces = [t.bg, t.paper, t.sidebar, t.tint, t.hover];
    for (const surface of surfaces) {
      for (const role of ['text', 'muted', 'accent', 'link']) assert.ok(contrast(t[role], surface) >= 4.5, `${p.id} ${role} on ${surface}`);
      assert.ok(contrast(t.focus, surface) >= 3, `${p.id} focus on ${surface}`);
    }
    for (const surface of [t.bg, t.paper, t.sidebar]) assert.ok(contrast(t['border-strong'], surface) >= 3);
    for (const role of ['success', 'danger', 'warning', 'info']) {
      assert.ok(contrast(t[role], t[role + '-tint']) >= 4.5, `${role} status`);
      assert.ok(contrast(t.text, t[role + '-tint']) >= 4.5, `${role} body`);
    }
    for (const bg of [t.accent, t['accent-hover']]) assert.ok(contrast(bg, t['accent-contrast']) >= 4.5, `primary ${bg}`);
  });
  test(`${p.name}: provider shades stay readable, including hostile edge-case swatches`, () => {
    const candidates = [...Object.values(providerDefaults), ...providerColorPresets.map(p => p.color), '#ffffff', '#000000', '#ffff00', '#777777', '#00ffff', '#ff00ff'];
    // Deterministic hue sampling also exercises non-preset custom choices.
    for (let i = 0; i < 96; i++) candidates.push('#' + ((i * 104729 + 7919) % 16777216).toString(16).padStart(6, '0'));
    for (const color of candidates) {
      const t = providerTokens('openai', { theme: p.id, providerColors: { openai: color } });
      for (const surface of [p.tokens.bg, p.tokens.paper, p.tokens.sidebar, p.tokens.hover, p.tokens.tint, t['--provider-tint']]) {
        assert.ok(contrast(t['--provider-fg'], surface) >= 4.5, `${color} on ${surface}`);
        assert.ok(contrast(t['--provider-border'], surface) >= 3);
      }
      assert.ok(contrast(t['--provider-solid'], t['--provider-on-solid']) >= 4.5);
    }
  });
}
test('provider identity uses exact provider keys rather than model names or broad prefix matching', () => {
  assert.equal(providerID('opencode/free'), 'opencode');
  assert.equal(providerID('opencode-go/model/variant'), 'opencode-go');
  for (const value of ['Free', 'opencode-fake/free', 'auto', 'inherit', 'Unknown/green', null]) assert.equal(providerID(value), null);
  assert.equal(providerTokens('unknown'), null);
  const [r, g, b] = colorChannels(providerColor('opencode'));
  assert.ok(g > r && g > b, 'OpenCode Free is green by default');
});
test('only canonical hex color settings are accepted, including reset and short hex', () => {
  assert.equal(normalizeColor(' #AbC '), '#aabbcc');
  for (const bad of ['red', 'var(--danger)', '#12345678', '#fff;background:red', 'url(https://example.com)', '', 4, {}, null]) assert.throws(() => normalizeColor(bad));
  assert.deepEqual(normalizeProviderPatch({ opencode: '#ABC', openai: null }), { opencode: '#aabbcc', openai: null });
  for (const bad of [null, [], {}, { unknown: '#ffffff' }, JSON.parse('{"__proto__":"#ffffff"}'), { openai: 4 }]) assert.throws(() => normalizeProviderPatch(bad));
  assert.deepEqual(mergeProviderColors({ openai: '#112233', opencode: '#445566' }, { openai: null }), { opencode: '#445566' });
  assert.equal(providerColor('openai', { openai: 'bad' }), providerDefaults.openai);
});
test('appearance writes preserve billing, other providers, layouts and drafts without native calls', async t => {
  const f = await fixture(t);
  await f.store.update('settings', s => ({ ...s, chatChoices: { ses_test: { model: 'openai/x' } }, appearance: { todoLayout: 'inline' } }));
  const before = await f.store.read('settings');
  await Promise.all([
    f.app.saveAppearance({ theme: 'midnight' }), f.app.saveAppearance({ providerColors: { openai: '#abc' } }),
    f.app.saveAppearance({ providerColors: { 'github-copilot': '#345678' } }), f.app.saveAppearance({ panelWidths: { navigation: 280 } }),
  ]);
  const after = await f.store.read('settings');
  assert.deepEqual(after.plans, before.plans); assert.deepEqual(after.chatChoices, before.chatChoices);
  assert.equal(after.appearance.theme, 'midnight'); assert.equal(after.appearance.todoLayout, 'inline');
  assert.deepEqual(after.appearance.providerColors, { openai: '#aabbcc', 'github-copilot': '#345678' });
  assert.deepEqual((await createStore(f.root).read('settings')).appearance, after.appearance);
  assert.deepEqual(await f.app.saveAppearance({ providerColors: { openai: null } }), { saved: true, providerColors: { 'github-copilot': '#345678' } });
  assert.equal(providerColor('openai', (await f.store.read('settings')).appearance.providerColors), providerDefaults.openai);
});
test('invalid combined color/theme changes are atomic and leave existing data untouched', async t => {
  const f = await fixture(t); const before = await f.store.read('settings');
  for (const input of [{ theme: 'sandstone', providerColors: { openai: 'red' } }, { theme: 'pink', providerColors: { openai: '#fff' } }, { providerColors: { unknown: '#ffffff' } }])
    await assert.rejects(f.app.saveAppearance(input));
  assert.deepEqual(await f.store.read('settings'), before);
});
test('color HTTP uses existing local-only security boundary and explicit confirmation', async t => {
  const f = await fixture(t); const body = JSON.stringify({ providerColors: { opencode: '#987654' } });
  assert.equal((await fetch(f.url + '/api/appearance', { method: 'PUT', body })).status, 403);
  const result = await fetch(f.url + '/api/appearance', { method: 'PUT', headers, body });
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { saved: true, providerColors: { opencode: '#987654' } });
});
test('all saved palettes reach initial HTML at browser startup without scripts or injected CSS', async t => {
  const f = await fixture(t);
  for (const p of palettes) {
    await f.app.saveAppearance({ theme: p.id });
    assert.equal(await savedTheme(createStore(f.root)), p.id);
    const response = await fetch(f.url); const text = await response.text();
    assert.ok(text.includes(`data-theme="${p.id}"`)); assert.ok(text.includes(`background-color:${p.tokens.bg};color-scheme:${p.mode}`));
    assert.ok(text.includes(`--danger:${p.tokens.danger}`));
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  }
  const html = themeDocument('<html><body></body></html>', '"><script>attack</script>');
  assert.doesNotMatch(html, /attack/);
});
test('runtime palette application updates every token rather than leaving colors from the prior palette', () => {
  const tokens = {}, root = { dataset: {}, style: { setProperty(k, v) { tokens[k] = v; } } };
  for (const p of [...palettes, palettes[0]]) {
    applyTheme(p.id, root);
    for (const [key, color] of Object.entries(p.tokens)) assert.equal(tokens['--' + key], color);
    assert.equal(root.style.colorScheme, p.mode);
  }
});
