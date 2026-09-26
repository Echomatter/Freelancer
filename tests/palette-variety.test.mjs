import test from "node:test";
import assert from "node:assert/strict";
import { palettes } from "../domain/theme.mjs";

// Weighted OKLab distance over the shell, sidebar, accent and text. This is a
// catalog separation guard, not a claim about WCAG or color-vision equivalence.
function lab(hex) {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const vector = (t) =>
  ["bg", "sidebar", "accent", "text"].flatMap((k, i) =>
    lab(t[k]).map((x) => x * [1, 1.1, 1, 0.4][i]),
  );

test("same-mode palettes remain separated across their rendered semantic colors", () => {
  const vectors = palettes.map((p) => vector(p.tokens));
  for (let i = 0; i < palettes.length; i++)
    for (let j = 0; j < i; j++) {
      if (palettes[i].mode !== palettes[j].mode) continue;
      const distance = Math.sqrt(
        vectors[i].reduce(
          (sum, value, k) => sum + (value - vectors[j][k]) ** 2,
          0,
        ),
      );
      assert.ok(
        distance >= 0.06,
        palettes[i].name + " overlaps " + palettes[j].name,
      );
    }
});
