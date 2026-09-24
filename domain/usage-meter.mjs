// Geometry only: preserve the availability view's equal-plan denominator.
// Known remaining portions meet on the left; their complements meet on the
// right in reverse provider order. Unknown shares are neither used nor free.
export function compoundSegments(plans = []) {
  const remaining = [],
    unknown = [],
    used = [];
  const share = plans.length ? 100 / plans.length : 0;
  for (const plan of plans) {
    const value = plan.remaining;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      unknown.push({ id: plan.id, portion: "unknown", width: share });
      continue;
    }
    const width = Math.min(100, value) / plans.length;
    remaining.push({ id: plan.id, portion: "remaining", width });
    used.push({ id: plan.id, portion: "used", width: share - width });
  }
  return [...remaining, ...unknown, ...used.reverse()];
}
