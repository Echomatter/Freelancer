import { usageView } from "../../shared/usage.mjs";
import { providerCatalog } from "../../domain/costs.mjs";

export function quotaFixture(now = Date.now()) {
  const telemetry = {
    status: "ok",
    source: "sanitized-test",
    as_of: new Date(now).toISOString(),
  };
  const reset = (delta) => new Date(now + delta).toISOString();
  return {
    surfaces: {
      "openai-oauth": {
        telemetry: { ...telemetry },
        windows: {
          primary: {
            used_percent: 10,
            window_seconds: 18000,
            reset_at_unix: (now + 4 * 3600000) / 1000,
          },
          weekly: {
            used_percent: 5,
            window_seconds: 604800,
            reset_at_unix: (now + 3 * 86400000) / 1000,
          },
        },
      },
      "github-copilot-oauth": {
        telemetry: { ...telemetry },
        reset_at: reset(7 * 86400000),
        buckets: {
          premium_interactions: { percent_remaining: 60 },
          chat: { unlimited: true, percent_remaining: 100 },
        },
      },
      "opencode-go": {
        telemetry: { ...telemetry },
        windows: {
          rolling: { used_percent: 70, resets_at: reset(2 * 3600000) },
          weekly: { used_percent: 25, resets_at: reset(2 * 86400000) },
          monthly: { used_percent: 20, resets_at: reset(10 * 86400000) },
        },
      },
    },
  };
}
export function usageData(now = Date.now(), state = quotaFixture(now)) {
  const providers = providerCatalog.map((p) => ({
    id: p.id,
    name: p.name,
    models: { test: { name: p.name + " model" } },
  }));
  return {
    providers: { all: providers, connected: providerCatalog.map((p) => p.id) },
    settings: {
      plans: {
        currency: "USD",
        providers: Object.fromEntries(
          providerCatalog.map((p) => [
            p.id,
            {
              mode: p.mode,
              enabled: true,
              monthlyPrice: null,
            },
          ]),
        ),
      },
    },
    models: providerCatalog.map((p) => ({
      id: p.id + "/test",
      provider: p.id,
      name: p.name + " model",
      availability: "connected / unverified",
    })),
    snapshot: {
      usage: usageView(
        state,
        providerCatalog.map((p) => p.surface),
        {},
        now,
      ),
    },
  };
}
