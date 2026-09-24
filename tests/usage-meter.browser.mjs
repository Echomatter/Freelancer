// Imported by the production usage journey; inspect rendered geometry, not just
// percentages in inline styles. No provider calls or separate browser fixture.
import assert from "node:assert/strict";
import { contrast } from "../domain/color.mjs";

export async function checkCompoundMeter(page, remaining, unknown = 0) {
  const expected = { remaining, unknown, used: 100 - remaining - unknown };
  await page.waitForFunction((expected) => {
    const bars = [...document.querySelectorAll(".usage-compound")].filter(
      (e) => e.getClientRects().length,
    );
    return (
      bars.length > 0 &&
      bars.every((bar) => {
        const r = bar.getBoundingClientRect(),
          style = getComputedStyle(bar);
        const left = r.left + parseFloat(style.borderLeftWidth),
          right = r.right - parseFloat(style.borderRightWidth),
          width = right - left;
        let x = left,
          rank = -1;
        const widths = { remaining: 0, unknown: 0, used: 0 };
        for (const child of bar.children) {
          const rect = child.getBoundingClientRect(),
            portion = child.dataset.portion;
          const nextRank = ["remaining", "unknown", "used"].indexOf(portion);
          if (nextRank < rank || nextRank < 0 || Math.abs(rect.left - x) > 0.2)
            return false;
          rank = nextRank;
          x = rect.right;
          widths[portion] += rect.width;
          if (getComputedStyle(child).borderRadius !== "0px") return false;
        }
        return (
          style.columnGap === "0px" &&
          Math.abs(x - right) < 0.2 &&
          Object.entries(widths).every(
            ([portion, value]) =>
              Math.abs(value - (width * expected[portion]) / 100) < 0.2,
          )
        );
      })
    );
  }, expected);
  assert.equal(
    await page
      .locator(
        ".usage-providers details, .usage-providers select, .usage-model-list",
      )
      .count(),
    0,
    "no model/limits dropdown beneath provider reset rows",
  );
}

export async function checkCompoundContrast(page) {
  const pairs = await page.locator(".usage-compound").evaluateAll((bars) =>
    bars
      .filter((b) => b.getClientRects().length)
      .flatMap((bar) => {
        return [...bar.querySelectorAll('[data-portion="remaining"]')].map(
          (fill) => {
            const used = [
              ...bar.querySelectorAll('[data-portion="used"]'),
            ].find((e) => e.dataset.provider === fill.dataset.provider);
            return [
              getComputedStyle(fill).backgroundColor,
              getComputedStyle(used).backgroundColor,
            ];
          },
        );
      }),
  );
  const hex = (value) =>
    "#" +
    value
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((v) => Math.round(Number(v)).toString(16).padStart(2, "0"))
      .join("");
  for (const [fill, used] of pairs)
    assert.ok(contrast(hex(fill), hex(used)) >= 3, `${fill} against ${used}`);
}
