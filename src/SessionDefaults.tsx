import { ProviderText } from "./ProviderColors";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { Button, PageCloseButton, PageHeading, Panel, Field } from "./echoflex/Controls";
import { ParentModelFields } from "./ModelSetup";
import { modelVariant } from "../domain/workspace.mjs";
import { api } from "./api";

export function SessionDefaults({
  data,
  refresh,
  onNavigate,
  onClose,
}: {
  data: any;
  refresh: () => Promise<void>;
  onNavigate: (view: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(data.sessionDefaults);
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setDraft(data.sessionDefaults);
    setError("");
  }, [data.project?.id, data.sessionDefaults?.revision]);
  useEffect(() => setSaved(false), [data.project?.id]);
  if (!data.project)
    return (
      <Panel>
        <h3>Choose a project</h3>
        <p>Open a project to set how its new chats start.</p>
      </Panel>
    );
  if (!draft)
    return (
      <Panel>
        <h3>Loading session defaults…</h3>
        <p role="status">Please wait for the project settings to load.</p>
      </Panel>
    );
  const workflow = data.settings.workflows.find(
    (w) => w.id === draft.workflowID,
  );
  const agent = data.settings.agents.find(
    (a) =>
      a.id ===
      (draft.agentID === "inherit" ? workflow?.agentID : draft.agentID),
  );
  const agentModel =
    agent?.model && agent.model !== "auto" ? agent.model : null;
  const parent = data.models.find((m) => m.id === agentModel);
  const change = (fields) => {
    setDraft((d) => ({ ...d, ...fields }));
    setSaved(false);
    setError("");
  };
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const next = await api(
        "session-defaults",
        { project: data.project.id, ...draft },
        "PUT",
      );
      await refresh();
      setDraft(next);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save defaults.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="session-defaults">
      <PageHeading title="Session defaults" description={<>
          New chats in{" "}
          <strong>
            {data.project.name ?? data.project.directory.split(/[\\/]/).pop()}
          </strong>{" "}
          start here. Existing chats keep their choices.
        </>} actions={<PageCloseButton onClick={onClose} />} />
      <form onSubmit={save}>
        <Panel className="session-start">
          <h3>Start a new chat</h3>
          <div className="editor-columns">
            <Field label="Workflow">
              <select
                value={draft.workflowID}
                onChange={(e) => change({ workflowID: e.target.value })}
              >
                {data.settings.workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Agent">
              <select
                value={draft.agentID}
                onChange={(e) => change({ agentID: e.target.value })}
              >
                <option value="inherit">
                  Workflow's agent (
                  {data.settings.agents.find((a) => a.id === workflow?.agentID)
                    ?.name ?? "None"}
                  )
                </option>

                {data.settings.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {agentModel ? (
            <div className="session-parent-summary">
              <div>
                <span>Parent model</span>
                <strong><ProviderText provider={agentModel} mark>{parent?.name ?? agentModel}</ProviderText></strong>
                <small>Set by {agent.name}</small>
              </div>
              {!!parent?.variants?.length && (
                <div>
                  <span>Intelligence</span>
                  <strong>
                    {modelVariant(parent.variants, agent.variant) || "Default"}
                  </strong>
                </div>
              )}
            </div>
          ) : (
            <div className="session-parent-fields">
              <p>
                {agent
                  ? "Choose a parent model for this agent until one is set in its setup."
                  : "Choose the parent model for chats without an agent."}
              </p>
              <ParentModelFields
                data={data}
                model={draft.parentModel}
                variant={draft.reasoningVariant}
                onModel={(v) =>
                  change({ parentModel: v, reasoningVariant: "" })
                }
                onVariant={(v) => change({ reasoningVariant: v })}
              />
            </div>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <div className="session-defaults-save">
            <Button
              type="submit"
              variant="primary"
              disabled={saving || (!agentModel && !draft.parentModel)}
            >
              {saving ? "Saving…" : "Save defaults"}
              <Check size={16} />
            </Button>
            <span role="status">{saved ? "Saved for new chats" : ""}</span>
          </div>
        </Panel>
      </form>
      <div className="session-setup-links">
        <button onClick={() => onNavigate("agents")}>
          <span>
            <strong>Agents</strong>
            <small>Prompts, parent models, and intelligence</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
        <button onClick={() => onNavigate("workflows")}>
          <span>
            <strong>Workflows</strong>
            <small>Instructions, child models, and parallel agents</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
      </div>
    </div>
  );
}
