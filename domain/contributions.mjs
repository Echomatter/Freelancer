// Presentation projection only. Native usage and routing prices remain intact.
// Activity weight is observed native token volume, including cache activity.
// It is price-independent: free routes count, retries count, and volume is NOT
// quality, completed work, subscription depletion, or a claim about billing.
const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const compareID = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function formatPercent(value) {
  return finite(value) && value <= 100
    ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`
    : "—";
}

// Reuse the existing flat aggregate calculation, never the chat allocation rate.
export function aggregateUsedPercent({ monthlyPrice, remainingValue } = {}) {
  return finite(monthlyPrice) && monthlyPrice > 0 && finite(remainingValue)
    ? Math.round(Math.max(0, Math.min(100, 100 * (1 - remainingValue / monthlyPrice))) * 10) / 10
    : null;
}

function identity(record, kind) {
  if (kind === "models") {
    const providerID = record.providerID || "unknown";
    const name = record.modelID || "Unknown model";
    return { id: `${providerID}/${name}`, name, providerID };
  }
  if (record.agentID) return {
    id: `agent:${record.agentID}`, name: record.agentName || record.agentID,
  };
  if (record.parentSessionID && record.nativeAgent) return {
    id: `native:${record.nativeAgent}`,
    name: record.nativeAgent[0].toUpperCase() + record.nativeAgent.slice(1),
  };
  return record.parentSessionID
    ? { id: "unattributed-child", name: "Unattributed helper" }
    : { id: "parent", name: "Parent" };
}

function breakdown(records, kind) {
  const groups = new Map();
  for (const record of records) {
    const who = identity(record, kind);
    const row = groups.get(who.id) ?? { ...who, weight: 0, measured: false, partial: false };
    const valid = finite(record.tokens);
    // Old positive records are usable. Legacy zero cannot distinguish missing
    // telemetry from a measured zero; new records carry an explicit marker.
    const measured = valid && (record.usageKnown === true || record.tokens > 0);
    if (measured) row.weight += record.tokens;
    row.measured ||= measured;
    row.partial ||= !measured || record.usageKnown === false;
    groups.set(who.id, row);
  }
  const rows = [...groups.values()].sort(compareID);
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const hasActivity = Number.isFinite(total) && total > 0;
  // Largest-remainder rounding keeps each independent breakdown at 100%.
  const shares = rows.map((row) => {
    const exact = hasActivity ? row.weight / total * 100 : 0;
    return { ...row, share: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  if (hasActivity) {
    const remainderOrder = shares.filter((row) => row.weight > 0)
      .sort((a, b) => b.remainder - a.remainder || compareID(a, b));
    const missing = 100 - shares.reduce((sum, row) => sum + row.share, 0);
    for (let i = 0; i < missing; i++) remainderOrder[i % remainderOrder.length].share++;
  }
  return {
    hasActivity,
    partial: rows.some((row) => row.partial) || !Number.isFinite(total),
    // No raw usage or monetary fields cross this presentation boundary.
    rows: shares.sort((a, b) => b.weight - a.weight || compareID(a, b)).map((row) => ({
      id: row.id,
      name: row.name,
      ...(row.providerID ? { providerID: row.providerID } : {}),
      sharePercent: hasActivity && row.measured ? row.share : null,
      partial: row.partial,
    })),
  };
}

export function summarizeContributions(records = [], month = new Date().toISOString().slice(0, 7)) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error("Invalid month");
  // Native message IDs are stable across streaming updates and observer rescans.
  const unique = [...new Map(records.filter((row) => row?.id && row.sessionID)
    .map((row) => [row.id, row])).values()];
  // Keep ancestry from outside the displayed month so older parents still link.
  const parents = new Map(unique.filter((row) => row.parentSessionID)
    .map((row) => [row.sessionID, row.parentSessionID]));
  const monthly = unique.filter((row) => finite(row.createdAt) &&
    Number.isFinite(new Date(row.createdAt).getTime()) &&
    new Date(row.createdAt).toISOString().startsWith(month));
  const chats = new Map();
  const cyclic = new Set();
  for (const record of monthly) {
    const visited = new Set();
    let id = record.sessionID;
    while (id && !visited.has(id)) {
      visited.add(id);
      const rows = chats.get(id) ?? [];
      rows.push(record);
      chats.set(id, rows);
      id = parents.get(id);
    }
    if (id) for (const seen of visited) cyclic.add(seen);
  }
  const project = (rows) => ({
    month,
    models: breakdown(rows, "models"),
    agents: breakdown(rows, "agents"),
  });
  return {
    ...project(monthly),
    chats: [...chats.entries()].map(([sessionID, rows]) => ({
      sessionID,
      ...project(rows),
      ancestryUncertain: cyclic.has(sessionID),
    })),
  };
}
