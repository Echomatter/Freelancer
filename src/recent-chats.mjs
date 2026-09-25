// Recent chat content stays in this browser tab only. Native OpenCode remains
// authoritative for status, permissions, questions, and every new response.
export class RecentChats {
  constructor({ limit = 12, maxBytes = 16_000_000, ttlMs = 15 * 60_000, now = Date.now } = {}) {
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.now = now;
    this.entries = new Map();
    this.bytes = 0;
  }

  key(project, session) {
    return JSON.stringify([project, session]);
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

  put(project, session, response, version = 0) {
    if (!project || !session) return;
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
      status: {},
      permissions: [],
      questions: [],
      loaded: true,
      selectionKey: new URLSearchParams({ project, session }).toString(),
    };
    const bytes = JSON.stringify(chat).length * 2;
    this.delete(project, session);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { chat, bytes, version, expiresAt: this.now() + this.ttlMs });
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
    for (const key of this.entries.keys()) {
      if (JSON.parse(key)[0] === project) {
        const entry = this.entries.get(key);
        this.bytes -= entry.bytes;
        this.entries.delete(key);
      }
    }
  }
}
