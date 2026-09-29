// Retain unchanged JSON branches across native snapshots. Completed messages,
// model catalogs and settings can then keep their React memoized presentation.
// No history cache: only the previous and incoming snapshots are traversed.
export function shareSnapshot(previous, next) {
  if (Object.is(previous, next)) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' ||
      Array.isArray(previous) !== Array.isArray(next)) return next;
  const keys = Object.keys(next);
  let equal = keys.length === Object.keys(previous).length;
  for (const key of keys) {
    const value = shareSnapshot(previous[key], next[key]);
    if (!Object.hasOwn(previous, key) || value !== previous[key]) equal = false;
    next[key] = value;
  }
  return equal ? previous : next;
}
