import { DelegationSettings } from "./DelegationSettings";
import { ProviderColorPicker } from "./ProviderColorPicker";
import { ProviderText, providerAttributes, type ColorPatch } from "./ProviderColors";
import { DataStorage } from "./DataStorage";
import { ContentIndex } from "./ContentIndex";
import { GitDefaults } from "./GitDefaults";
import { ThemePicker } from "./ThemePicker";
import { useEffect, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Button, Panel, Field, Badge, PageHeading } from "./echoflex/Controls";
import { api } from "./api";
import { ProviderConnection } from "./ProviderConnection";
import { SessionDefaults } from "./SessionDefaults";
import { TodoPlacement } from "./TodoPlacement";
import { persistTodoLayout } from "../domain/appearance.mjs";
const providers = [
  ["openai", "OpenAI"],
  ["github-copilot", "GitHub Copilot"],
  ["opencode-go", "OpenCode Go"],
  ["opencode", "OpenCode Free"],
];
export function Settings({
  data,
  sessionID,
  tab,
  run,
  refresh,
  onNavigate,
  onAppearanceSaved,
  onColorsSaved,
  onHistory,
}: {
  data: any;
  sessionID?: string;
  onHistory?: () => void;
  onAppearanceSaved?: (layout: string) => void;
  onColorsSaved: (patch: ColorPatch) => void;
  onNavigate: (view: string) => void;
  tab: string;
  run: (fn: () => Promise<any>) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [plans, setPlans] = useState<any>(data.settings.plans);
  const [auth, setAuth] = useState<any>(null),
    [methods, setMethods] = useState<any>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setPlans(data.settings.plans);
  }, [data.settings.revision, data.project?.id]);
  const changePlan = (id, key, value) =>
    setPlans((p) => ({
      ...p,
      providers: { ...p.providers, [id]: { ...p.providers[id], [key]: value } },
    }));
  async function connect(id) {
    const all = await api("auth");
    setMethods(all);
    setAuth({ provider: id });
  }
  return (
    <div className="settings-layout">
      <div className="settings-content">
        {tab === "delegation" && <><PageHeading title="Delegation" description="Set the project’s delegation budget and limits." /><DelegationSettings key={data.project?.id} project={data.project?.id ?? ""} sessionID={sessionID} refresh={refresh} /></>}
        {tab === "storage" && <DataStorage onHistory={() => onHistory?.()} onChange={refresh} />}
        {tab === "index" && <ContentIndex />}
        {tab === "git-defaults" && <GitDefaults preset={data.settings.gitDefaults?.preset} refresh={refresh} />}
        {tab === "providers" && (
          <>
            <PageHeading title="Providers" description="Manage connections, billing preferences, and provider colors." />
            <div className="provider-list">
              {providers.map(([id, name]) => (
                <Panel key={id} className="provider-card" aria-label={`${name} settings`} {...providerAttributes(id, data.settings.appearance ?? {})}>
                  <div className="provider-top">
                    <span className="provider-icon provider-fill">
                      {name.slice(0, 1)}
                    </span>
                    <div>
                      <h3><ProviderText provider={id}>{name}</ProviderText></h3>
                      <Badge
                        tone={
                          data.providers.connected.includes(id) ||
                          id === "opencode"
                            ? "success"
                            : "neutral"
                        }
                      >
                        {data.providers.connected.includes(id) ||
                        id === "opencode"
                          ? "Connected"
                          : "Not connected"}
                      </Badge>
                    </div>
                    {id !== "opencode" && (
                      <Button onClick={() => run(() => connect(id))}>
                        {data.providers.connected.includes(id)
                          ? "Reconnect"
                          : "Connect"}
                        <Link2 size={15} />
                      </Button>
                    )}
                  </div>
                  {id !== "opencode" && (
                    <div className="field-grid">
                      <Field label="Billing">
                        <select
                          value={plans.providers[id].mode}
                          onChange={(e) =>
                            changePlan(id, "mode", e.target.value)
                          }
                        >
                          <option value="subscription">
                            Monthly subscription
                          </option>
                          <option value="api">Pay as you go</option>
                        </select>
                      </Field>
                      {plans.providers[id].mode === "subscription" && (
                        <Field label={`Monthly cost (${plans.currency})`}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Add price"
                            value={plans.providers[id].monthlyPrice ?? ""}
                            onChange={(e) =>
                              changePlan(
                                id,
                                "monthlyPrice",
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                          />
                        </Field>
                      )}
                    </div>
                  )}
                  <ProviderColorPicker provider={id} name={name} onSaved={onColorsSaved} />
                </Panel>
              ))}
            </div>
            <div className="save-row">
              <Field label="Currency">
                <select
                  value={plans.currency}
                  onChange={(e) =>
                    setPlans({ ...plans, currency: e.target.value })
                  }
                >
                  {["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Button
                variant="primary"
                onClick={() =>
                  run(async () => {
                    await api("plans", plans, "PUT");
                    await refresh();
                    setSaved(true);
                    setTimeout(() => setSaved(false), 2500);
                  })
                }
              >
                {saved ? "Saved" : "Save provider settings"}
                <Check size={16} />
              </Button>
            </div>
          </>
        )}
        {tab === "sessions" && (
          <SessionDefaults
            key={data.project?.id}
            data={data}
            refresh={refresh}
            onNavigate={onNavigate}
          />
        )}
        {tab === "appearance" && (
          <>
            <PageHeading title="Appearance" description="Choose how Freelancer looks and arranges your workspace." />
              <Panel>
                <TodoPlacement
                  appearance={data.settings.appearance}
                  save={async (todoLayout) => {
                    await persistTodoLayout(
                      todoLayout,
                      (patch) => api("appearance", patch, "PUT"),
                      async (layout) => {
                        if (onAppearanceSaved) onAppearanceSaved(layout);
                        else await refresh();
                      },
                    );
                  }}
                />
                <label className="check">
                <input
                  type="checkbox"
                  checked={
                    data.settings.appearance?.showDepletedModels !== false
                  }
                  onChange={(e) => {
                    const showDepletedModels = e.target.checked;
                    void run(async () => {
                      await api("appearance", { showDepletedModels }, "PUT");
                      await refresh();
                    });
                  }}
                />
                Show depleted usage models in the workspace picker
              </label>
              <ThemePicker theme={data.settings.appearance?.theme} refresh={refresh} onSaved={onColorsSaved} />
            </Panel>
          </>
        )}
      </div>
      {auth && (
        <ProviderConnection
          key={auth.provider}
          provider={auth.provider}
          name={
            providers.find((p) => p[0] === auth.provider)?.[1] ?? auth.provider
          }
          methods={methods[auth.provider] ?? []}
          onClose={() => setAuth(null)}
          onConnected={refresh}
        />
      )}
    </div>
  );
}
