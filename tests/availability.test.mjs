import test from "node:test";
import assert from "node:assert/strict";
import {
  availabilityView,
  remainingLabel,
  resetLabel,
  observedLabel,
  modelAvailability,
} from "../domain/availability.mjs";
import { createUsageRefresh } from "../domain/usage-refresh.mjs";
import { palettes } from "../domain/theme.mjs";
import { providerTokens } from "../domain/provider-colors.mjs";
import { contrast } from "../domain/color.mjs";
import { quotaFixture, usageData } from "./fixtures/usage-data.mjs";
const now = Date.parse("2026-09-21T08:00:00Z");
const provider = (view, id) => view.providers.find((p) => p.id === id);

test("availability is an equal plan-share estimate, never subscription value", () => {
  const data = usageData(now),
    initial = availabilityView(data, now);
  assert.equal(initial.remaining, 60);
  assert.equal(initial.headline, "60%");
  assert.deepEqual(
    initial.plans.map((p) => p.remaining),
    [90, 60, 30],
  );
  for (const value of [null, 0, 1, 10000]) {
    data.settings.plans.providers.openai.monthlyPrice = value;
    assert.deepEqual(availabilityView(data, now), initial);
  }
  assert.equal(initial.providers.length, 4);
  assert.equal(initial.plans.length, 3);
  assert.equal(provider(initial, "opencode").label, "Variable");
});
test("one shared allowance is counted once regardless of model count", () => {
  const data = usageData(now);
  data.models.push(
    ...Array.from({ length: 30 }, (_, i) => ({
      ...data.models[0],
      id: `openai/test-${i}`,
    })),
  );
  const result = availabilityView(data, now);
  assert.equal(result.remaining, 60);
  assert.equal(result.plans.length, 3);
  assert.equal(result.events.length, 6);
  assert.equal(result.providers[0].models.length, 31);
});
test("native connections, saved enablement and billing mode bound finite shares", () => {
  const data = usageData(now);
  data.providers.connected = ["openai"];
  // Public Free inventory needs no OAuth connection, but is not proof of quota.
  assert.deepEqual(
    availabilityView(data, now).providers.map((p) => p.id),
    ["openai", "opencode"],
  );
  data.settings.plans.providers.openai.enabled = false;
  assert.equal(availabilityView(data, now).headline, "Free models");
  data.providers.all = [];
  assert.equal(availabilityView(data, now).status, "empty");
  const api = usageData(now);
  api.settings.plans.providers.openai.mode = "api";
  assert.equal(availabilityView(api, now).remaining, 45);
  assert.equal(provider(availabilityView(api, now), "openai").remaining, null);
});
test("exhausted limiting window overrides a positive monthly balance", () => {
  const state = quotaFixture(now);
  state.surfaces["opencode-go"].windows.weekly.used_percent = 100;
  const result = availabilityView(usageData(now, state), now),
    go = provider(result, "opencode-go");
  assert.equal(go.remaining, 0);
  assert.equal(go.label, "0%");
  assert.equal(go.windows.find((w) => w.key === "monthly").remaining, 80);
  assert.equal(go.models[0].status, "Unavailable");
  assert.equal(result.nextReset.provider, "opencode-go");
  assert.equal(result.nextReset.window, "5-hour");
});
test("a valid known block is not hidden by an unrelated unknown window", () => {
  const state = quotaFixture(now);
  state.surfaces["opencode-go"].windows.weekly.used_percent = 100;
  delete state.surfaces["opencode-go"].windows.monthly;
  assert.equal(
    provider(availabilityView(usageData(now, state), now), "opencode-go")
      .remaining,
    0,
  );
});
test("active execution block is timed and its expiry requires new observation", () => {
  const state = quotaFixture(now),
    until = now + 120000;
  state.surfaces["openai-oauth"].execution = {
    blocked: true,
    recheck_at: new Date(until).toISOString(),
  };
  const data = usageData(now, state),
    before = availabilityView(data, now);
  assert.equal(provider(before, "openai").remaining, 0);
  assert.equal(before.nextChangeAt, now + 60000);
  const after = availabilityView(data, until);
  assert.equal(provider(after, "openai").remaining, null);
  assert.equal(after.needsRefresh, true);
  // A recheck deadline is not fabricated as a provider reset event.
  assert.ok(!after.events.some((e) => Date.parse(e.resetAt) === until));
});
test("explicit provider denial remains known zero without complete window data", () => {
  const state = quotaFixture(now);
  state.surfaces["openai-oauth"].allowed = false;
  state.surfaces["openai-oauth"].windows = {};
  assert.equal(
    provider(availabilityView(usageData(now, state), now), "openai").remaining,
    0,
  );
});
test("unknown and stale plans keep their segments but suppress a combined number", () => {
  const state = quotaFixture(now);
  delete state.surfaces["opencode-go"];
  const data = usageData(now, state),
    partial = availabilityView(data, now);
  assert.equal(partial.headline, "Partial data");
  assert.equal(partial.remaining, null);
  assert.equal(partial.plans.length, 3);
  assert.deepEqual(
    partial.plans.map((p) => p.remaining),
    [90, 60, null],
  );
  const stale = availabilityView(data, now + 600001);
  assert.equal(stale.status, "unknown");
  assert.ok(stale.plans.every((p) => p.remaining === null));
  assert.equal(stale.needsRefresh, true);
});
test("time crossing a reset invalidates the old observation without granting a refill", () => {
  const state = quotaFixture(now);
  state.surfaces["opencode-go"].windows.rolling.resets_at = new Date(
    now + 30000,
  ).toISOString();
  const data = usageData(now, state);
  assert.equal(availabilityView(data, now).nextChangeAt, now + 30000);
  const expired = availabilityView(data, now + 30000);
  assert.equal(provider(expired, "opencode-go").remaining, null);
  assert.equal(expired.status, "partial");
  assert.equal(expired.needsRefresh, true);
  assert.ok(expired.events.every((e) => Date.parse(e.resetAt) > now + 30000));
});
test("malformed and future observations cannot carry a plausible leftover percentage", () => {
  for (const corrupt of [
    (p) => {
      p.metrics = [];
    },
    (p) => {
      p.asOf = "bad";
    },
    (p) => {
      p.asOf = new Date(now + 61000).toISOString();
    },
    (p) => {
      p.metrics[0].remainingPercent = NaN;
    },
    (p) => {
      p.availableRemaining = -2;
    },
  ]) {
    const data = usageData(now);
    corrupt(data.snapshot.usage.providers[0]);
    assert.equal(
      provider(availabilityView(data, now), "openai").remaining,
      null,
    );
  }
  for (const data of [
    null,
    {},
    {
      snapshot: { usage: { providers: {} } },
      models: {},
      providers: { all: {}, connected: {} },
    },
  ])
    assert.doesNotThrow(() => availabilityView(data, now));
});
test("cached-but-usable observations keep their age and flag a failed refresh", () => {
  const data = usageData(now);
  data.snapshot.usage.providers[0].telemetryStatus = "auth-failed";
  data.snapshot.usage.providers[0].cached = true;
  data.snapshot.usage.providers[0].asOf = new Date(now - 180000).toISOString();
  data.snapshot.generatedAt = new Date(now + 1000).toISOString();
  const result = availabilityView(data, now);
  assert.equal(result.remaining, 60);
  assert.equal(result.asOf, new Date(now - 180000).toISOString());
  assert.equal(result.refreshFailed, true);
  assert.equal(observedLabel(result.asOf, now), "Updated 3m ago");
});
test("model statuses distinguish shared availability from independent native restrictions", () => {
  const data = usageData(now);
  data.models[0].availability = "deprecated";
  const result = availabilityView(data, now);
  assert.equal(result.models, undefined);
  assert.equal(result.providers[0].models[0].status, "Deprecated");
  assert.equal(
    modelAvailability({ disabled: true }, result.providers[1]),
    "Unavailable",
  );
  assert.equal(modelAvailability({}, null), "Not connected");
});
test("percent and countdown copy preserve unknown and nonterminal edges", () => {
  assert.deepEqual(
    [null, undefined, NaN, Infinity, -1, 0, 0.01, 42.2, 99.99, 100, 110].map(
      remainingLabel,
    ),
    [
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
      "0%",
      "<1%",
      "42%",
      ">99%",
      "100%",
      "100%",
    ],
  );
  assert.equal(resetLabel("bad", now), "Reset unknown");
  assert.equal(resetLabel(new Date(now).toISOString(), now), "Checking…");
  assert.equal(resetLabel(new Date(now + 10).toISOString(), now), "<1m");
  assert.equal(
    resetLabel(new Date(now + 134 * 60000).toISOString(), now),
    "2h 14m",
  );
});
test("provider fill and text retain contrast on their actual rail and panel in every palette", () => {
  for (const palette of palettes)
    for (const color of [
      "#ffffff",
      "#000000",
      "#ffff00",
      "#00ffff",
      "#ff00ff",
      "#777777",
    ]) {
      const t = providerTokens("openai", {
        theme: palette.id,
        providerColors: { openai: color },
      });
      assert.ok(contrast(t["--provider-solid"], t["--provider-tint"]) >= 3);
      assert.ok(contrast(t["--provider-fg"], palette.tokens.paper) >= 4.5);
      assert.equal(t["--provider-base"], color);
    }
});
test("refresh coordinator deduplicates views, respects cooldown and bounds retries", async () => {
  let at = now,
    calls = 0,
    finish;
  const controller = createUsageRefresh({
    clock: () => at,
    request: () => {
      calls++;
      return new Promise((r) => {
        finish = r;
      });
    },
  });
  const states = [],
    unsubscribe = controller.subscribe((s) => states.push(s));
  const first = controller.refresh();
  const second = controller.refresh({ automatic: true });
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish();
  assert.equal(await first, true);
  assert.equal(controller.getState().pending, false);
  assert.equal(await controller.refresh({ automatic: true }), false);
  assert.equal(calls, 1);
  at += 60000;
  const third = controller.refresh({ automatic: true });
  await Promise.resolve();
  finish();
  await third;
  assert.equal(calls, 2);
  unsubscribe();
  assert.ok(states.some((s) => s.pending));
});
test("failed and synchronous refreshes settle, retain a concise error, and back off", async () => {
  let at = now,
    calls = 0;
  const controller = createUsageRefresh({
    clock: () => at,
    request: () => {
      calls++;
      throw Error("Network failed");
    },
  });
  for (const gap of [120000, 240000, 300000, 300000]) {
    assert.equal(await controller.refresh({ automatic: true }), false);
    assert.equal(controller.getState().pending, false);
    assert.equal(controller.getState().error, "Refresh failed");
    assert.equal(controller.getState().nextAttemptAt, at + gap);
    at += gap;
  }
  assert.equal(calls, 4);
});
test("a refreshed bootstrap alone cannot clear an expired execution block", () => {
  const state = quotaFixture(now),
    until = now + 120000;
  state.surfaces["openai-oauth"].execution = {
    blocked: true,
    recheck_at: new Date(until).toISOString(),
  };
  const staleObservation = usageData(until + 1, state);
  assert.equal(
    provider(availabilityView(staleObservation, until + 1), "openai").remaining,
    null,
  );
  state.surfaces["openai-oauth"].telemetry.as_of = new Date(
    until + 1,
  ).toISOString();
  assert.equal(
    provider(availabilityView(usageData(until + 1, state), until + 1), "openai")
      .remaining,
    90,
  );
});
test("Free route execution failures and native model restrictions remain visible without fake quotas", () => {
  const state = quotaFixture(now);
  state.surfaces["opencode-free"] = {
    execution: {
      blocked: true,
      recheck_at: new Date(now + 300000).toISOString(),
    },
  };
  const result = availabilityView(usageData(now, state), now),
    free = provider(result, "opencode");
  assert.equal(free.remaining, null);
  assert.equal(free.label, "Unavailable");
  assert.equal(free.models[0].status, "Unavailable");
  assert.equal(result.remaining, 60);
  const data = usageData(now);
  data.providers.all[0].models.test.status = "disabled";
  assert.equal(
    availabilityView(data, now).providers[0].models[0].status,
    "Unavailable",
  );
});
