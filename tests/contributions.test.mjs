import test from "node:test";
import assert from "node:assert/strict";
import { summarizeContributions, aggregateUsedPercent, formatPercent } from "../domain/contributions.mjs";
import { summarizeCosts, usageRecord } from "../domain/costs.mjs";

const month = "2026-09", createdAt = Date.UTC(2026, 8, 20);
const record = (id, sessionID, tokens, extra = {}) => ({
  id, sessionID, tokens, createdAt, usageKnown: true,
  providerID: "openai", modelID: id, completed: true, tools: 1,
  reportedCost: 5, ...extra,
});
const records = () => [
  record("a", "parent", 60, { agentID: "engineer", agentName: "Engineer" }),
  record("b", "child", 30, { parentSessionID: "parent", nativeAgent: "worker" }),
  record("c", "grandchild", 10, { parentSessionID: "child", nativeAgent: "review", providerID: "opencode" }),
];
const chat = (input, id = "parent") => summarizeContributions(input, month).chats.find((row) => row.sessionID === id);
const shares = (breakdown) => Object.fromEntries(breakdown.rows.map((row) => [row.name, row.sharePercent]));

test("chat shares include parent, child and grandchild once, including free work", () => {
  const value = chat(records());
  assert.deepEqual(shares(value.models), { a: 60, b: 30, c: 10 });
  assert.deepEqual(shares(value.agents), { Engineer: 60, Worker: 30, Review: 10 });
  assert.deepEqual(shares(chat(records(), "child").models), { b: 75, c: 25 });
  for (const dimension of [value.models, value.agents])
    assert.equal(dimension.rows.reduce((n, row) => n + row.sharePercent, 0), 100);
});

test("unrelated chats, prices, billing mode and connection state do not change chat shares", () => {
  const expected = chat(records());
  const input = [...records(), record("unrelated", "other", 900000)];
  assert.deepEqual(chat(input), expected);
  for (const monthlyPrice of [null, 10, 100, 1000]) {
    const result = summarizeCosts({ records: input, month, connected: ["openai"],
      plans: { providers: { openai: { monthlyPrice } } } });
    assert.deepEqual(result.contributions.chats.find((row) => row.sessionID === "parent"), expected);
  }
  const result = summarizeCosts({ records: input, month, connected: [],
    plans: { providers: { openai: { mode: "api", enabled: false } } } });
  assert.deepEqual(result.contributions.chats.find((row) => row.sessionID === "parent"), expected);
});

test("stream updates and observer rescans replace the same native response", () => {
  const original = records();
  const changed = { ...original[1], tokens: 60 };
  assert.deepEqual(chat([...original, ...original, changed]), chat([original[0], changed, original[2]]));
});

test("rounding is deterministic and independent model and agent shares sum to 100", () => {
  const input = [record("c", "s", 1), record("a", "s", 1), record("b", "s", 1)];
  assert.deepEqual(shares(chat(input, "s").models), { a: 34, b: 33, c: 33 });
  assert.deepEqual(chat(input, "s"), chat(input.toReversed(), "s"));
});

test("unknown and partial observations do not become zero-share claims", () => {
  const input = [record("known", "s", 30), record("missing", "s", 0, { usageKnown: false })];
  const value = chat(input, "s").models;
  assert.equal(value.partial, true);
  assert.deepEqual(shares(value), { known: 100, missing: null });
  input[1].tokens = 10;
  assert.deepEqual(shares(chat(input, "s").models), { known: 75, missing: 25 });
  assert.equal(chat(input, "s").models.rows.find((r) => r.name === "missing").partial, true);
});

test("zero denominator produces no fabricated percentages; measured zero is preserved", () => {
  assert.equal(summarizeContributions([], month).models.hasActivity, false);
  assert.equal(chat([record("zero", "s", 0)], "s").models.rows[0].sharePercent, null);
  assert.deepEqual(shares(chat([record("zero", "s", 0), record("work", "s", 10)], "s").models), { work: 100, zero: 0 });
  const legacy = record("legacy", "s", 0);
  delete legacy.usageKnown;
  assert.equal(chat([legacy], "s").models.partial, true);
  legacy.tokens = 10;
  assert.equal(chat([legacy], "s").models.partial, false);
});

test("observed model identity includes the provider, never a selected-model substitution", () => {
  const input = [record("a", "s", 1, { modelID: "same", selected_model: "wrong" }),
    record("b", "s", 1, { modelID: "same", providerID: "opencode" })];
  const rows = chat(input, "s").models.rows;
  assert.deepEqual(rows.map((r) => r.id), ["openai/same", "opencode/same"]);
  assert.ok(rows.every((r) => r.sharePercent === 50));
});

test("monthly scope retains older ancestry but excludes older activity", () => {
  const input = records();
  input[0].createdAt = Date.UTC(2026, 7, 30);
  input[1].createdAt = Date.UTC(2026, 7, 31);
  const value = chat(input);
  assert.equal(value.month, month);
  assert.deepEqual(shares(value.models), { c: 100 });
});

test("cyclic ancestry terminates, counts each response once and flags uncertainty", () => {
  const input = [record("a", "x", 1, { parentSessionID: "y" }),
    record("b", "y", 1, { parentSessionID: "x" })];
  for (const value of summarizeContributions(input, month).chats) {
    assert.equal(value.ancestryUncertain, true);
    assert.deepEqual(shares(value.models), { a: 50, b: 50 });
  }
});

test("presentation projection contains no raw usage weights or monetary fields", () => {
  const forbidden = new Set(["tokens", "weight", "total", "reportedCost", "estimatedCost", "monthlyPrice"]);
  function inspect(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, key);
      inspect(child);
    }
  }
  inspect(summarizeContributions(records(), month));
});

test("flat aggregate remains $100 with 2% consumed and $98 remaining, not chat allocation", () => {
  const result = summarizeCosts({ records: records(), month, connected: ["openai"],
    plans: { providers: { openai: { monthlyPrice: 100 } } },
    usage: { providers: [{ id: "openai-oauth", fresh: true, availableRemaining: 98 }] } });
  assert.equal(result.monthlyPrice, 100);
  assert.equal(result.remainingValue, 98);
  assert.equal(aggregateUsedPercent(result), 2);
  assert.equal(formatPercent(aggregateUsedPercent(result)), "2%");
  // Internal telemetry and old estimates are preserved but not presented as charges.
  assert.equal(result.tokens, 100);
  assert.equal(typeof result.chats[0].estimatedCost, "number");
});

test("unknown aggregate capacity stays unknown; percentage formatting retains zero", () => {
  for (const input of [{}, { monthlyPrice: 0, remainingValue: 0 }, { monthlyPrice: 100, remainingValue: null }])
    assert.equal(aggregateUsedPercent(input), null);
  assert.equal(aggregateUsedPercent({ monthlyPrice: 100, remainingValue: 100 }), 0);
  assert.equal(formatPercent(0), "0%");
  for (const value of [null, undefined, NaN, Infinity, -1, 101, "2"])
    assert.equal(formatPercent(value), "—");
});

test("native usage keeps existing math while distinguishing absent from recorded zero", () => {
  const info = { id: "m", sessionID: "s", role: "assistant", providerID: "openai", time: { created: createdAt } };
  assert.equal(usageRecord({ info }).usageKnown, false);
  info.tokens = { total: 0 };
  assert.equal(usageRecord({ info }).usageKnown, true);
  info.tokens = { input: 10, output: 20, reasoning: 5, cache: { read: 30, write: 40 } };
  assert.equal(usageRecord({ info }).tokens, 100);
  assert.equal(usageRecord({ info }).usageKnown, true);
  info.tokens.total = 80;
  assert.equal(usageRecord({ info }).tokens, 80);
});

test("invalid inputs are bounded rather than leaking NaN into the UI", () => {
  assert.throws(() => summarizeContributions([], "2026-13"));
  assert.equal(summarizeContributions([null, {}, record("bad", "s", 1, { createdAt: NaN })], month).chats.length, 0);
  assert.equal(chat([record("bad", "s", NaN)], "s").models.rows[0].sharePercent, null);
});
