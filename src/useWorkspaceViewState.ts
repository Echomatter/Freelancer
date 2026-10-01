import { useEffect, useState } from "react";
import { api } from "./api";

export function useWorkspaceViewState() {
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let saved = await api("view-state");
      if (!saved.migrated) {
        const lastChats: Record<string, string> = {};
        let navigationCollapsed = false;
        try {
          navigationCollapsed =
            localStorage.getItem("freelancer:navigation-collapsed") === "true";
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)!;
            if (key.startsWith("freelancer:last-chat:"))
              lastChats[key.slice(21)] = localStorage.getItem(key)!;
          }
        } catch {
          /* Restricted browsers have no legacy preferences to import. */
        }
        saved = await api(
          "view-state",
          { migrate: true, navigationCollapsed, lastChats },
          "PUT",
        );
      }
      if (!cancelled) setState(saved);
    })().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const save = async (patch: any) => {
    try {
      const next = await api("view-state", patch, "PUT");
      setState(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return { state, save, error };
}
