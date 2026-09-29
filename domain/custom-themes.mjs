import { palettes, customThemePalette, normalizeCustomTheme } from './theme.mjs';

// The same weighted OKLab separation used by the built-in catalog audit.
function lab(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255)
    .map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}
const vectors = new WeakMap();
function vector(p) {
  if (!vectors.has(p)) vectors.set(p, ['bg', 'sidebar', 'accent', 'text'].flatMap((key, i) => lab(p.tokens[key]).map(x => x * [1, 1.1, 1, .4][i])));
  return vectors.get(p);
}
export function paletteDistance(a, b) {
  const right = vector(b);
  return Math.sqrt(vector(a).reduce((sum, value, i) => sum + (value - right[i]) ** 2, 0));
}
const decorative = ['bg', 'paper', 'sidebar', 'accent', 'tint', 'hover'];
export function validateNewTheme(input, saved = []) {
  const theme = normalizeCustomTheme(input), p = customThemePalette(theme);
  const existing = [...palettes, ...saved.map(customThemePalette)];
  if (saved.length >= 64) throw Error('Your collection has 64 themes. Remove one before saving another.');
  if (existing.some(other => other.id === theme.id || other.name.toLowerCase() === theme.name.toLowerCase()))
    throw Error('Choose a different name for this theme.');
  const used = new Set(existing.flatMap(other => decorative.map(key => other.tokens[key])));
  if (decorative.some(key => used.has(p.tokens[key])) || existing.some(other => other.mode === p.mode && paletteDistance(p, other) < .08))
    throw Error('This palette is too close to an existing theme. Roll again for fresh colors.');
  return theme;
}
function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h / 60 % 2 - 1)), m = l - c / 2;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
const freshRandom = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
/** @param {{ mode?: string, saved?: any[], avoid?: any[], random?: () => number }} options */
export function generateCustomTheme({ mode = 'any', saved = [], avoid = [], random = freshRandom } = {}) {
  if (!['any', 'light', 'dark'].includes(mode)) throw Error('Choose Light, Dark, or Surprise me.');
  const range = (a, b) => a + random() * (b - a);
  const chosenMode = mode === 'any' ? (random() < .5 ? 'light' : 'dark') : mode;
  const names = new Set([...palettes, ...saved].map(p => p.name.toLowerCase()));
  let number = 1;
  while (names.has(`My theme ${number}`.toLowerCase())) number++;
  for (let attempt = 0; attempt < 160; attempt++) {
    const dark = chosenMode === 'dark', hue = range(0, 360), saturation = range(.14, .62);
    const accentHue = (hue + range(45, 315)) % 360;
    const colors = {
      bg: hsl(hue, saturation, dark ? range(.055, .18) : range(.88, .965)),
      sidebar: hsl((hue + range(-22, 22) + 360) % 360, saturation, dark ? range(.025, .12) : range(.76, .89)),
      paper: hsl(hue, saturation * .6, dark ? range(.13, .22) : range(.973, .991)),
      text: hsl(hue, .2, dark ? .95 : .09), muted: hsl(hue, .14, dark ? .7 : .32),
      line: hsl(hue, saturation * .5, dark ? .3 : .67),
      accent: hsl(accentHue, range(.38, .88), dark ? range(.65, .83) : range(.26, .44)),
      tint: hsl(accentHue, saturation * .6, dark ? .25 : .78),
      hover: hsl(hue, saturation * .7, dark ? .25 : .78),
    };
    try {
      const candidate = validateNewTheme({ id: `custom-${globalThis.crypto.randomUUID()}`, name: `My theme ${number}`, mode: chosenMode, colors }, saved);
      const p = customThemePalette(candidate);
      if (avoid.some(previous => previous.mode === p.mode && paletteDistance(p, customThemePalette(previous)) < .08)) continue;
      return candidate;
    } catch { /* Rejection sampling keeps contrast and novelty independent of luck. */ }
  }
  throw Error('Could not find a fresh palette this time. Try rolling again.');
}
