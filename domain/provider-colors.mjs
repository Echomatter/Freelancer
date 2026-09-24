import { normalizeColor, mixColor, onColor, readableColor } from './color.mjs';
import { themePalette } from './theme.mjs';

// Stable provider identity, independent of billing mode, account status or model
// names. OpenCode Free and Go are deliberately distinct provider keys.
export const providerDefaults = Object.freeze({
  openai: '#168578', 'github-copilot': '#8560cf', 'opencode-go': '#cf7330', opencode: '#26834a',
});
export const providerColorPresets = Object.freeze([
  ['Green', '#26834a'], ['Teal', '#168578'], ['Blue', '#3379cc'],
  ['Violet', '#8560cf'], ['Rose', '#c34f85'], ['Amber', '#cf7330'],
].map(([name, color]) => Object.freeze({ name, color })));
export function providerID(value) {
  if (typeof value !== 'string') return null;
  const key = value.split('/')[0];
  return Object.hasOwn(providerDefaults, key) ? key : null;
}
export function providerColor(id, overrides = {}) {
  const key = providerID(id);
  if (!key) return null;
  try { return normalizeColor(overrides?.[key] ?? providerDefaults[key]); }
  catch { return providerDefaults[key]; } // Damaged/legacy display metadata is not execution state.
}
export function normalizeProviderPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid provider colors.');
  const entries = Object.entries(input);
  if (!entries.length || entries.length > Object.keys(providerDefaults).length) throw Error('Choose a provider color.');
  return Object.fromEntries(entries.map(([id, value]) => {
    if (!Object.hasOwn(providerDefaults, id)) throw Error('Unsupported provider color.');
    return [id, value === null ? null : normalizeColor(value)];
  }));
}
export function mergeProviderColors(previous = {}, patch) {
  const result = Object.fromEntries(Object.keys(providerDefaults).filter(id => Object.hasOwn(previous ?? {}, id))
    .map(id => [id, providerColor(id, previous)]));
  for (const [id, color] of Object.entries(patch)) {
    if (color === null) delete result[id];
    else result[id] = color;
  }
  return result;
}
const cache = new Map();
export function providerTokens(id, appearance = {}) {
  const base = providerColor(id, appearance.providerColors);
  if (!base) return null;
  const p = themePalette(appearance.theme), key = `${p.id}/${base}`;
  if (cache.has(key)) return cache.get(key);
  const tint = mixColor(p.tokens.paper, base, p.mode === 'dark' ? 0.15 : 0.08);
  const surfaces = [p.tokens.bg, p.tokens.paper, p.tokens.sidebar, p.tokens.hover, p.tokens.tint, tint];
  const ink = readableColor(base, surfaces);
  const result = Object.freeze({
    '--provider-base': base, '--provider-fg': ink, '--provider-tint': tint,
    '--provider-solid': ink, '--provider-on-solid': onColor(ink),
    '--provider-border': readableColor(base, surfaces, 3),
  });
  if (cache.size >= 256) cache.clear();
  cache.set(key, result);
  return result;
}
