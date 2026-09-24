import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { uiContract } from "../domain/protocol.mjs";
import { availabilityView } from "../domain/availability.mjs";
import { usageData } from "./fixtures/usage-data.mjs";
import { usageFixture } from "./fixtures/usage-app.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const now = Date.parse("2026-09-21T08:00:00Z");
test("rendered summaries and provider details expose the same estimate without financial leakage", async (t) => {
  const server = await createServer({
    root,
    optimizeDeps: { noDiscovery: true, entries: [], include: [] },
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  t.after(() => server.close());
  const { UsageSidebar, UsageHero, UsageProviders } =
    await server.ssrLoadModule("/src/AvailableUsage.tsx");
  const { AppearanceContext } = await server.ssrLoadModule(
    "/src/ProviderColors.tsx",
  );
  const data = usageData(now),
    view = availabilityView(data, now);
  const render = (Component, selected = view) =>
    renderToStaticMarkup(
      React.createElement(
        AppearanceContext.Provider,
        { value: { theme: "midnight", providerColors: { openai: "#ffffff" } } },
        React.createElement(Component, {
          view: selected,
          state: { pending: false, error: "" },
          onRefresh() {},
          onOpen() {},
        }),
      ),
    );
  for (const Component of [UsageSidebar, UsageHero]) {
    const html = render(Component);
    assert.match(html, /Estimated available/);
    assert.match(html, />60%<\/strong>/);
    assert.equal((html.match(/data-portion="remaining"/g) ?? []).length, 3);
    assert.equal((html.match(/data-portion="used"/g) ?? []).length, 3);
    assert.ok(
      html.indexOf('data-portion="remaining"') <
        html.indexOf('data-portion="used"'),
    );
    assert.match(html, /flex-basis:30%/);
    assert.match(html, /data-provider="openai"/);
    assert.match(html, /--provider-base:#ffffff/);
    assert.doesNotMatch(
      html,
      /\$|Monthly subscriptions|remainingValue|estimatedCost|tokens|currency/,
    );
    assert.doesNotMatch(html, /transition:all/);
  }
  const sidebar = render(UsageSidebar);
  assert.match(sidebar, /aria-expanded="false"/);
  assert.match(sidebar, /id="[^"]+" hidden=""/);
  assert.match(sidebar, /Show provider availability/);
  const details = render(UsageProviders);
  assert.match(details, /Next reset/);
  assert.match(details, /90%/);
  assert.doesNotMatch(
    details,
    /<details|<summary|usage-model-list|usage-provider-details|model · Limits/,
  );
  assert.doesNotMatch(details, /OpenAI model|No models reported/);
  const hero = render(UsageHero);
  assert.match(hero, /About this estimate/);
  assert.match(hero, /usage-event/);
  assert.match(hero, /dateTime=/i);
  const partial = structuredClone(data);
  partial.snapshot.usage.providers[0].fresh = false;
  for (const Component of [UsageSidebar, UsageHero]) {
    const html = render(Component, availabilityView(partial, now));
    assert.match(html, /Partial data/);
    assert.match(html, /usage-unknown/);
    assert.doesNotMatch(html, /aria-valuenow="0"/);
  }
});
test("actual bootstrap and HTTP refresh preserve the public quota boundary and internal accounting", async (t) => {
  const f = await usageFixture();
  t.after(() => f.close());
  const headers = {
    "X-Freelancer-Client": "webpage",
    "Content-Type": "application/json",
  };
  const before = await f.app.bootstrap(f.project.id, f.session.id);
  const summary = availabilityView(before, Date.now());
  assert.equal(summary.remaining, 60);
  assert.equal(before.uiContract, uiContract);
  const observed = before.snapshot.usage.providers.map((p) => p.asOf);
  const response = await fetch(f.url + "/api/usage/refresh", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(response.status, 200);
  assert.equal(f.refreshCount(), 1);
  const after = await f.app.bootstrap(f.project.id, f.session.id);
  assert.deepEqual(
    after.snapshot.usage.providers.map((p) => p.asOf),
    observed,
    "refresh completion does not rewrite observation times",
  );
  const settings = await f.store.read("settings");
  settings.plans.providers.openai.monthlyPrice = 250;
  await f.app.savePlans(settings.plans);
  const priced = await f.app.bootstrap(f.project.id, f.session.id);
  assert.equal(availabilityView(priced, Date.now()).remaining, 60);
  assert.equal(
    priced.costs.providers.find((p) => p.id === "openai").monthlyPrice,
    250,
  );
  assert.equal(
    priced.costs.providers.find((p) => p.id === "openai").remainingValue,
    225,
  );
  assert.equal(
    f.mutations.length,
    0,
    "usage refresh never dispatches or changes native authentication",
  );
});
