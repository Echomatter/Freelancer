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
    <PageHeading title="Git defaults" actions={<PageCloseButton onClick={onClose} />} />
    <Panel title="New project working style">
      <p className="settings-context">This is the starting style for new projects. Existing projects keep their own saved agreements.</p>
      <label className="field"><span>Working style</span>
        <select value={choice} disabled={pending} onChange={(e) => setChoice(e.target.value)}>
          {gitPresets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {error && <p className="notice error" role="alert">{error}</p>}
      {saved && <p role="status">Default saved for new projects.</p>}
      <Button disabled={pending || choice === preset} onClick={() => void save()}><GitBranch size={16} />{pending ? "Saving…" : "Save default"}</Button>
    </Panel>
  </>;
}
