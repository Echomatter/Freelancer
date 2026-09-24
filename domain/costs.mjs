import { summarizeContributions } from "./contributions.mjs";

export const providerCatalog = Object.freeze([
  {
    id: "openai",
    name: "OpenAI",
    surface: "openai-oauth",
    mode: "subscription",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot",
    surface: "github-copilot-oauth",
    mode: "subscription",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    surface: "opencode-go",
    mode: "subscription",
  },
  {
    id: "opencode",
    name: "OpenCode Free",
    surface: "opencode-free",
    mode: "free",
  },
]);
const finite = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
export function normalizePlans(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid provider settings");
  const currency = input.currency ?? "USD";
  if (!/^[A-Z]{3}$/.test(currency))
    throw Error("Choose a three-letter currency");
  const rows = input.providers ?? {};
  for (const id of Object.keys(rows))
    if (!providerCatalog.some((p) => p.id === id))
      throw Error("Unsupported provider");
  return {
    currency,
    providers: Object.fromEntries(
      providerCatalog.map((p) => {
        const value = rows[p.id] ?? {},
          mode = value.mode ?? p.mode,
          monthlyPrice = value.monthlyPrice ?? null;
        if (
          !["subscription", "api", "free"].includes(mode) ||
          (p.mode === "free" && mode !== "free")
        )
          throw Error("Invalid billing type");
        if (
          monthlyPrice !== null &&
          (!finite(monthlyPrice) || monthlyPrice > 1000000)
        )
          throw Error("Enter a valid monthly price");
        return [
          p.id,
          {
            mode,
            monthlyPrice: mode === "subscription" ? monthlyPrice : null,
            enabled: value.enabled !== false,
          },
        ];
      }),
    ),
  };
}
export function usageRecord(message, directory = "", parentSessionID) {
  const info = message?.info ?? message;
  if (
    info?.role !== "assistant" ||
    !info.id ||
    !info.sessionID ||
    !providerCatalog.some((p) => p.id === info.providerID)
  )
    return null;
  const t = info.tokens ?? {};
  const tokens = finite(t.total)
    ? t.total
    : [t.input, t.output, t.cache?.read, t.cache?.write].reduce(
        (s, n) => s + (finite(n) ? n : 0),
        0,
      );
  const createdAt = info.time?.created;
  if (!finite(createdAt) || !Number.isFinite(new Date(createdAt).getTime()))
    return null;
  return {
    id: info.id,
    sessionID: info.sessionID,
    parentMessageID: info.parentID ?? null,
    ...(parentSessionID ? { parentSessionID } : {}),
    nativeAgent: info.agent ?? info.mode ?? null,
    providerID: info.providerID,
    modelID: info.modelID ?? "unknown",
    directory,
    createdAt,
    tokens,
    usageKnown: finite(t.total) || (finite(t.input) && finite(t.output)),
    reportedCost: finite(info.cost) ? info.cost : null,
    completed: !!info.time?.completed && !info.error,
    tools: (message.parts ?? []).filter(
      (p) => p.type === "tool" && p.state?.status === "completed",
    ).length,
  };
}
export function summarizeCosts({
  plans: input = {},
  records = [],
  usage = { providers: [] },
  month = new Date().toISOString().slice(0, 7),
  connected = [],
} = {}) {
  const plans = normalizePlans(input);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error("Invalid month");
  const active = providerCatalog.filter(
    (p) =>
      plans.providers[p.id].enabled &&
      (connected.includes(p.id) || p.id === "opencode"),
  );
  const ids = new Set(active.map((p) => p.id));
  // A repeated reconnect cannot count the same native response twice.
  const unique = [
    ...new Map(
      records.filter((r) => r && ids.has(r.providerID)).map((r) => [r.id, r]),
    ).values(),
  ];
  const rows = unique.filter((r) =>
    new Date(r.createdAt).toISOString().startsWith(month),
  );
  const subscriptions = active.filter(
    (p) => plans.providers[p.id].mode === "subscription",
  );
  const missingPrices = subscriptions
    .filter((p) => plans.providers[p.id].monthlyPrice === null)
    .map((p) => p.id);
  const monthlyPrice = missingPrices.length
    ? null
    : subscriptions.reduce((s, p) => s + plans.providers[p.id].monthlyPrice, 0);
  const subTokens = rows
    .filter((r) => plans.providers[r.providerID].mode === "subscription")
    .reduce((s, r) => s + r.tokens, 0);
  const rate =
    monthlyPrice !== null && subTokens > 0 ? monthlyPrice / subTokens : null;
  const providers = active.map((p) => {
    const plan = plans.providers[p.id],
      quota = usage.providers?.find((q) => q.id === p.surface);
    const remaining =
      quota?.fresh === true && finite(quota.availableRemaining)
        ? Math.min(100, quota.availableRemaining)
        : null;
    return {
      ...p,
      ...plan,
      remainingPercent: remaining,
      remainingValue:
        plan.mode === "subscription" &&
        plan.monthlyPrice !== null &&
        remaining !== null
          ? (plan.monthlyPrice * remaining) / 100
          : null,
      tokens: rows
        .filter((r) => r.providerID === p.id)
        .reduce((s, r) => s + r.tokens, 0),
    };
  });
  const remainingPlans = providers.filter((p) => p.mode === "subscription");
  const remainingValue =
    remainingPlans.length &&
    remainingPlans.every((p) => p.remainingValue !== null)
      ? remainingPlans.reduce((s, p) => s + p.remainingValue, 0)
      : null;
  const chats = new Map(),
    models = new Map(),
    agents = new Map();
  const parents = new Map(
    unique
      .filter((r) => r.parentSessionID)
      .map((r) => [r.sessionID, r.parentSessionID]),
  );
  let apiCost = 0,
    apiUnknown = false;
  for (const r of rows) {
    const mode = plans.providers[r.providerID].mode;
    const estimate =
      mode === "free"
        ? 0
        : mode === "api"
          ? r.reportedCost
          : r.tokens === 0
            ? 0
            : rate === null
              ? null
              : r.tokens * rate;
    if (mode === "api") {
      if (r.reportedCost === null) apiUnknown = true;
      else apiCost += r.reportedCost;
    }
    const delegatedAgent = r.parentSessionID && r.nativeAgent;
    const agentID =
      r.agentID ?? (delegatedAgent ? `native:${r.nativeAgent}` : "unassigned");
    const agentName =
      r.agentName ??
      (delegatedAgent
        ? r.nativeAgent[0].toUpperCase() + r.nativeAgent.slice(1)
        : "Other chats");
    const addAgent = (map) => {
      const row = map.get(agentID) ?? {
        id: agentID,
        name: agentName,
        tokens: 0,
        responses: 0,
        estimatedCost: 0,
        complete: true,
      };
      row.tokens += r.tokens;
      row.responses += Number(r.completed);
      if (estimate === null) row.complete = false;
      else row.estimatedCost += estimate;
      map.set(agentID, row);
    };
    addAgent(agents);
    // Include descendants in a chat's total, but count each response only once
    // in the global pool and per-agent totals. Guard malformed ancestry cycles.
    const visited = new Set();
    let chatID = r.sessionID;
    while (chatID && !visited.has(chatID)) {
      visited.add(chatID);
      const chat = chats.get(chatID) ?? {
        sessionID: chatID,
        tokens: 0,
        childTokens: 0,
        estimatedCost: 0,
        complete: true,
        agents: new Map(),
      };
      chat.tokens += r.tokens;
      if (chatID !== r.sessionID) chat.childTokens += r.tokens;
      if (estimate === null) chat.complete = false;
      else chat.estimatedCost += estimate;
      addAgent(chat.agents);
      chats.set(chatID, chat);
      chatID = parents.get(chatID);
    }
    const key = r.providerID + "/" + r.modelID,
      model = models.get(key) ?? {
        id: key,
        providerID: r.providerID,
        name: r.modelID,
        tokens: 0,
        responses: 0,
        tools: 0,
        estimatedCost: 0,
        complete: true,
      };
    model.tokens += r.tokens;
    model.responses += Number(r.completed);
    model.tools += r.tools;
    if (estimate === null) model.complete = false;
    else model.estimatedCost += estimate;
    models.set(key, model);
  }
  return {
    month,
    contributions: summarizeContributions(records, month),
    currency: plans.currency,
    monthlyPrice,
    remainingValue,
    missingPrices,
    unitCostPerMillion: rate === null ? null : rate * 1e6,
    tokens: rows.reduce((s, r) => s + r.tokens, 0),
    apiCost: apiUnknown ? null : apiCost,
    estimatedSpend:
      monthlyPrice === null || apiUnknown ? null : monthlyPrice + apiCost,
    providers,
    chats: [...chats.values()].map((c) => ({
      ...c,
      agents: [...c.agents.values()].map((a) => ({
        ...a,
        estimatedCost: a.complete ? a.estimatedCost : null,
      })),
      estimatedCost: c.complete ? c.estimatedCost : null,
    })),
    agents: [...agents.values()]
      .map((a) => ({
        ...a,
        estimatedCost: a.complete ? a.estimatedCost : null,
      }))
      .sort((a, b) => b.tokens - a.tokens),
    models: [...models.values()]
      .map((m) => ({
        ...m,
        estimatedCost: m.complete ? m.estimatedCost : null,
      }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}
