const names = values => [...new Set((Array.isArray(values) ? values : []).filter(value =>
  typeof value === 'string' && /^[\w.:-]{1,80}$/.test(value)))];
function compact(values) {
  const all = names(values), shown = [];
  for (const value of all) {
    if (JSON.stringify([...shown, value]).length > 650) break;
    shown.push(value);
  }
  return `${JSON.stringify(shown)}${shown.length < all.length ? ` (${all.length - shown.length} more)` : ''}`;
}

// Optional native inventory projection, not another loader or permission engine.
// Expose IDs only: tool schemas/configuration can contain sensitive defaults.
export function createCapabilityInventory({ client, directory, skills = [], now = Date.now, ttl = 30000 }) {
  const cache = new Map();
  async function probe(work) {
    try {
      const result = await work();
      return Array.isArray(result?.data) ? result.data : null;
    } catch { return null; }
  }
  return async model => {
    const provider = model?.providerID, id = model?.id;
    const key = JSON.stringify([provider, id]);
    const existing = cache.get(key);
    if (existing && now() - existing.at < ttl) return existing.work;
    const work = (async () => {
      const options = { query: { directory }, signal: AbortSignal.timeout(3000) };
      const [registered, exposed] = await Promise.all([
        probe(() => client.tool.ids(options)),
        provider && id ? probe(() => client.tool.list({ ...options, query: { directory, provider, model: id } })) : null,
      ]);
      return `Capability inventory (optional read-only discovery; not proof of permission, dependency health or successful use):\n` +
        `Native registered IDs: ${registered === null ? 'unavailable' : compact(registered)}.\n` +
        `Selected-model native definitions: ${exposed === null ? (provider && id ? 'unavailable' : 'not-run (model unresolved)') : compact(exposed.map(row => row?.id))}.\n` +
        `Freelancer shared skills (manifest, not a second loader): ${compact(skills)}.`;
    })();
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now(), work });
    return work;
  };
}
