import { ProviderText } from "./ProviderColors";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, MessageSquare } from "lucide-react";
import { Button, PageCloseButton, PageHeading, Panel, Field } from "./echoflex/Controls";
import { ParentModelFields } from "./ModelSetup";
import { modelVariant } from "../domain/workspace.mjs";
import { api } from "./api";
import { ContextSettings } from './ContextSettings';

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
      </Panel>
    );
  if (!draft)
    return (
      <Panel>
        <h3>Loading session defaults…</h3>
      </Panel>
    );
  const agent = data.settings.agents.find(
    (a) => a.id === draft.agentID,
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
      <PageHeading title="Session defaults" icon={MessageSquare} help="session-defaults" actions={<PageCloseButton onClick={onClose} />} />
      <form onSubmit={save}>
        <Panel className="session-start" title="Start a new chat">
          <div className="session-agent-field">
            <Field label="Agent">
              <select
                value={draft.agentID}
                onChange={(e) => change({ agentID: e.target.value })}
              >
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
      <ContextSettings key={data.project.id} project={data.project.id} />
      <div className="session-setup-links">
        <button onClick={() => onNavigate("agents")}>
          <span>
            <strong>Agents</strong>
          </span>
          <ArrowUpRight size={18} />
        </button>
      </div>
    </div>
  );
}
