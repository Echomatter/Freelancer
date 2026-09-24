import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePlans,
  usageRecord,
  summarizeCosts,
} from "../domain/costs.mjs";
const at = Date.UTC(2026, 8, 20);
const record = (id, providerID, tokens, sessionID = id) => ({
  id,
  providerID,
  tokens,
  sessionID,
  modelID: "model",
  createdAt: at,
  completed: true,
  tools: 2,
  reportedCost: 0.25,
});
const plan = {
  providers: {
    openai: { monthlyPrice: 20 },
    "github-copilot": { monthlyPrice: 10 },
  },
};

test("chat totals include descendants while global and per-agent estimates count responses once", () => {
  const result = summarizeCosts({
    plans: { providers: { openai: { monthlyPrice: 30 } } },
    month: "2026-09",
    connected: ["openai"],
    records: [
      {
        ...record("a", "openai", 10, "parent"),
        agentID: "engineer",
        agentName: "Engineer",
      },
      {
        ...record("b", "openai", 20, "child"),
        parentSessionID: "parent",
        nativeAgent: "researcher",
      },
      {
        ...record("c", "opencode", 15, "grandchild"),
        parentSessionID: "child",
        nativeAgent: "review",
      },
    ],
  });
  assert.equal(result.tokens, 45);
  assert.equal(result.chats.find((c) => c.sessionID === "parent").tokens, 45);
  assert.equal(
    result.chats.find((c) => c.sessionID === "parent").childTokens,
    35,
  );
  assert.equal(
    result.chats.find((c) => c.sessionID === "parent").estimatedCost,
    30,
  );
  assert.equal(result.chats.find((c) => c.sessionID === "child").tokens, 35);
  assert.equal(
    result.agents.reduce((n, a) => n + a.tokens, 0),
    45,
  );
  assert.equal(
    result.agents.reduce((n, a) => n + a.estimatedCost, 0),
    30,
  );
  assert.equal(
    result.agents.find((a) => a.id === "native:review").estimatedCost,
    0,
  );
});
test("monthly subscription pool is allocated by usage, free responses stay free", () => {
  const result = summarizeCosts({
    plans: plan,
    month: "2026-09",
    connected: ["openai", "github-copilot"],
    records: [
      record("a", "openai", 100),
      record("b", "github-copilot", 200),
      record("c", "opencode", 900),
    ],
  });
  assert.equal(result.monthlyPrice, 30);
  assert.deepEqual(
    result.chats.map((c) => c.estimatedCost),
    [10, 20, 0],
  );
  assert.equal(result.tokens, 1200);
});
test("missing prices and stale quota remain unknown, not zero", () => {
  const result = summarizeCosts({
    month: "2026-09",
    connected: ["openai"],
    records: [record("a", "openai", 100)],
    usage: {
      providers: [{ id: "openai-oauth", fresh: false, availableRemaining: 50 }],
    },
  });
  assert.equal(result.monthlyPrice, null);
  assert.equal(result.chats[0].estimatedCost, null);
  assert.equal(result.remainingValue, null);
});
test("remaining value weights each subscription price and requires all current allowances", () => {
  const args = {
    plans: plan,
    month: "2026-09",
    connected: ["openai", "github-copilot"],
    usage: {
      providers: [
        { id: "openai-oauth", fresh: true, availableRemaining: 50 },
        { id: "github-copilot-oauth", fresh: true, availableRemaining: 20 },
      ],
    },
  };
  assert.equal(summarizeCosts(args).remainingValue, 12);
  args.usage.providers.pop();
  assert.equal(summarizeCosts(args).remainingValue, null);
});
test("stream updates replace usage; month boundaries and API cost are separate", () => {
  const a = record("a", "openai", 20),
    b = record("b", "github-copilot", 30);
  b.createdAt = Date.UTC(2026, 7, 31, 23, 59);
  const r = summarizeCosts({
    month: "2026-09",
    plans: { providers: { openai: { mode: "api" } } },
    connected: ["openai", "github-copilot"],
    records: [a, { ...a, tokens: 100 }, b],
  });
  assert.equal(r.tokens, 100);
  assert.equal(r.apiCost, 0.25);
  assert.equal(r.chats[0].estimatedCost, 0.25);
  assert.equal(r.models[0].responses, 1);
});
test("zero usage has no invented rate, and OpenCode Go defaults to a subscription", () => {
  const r = summarizeCosts({
    plans: plan,
    month: "2026-09",
    connected: ["openai"],
  });
  assert.equal(r.unitCostPerMillion, null);
  assert.equal(r.monthlyPrice, 20);
  assert.equal(normalizePlans().providers["opencode-go"].mode, "subscription");
});
test("native usage fallback does not double count reasoning; native total takes precedence", () => {
  const info = {
    role: "assistant",
    id: "m",
    sessionID: "s",
    providerID: "openai",
    time: { created: at },
    tokens: {
      input: 10,
      output: 20,
      reasoning: 5,
      cache: { read: 30, write: 40 },
    },
  };
  assert.equal(usageRecord({ info }).tokens, 100);
  info.tokens.total = 80;
  assert.equal(usageRecord({ info }).tokens, 80);
  assert.equal(usageRecord({ info: { ...info, role: "user" } }), null);
});
test("reject invalid money and unsupported providers", () => {
  for (const monthlyPrice of [-1, NaN, Infinity, "20"])
    assert.throws(() =>
      normalizePlans({ providers: { openai: { monthlyPrice } } }),
    );
  assert.throws(() => normalizePlans({ providers: { unknown: {} } }));
  assert.throws(() => normalizePlans({ currency: "money" }));
});
