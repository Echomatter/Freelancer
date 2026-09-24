import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { createDraftCache } from "../domain/draft-cache.mjs";

export function useDrafts(project: string, session: string, enabled: boolean) {
  const cache = useRef<ReturnType<typeof createDraftCache>>();
  cache.current ??= createDraftCache(api);
  const controller = cache.current;
  const [, rerender] = useState(0);
  useEffect(
    () => controller.subscribe(() => rerender((v) => v + 1)),
    [controller],
  );
  useEffect(() => {
    if (enabled && project)
      void controller.load(project, session).catch(() => {});
  }, [controller, project, session, enabled]);
  useEffect(() => {
    const flush = () => {
      void controller.flushAll().catch(() => {});
    };
    const beforeClose = (e: BeforeUnloadEvent) => {
      if (controller.hasUnsaved()) {
        e.preventDefault();
        e.returnValue = "";
        flush();
      }
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", beforeClose);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("beforeunload", beforeClose);
      document.removeEventListener("visibilitychange", visibility);
      controller.dispose();
    };
  }, [controller]);
  const state = controller.get(project, session);
  return {
    controller,
    text: project ? state.text : "",
    status: state.status,
    error: state.error,
    loading: !!project && !state.ready && !state.error,
    setText: (text: string) => controller.set(project, session, text),
    capture: () => controller.capture(project, session),
    reload: () => controller.reload(project, session),
    retry: () => controller.flush(project, session),
  };
}
