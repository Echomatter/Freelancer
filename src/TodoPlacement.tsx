import { useEffect, useRef, useState } from "react";
import { resolveTodoLayout } from "../domain/appearance.mjs";

export function TodoPlacement({ appearance, save }: {
  appearance?: any;
  save: (layout: string) => Promise<void>;
}) {
  const persisted = resolveTodoLayout(appearance);
  const [value, setValue] = useState(persisted);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) setValue(persisted);
  }, [persisted]);
  async function change(next: string) {
    if (pending.current) return;
    const previous = value;
    pending.current = true;
    setValue(next);
    setSaving(true);
    setError("");
    try {
      await save(next);
    } catch (error) {
      setValue(previous);
      setError(error instanceof Error ? error.message : "Could not save todo placement. Try again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <div>
      <label className="field">
        <span>Todo placement</span>
        <select aria-label="Todo placement" value={value} disabled={saving}
          onChange={(event) => void change(event.target.value)}>
          <option value="docked">Docked above the composer (default)</option>
          <option value="inline">In the chat Details panel</option>
        </select>
      </label>
      <small role="status">{saving ? "Saving…" : "Applies to all chats. Saves automatically."}</small>
      {error && <p className="notice error" role="alert">{error}</p>}
    </div>
  );
}
