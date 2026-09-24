// sRGB color math shared by palette generation, provider identities and tests.
// Only canonical hex colors cross the settings boundary; never arbitrary CSS.
export function normalizeColor(value) {
  if (typeof value !== 'string') throw Error('Choose a hex color such as #2563eb.');
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) return '#' + [...hex.slice(1)].map(c => c + c).join('');
  if (!/^#[0-9a-f]{6}$/.test(hex)) throw Error('Choose a hex color such as #2563eb.');
  return hex;
}
export const colorChannels = value => normalizeColor(value).slice(1).match(/../g).map(c => parseInt(c, 16));
export function luminance(value) {
  const rgb = colorChannels(value).map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function mixColor(a, b, amount) {
  const left = colorChannels(a), right = colorChannels(b);
  const t = Math.max(0, Math.min(1, amount));
  return '#' + left.map((c, i) => Math.round(c + (right[i] - c) * t).toString(16).padStart(2, '0')).join('');
}
export function readableColor(base, surfaces, minimum = 4.5) {
  const source = normalizeColor(base);
  const passes = color => surfaces.every(surface => contrast(color, surface) >= minimum);
  if (passes(source)) return source;
  // Mixing toward white/black retains the color family without trusting the
  // selected swatch as text. Work in quantized sRGB and test the emitted hex.
  for (let step = 1; step <= 255; step++) {
    for (const endpoint of ['#000000', '#ffffff']) {
      const candidate = mixColor(source, endpoint, step / 255);
      if (passes(candidate)) return candidate;
    }
  }
  throw Error('The palette has incompatible text surfaces.');
}
export const onColor = background => contrast('#ffffff', background) >= contrast('#000000', background) ? '#ffffff' : '#000000';
