import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { gitPresets } from "../domain/git-project.mjs";
import { api } from "./api";
import { Button, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";

export function GitDefaults({ preset = "review", onClose, refresh }: { preset?: string; onClose: () => void; refresh: () => Promise<void> }) {
  const [choice, setChoice] = useState(preset), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [saved, setSaved] = useState(false);
  useEffect(() => setChoice(preset), [preset]);
  const save = async () => {
    setPending(true); setError(""); setSaved(false);
    try {
      await api("git/defaults", { preset: choice }, "PUT");
      await refresh();
      setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };
  return <>
    <PageHeading title="Git defaults" icon={GitBranch} help="git-defaults" actions={<PageCloseButton onClick={onClose} />} />
    <Panel title="New project working style">
      <p>Choose how new projects save and share work. Existing projects keep their working agreement.</p>
      <fieldset className="git-default-choices" disabled={pending}>
        <legend>Working style</legend>
        {gitPresets.map(item => <label key={item.id} className={choice === item.id ? "chosen" : ""}>
          <input type="radio" name="git-default-preset" value={item.id} checked={choice === item.id} onChange={() => { setChoice(item.id); setSaved(false); }} />
          <span><strong>{item.name}</strong><small>{item.description}</small></span>
        </label>)}
      </fieldset>
      {error && <p className="notice error" role="alert">{error}</p>}
      {saved && <p role="status">Default saved for new projects.</p>}
      <Button variant="primary" disabled={pending || choice === preset} onClick={() => void save()}><GitBranch size={16} />{pending ? "Saving…" : "Save default"}</Button>
    </Panel>
  </>;
}
