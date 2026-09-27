import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, mixColor, normalizeColor, readableColor } from '../domain/color.mjs';

// Independent reference retains the previous emitted-hex search. Equivalence
// protects shade choice as well as contrast; choosing any passing shade is not enough.
function reference(base, surfaces, minimum) {
  const source = normalizeColor(base);
  const passes = color => surfaces.every(surface => contrast(color, surface) >= minimum);
  if (passes(source)) return source;
  for (let step = 1; step <= 255; step++) {
    for (const endpoint of ['#000000', '#ffffff']) {
      const candidate = mixColor(source, endpoint, step / 255);
      if (passes(candidate)) return candidate;
    }
  }
  throw Error('incompatible');
}
test('optimized readability preserves the exact quantized shade search', () => {
  const colors = ['#fff', '#000', '#777777', '#ffff00', '#00ffff', '#ff00ff', '#168578'];
  for (let i = 0; i < 32; i++) colors.push('#' + ((i * 104729 + 7919) % 16777216).toString(16).padStart(6, '0'));
  for (const surfaces of [['#ffffff', '#f8f9f6'], ['#171c19', '#222a25'], ['#f0e7df']])
    for (const minimum of [3, 4.5, 7])
      for (const color of colors)
        assert.equal(readableColor(color, surfaces, minimum), reference(color, surfaces, minimum), `${color} on ${surfaces} at ${minimum}`);
  assert.throws(() => readableColor('#777777', ['#000000', '#ffffff'], 7), /incompatible/);
  assert.throws(() => readableColor('invalid', ['#ffffff']), /hex color/);
});
