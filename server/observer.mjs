import { usageRecord } from "../domain/costs.mjs";

// Observe native sessions independently of the selected view. OpenCode remains
// the ledger of record; response IDs make reconnects and rescans idempotent.
export function createObserver({ host, store, interval = 15000 }) {
  const versions = new Map();
  let running,
    stopped = false,
    timer;
  const status = { lastUpdated: null, error: null };
  async function scan() {
    const { projects } = await store.read("settings");
    for (const project of projects) {
      if (stopped) break;
      const sessions = await host.request("/session?limit=1000", {
        directory: project.directory,
      });
      const start = new Date();
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      for (const session of sessions) {
        if (stopped) break;
        if (
          session.directory?.toLowerCase() !== project.directory.toLowerCase()
        )
          continue;
        const key = project.id + session.id,
          version = session.time?.updated;
        if (
          version < start.getTime() ||
          (version && versions.get(key) === version)
        )
          continue;
        const messages = await host.request(
          `/session/${encodeURIComponent(session.id)}/message`,
          { directory: project.directory },
        );
        await store.observe(
          messages.map((message) =>
            usageRecord(message, project.directory, session.parentID),
          ),
          { session },
        );
        if (version) versions.set(key, version);
      }
    }
    status.lastUpdated = new Date().toISOString();
    status.error = null;
  }
  function refresh() {
    if (stopped) return Promise.resolve();
    if (!running)
      running = scan()
        .catch(() => {
          status.error = "Usage is waiting to reconnect.";
        })
        .finally(() => {
          running = null;
        });
    return running;
  }
  return {
    status,
    refresh,
    start() {
      void refresh();
      timer = setInterval(() => void refresh(), interval);
      timer.unref?.();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      return running;
    },
  };
}
