import { useEffect, useState } from "react";
import { Files } from "lucide-react";
import { Button, Panel } from "./echoflex/Controls";
import { fileAccessScopeText } from "../domain/workspace.mjs";

export type FileAccessScope = "project" | "projects" | "computer";

const SCOPES: FileAccessScope[] = ["project", "projects", "computer"];

function normalize(value: unknown): FileAccessScope {
  return SCOPES.includes(value as FileAccessScope)
    ? (value as FileAccessScope)
    : "computer";
}

const descriptions: Record<FileAccessScope, string> = {
  project: "Only the current project folder.",
  projects: "Every registered project folder.",
  computer: "Project folders plus other locations (current behavior).",
};

export function FileAccessSettings({
  value,
  projectCount = 0,
  onSave,
}: {
  value?: unknown;
  projectCount?: number;
  onSave: (scope: FileAccessScope) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<FileAccessScope>(() => normalize(value));
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    // Sync only the draft to the confirmed setting; the saved confirmation
    // and any error belong to the current draft and are cleared on edit.
    setDraft(normalize(value));
  }, [value]);
  const save = async () => {
    setPending(true);
    setError("");
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } catch (e) {
      // The draft is intentionally preserved so the choice survives a
      // failed save and the same button retries.
      setError(e instanceof Error ? e.message : "Could not save file access.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Panel title="Allowed locations" help="file-access">
        <fieldset className="git-default-choices" disabled={pending}>
          <legend>File scope</legend>
          {SCOPES.map((scope) => (
            <label key={scope} className={draft === scope ? "chosen" : ""}>
              <input
                type="radio"
                name="file-access-scope"
                value={scope}
                checked={draft === scope}
                onChange={() => {
                  setDraft(scope);
                  setSaved(false);
                  setError("");
                }}
              />
              <span>
                <strong>{fileAccessScopeText(scope)}</strong>
                <small>{descriptions[scope]}{scope === "projects" && projectCount > 0 ? ` (${projectCount} registered)` : ""}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {saved && <p role="status">File access saved.</p>}
        <Button
          variant="primary"
          disabled={pending || normalize(value) === draft}
          onClick={() => void save()}
        >
          <Files size={16} />
          {pending ? "Saving…" : saved ? "Saved" : error ? "Retry save" : "Save file access"}
        </Button>
    </Panel>
  );
}
