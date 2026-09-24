import { providerCatalog } from "./costs.mjs";

// Presentation over the existing quota observations, never a second collector or
// an accounting-to-quota conversion. The clock can invalidate, not invent, data.
export const availabilityMaxAge = 10 * 60 * 1000;
const finite = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const time = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null;
const percent = (value) => (finite(value) ? Math.min(100, value) : null);
const list = (value) => (Array.isArray(value) ? value : []);

export function remainingLabel(value) {
  if (!finite(value)) return "Unknown";
  if (value === 0) return "0%";
  if (value >= 100) return "100%";
  const rounded = Math.round(value);
  return rounded === 0 ? "<1%" : rounded === 100 ? ">99%" : `${rounded}%`;
}
export function resetLabel(resetAt, now = Date.now()) {
  const until = time(resetAt);
  if (until === null) return "Reset unknown";
  const delta = until - now;
  if (delta <= 0) return "Checking…";
  if (delta < 60000) return "<1m";
  const minutes = Math.ceil(delta / 60000),
    days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60),
    rest = minutes % 60;
  return days
    ? `${days}d${hours ? ` ${hours}h` : ""}`
    : hours
      ? `${hours}h${rest ? ` ${rest}m` : ""}`
      : `${minutes}m`;
}
export function observedLabel(asOf, now = Date.now()) {
  const at = time(asOf);
  if (at === null || at > now + 60000) return "Not checked";
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (!minutes) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  if (minutes < 1440) return `Updated ${Math.floor(minutes / 60)}h ago`;
  return `Updated ${Math.floor(minutes / 1440)}d ago`;
}

// A quota restriction computed from an old observation must not masquerade as a
// new model-specific failure. Independent native restrictions remain visible.
export function modelAvailability(model, provider) {
  const status = String(model.status ?? model.availability ?? "").toLowerCase();
  if (status.includes("deprecated")) return "Deprecated";
  if (
    model.disabled === true ||
    model.available === false ||
    /unavailable|disabled|blocked|rate.limit/.test(status)
  )
    return "Unavailable";
  if (!provider) return "Not connected";
  if (provider.remaining === 0 || provider.blocked) return "Unavailable";
  if (provider.kind === "free") return "Variable";
  return provider.remaining === null ? "Unknown" : "Available";
}

export function availabilityView(data, now = Date.now()) {
  const catalog = list(data?.providers?.all),
    models = list(data?.models);
  const connected = new Set(list(data?.providers?.connected));
  const observations = list(data?.snapshot?.usage?.providers);
  const deadlines = [],
    providers = [];
  for (const definition of providerCatalog) {
    const plan = data?.settings?.plans?.providers?.[definition.id] ?? {};
    const native = catalog.find((p) => p.id === definition.id);
    const freeInventory =
      definition.mode === "free" &&
      Object.keys(native?.models ?? {}).length > 0;
    if (
      plan.enabled === false ||
      (!connected.has(definition.id) && !freeInventory)
    )
      continue;
    const kind =
      definition.mode === "free"
        ? "free"
        : (plan.mode ?? definition.mode) === "subscription"
          ? "finite"
          : "unmetered";
    const source = observations.find((p) => p.id === definition.surface);
    const observed = time(source?.asOf),
      age = observed === null ? Infinity : now - observed;
    const fresh =
      source?.fresh === true && age >= -60000 && age < availabilityMaxAge;
    const blockedUntil = time(source?.blockedUntil);
    const blockActive = blockedUntil !== null && blockedUntil > now;
    const blockExpired =
      blockedUntil !== null &&
      blockedUntil <= now &&
      (observed === null || observed <= blockedUntil);
    const metrics = list(source?.metrics)
      .filter((m) => m && !m.unlimited)
      .map((m) => {
        const at = time(m.resetAt);
        return {
          key: String(m.key ?? ""),
          label: String(m.label ?? "Usage window"),
          remaining: percent(m.remainingPercent),
          resetAt: at === null ? null : new Date(at).toISOString(),
          usable: fresh && m.usable === true && (at === null || at > now),
          blocked: m.blocked === true,
        };
      });
    const expired = metrics.some(
      (m) => m.resetAt && Date.parse(m.resetAt) <= now,
    );
    // Reuse the quota view's limiting-window calculation. Only new time fences
    // and already-observed blocking evidence affect its current presentation.
    const knownBlock =
      fresh &&
      (source?.restricted === true ||
        metrics.some((m) => m.usable && (m.blocked || m.remaining === 0)));
    const complete =
      metrics.length > 0 &&
      metrics.every((m) => m.usable && m.remaining !== null);
    let remaining =
      kind === "finite" && fresh && complete && !expired && !blockExpired
        ? percent(source?.availableRemaining)
        : null;
    if (kind === "finite" && (blockActive || knownBlock)) remaining = 0;
    const resetEvents =
      kind === "finite" && fresh
        ? metrics
            .filter((m) => m.resetAt && Date.parse(m.resetAt) > now)
            .map((m) => ({
              provider: definition.id,
              name: definition.name,
              window: m.label,
              key: m.key,
              resetAt: String(m.resetAt),
            }))
        : [];
    resetEvents.sort(
      (a, b) =>
        Date.parse(a.resetAt) - Date.parse(b.resetAt) ||
        a.key.localeCompare(b.key),
    );
    if (kind === "finite") {
      if (fresh && observed !== null)
        deadlines.push(observed + availabilityMaxAge);
      for (const m of metrics)
        if (m.resetAt && fresh) deadlines.push(Date.parse(m.resetAt));
      if (blockedUntil !== null) deadlines.push(blockedUntil);
    }
    const row = {
      id: definition.id,
      surface: definition.surface,
      name: definition.name,
      kind,
      remaining,
      label: kind === "free" ? "Variable" : remainingLabel(remaining),
      fresh,
      blocked: blockActive || knownBlock,
      asOf: observed === null ? null : new Date(observed).toISOString(),
      stale: kind === "finite" && (!fresh || expired || blockExpired),
      refreshFailed:
        !!source?.telemetryStatus &&
        source.telemetryStatus !== "ok" &&
        source.telemetryStatus !== "unavailable",
      nextReset: resetEvents[0] ?? null,
      resetEvents,
      windows: metrics,
      needsRefresh:
        kind === "finite" &&
        (!fresh || expired || blockExpired || remaining === null),
      models: /** @type {{id: string, name: string, status: string}[]} */ ([]),
    };
    row.models = models
      .filter((m) => m.provider === definition.id)
      .map((m) => ({
        id: String(m.id),
        name: String(m.name),
        status: modelAvailability(
          {
            ...m,
            status:
              native?.models?.[
                m.modelID ?? String(m.id).split("/").slice(1).join("/")
              ]?.status ?? m.status,
          },
          row,
        ),
      }));
    if (
      kind === "free" &&
      (blockActive ||
        (row.models.length &&
          row.models.every((m) =>
            ["Unavailable", "Deprecated"].includes(m.status),
          )))
    )
      row.label = "Unavailable";
    providers.push(row);
  }
  const plans = providers.filter((p) => p.kind === "finite"),
    known = plans.filter((p) => p.remaining !== null);
  const remaining =
    plans.length && known.length === plans.length
      ? known.reduce((sum, p) => sum + p.remaining / plans.length, 0)
      : null;
  const status = !data
    ? "loading"
    : !providers.length
      ? "empty"
      : !plans.length
        ? "unmetered"
        : known.length === plans.length
          ? "known"
          : known.length
            ? "partial"
            : "unknown";
  const headline =
    status === "known"
      ? remainingLabel(remaining)
      : {
          loading: "Checking…",
          empty: "No providers",
          unmetered: providers.every((p) => p.kind === "free")
            ? "Free models"
            : "Unknown",
          partial: "Partial data",
          unknown: "Unknown",
        }[status];
  const events = providers
    .flatMap((p) => p.resetEvents)
    .sort(
      (a, b) =>
        Date.parse(a.resetAt) - Date.parse(b.resetAt) ||
        a.provider.localeCompare(b.provider) ||
        a.key.localeCompare(b.key),
    );
  // The oldest observation describes coverage honestly; a render or one recent
  // provider cannot label an older mixed snapshot as "updated now".
  const observed = plans.map((p) => time(p.asOf));
  const asOf =
    observed.length && observed.every((v) => v !== null)
      ? new Date(Math.min(...observed)).toISOString()
      : null;
  return {
    status,
    headline,
    remaining,
    providers,
    plans,
    nextReset: events[0] ?? null,
    events,
    asOf,
    now,
    needsRefresh: plans.some((p) => p.needsRefresh),
    nextChangeAt: Math.min(now + 60000, ...deadlines.filter((at) => at > now)),
    refreshFailed: plans.some((p) => p.refreshFailed),
    description:
      providers.map((p) => `${p.name}: ${p.label}`).join("; ") || headline,
  };
}
