import { useEffect, useRef, useState } from "react";
import { availabilityView } from "../domain/availability.mjs";
import { createUsageRefresh } from "../domain/usage-refresh.mjs";
import { compatibleApplication } from "../domain/protocol.mjs";
import { api } from "./api";

export function useAvailability(
  data: any,
  refreshBootstrap: (signal?: AbortSignal) => Promise<void>,
) {
  const [now, setNow] = useState(Date.now);
  const latest = useRef(refreshBootstrap);
  latest.current = refreshBootstrap;
  const [coordinator] = useState(() =>
    createUsageRefresh({
      request: async () => {
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 45000);
        try {
          await api("usage/refresh", {}, "POST", abort.signal);
          await latest.current(abort.signal);
        } finally {
          clearTimeout(timeout);
        }
      },
    }),
  );
  const [state, setState] = useState(coordinator.getState);
  const ready = !!data && compatibleApplication(data);
  const view = availabilityView(ready ? data : null, now);
  const current = useRef({ ready, view });
  current.current = { ready, view };
  useEffect(() => coordinator.subscribe(setState), [coordinator]);
  useEffect(() => {
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(60000, view.nextChangeAt - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [now, view.nextChangeAt]);
  useEffect(() => {
    if (
      ready &&
      view.needsRefresh &&
      !state.pending &&
      now >= state.nextAttemptAt &&
      document.visibilityState !== "hidden"
    )
      void coordinator.refresh({ automatic: true });
  }, [
    ready,
    view.needsRefresh,
    now,
    state.pending,
    state.nextAttemptAt,
    coordinator,
  ]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      setNow(Date.now());
      if (current.current.ready && current.current.view.plans.length)
        void coordinator.refresh({ automatic: true });
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [coordinator]);
  return { view, state, refresh: () => coordinator.refresh() };
}
