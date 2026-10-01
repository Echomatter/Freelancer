import { DelegationSettings } from "./DelegationSettings";
import { ProviderColorPicker } from "./ProviderColorPicker";
import { ProviderText, providerAttributes, type ColorPatch } from "./ProviderColors";
import { ContentStorage } from "./ContentStorage";
import { FileAccessSettings } from "./FileAccessSettings";

import { GitDefaults } from "./GitDefaults";
import { ThemePicker } from "./ThemePicker";
import { useEffect, useState } from "react";
import { Check, GitFork, Link2, Palette, Wallet } from "lucide-react";
import { Button, Panel, Field, Badge, PageCloseButton, PageHeading } from "./echoflex/Controls";
import { api } from "./api";
import { ProviderConnection } from "./ProviderConnection";
import { SessionDefaults } from "./SessionDefaults";
import { ScheduledPrompts } from "./ScheduledPrompts";
import { RemoteAccess } from "./RemoteAccess";
import { Capabilities } from './Capabilities';
import type { SettingsScope } from "./SettingsNavigation";
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
  onSetting,
  onColorsSaved,
  onHistory,
  onOpenChat,
  onClose,
}: {
  data: any;
  sessionID?: string;
  onHistory?: () => void;
  onOpenChat: (project: string, session: string) => Promise<void>;
  onClose: () => void;
  onColorsSaved: (patch: ColorPatch) => void;
  onNavigate: (view: string) => void;
  onSetting: (scope: SettingsScope, tab: string) => void;
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
  const closeAction = <PageCloseButton onClick={onClose} />;
  return (
    <div className="settings-layout">
      <div className="settings-content">
        {tab === "remote-access" && <RemoteAccess onClose={onClose} />}
        {tab === 'capabilities' && <Capabilities data={data} sessionID={sessionID} onClose={onClose}
          onSaveLsp={async enabled => {
            const result = await api('appearance', { nativeLspToolEnabled: enabled }, 'PUT');
            if (result?.saved !== true || result.nativeLspToolEnabled !== enabled) throw Error('The native tool choice was not confirmed.');
            await refresh();
          }} />}
        {tab === "schedules" && <ScheduledPrompts data={data} onClose={onClose} onOpen={onOpenChat} />}
        {tab === "delegation" && <><PageHeading title="Delegation" icon={GitFork} help="delegation" actions={closeAction} /><DelegationSettings key={data.project?.id} project={data.project?.id ?? ""} sessionID={sessionID} refresh={refresh} /></>}
        {tab === "content-storage" && <>
          <ContentStorage onHistory={() => onHistory?.()} onSearch={() => onSetting("application", "search")} onClose={onClose} onChange={refresh} />
          <FileAccessSettings
            value={data.settings.fileAccessScope}
            projectCount={data.settings.projects?.length ?? 0}
            onSave={async (scope) => {
              const result = await api("appearance", { fileAccessScope: scope }, "PUT");
              if (result?.saved !== true || (result.fileAccessScope !== undefined && result.fileAccessScope !== scope))
                throw Error("The file access choice was not confirmed. Try again.");
              await refresh();
            }}
          />
        </>}
        {tab === "git-defaults" && <GitDefaults preset={data.settings.gitDefaults?.preset} onClose={onClose} refresh={refresh} />}
        {tab === "providers" && (
          <>
            <PageHeading title="Providers" icon={Wallet} help="providers" actions={closeAction} />
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
            onClose={onClose}
          />
        )}
        {tab === "appearance" && (
          <>
            <PageHeading title="Appearance" icon={Palette} actions={closeAction} />
            <Panel>
              <ThemePicker theme={data.settings.appearance?.theme} customThemes={data.settings.appearance?.customThemes} refresh={refresh} onSaved={onColorsSaved} />
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
          onConnected={async () => {
            // Authentication succeeded independently of quota telemetry. Refresh
            // observations now so a repaired sign-in does not look disconnected.
            await api('usage/refresh', {}).catch(() => {});
            await refresh();
          }}
        />
      )}
    </div>
  );
}
