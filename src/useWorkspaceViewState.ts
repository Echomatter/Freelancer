import { useEffect, useState } from "react";
import { api } from "./api";

export function useWorkspaceViewState() {
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await api("view-state");
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
