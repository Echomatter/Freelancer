// Recent chat content stays in this browser tab only. Native OpenCode remains
// authoritative for status, permissions, questions, and every new response.
export class RecentChats {
  constructor({ limit = 32, maxBytes = 24_000_000, ttlMs = 20 * 60_000, now = Date.now } = {}) {
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
    this.bytes = 0;
  }

  key(project, session) {
    return `${project}\0${session}`;
  }

  get(project, session) {
    const key = this.key(project, session);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.delete(project, session);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.chat;
  }

  isFresh(project, session, ageMs) {
    const entry = this.entries.get(this.key(project, session));
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.delete(project, session);
      return false;
    }
    return this.now() - (entry.updatedAt ?? 0) < ageMs;
  }

  put(project, session, response, version = 0) {
    if (!project || !session) return;
    const now = this.now();
    // Expired entries should never evict a still-useful transcript merely
    // because an expired chat was recently read before its deadline.
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.bytes -= entry.bytes;
        this.entries.delete(key);
      }
    }
    const key = this.key(project, session);
    const previous = this.entries.get(key);
    if (previous && previous.version > version) return;
    // Never replay old native decisions or running state from a cached read.
    const chat = {
      messages: response.messages ?? [],
      todos: response.todos ?? [],
      diff: response.diff ?? [],
      activity: response.activity ?? [],
      summary: response.summary,
      receipts: response.receipts ?? [],
      imported: response.imported,
      continuation: response.continuation,
      title: response.title,
      session: response.session ?? { id: session, title: response.title },
      status: {},
      permissions: [],
      questions: [],
      loaded: true,
      selectionKey: new URLSearchParams({ project, session }).toString(),
    };
    const bytes = estimateBytes(project) + estimateBytes(session) + estimateBytes(chat);
    this.delete(project, session);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { project, session, chat, bytes, version, updatedAt: now, expiresAt: now + this.ttlMs });
    this.bytes += bytes;
    while (this.entries.size > this.limit || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      const entry = this.entries.get(oldest);
      this.bytes -= entry.bytes;
      this.entries.delete(oldest);
    }
  }

  delete(project, session) {
    const key = this.key(project, session);
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  deleteProject(project) {
    for (const [key, entry] of this.entries) {
      if (entry.project === project) {
        this.bytes -= entry.bytes;
        this.entries.delete(key);
      }
    }
  }
}

// Warm every visible active/awaiting session first, then a small recent slice
// of parent chats. Child transcripts are discovered from cached parent links.
export function chatWarmTargets(sessions = [], activity = {}, recentRoots = 3) {
  const byID = new Map(sessions.filter(row => row?.id).map(row => [row.id, row]));
  const recency = row => Number(row.time?.updated ?? row.time?.created ?? 0) || 0;
  const active = [...byID.values()]
    .filter(row => {
      const state = activity[row.id];
      return state?.active || state?.retry || state?.waiting;
    })
    .sort((a, b) => Number(!!activity[b.id]?.active) - Number(!!activity[a.id]?.active) || recency(b) - recency(a));
  const roots = [...byID.values()].filter(row => !row.parentID).sort((a, b) => recency(b) - recency(a)).slice(0, recentRoots);
  const seen = new Set();
  return [...active, ...roots].filter(row => !seen.has(row.id) && seen.add(row.id));
}

function estimateBytes(value, seen = new WeakSet()) {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 4;
  if (typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) return 16 + value.reduce((sum, item) => sum + estimateBytes(item, seen), 0);
  let total = 32;
  for (const [key, item] of Object.entries(value)) total += key.length * 2 + estimateBytes(item, seen);
  return total;
}
