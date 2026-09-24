import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { gitPresets } from "../domain/git-project.mjs";
import { api } from "./api";
import { Button, PageHeading, Panel } from "./echoflex/Controls";

export function GitDefaults({ preset = "review", refresh }: { preset?: string; refresh: () => Promise<void> }) {
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
    <PageHeading title="Git defaults" description="Choose the starting working style for newly configured projects. Each project keeps its own saved agreement." />
    <Panel title="New project working style">
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
