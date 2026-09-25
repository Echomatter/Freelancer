import { mixColor, onColor, readableColor } from './color.mjs';

// One small application-owned palette catalog, not an editable style engine.
// A palette's mode also drives the browser's built-in widgets.
const definitions = [
  { id: 'light', name: 'Sage Daybreak', mode: 'light', description: 'Fresh paper and soft greens.',
    bg: '#f8f9f6', paper: '#ffffff', sidebar: '#eef1ec', text: '#252d2a', muted: '#68726b', line: '#e1e7df', accent: '#426b4c', tint: '#e4eddf', hover: '#e8ede5' },
  { id: 'dark', name: 'Forest Night', mode: 'dark', description: 'Charcoal with a calm green accent.',
    bg: '#171c19', paper: '#1e2520', sidebar: '#121814', text: '#e4ebe2', muted: '#9aa99b', line: '#303c33', accent: '#a5c695', tint: '#293c2a', hover: '#263127' },
  { id: 'sandstone', name: 'Desert Clay', mode: 'light', description: 'Warm ivory, sand, and terracotta.',
    bg: '#faf6ee', paper: '#fffdf8', sidebar: '#f1e9dc', text: '#352c26', muted: '#756758', line: '#e3d7c5', accent: '#9b4b32', tint: '#f3e3d5', hover: '#eee3d5' },
  { id: 'midnight', name: 'Blue Hour', mode: 'dark', description: 'Deep navy with clear blue highlights.',
    bg: '#101827', paper: '#172237', sidebar: '#0c1321', text: '#e4edf9', muted: '#a1b2cb', line: '#2c3e58', accent: '#85b9ff', tint: '#233854', hover: '#203149' },
  { id: 'coast', name: 'Coastal Teal', mode: 'light', description: 'Sea-glass blue with a calm, clear accent.',
    bg: '#f4f8f8', paper: '#ffffff', sidebar: '#e5f0f0', text: '#173238', muted: '#61777a', line: '#d5e3e4', accent: '#0d6975', tint: '#d9edef', hover: '#e7f2f2' },
  { id: 'lilac', name: 'Amethyst Mist', mode: 'light', description: 'Soft lavender with a deep violet accent.',
    bg: '#f8f3fb', paper: '#fffdfd', sidebar: '#eee5f5', text: '#332741', muted: '#776681', line: '#e2d7ed', accent: '#70449f', tint: '#eadcf5', hover: '#f0e8f5' },
  { id: 'ember', name: 'Ember Amber', mode: 'dark', description: 'Smoked plum with a warm amber glow.',
    bg: '#25141d', paper: '#351d2a', sidebar: '#190d14', text: '#f5e4ea', muted: '#c6a2b2', line: '#523143', accent: '#ffab68', tint: '#51283a', hover: '#402432' },
  { id: 'aurora', name: 'Aurora Green', mode: 'dark', description: 'Deep evergreen with a luminous mint accent.',
    bg: '#10271e', paper: '#19372a', sidebar: '#091a13', text: '#e5f2e9', muted: '#a0c0aa', line: '#2b4c39', accent: '#6ddd98', tint: '#204832', hover: '#263d30' },
  { id: 'porcelain', name: 'Glacier Cobalt', mode: 'light', description: 'Cool porcelain and tailored cobalt.',
    bg: '#f2f5fa', paper: '#ffffff', sidebar: '#e4ebf6', text: '#202b43', muted: '#61718c', line: '#d8e1ef', accent: '#365caa', tint: '#dfe9fb', hover: '#eaf0f8' },
  { id: 'rosewater', name: 'Garnet Blush', mode: 'light', description: 'Powdered blush with a garnet finish.',
    bg: '#fbf4f3', paper: '#fffdfb', sidebar: '#f2e4e5', text: '#402b34', muted: '#806871', line: '#e8d6da', accent: '#a13c59', tint: '#f5dfe7', hover: '#f4e7e9' },
  { id: 'matcha', name: 'Matcha Olive', mode: 'light', description: 'Creamy matcha and pressed olive.',
    bg: '#f8f6e9', paper: '#fdfcf5', sidebar: '#e9e8d1', text: '#353722', muted: '#74734f', line: '#dcddc2', accent: '#6a7024', tint: '#e9e9c8', hover: '#efeedb' },
  { id: 'marigold', name: 'Golden Ochre', mode: 'light', description: 'Buttercream paper and golden ochre.',
    bg: '#fff6e8', paper: '#fffdf8', sidebar: '#f5e6ca', text: '#41301f', muted: '#796448', line: '#e7d7b7', accent: '#9b5e12', tint: '#f8e6c2', hover: '#f7edd9' },
  { id: 'graphite', name: 'Graphite Coral', mode: 'dark', description: 'Soft graphite with a coral spark.',
    bg: '#191b20', paper: '#24272e', sidebar: '#121419', text: '#f0ede9', muted: '#adb0b6', line: '#3a3e46', accent: '#ff947e', tint: '#433033', hover: '#30333a' },
  { id: 'mulberry', name: 'Mulberry Orchid', mode: 'dark', description: 'Velvet violet and orchid light.',
    bg: '#201826', paper: '#2d2133', sidebar: '#170f1d', text: '#f2e8f4', muted: '#bca9c4', line: '#49364f', accent: '#dca0e4', tint: '#403048', hover: '#392b40' },
  { id: 'fjord', name: 'Fjord Sky', mode: 'dark', description: 'Slate-blue depths and glacial cyan.',
    bg: '#18242d', paper: '#24343f', sidebar: '#101a21', text: '#e7eff2', muted: '#afc0c7', line: '#3a4e59', accent: '#8dc8e8', tint: '#2c4654', hover: '#2d3d46' },
  { id: 'espresso', name: 'Espresso Brass', mode: 'dark', description: 'Dark roast warmth with a soft brass glow.',
    bg: '#241b17', paper: '#322721', sidebar: '#19130f', text: '#f5ede3', muted: '#c2ad9b', line: '#514036', accent: '#e8bb77', tint: '#493829', hover: '#3e3029' },
  { id: 'glacier', name: 'Arctic Blue', mode: 'light', description: 'Icy blue-white with a crisp arctic blue accent.',
    bg: '#f3f8fc', paper: '#ffffff', sidebar: '#e5eff7', text: '#253645', muted: '#667e91', line: '#d7e4ed', accent: '#28729c', tint: '#dceef8', hover: '#e8f2f8' },
  { id: 'sakura', name: 'Sakura Violet', mode: 'light', description: 'Orchid-tinted petals with a soft violet accent.',
    bg: '#faf4fb', paper: '#fffdfd', sidebar: '#efe4f2', text: '#392b40', muted: '#786982', line: '#e2d6e9', accent: '#854b9e', tint: '#efdef2', hover: '#f2e9f4' },
  { id: 'sage', name: 'Forest Sage', mode: 'light', description: 'Quiet herbal green with a grounded forest accent.',
    bg: '#edf5ec', paper: '#f9fdf8', sidebar: '#dbe9d9', text: '#293a2e', muted: '#637b68', line: '#cfdfcd', accent: '#347247', tint: '#d5ead4', hover: '#e1eee0' },
  { id: 'citrus', name: 'Lemon Leaf', mode: 'light', description: 'Bright lemon cream with a fresh leaf accent.',
    bg: '#fffbe2', paper: '#fffef5', sidebar: '#f4edc2', text: '#3c361f', muted: '#796d45', line: '#e8dfb5', accent: '#92720b', tint: '#f5ecc4', hover: '#f8f1d5' },
  { id: 'lagoon', name: 'Lagoon Teal', mode: 'light', description: 'Pale aqua with a deep tropical teal accent.',
    bg: '#eaf8f4', paper: '#f8fffc', sidebar: '#d4eee5', text: '#1d3831', muted: '#57796e', line: '#c5e3d8', accent: '#087b69', tint: '#cdeee3', hover: '#def2e9' },
  { id: 'clay', name: 'Adobe Rust', mode: 'light', description: 'Soft adobe and a rich rust accent.',
    bg: '#f7eee9', paper: '#fffaf7', sidebar: '#ead8cf', text: '#412c2a', muted: '#80635f', line: '#e2cdc4', accent: '#ad463b', tint: '#f3dcd5', hover: '#f1e2dc' },
  { id: 'periwinkle', name: 'Periwinkle Iris', mode: 'light', description: 'Airy blue-violet with an indigo accent.',
    bg: '#f1f4fd', paper: '#fcfdff', sidebar: '#e1e8f9', text: '#29334b', muted: '#66748f', line: '#d4def2', accent: '#4d67b6', tint: '#dce6fa', hover: '#e8edf9' },
  { id: 'onyx', name: 'Onyx Silver', mode: 'dark', description: 'Near-black stone with a clean silver accent.',
    bg: '#17191c', paper: '#222529', sidebar: '#101215', text: '#eceff1', muted: '#a7afb5', line: '#373c41', accent: '#b9c8d1', tint: '#2c353b', hover: '#2a2e32' },
  { id: 'volcanic', name: 'Basalt Ember', mode: 'dark', description: 'Basalt and cooled ash with a molten orange accent.',
    bg: '#1d1b19', paper: '#292522', sidebar: '#121110', text: '#f3ece4', muted: '#b7a99b', line: '#423a33', accent: '#ff8a3d', tint: '#493020', hover: '#352a23' },
  { id: 'deepsea', name: 'Deepsea Aqua', mode: 'dark', description: 'Abyssal blue with a bright aqua accent.',
    bg: '#101a29', paper: '#19263a', sidebar: '#0a111d', text: '#e5edf7', muted: '#9eafc7', line: '#2d405c', accent: '#51d8c4', tint: '#1b3d48', hover: '#222f43' },
  { id: 'plum', name: 'Plum Lavender', mode: 'dark', description: 'Inky aubergine with a lavender-violet accent.',
    bg: '#1b1728', paper: '#272139', sidebar: '#100e1a', text: '#eeeafa', muted: '#b0a9ca', line: '#3e3857', accent: '#b7a0ff', tint: '#362d54', hover: '#302a45' },
  { id: 'pine', name: 'Pine Fern', mode: 'dark', description: 'Deep alpine green with a fresh fern accent.',
    bg: '#10271a', paper: '#1a3524', sidebar: '#09170f', text: '#e7f1e9', muted: '#a3bea9', line: '#2b4d36', accent: '#a7db78', tint: '#25452b', hover: '#263c2d' },
  { id: 'cobalt', name: 'Cobalt Electric', mode: 'dark', description: 'Midnight indigo with an electric blue accent.',
    bg: '#17152c', paper: '#24203f', sidebar: '#0e0c1d', text: '#f0edff', muted: '#b4add5', line: '#3d3764', accent: '#9c8cff', tint: '#30295b', hover: '#302b4b' },
  { id: 'ruby', name: 'Ruby Rose', mode: 'dark', description: 'Dark garnet with a bright rose accent.',
    bg: '#24171b', paper: '#332126', sidebar: '#180f12', text: '#f3e7e9', muted: '#c0a3aa', line: '#50343d', accent: '#ff91a4', tint: '#4a2833', hover: '#3d272e' },
  { id: 'canyon', name: 'Canyon Ember', mode: 'light', description: 'Sun-baked clay with a burnt orange accent.',
    bg: '#faf0e3', paper: '#fffaf2', sidebar: '#f0ddc4', text: '#3e2b1f', muted: '#7a6451', line: '#e5d0b5', accent: '#b0431a', tint: '#f5dccc', hover: '#f1e4d1' },
  { id: 'meadow', name: 'Spring Meadow', mode: 'light', description: 'Fresh sprout green with a leafy accent.',
    bg: '#f1f8e7', paper: '#fcfff6', sidebar: '#dfeacb', text: '#2b3a23', muted: '#66775b', line: '#cfdfbe', accent: '#4a7d2b', tint: '#dcefcf', hover: '#e5efda' },
  { id: 'harbor', name: 'Morning Harbor', mode: 'light', description: 'Harbor mist blue with a vivid marine accent.',
    bg: '#edf5fb', paper: '#ffffff', sidebar: '#d6e8f4', text: '#223242', muted: '#5e7383', line: '#c9dbe8', accent: '#1a5fb4', tint: '#d9e8fa', hover: '#e3eef7' },
  { id: 'orchid', name: 'Wild Orchid', mode: 'light', description: 'Pale petal pink with a bold magenta accent.',
    bg: '#faf0f6', paper: '#fffcfd', sidebar: '#f1d9e8', text: '#412234', muted: '#7c5e71', line: '#e6c6db', accent: '#b02a7a', tint: '#f5d5e8', hover: '#f4e2ed' },
  { id: 'dune', name: 'Golden Dune', mode: 'light', description: 'Warm dune sand with a deep bronze accent.',
    bg: '#fbf5e3', paper: '#fffdf5', sidebar: '#efe2bd', text: '#3e331e', muted: '#786a4c', line: '#e3d4af', accent: '#8c4d0f', tint: '#f0dfbd', hover: '#f4ead1' },
  { id: 'tidepool', name: 'Tidepool', mode: 'light', description: 'Shallow aqua with a deep sea-green accent.',
    bg: '#ebf6f4', paper: '#f8fffd', sidebar: '#cbe8e2', text: '#1e3531', muted: '#577672', line: '#bedcd6', accent: '#0b7a7d', tint: '#c9ece8', hover: '#dcefeb' },
  { id: 'wisteria', name: 'Wisteria Dawn', mode: 'light', description: 'Mist lavender with a vivid indigo accent.',
    bg: '#f3f0fc', paper: '#fdfcff', sidebar: '#dfd5f4', text: '#2d2944', muted: '#686181', line: '#d2c7e8', accent: '#5b4bc4', tint: '#ded5f8', hover: '#e9e3f8' },
  { id: 'cedar', name: 'Cedar Grove', mode: 'light', description: 'Birch paper with a bark-brown accent.',
    bg: '#f2f0e9', paper: '#faf9f5', sidebar: '#dfd8c6', text: '#32302a', muted: '#6e695c', line: '#d6cfbb', accent: '#6b4a2a', tint: '#e8dcc6', hover: '#eae5d6' },
  { id: 'blossom', name: 'Cherry Blossom', mode: 'light', description: 'Soft blossom pink with a true red accent.',
    bg: '#fdf1f1', paper: '#fffbfb', sidebar: '#f3d8d8', text: '#412c2c', muted: '#7e6161', line: '#e5c5c5', accent: '#be2e3a', tint: '#f6d5d8', hover: '#f4e1e1' },
  { id: 'mint', name: 'Morning Mint', mode: 'light', description: 'Cool mint wash with an emerald accent.',
    bg: '#edf8ef', paper: '#fafffc', sidebar: '#d0ebd6', text: '#23402d', muted: '#5e7c67', line: '#c3dfca', accent: '#1d7a4d', tint: '#cdecd7', hover: '#ddf0e2' },
  { id: 'nebula', name: 'Deep Nebula', mode: 'dark', description: 'Violet void with a nebula lilac accent.',
    bg: '#1b1626', paper: '#282037', sidebar: '#110d1a', text: '#ebe7f6', muted: '#aca5c3', line: '#3e3656', accent: '#c792ea', tint: '#3a2e50', hover: '#2f2644' },
  { id: 'crimson', name: 'Crimson Night', mode: 'dark', description: 'Smoked claret with a bright coral-red accent.',
    bg: '#251315', paper: '#362021', sidebar: '#180d0e', text: '#f4e5e5', muted: '#c19f9f', line: '#513235', accent: '#ff7a7a', tint: '#4a2730', hover: '#3d2629' },
  { id: 'kelp', name: 'Midnight Kelp', mode: 'dark', description: 'Deep kelp green with a bright kelp accent.',
    bg: '#12211b', paper: '#1c3329', sidebar: '#0a1511', text: '#e5efe9', muted: '#a1b7ab', line: '#2d493d', accent: '#4ade80', tint: '#1e4430', hover: '#24382e' },
  { id: 'saffron', name: 'Saffron Night', mode: 'dark', description: 'Dark spice brown with a golden saffron accent.',
    bg: '#211a11', paper: '#31271f', sidebar: '#16100a', text: '#f2ebdf', muted: '#bbad93', line: '#4c3f2f', accent: '#fbbf24', tint: '#4a3820', hover: '#3d3225' },
  { id: 'trench', name: 'Ocean Trench', mode: 'dark', description: 'Midnight trench blue with a sky-dive accent.',
    bg: '#0d1d2d', paper: '#152b41', sidebar: '#07121f', text: '#e2edf7', muted: '#9bb2c8', line: '#2a3f58', accent: '#38bdf8', tint: '#1b3a52', hover: '#1f2f43' },
  { id: 'moss', name: 'Night Moss', mode: 'dark', description: 'Forest floor dark with a lime-moss accent.',
    bg: '#191f13', paper: '#25301d', sidebar: '#10150b', text: '#ebeddc', muted: '#a8b497', line: '#3a492f', accent: '#bef264', tint: '#2c4224', hover: '#2b3623' },
  { id: 'neon', name: 'Neon Bloom', mode: 'dark', description: 'Black orchid with a neon pink accent.',
    bg: '#221426', paper: '#321d38', sidebar: '#170c1b', text: '#f3e5f4', muted: '#bca2c1', line: '#4e3056', accent: '#f0abfc', tint: '#452a51', hover: '#3c2645' },
  { id: 'copper', name: 'Smelted Copper', mode: 'dark', description: 'Smoked bronze with a molten copper accent.',
    bg: '#201814', paper: '#2f241c', sidebar: '#150f0b', text: '#f1e8de', muted: '#b4a595', line: '#493c30', accent: '#fb923c', tint: '#4a2e1e', hover: '#3a2c22' },
  { id: 'storm', name: 'Thunderstorm', mode: 'dark', description: 'Storm slate with a silver lightning accent.',
    bg: '#141a22', paper: '#1e2531', sidebar: '#0d1118', text: '#e5eaf1', muted: '#9faab8', line: '#323c4b', accent: '#94a3b8', tint: '#2b3543', hover: '#262e3a' },
  { id: 'ultraviolet', name: 'Ultraviolet', mode: 'dark', description: 'Deep ultraviolet with an electric indigo accent.',
    bg: '#191431', paper: '#251e47', sidebar: '#0f0b21', text: '#ebe8fa', muted: '#a9a2cf', line: '#3c3465', accent: '#818cf8', tint: '#2c2a5a', hover: '#2d2949' },
  { id: 'pistachio', name: 'Pistachio Lime', mode: 'light', description: 'Soft pistachio paper with a lively lime accent.',
    bg: '#f5f7e9', paper: '#fcfdf5', sidebar: '#e5e8cd', text: '#33351f', muted: '#70734f', line: '#d6dbb9', accent: '#788d16', tint: '#e7ecc7', hover: '#ecefd9' },
  { id: 'mauve', name: 'Mauve Rose', mode: 'light', description: 'Cool lilac paper with a rich berry accent.',
    bg: '#f7f0f7', paper: '#fffcff', sidebar: '#eadbea', text: '#39293a', muted: '#766477', line: '#dfcedf', accent: '#963b78', tint: '#efd8eb', hover: '#f0e3ef' },
  { id: 'verdant', name: 'Verdant Circuit', mode: 'dark', description: 'Deep evergreen with a bright spring-green accent.',
    bg: '#142019', paper: '#203126', sidebar: '#0b140f', text: '#e7f1e9', muted: '#a5b9a8', line: '#344a39', accent: '#80df80', tint: '#29452f', hover: '#293a2d' },
  { id: 'fuchsia', name: 'Fuchsia Voltage', mode: 'dark', description: 'Blackberry violet with an electric fuchsia accent.',
    bg: '#211323', paper: '#301b34', sidebar: '#160b18', text: '#f4e6f4', muted: '#bca3bd', line: '#4c3051', accent: '#f078d6', tint: '#442649', hover: '#39243f' },
];
function palette(definition) {
  const { id, name, mode, description, ...base } = definition;
  const surfaces = [base.bg, base.paper, base.sidebar, base.tint, base.hover];
  const accent = readableColor(base.accent, surfaces);
  const tokens = { ...base, accent,
    muted: readableColor(base.muted, surfaces),
    'accent-contrast': onColor(accent),
    'accent-hover': readableColor(mixColor(accent, mode === 'dark' ? '#ffffff' : '#000000', 0.08), surfaces),
    'border-strong': readableColor(base.muted, [base.paper, base.bg, base.sidebar], 3),
    focus: readableColor(base.accent, surfaces, 3),
    link: accent,
    'code-bg': base.sidebar, 'code-text': base.text,
    overlay: mode === 'dark' ? '#020711bb' : '#15201866',
    'overlay-strong': mode === 'dark' ? '#020711dd' : '#152018bb',
    shadow: mode === 'dark' ? '#00000066' : '#00000033',
    'shadow-soft': mode === 'dark' ? '#00000033' : '#00000014',
  };
  for (const [role, color] of Object.entries({ success: '#22834a', danger: '#be3b36', warning: '#986000', info: '#2865b2' })) {
    const tint = mixColor(base.paper, color, mode === 'dark' ? 0.17 : 0.09);
    tokens[role + '-tint'] = tint;
    tokens[role] = readableColor(color, [...surfaces, tint]);
    tokens[role + '-contrast'] = onColor(tokens[role]);
  }
  return Object.freeze({ id, name, mode, description, tokens: Object.freeze(tokens) });
}
export const palettes = Object.freeze(definitions.map(palette));
// Accent hue drives the appearance panel's within-mode color order, so the
// grid reads as a rainbow rather than registry insertion order.
export function accentHue(value) {
  const hex = String(value).trim().toLowerCase();
  const channels = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255);
  const [r, g, b] = channels;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (hue * 60 + 360) % 360;
}
export function accentSaturation(value) {
  const channels = String(value).trim().toLowerCase().slice(1).match(/../g).map(c => parseInt(c, 16) / 255);
  const max = Math.max(...channels), min = Math.min(...channels);
  if (max === 0) return 0;
  return (max - min) / max;
}
export const paletteHue = palette => accentHue(palette.tokens.accent);
function comparePalettesByColor(a, b) {
  if (a.mode !== b.mode) return a.mode === 'light' ? -1 : 1;
  const hue = paletteHue(a) - paletteHue(b);
  if (hue !== 0) return hue;
  const saturation = accentSaturation(b.tokens.accent) - accentSaturation(a.tokens.accent);
  if (Math.abs(saturation) > 0.001) return saturation;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}
// Light palettes first, then dark; each mode runs red -> orange -> yellow ->
// green -> teal -> blue -> violet -> pink by accent hue.
export const sortedPalettes = Object.freeze([...palettes].sort(comparePalettesByColor));
export const lightPalettes = Object.freeze(sortedPalettes.filter(p => p.mode === 'light'));
export const darkPalettes = Object.freeze(sortedPalettes.filter(p => p.mode === 'dark'));
export const isTheme = value => palettes.some(p => p.id === value);
export const resolveTheme = value => isTheme(value) ? value : 'light';
export const themePalette = value => palettes.find(p => p.id === resolveTheme(value));
export const themeMode = value => themePalette(value).mode;
export const themeColors = Object.freeze(Object.fromEntries(palettes.map(p => [p.id, p.tokens.bg])));
export const paletteStyles = Object.freeze(Object.fromEntries(palettes.map(p => [p.id,
  Object.freeze(Object.fromEntries(Object.entries(p.tokens).map(([key, color]) => ['--' + key, color]))),
])));
export function themeStyle(value) { return paletteStyles[themePalette(value).id]; }
export function applyTheme(value, root = document.documentElement) {
  const p = themePalette(value);
  root.dataset.theme = p.id;
  root.style.backgroundColor = p.tokens.bg;
  root.style.colorScheme = p.mode;
  for (const [key, color] of Object.entries(themeStyle(p.id))) root.style.setProperty(key, color);
}
// Checked-in fallback CSS is generated from exactly these same tokens. It also
// makes Vite development and server-rendered fixtures independent of JavaScript.
export function paletteCSS() {
  return '/* Generated by scripts/palette-css.mjs. Edit domain/theme.mjs, not this file. */\n' + palettes.map(p =>
    `${p.id === 'light' ? ':root, ' : ''}:root[data-theme="${p.id}"] {\n  color-scheme: ${p.mode};\n` +
    Object.entries(themeStyle(p.id)).map(([key, color]) => `  ${key}: ${color};`).join('\n') + '\n}\n').join('\n');
}
