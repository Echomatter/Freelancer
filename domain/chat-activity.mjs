// Read-only presentation: native work rolls up to its visible parent chat.
// Rebuild from each snapshot; never keep a completed chat spinning by merging.
export function projectActivity(sessions = [], status = {}, questions = [], permissions = []) {
  const parents = new Map(sessions.map((s) => [s.id, s.parentID]));
  const waiting = new Set([...questions, ...permissions].map((r) => r.sessionID));
  const result = Object.fromEntries(sessions.map((s) => [s.id, {
    active: false, retry: false, waiting: false, delegated: false,
  }]));
  for (const session of sessions) {
    const needsAnswer = waiting.has(session.id);
    const type = status[session.id]?.type;
    const active = !needsAnswer && (type === "busy" || type === "retry");
    if (!active && !needsAnswer) continue;
    const visited = new Set();
    let id = session.id;
    while (parents.has(id) && !visited.has(id)) {
      visited.add(id);
      const row = result[id];
      row.active ||= active;
      row.retry ||= active && type === "retry";
      row.waiting ||= needsAnswer;
      row.delegated ||= active && id !== session.id;
      id = parents.get(id);
    }
  }
  return result;
}

export function activityLabel(activity) {
  if (!activity) return "Activity unavailable";
  if (activity.active) {
    const work = activity.retry ? "Retrying" : activity.delegated ? "Helper working" : "Working";
    return activity.waiting ? `${work}; answer needed` : work;
  }
  return activity.waiting ? "Answer needed" : "Idle";
}

// One request at a time, including slow failures. Stopping a subscription prevents
// late results from a previous project repainting the current project's sidebar.
export function pollActivity(read, publish, { delay = 2000, timeout = 8000 } = {}) {
  let stopped = false, next, current;
  async function poll() {
    const abort = new AbortController();
    current = abort;
    const deadline = setTimeout(() => abort.abort(), timeout);
    try {
      const value = await read(abort.signal);
      if (!stopped) publish(abort.signal.aborted ? null : value);
    } catch {
      if (!stopped) publish(null);
    } finally {
      clearTimeout(deadline);
      if (!stopped) next = setTimeout(poll, delay);
    }
  }
  void poll();
  return () => {
    stopped = true;
    clearTimeout(next);
    current?.abort();
  };
}
