import { DelegationSettings } from "./DelegationSettings";
import { ProviderColorPicker } from "./ProviderColorPicker";
import { ProviderText, providerAttributes, type ColorPatch } from "./ProviderColors";
import { ContentStorage } from "./ContentStorage";
import { FileAccessSettings } from "./FileAccessSettings";
import { ThemePicker } from "./ThemePicker";
import { useEffect, useRef, useState } from "react";
import { Check, Files, GitFork, Link2, Palette, Wallet } from "lucide-react";
import { Button, Panel, Field, Badge, PageCloseButton, PageHeading } from "./echoflex/Controls";
import { Dialog } from './echoflex/Dialog';
import { api } from "./api";
import { ProviderConnection } from "./ProviderConnection";
import { SessionDefaults } from "./SessionDefaults";
import { ScheduledPrompts } from "./ScheduledPrompts";
import { RemoteAccess } from "./RemoteAccess";
import { Capabilities } from './Capabilities';
import type { useModelDataUpdate } from './ModelRatings';
import { providerDefaults } from '../domain/provider-colors.mjs';
import type { SettingsScope } from "./SettingsNavigation";

export function Settings({ data, modelData, sessionID, tab, run, refresh, onNavigate, onSetting, onColorsSaved, onOpenChat, onClose }: {
  data: any; modelData: ReturnType<typeof useModelDataUpdate>; sessionID?: string;
  onOpenChat: (project: string, session: string) => Promise<void>;
  onClose: () => void; onColorsSaved: (patch: ColorPatch) => void;
  onNavigate: (view: string) => void; onSetting: (scope: SettingsScope, tab: string) => void;
  tab: string; run: (fn: () => Promise<any>) => Promise<void>; refresh: () => Promise<void>;
}) {
  const [plans, setPlans] = useState<any>(data.settings.plans);
  const [auth, setAuth] = useState<any>(null), [methods, setMethods] = useState<any>({});
  const [addingProvider, setAddingProvider] = useState(false), [providerQuery, setProviderQuery] = useState('');
  const [providerChoice, setProviderChoice] = useState(''), [providerPending, setProviderPending] = useState(false), [providerError, setProviderError] = useState('');
  const providerRequest = useRef<AbortController>();
  useEffect(() => () => providerRequest.current?.abort(), []);
  const [billingSaving, setBillingSaving] = useState(false), [billingSaved, setBillingSaved] = useState(false);
  const [billingError, setBillingError] = useState(''), [billingNotice, setBillingNotice] = useState('');
  const billingDirty = useRef(false), billingFlight = useRef(false);
  useEffect(() => {
    // A color/auth refresh must not silently replace unsaved billing choices.
    if (!billingDirty.current && !billingFlight.current) setPlans(data.settings.plans);
  }, [data.settings.revision, data.settings.plans]);
  const editPlans = (next: any) => {
    billingDirty.current = true; setBillingSaved(false); setBillingError(''); setBillingNotice(''); setPlans(next);
  };
  const changePlan = (id: string, key: string, value: unknown) => editPlans((p: any) => ({
    ...p, providers: { ...p.providers, [id]: { ...p.providers[id], [key]: value } },
  }));
  async function savePlans() {
    if (billingFlight.current) return;
    billingFlight.current = true; setBillingSaving(true); setBillingError(''); setBillingNotice(''); setBillingSaved(false);
    try {
      await api('plans', plans, 'PUT');
      billingDirty.current = false; setBillingSaved(true);
      try { await refresh(); }
      catch { setBillingNotice('Billing settings were saved, but the workspace could not refresh. Reopen this page to reload them.'); }
    } catch (error) { setBillingError(error instanceof Error ? error.message : 'Could not save billing settings. Your edits are retained.'); }
    finally { billingFlight.current = false; setBillingSaving(false); }
  }
  const nativeProviders = data.providers.all ?? [];
  const connectedProviders = new Set<string>(data.providers.connected ?? []);
  const currentProviders = nativeProviders.filter((provider: any) => connectedProviders.has(provider.id) ||
    (provider.id === 'opencode' && Object.values(provider.models ?? {}).some((model: any) => model.cost?.input === 0 && model.cost?.output === 0)));
  const currentProviderIDs = new Set(currentProviders.map((provider: any) => provider.id));
  const additionalProviders = nativeProviders.filter((provider: any) => !currentProviderIDs.has(provider.id));
  const matchingProviders = additionalProviders.filter((provider: any) =>
    `${provider.name} ${provider.id}`.toLowerCase().includes(providerQuery.trim().toLowerCase()));
  async function connect(id: string, signal?: AbortSignal) {
    const all = await api("auth", undefined, 'GET', signal);
    if (signal?.aborted) return false;
    setMethods(all); setAuth({ provider: id }); return true;
  }
  const closeProviderPicker = () => {
    providerRequest.current?.abort(); providerRequest.current = undefined;
    setAddingProvider(false); setProviderPending(false);
  };
  async function chooseProvider() {
    if (providerRequest.current || !additionalProviders.some((provider: any) => provider.id === providerChoice)) return;
    const controller = new AbortController(); providerRequest.current = controller;
    setProviderPending(true); setProviderError('');
    try {
      if (await connect(providerChoice, controller.signal)) setAddingProvider(false);
    } catch (error) {
      if (!controller.signal.aborted) setProviderError(error instanceof Error ? error.message : 'Could not load the provider connection. Try again.');
    } finally {
      if (providerRequest.current === controller) {
        providerRequest.current = undefined;
        if (!controller.signal.aborted) setProviderPending(false);
      }
    }
  }
  const closeAction = <PageCloseButton onClick={onClose} />;
  return <div className="settings-layout"><div className="settings-content">
    {tab === "remote-access" && <RemoteAccess onClose={onClose} />}
    {tab === 'capabilities' && <Capabilities data={data} modelData={modelData} sessionID={sessionID} onClose={onClose} />}
    {tab === "schedules" && <ScheduledPrompts data={data} onClose={onClose} onOpen={onOpenChat} />}
    {tab === "delegation" && <><PageHeading title="Delegation" icon={GitFork} help="delegation" actions={closeAction} />
      <DelegationSettings key={data.project?.id} project={data.project?.id ?? ""} sessionID={sessionID} refresh={refresh} /></>}
    {tab === "content-storage" && <ContentStorage
      onClose={onClose} onChange={refresh} onSearch={() => onSetting("application", "search")} />}
    {tab === "file-access" && <><PageHeading title="File access" icon={Files} actions={closeAction} />
      <FileAccessSettings value={data.settings.fileAccessScope}
        projectCount={data.settings.projects?.length ?? 0} onSave={async scope => {
          const result = await api("appearance", { fileAccessScope: scope }, "PUT");
          if (result?.saved !== true || (result.fileAccessScope !== undefined && result.fileAccessScope !== scope))
            throw Error("The file access choice was not confirmed. Try again.");
          await refresh();
        }} /></>}
    {tab === "providers" && <>
      <PageHeading title="Providers" icon={Wallet} help="providers" actions={<>
        <Button type="button" variant="primary" onClick={() => {
          setProviderQuery(''); setProviderChoice(''); setProviderError(''); setAddingProvider(true);
        }}>Add provider</Button>{closeAction}
      </>} />
      {!currentProviders.length && <p>No providers are connected.</p>}
      <div className="provider-list">{currentProviders.map(({ id, name }: { id: string; name: string }) => {
        const plan = plans.providers[id] ?? { mode: "unknown", monthlyPrice: null, enabled: true };
        return <Panel key={id} className="provider-card" aria-label={`${name} settings`} {...providerAttributes(id, data.settings.appearance ?? {})}>
        <div className="provider-top">
          <span className="provider-icon provider-fill" aria-hidden="true">{name.slice(0, 1)}</span>
          <div><h2 className="panel-heading"><ProviderText provider={id}>{name}</ProviderText></h2>
            <Badge tone={data.providers.connected.includes(id) || id === "opencode" ? "success" : "neutral"}>
              {data.providers.connected.includes(id) || id === "opencode" ? "Connected" : "Not connected"}
            </Badge>
          </div>
          {id !== "opencode" && <Button type="button" onClick={() => run(() => connect(id))}>
            {data.providers.connected.includes(id) ? "Reconnect" : "Connect"}<Link2 size={15} aria-hidden="true" />
          </Button>}
        </div>
        {id !== "opencode" && <fieldset disabled={billingSaving}>
          <legend>Billing reference</legend><div className="field-grid">
            <Field label="Billing"><select value={plan.mode} onChange={e => changePlan(id, "mode", e.target.value)}>
              {!Object.hasOwn(providerDefaults, id) && <>
                <option value="unknown">Unknown</option>
                <option value="free">Free</option>
              </>}
              <option value="subscription">Monthly subscription</option><option value="api">Pay as you go</option>
            </select></Field>
            {plan.mode === "subscription" && <Field label={`Monthly cost (${plans.currency})`}>
              <input type="number" min="0" step="0.01" placeholder="Add price" value={plan.monthlyPrice ?? ""}
                onChange={e => changePlan(id, "monthlyPrice", e.target.value === "" ? null : Number(e.target.value))} />
            </Field>}
          </div>
        </fieldset>}
        {Object.hasOwn(providerDefaults, id) && <ProviderColorPicker provider={id} name={name} onSaved={onColorsSaved} />}
      </Panel>;
      })}</div>
      <Panel title="Billing preferences" help="billing-preferences">
        <div className="save-row settings-billing-actions">
          <Field label="Currency"><select disabled={billingSaving} value={plans.currency} onChange={e => editPlans({ ...plans, currency: e.target.value })}>
            {["USD", "EUR", "GBP", "CAD", "AUD"].map(c => <option key={c}>{c}</option>)}
          </select></Field>
          <Button type="button" variant="primary" disabled={billingSaving} onClick={() => void savePlans()}>
            {billingSaving ? "Saving…" : billingSaved ? "Saved" : "Save provider settings"}<Check size={16} aria-hidden="true" />
          </Button>
        </div>
        {billingError && <p className="notice error" role="alert">{billingError}</p>}
        <p className="settings-save-status" role="status">{billingNotice || (billingSaved ? 'Billing settings saved.' : '')}</p>
      </Panel>
    </>}
    {tab === "sessions" && <SessionDefaults key={data.project?.id} data={data} refresh={refresh} onNavigate={onNavigate} onClose={onClose} />}
    {tab === "appearance" && <><PageHeading title="Appearance" icon={Palette} actions={closeAction} />
      <Panel><ThemePicker theme={data.settings.appearance?.theme} customThemes={data.settings.appearance?.customThemes} refresh={refresh} onSaved={onColorsSaved} /></Panel></>}
  </div>
  {addingProvider && <Dialog title="Add provider" ariaLabel="Add provider" size="compact" initialFocus="first"
    onClose={closeProviderPicker} onSubmit={event => { event.preventDefault(); void chooseProvider(); }}
    footer={<>
      <Button type="button" onClick={closeProviderPicker}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={providerPending || !additionalProviders.some((provider: any) => provider.id === providerChoice)}>
        {providerPending ? 'Loading connection…' : 'Continue'}
      </Button>
    </>}>
    <Field label="Search providers"><input type="search" value={providerQuery} disabled={providerPending}
      onChange={event => { setProviderQuery(event.target.value); setProviderChoice(''); setProviderError(''); }} /></Field>
    <Field label="Provider"><select value={providerChoice} disabled={providerPending || !matchingProviders.length}
      onChange={event => { setProviderChoice(event.target.value); setProviderError(''); }}>
      <option value="">Choose a provider</option>
      {matchingProviders.map((provider: any) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
    </select></Field>
    {!matchingProviders.length && <p>{additionalProviders.length ? 'No providers match this search.' : 'No additional providers were returned by OpenCode.'}</p>}
    {providerError && <p className="notice error" role="alert">{providerError}</p>}
  </Dialog>}
  {auth && <ProviderConnection key={auth.provider} provider={auth.provider} name={data.providers.all.find((provider: any) => provider.id === auth.provider)?.name ?? auth.provider}
    methods={methods[auth.provider] ?? []} onClose={() => setAuth(null)} onConnected={async () => {
      await api('usage/refresh', {}).catch(() => {}); await refresh();
    }} />}
  </div>;
}
