import test from "node:test";
import assert from "node:assert/strict";
import { uiContract } from "../domain/protocol.mjs";
import { availabilityView } from "../domain/availability.mjs";
import { usageFixture } from "./fixtures/usage-app.mjs";

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
