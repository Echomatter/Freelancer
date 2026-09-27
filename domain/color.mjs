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
const linear = Array.from({ length: 256 }, (_, channel) => {
  const s = channel / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});
const channelLuminance = ([r, g, b]) => linear[r] * 0.2126 + linear[g] * 0.7152 + linear[b] * 0.0722;
export const luminance = value => channelLuminance(colorChannels(value));
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
  const channels = colorChannels(source), backgrounds = surfaces.map(luminance);
  const passes = rgb => {
    const value = channelLuminance(rgb);
    return backgrounds.every(background => (Math.max(value, background) + 0.05) / (Math.min(value, background) + 0.05) >= minimum);
  };
  if (passes(channels)) return source;
  // Mixing toward white/black retains the color family without trusting the
  // selected swatch as text. Work in quantized sRGB and test the emitted hex.
  for (let step = 1; step <= 255; step++) {
    for (const endpoint of [0, 255]) {
      const candidate = channels.map(channel => Math.round(channel + (endpoint - channel) * (step / 255)));
      if (passes(candidate)) return '#' + candidate.map(channel => channel.toString(16).padStart(2, '0')).join('');
    }
  }
  throw Error('The palette has incompatible text surfaces.');
}
export const onColor = background => contrast('#ffffff', background) >= contrast('#000000', background) ? '#ffffff' : '#000000';
