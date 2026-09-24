import test from "node:test";
import assert from "node:assert/strict";
import { compoundSegments } from "../domain/usage-meter.mjs";
import { availabilityView } from "../domain/availability.mjs";
import { usageData } from "./fixtures/usage-data.mjs";

const plans = (...values) =>
  values.map((remaining, index) => ({ id: String(index), remaining }));
const total = (segments, portion) =>
  segments
    .filter((s) => s.portion === portion)
    .reduce((sum, s) => sum + s.width, 0);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function conservation(segments, count) {
  near(
    segments.reduce((sum, s) => sum + s.width, 0),
    count ? 100 : 0,
  );
  for (const id of new Set(segments.map((s) => s.id))) {
    near(
      segments.filter((s) => s.id === id).reduce((sum, s) => sum + s.width, 0),
      100 / count,
    );
  }
  assert.ok(segments.every((s) => Number.isFinite(s.width) && s.width >= 0));
}

test("compound rail packs remaining left and used right around one 60% boundary", () => {
  const segments = compoundSegments(plans(90, 60, 30));
  assert.deepEqual(
    segments.map((s) => `${s.id}/${s.portion}`),
    ["0/remaining", "1/remaining", "2/remaining", "2/used", "1/used", "0/used"],
  );
  assert.deepEqual(
    segments.slice(0, 3).map((s) => s.width),
    [30, 20, 10],
  );
  near(total(segments, "remaining"), 60);
  near(total(segments, "used"), 40);
  conservation(segments, 3);
});

test("unknown shares stay between the known blocks, never spent or redistributed", () => {
  const segments = compoundSegments(plans(90, null, 30));
  assert.deepEqual(
    segments.map((s) => s.portion),
    ["remaining", "remaining", "unknown", "used", "used"],
  );
  near(total(segments, "remaining"), 40);
  near(total(segments, "unknown"), 100 / 3);
  near(total(segments, "used"), 80 / 3);
  conservation(segments, 3);
});

test("full, exhausted, tiny, and single-provider portions retain exact geometry", () => {
  for (const values of [
    [100, 100, 100],
    [0, 0, 0],
    [0, 50, 100],
    [0.001, 99.999, 40],
    [67],
    [null, null, null],
    [],
  ]) {
    const segments = compoundSegments(plans(...values));
    conservation(segments, values.length);
    if (values.length && values.every((v) => v !== null))
      near(
        total(segments, "remaining"),
        values.reduce((s, v) => s + v, 0) / values.length,
      );
  }
  assert.deepEqual(compoundSegments(), []);
});

test("invalid values remain unknown; large finite percentages clamp without overflow", () => {
  const segments = compoundSegments(
    plans(NaN, undefined, -1, Infinity, "40", 120),
  );
  near(total(segments, "unknown"), 500 / 6);
  near(total(segments, "remaining"), 100 / 6);
  near(total(segments, "used"), 0);
  conservation(segments, 6);
});

test("the shared endpoint moves with availability, not price, model count, or rounding", () => {
  const now = Date.parse("2026-09-21T08:00:00Z"),
    data = usageData(now);
  const view = availabilityView(data, now);
  const before = compoundSegments(view.plans);
  data.settings.plans.providers.openai.monthlyPrice = 10000;
  data.models.push(
    ...data.models.map((m) => ({ ...m, id: m.id + "-another" })),
  );
  assert.deepEqual(compoundSegments(availabilityView(data, now).plans), before);
  const lower = compoundSegments(
    view.plans.map((p, i) => ({ ...p, remaining: i === 0 ? 60 : p.remaining })),
  );
  near(total(lower, "remaining"), 50);
  near(total(lower, "used"), 50);
  assert.deepEqual(
    lower.map((s) => `${s.id}/${s.portion}`),
    before.map((s) => `${s.id}/${s.portion}`),
  );
  assert.equal(view.remaining, 60, "geometry never mutates the quota view");
});
