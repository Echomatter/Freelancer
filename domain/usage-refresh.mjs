// One in-flight refresh and a bounded retry cadence for the application, not one
// poller per meter. Provider timestamps remain authoritative after a success.
export function createUsageRefresh({ request, clock = Date.now }) {
  let state = { pending: false, error: "", nextAttemptAt: 0 },
    inFlight,
    failures = 0;
  const listeners = new Set();
  const emit = (patch) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh({ automatic = false } = {}) {
      if (inFlight) return inFlight;
      if (automatic && clock() < state.nextAttemptAt)
        return Promise.resolve(false);
      emit({ pending: true, error: "" });
      // Promise.resolve also makes synchronous transport errors follow cleanup.
      inFlight = Promise.resolve()
        .then(request)
        .then(
          () => {
            failures = 0;
            emit({ error: "" });
            return true;
          },
          () => {
            failures++;
            emit({ error: "Refresh failed" });
            return false;
          },
        )
        .finally(() => {
          inFlight = undefined;
          emit({
            pending: false,
            nextAttemptAt:
              clock() + Math.min(300000, 60000 * 2 ** Math.min(failures, 3)),
          });
        });
      return inFlight;
    },
  };
}
