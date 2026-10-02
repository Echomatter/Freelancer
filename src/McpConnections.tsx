import { useEffect, useState } from 'react';
import { api } from './api';
import { serviceLabel } from './capability-presentation.mjs';
import { mcpCatalog, mcpPreset } from './mcp-catalog.mjs';
import { Button, Panel } from './echoflex/Controls';

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
  const readiness = mcpCatalog.reduce((n, item) => n + (inventory?.services.some(service => service.name === item.id && service.enabled && service.status === 'connected') ? 1 : 0), 0);
  return <Panel title="Connected Services (MCP)" help="mcp-connections" collapsible storageKey="mcp" summaryText={`${mcpCatalog.length} · ${readiness} ready`}>
    {error && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!inventory && !error && <p role="status">Checking shared connections…</p>}
    {inventory?.state === 'unavailable' && <p>{inventory.reason}</p>}
    {inventory?.state === 'observed' && <>
      <p className="mcp-summary">{mcpCatalog.length} suggested · {readiness} ready. Shared native OpenCode connections are available to all agents, models and projects.</p>
      {!inventory.services.length && <p>No custom MCP connections.</p>}
      <ul className="capability-list mcp-service-list">{[...mcpCatalog.map(preset => ({
        name: preset.id, title: preset.name, cost: preset.cost,
        service: inventory.services.find(row => row.name === preset.id), preset,
      })), ...inventory.services.filter(row => !mcpCatalog.some(item => item.id === row.name)).map(service => ({
        name: service.name, title: service.name, cost: 'Custom native OpenCode MCP connection', service, preset: null,
      }))].map(item => {
        const service = item.service;
        return <li key={item.name}>
          <div className="mcp-service-title"><strong>{item.title}</strong><span>{serviceLabel(service?.status ?? 'needs_setup')}</span></div>
          <small>{item.cost}</small>
          <small>{service ? `${service.type} · OpenCode global configuration` : `${item.preset?.provider ?? item.preset?.kind ?? 'custom'} · Suggested setup template`}</small>
          {item.preset?.dependency && <small>Dependency: {item.preset.dependency}</small>}
          {service?.reason && <small>{service.reason}</small>}
          <div className="save-row">
            {!service && item.preset && <Button disabled={busy} onClick={() => choosePreset(item.preset.id)}>Set up {item.title}</Button>}
            {service && <Button disabled={busy} onClick={() => void act(service.enabled ? 'disable' : 'enable', service.name)}>{service.enabled ? 'Disable' : 'Enable'} {item.title}</Button>}
            {service?.enabled && <Button disabled={busy} onClick={() => void act('retry', service.name)}>Test / retry</Button>}
            {service?.enabled && service.authentication === 'native-oauth' && <Button disabled={busy} onClick={() => void act('authenticate', service.name)}>Authenticate</Button>}
            {service?.authentication === 'native-oauth' && <Button disabled={busy} onClick={() => void act('logout', service.name)}>Sign out</Button>}
          </div>
        </li>;
      })}</ul>
      <Button disabled={busy} onClick={() => setAdding(value => !value)}>{adding ? 'Cancel new connection' : 'Add connection'}</Button>
      {adding && <fieldset className="mcp-form" disabled={busy}>
        <legend>New shared connection</legend>
        <label>Service template<select value={preset} onChange={e => choosePreset(e.target.value)}>
          <option value="">Custom MCP service</option>{mcpCatalog.map(item => <option key={item.id} value={item.id}>{item.name} · {item.cost}</option>)}
        </select></label>
        {preset && <p className="capability-reason">{mcpPreset(preset)?.cost}. OpenCode owns the connection and runtime. Set referenced environment variables on the host, restart OpenCode/Freelancer, then test; secrets stay out of Freelancer settings.</p>}
        <label>Service name<input value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>
        <label>Connection type<select value={type} onChange={e => { setType(e.target.value); setTarget(''); setConsent(false); }}>
          <option value="remote">Remote URL</option><option value="local">Local command</option>
        </select></label>
        <label>{type === 'local' ? 'Executable and arguments (JSON array)' : 'MCP server URL'}
          <input value={target} onChange={e => { setTarget(e.target.value); setConsent(false); }} placeholder={type === 'local' ? '["node", "C:/tools/server.mjs"]' : 'https://service.example/mcp'} autoComplete="off" /></label>
        <label>{type === 'local' ? 'Environment references (JSON object)' : 'Header references (JSON object)'}
          <textarea value={references} onChange={e => setReferences(e.target.value)} spellCheck={false} /></label>
        {type === 'remote' && <label><input type="checkbox" checked={oauth} onChange={e => setOauth(e.target.checked)} />Use OpenCode OAuth when required</label>}
        <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          {type === 'local' ? 'I approve running this command on this computer.' : 'I approve connecting to this service.'}</label>
        <Button variant="primary" disabled={!consent || !name.trim() || !target.trim()} onClick={add}>Save shared connection</Button>
      </fieldset>}
    </>}
    {busy && <p role="status">Updating connection…</p>}
    <div className="save-row"><Button disabled={busy} onClick={() => { setError(''); setRefresh(n => n + 1); }}>Refresh connections</Button></div>
  </Panel>;
}
