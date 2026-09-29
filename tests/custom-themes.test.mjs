import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateCustomTheme, validateNewTheme, paletteDistance } from '../domain/custom-themes.mjs';
import { palettes, normalizeCustomTheme, customThemePalette, themePalette, applyTheme } from '../domain/theme.mjs';
import { providerTokens } from '../domain/provider-colors.mjs';
import { contrast } from '../domain/color.mjs';
import { createApplication } from '../server/application.mjs';
import { savedTheme, themeDocument } from '../server/theme.mjs';
import { createStore } from '../server/store.mjs';

test('random palettes remain readable and distinct across both modes and a full collection', () => {
  let seed = 17683;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const saved = [];
  for (let i = 0; i < 64; i++) {
    const theme = generateCustomTheme({ mode: i % 2 ? 'light' : 'dark', saved, random });
    const p = customThemePalette(theme), t = p.tokens;
    assert.deepEqual(Object.keys(t).sort(), Object.keys(palettes[0].tokens).sort());
    for (const other of [...palettes, ...saved.map(customThemePalette)])
      if (other.mode === p.mode) assert.ok(paletteDistance(p, other) >= .08);
    for (const role of ['text', 'muted', 'accent', 'link'])
      for (const bg of ['bg', 'paper', 'sidebar', 'tint', 'hover']) assert.ok(contrast(t[role], t[bg]) >= 4.5);
    for (const color of ['#ffffff', '#000000', '#777777', '#ffff00', '#ff00ff']) {
      const tokens = providerTokens('openai', { theme: theme.id, customThemes: [theme], providerColors: { openai: color } });
      for (const bg of [t.bg, t.paper, t.sidebar, t.tint, t.hover, tokens['--provider-tint']]) {
        assert.ok(contrast(tokens['--provider-fg'], bg) >= 4.5);
        assert.ok(contrast(tokens['--provider-border'], bg) >= 3);
      }
    }
    saved.push(theme);
  }
  assert.equal(new Set(saved.map(p => p.id)).size, 64);
  assert.throws(() => validateNewTheme(generateCustomTheme(), saved), /64 themes/);
});

test('generation uses fresh randomness and rejects duplicates, CSS and unreadable input', () => {
  const a = generateCustomTheme(), b = generateCustomTheme({ avoid: [a] });
  assert.notEqual(a.id, b.id);
  assert.notDeepEqual(a.colors, b.colors);
  if (a.mode === b.mode) assert.ok(paletteDistance(customThemePalette(a), customThemePalette(b)) >= .08);
  assert.throws(() => validateNewTheme({ ...a, id: b.id, name: 'Another name' }, [a]), /too close/);
  assert.throws(() => validateNewTheme({ ...b, name: a.name }, [a]), /different name/);
  for (const patch of [{ id: 'light' }, { name: 'x'.repeat(49) }, { mode: 'url(evil)' },
    { colors: { ...a.colors, bg: '#fff; color:red' } }, { colors: { ...a.colors, text: a.colors.bg } },
    { colors: { ...a.colors, unexpected: '#ffffff' } }]) assert.throws(() => normalizeCustomTheme({ ...a, ...patch }));
  assert.throws(() => generateCustomTheme({ mode: 'invalid' }));
  assert.throws(() => generateCustomTheme({ random: () => .5 }), /Try rolling again/);
});

test('custom theme persistence is atomic, preserves other settings and reaches first paint', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-custom-theme-'));
  const store = createStore(root), app = createApplication({ backendRoot: root, store, host: {} });
  t.after(async () => {
    await app.indexJobs.close(); app.history.close(); app.modelRatings.close(); await app.gitProjects.close(); app.localData.close();
    await store.flush(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const a = generateCustomTheme({ mode: 'dark' }), b = generateCustomTheme({ mode: 'light', saved: [a] });
  const before = await store.read('settings');
  await Promise.all([app.saveAppearance({ customTheme: a, theme: a.id }), app.saveAppearance({ customTheme: b }),
    app.saveAppearance({ providerColors: { openai: '#abc' } })]);
  const after = await store.read('settings');
  assert.deepEqual(after.plans, before.plans);
  assert.equal(after.appearance.customThemes.length, 2);
  assert.equal(after.appearance.theme, a.id);
  assert.equal(after.appearance.providerColors.openai, '#aabbcc');
  assert.equal(themePalette(a.id, after.appearance.customThemes).id, a.id);
  const p = customThemePalette(a);
  const html = themeDocument('<html><body></body></html>', await savedTheme(createStore(root)));
  assert.ok(html.includes(`data-theme="${a.id}"`));
  for (const [key, color] of Object.entries(p.tokens)) assert.ok(html.includes(`--${key}:${color}`));
  assert.doesNotMatch(themeDocument('<html>', { ...a, colors: { ...a.colors, bg: '"><script>attack</script>' } }), /attack/);
  const styles = {}, dom = { dataset: {}, style: { setProperty(key, value) { styles[key] = value; } } };
  applyTheme(a.id, dom, [a]); assert.equal(styles['--bg'], p.tokens.bg);
  applyTheme('light', dom, [a]); assert.equal(styles['--bg'], palettes[0].tokens.bg);
  await assert.rejects(app.saveAppearance({ theme: 'custom-not-saved', providerColors: { openai: '#fff' } }));
  await assert.rejects(app.saveAppearance({ customTheme: a, theme: a.id }));
  assert.deepEqual(await store.read('settings'), after);
  const removed = await app.saveAppearance({ removeCustomTheme: a.id });
  assert.equal(removed.theme, 'dark'); assert.deepEqual(removed.customThemes, [b]);
  assert.equal((await store.read('settings')).appearance.providerColors.openai, '#aabbcc');
});
