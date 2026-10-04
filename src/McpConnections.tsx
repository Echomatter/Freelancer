import { useEffect, useState } from 'react';
import { api } from './api';
import { serviceLabel } from './capability-presentation.mjs';
import { mcpCatalog, mcpPreset } from './mcp-catalog.mjs';
import { Badge, Button, Field, Panel } from './echoflex/Controls';

type Service = { name: string; type: string; enabled: boolean; status: string; authentication: string; reason?: string };
type Inventory = { state: string; revision?: string; services: Service[]; reason?: string; notice?: string };
export function McpConnections({ onChanged }: { onChanged: () => void }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('remote');
  const [target, setTarget] = useState('');
  const [references, setReferences] = useState('{}');
  const [oauth, setOauth] = useState(true);
  const [preset, setPreset] = useState('');
  const [consent, setConsent] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api('mcp', undefined, 'GET', controller.signal).then(value => {
      if (!controller.signal.aborted) setInventory(value);
    }).catch(() => { if (!controller.signal.aborted) { setInventory(null); setError('Could not inspect shared MCP connections.'); } });
    return () => controller.abort();
  }, [refresh]);
  const act = async (action: string, service: string, config?: unknown) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('mcp', { action, name: service, expectedRevision: inventory?.revision, ...(config ? { config } : {}) }, 'POST');
      setInventory(result);
      setNotice(result.notice || (action === 'authenticate' ? 'Sign-in finished.'
        : 'Connection updated.'));
      if (action === 'add' && result.saved) { setAdding(false); setName(''); setTarget(''); setReferences('{}'); setConsent(false); }
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The connection action was not confirmed.');
      setRefresh(n => n + 1);
    } finally { setBusy(false); }
  };
  const add = () => {
    try {
      const fields = JSON.parse(references || '{}');
      const config = type === 'local' ? { type, command: JSON.parse(target), environment: fields, enabled: true }
        : { type, url: target, headers: fields, enabled: true, ...(oauth ? {} : { oauth: false }) };
      void act('add', name.trim(), config);
    } catch { setError('Command arguments and environment/header references must be valid JSON.'); }
  };
  const choosePreset = (id: string) => {
    const item = mcpPreset(id); if (!item) return;
    setPreset(id); setName(item.id); setType(item.kind);
    setTarget(item.kind === 'local' ? JSON.stringify(item.command ?? []) : item.url ?? '');
    setReferences(item.kind === 'local'
      ? JSON.stringify(item.environment ?? {}, null, 2)
      : !item.header || !item.value ? '{}' : JSON.stringify({ [item.header]: item.value }, null, 2));
    setOauth(false); setAdding(true);
  };
  const connected = inventory?.services.filter(service => service.enabled && service.status === 'connected').length ?? 0;
  const services = [...mcpCatalog.map(preset => ({
    name: preset.id, title: preset.name, cost: preset.cost,
    service: inventory?.services.find(row => row.name === preset.id), preset,
  })), ...(inventory?.services ?? []).filter(row => !mcpCatalog.some(item => item.id === row.name)).map(service => ({
    name: service.name, title: service.name, cost: 'Custom native OpenCode MCP connection', service, preset: null,
  }))];
  return <Panel title="Connected services" className="capability-section connection-panel" help="mcp-connections" collapsible storageKey="mcp"
    summaryText={inventory?.state === 'observed' ? `${inventory.services.length} configured · ${connected} connected` : inventory?.state === 'unavailable' || error ? 'Unavailable' : 'Checking…'}
    helpDetails={<details className="connection-details"><summary>Connection details</summary>
      {services.map(item => <div key={item.name}><strong>{item.title}</strong><p>{item.cost}</p>
        <p>{item.service ? `${item.service.type} · OpenCode global configuration` : `${item.preset?.provider ?? item.preset?.kind ?? 'custom'} · Setup template`}</p>
        {item.service?.reason && <p>{item.service.reason}</p>}
        {item.preset?.dependency && <p>Dependency: {item.preset.dependency}</p>}
      </div>)}
    </details>}>
    {error && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!inventory && !error && <p role="status">Checking shared connections…</p>}
    {inventory?.state === 'unavailable' && <p role="status">{inventory.reason}</p>}
    {inventory?.state === 'observed' && <>
      {!inventory.services.length && <p>No custom MCP connections.</p>}
      <ul className="connection-rows mcp-service-list" aria-label="Shared MCP connections">{services.map(item => {
        const service = item.service;
        const status = service?.status === 'connected' ? 'Connected' : serviceLabel(service?.status ?? 'needs_setup');
        return <li key={item.name}>
          <div className="connection-row-main">
            <div className="connection-row-title"><strong>{item.title}</strong><Badge tone={service?.enabled && service.status === 'connected' ? 'success' : 'neutral'}>{status}</Badge></div>
            <span className="connection-row-meta">{service?.type ?? item.preset?.kind ?? 'Custom'}{!service && ' · Setup template'}</span>
            {service?.reason && service.status !== 'connected' && <p className="connection-row-issue">{service.reason}</p>}
          </div>
          <div className="connection-row-actions">
            {!service && item.preset && <Button type="button" disabled={busy} aria-label={`Set up ${item.title}`} onClick={() => choosePreset(item.preset.id)}>Set up</Button>}
            {service && <Button type="button" variant="quiet" disabled={busy} aria-label={`${service.enabled ? 'Disable' : 'Enable'} ${item.title}`} onClick={() => void act(service.enabled ? 'disable' : 'enable', service.name)}>{service.enabled ? 'Disable' : 'Enable'}</Button>}
            {service?.enabled && <Button type="button" disabled={busy} onClick={() => void act('retry', service.name)}>Test / retry</Button>}
            {service?.enabled && service.authentication === 'native-oauth' && <Button type="button" disabled={busy} onClick={() => void act('authenticate', service.name)}>Authenticate</Button>}
            {service?.authentication === 'native-oauth' && <Button type="button" variant="quiet" disabled={busy} onClick={() => void act('logout', service.name)}>Sign out</Button>}
          </div>
        </li>;
      })}</ul>
      <div className="connection-actions"><Button type="button" variant={adding ? 'secondary' : 'primary'} disabled={busy} onClick={() => setAdding(value => !value)}>{adding ? 'Cancel new connection' : 'Add connection'}</Button>
        <Button type="button" variant="quiet" disabled={busy} onClick={() => { setError(''); setRefresh(n => n + 1); }}>Refresh connections</Button></div>
      {adding && <fieldset className="mcp-form" disabled={busy}>
        <legend>New shared connection</legend>
        <Field label="Service template"><select value={preset} onChange={e => choosePreset(e.target.value)}>
          <option value="">Custom MCP service</option>{mcpCatalog.map(item => <option key={item.id} value={item.id}>{item.name} · {item.cost}</option>)}
        </select></Field>
        <div className="connection-fields"><Field label="Service name"><input value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></Field>
        <Field label="Connection type"><select value={type} onChange={e => { setType(e.target.value); setTarget(''); setConsent(false); }}>
          <option value="remote">Remote URL</option><option value="local">Local command</option>
        </select></Field></div>
        <Field label={type === 'local' ? 'Executable and arguments (JSON array)' : 'MCP server URL'}>
          <input value={target} onChange={e => { setTarget(e.target.value); setConsent(false); }} placeholder={type === 'local' ? '["node", "C:/tools/server.mjs"]' : 'https://service.example/mcp'} autoComplete="off" /></Field>
        <Field label={type === 'local' ? 'Environment references (JSON object)' : 'Header references (JSON object)'}>
          <textarea value={references} onChange={e => setReferences(e.target.value)} spellCheck={false} /></Field>
        {type === 'remote' && <label className="check"><input type="checkbox" checked={oauth} onChange={e => setOauth(e.target.checked)} />Use OpenCode OAuth when required</label>}
        <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          {type === 'local' ? 'I approve running this command on this computer.' : 'I approve connecting to this service.'}</label>
        <Button variant="primary" disabled={!consent || !name.trim() || !target.trim()} onClick={add}>Save shared connection</Button>
      </fieldset>}
    </>}
    {busy && <p role="status">Updating connection…</p>}
    {inventory?.state !== 'observed' && <div className="connection-actions"><Button type="button" disabled={busy} onClick={() => { setError(''); setRefresh(n => n + 1); }}>Refresh connections</Button></div>}
  </Panel>;
}
