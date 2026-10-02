import { useEffect, useState } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { api } from './api';
import { Badge, Button, Field, PageCloseButton, PageHeading, Panel } from './echoflex/Controls';
import { inventoryMatches, serviceLabel, skillLabel, toolReason } from './capability-presentation.mjs';
import { capabilityStatus } from '../domain/mcp.mjs';
import { McpConnections } from './McpConnections';
import './capabilities.css';

type Probe = { state: string; reason?: string | null };
type Tool = { id: string; origin: string; discovered: boolean | null; configured?: boolean; dependency?: string;
  nativePermission?: string; applicationAccess?: string; modelExposure?: boolean | null; unavailableReason?: string | null };
type Skill = { name: string; origin: string; discovered: boolean; dependency?: string; unavailableReason?: string | null };
type Service = { name: string; status: string; unavailableReason?: string | null };
type Inventory = { observedAt: number; tools: Tool[]; skills: Skill[]; mcp: Service[];
  probes?: Record<string, Probe>; context: { model?: string }; instructions?: { composition: string; requestID?: string; sources: { id: string; origin: string; state: string; note: string }[] } };

export function Capabilities({ data, sessionID, onClose }: {
  data: any; sessionID?: string; onClose: () => void;
}) {
  const project = data.project?.id;
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setInventory(null); setError(''); setLoading(false);
    if (!project) return;
    setLoading(true);
    const query = new URLSearchParams({ project, ...(sessionID ? { session: sessionID } : {}) });
    api(`capabilities?${query}`, undefined, 'GET', controller.signal)
      .then(result => {
        if (!Array.isArray(result?.tools) || !Array.isArray(result?.skills) || !Array.isArray(result?.mcp))
          throw Error('The runtime returned an incomplete capability inventory. Retry the inspection.');
        if (!controller.signal.aborted) setInventory(result);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Capabilities are unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project, sessionID, refresh]);
  const tools = inventory?.tools.filter(row => inventoryMatches(row, filter)) ?? [];
  const skills = inventory?.skills.filter(row => inventoryMatches(row, filter)) ?? [];
  const services = inventory?.mcp.filter(row => inventoryMatches(row, filter)) ?? [];
  const observedAt = inventory && Number.isFinite(inventory.observedAt) ? new Date(inventory.observedAt) : null;
  const serviceProbeFailed = inventory?.probes?.mcp?.state === 'unavailable' || inventory?.probes?.config?.state === 'unavailable';
  return <div className="capability-view">
    <PageHeading title="Capabilities" icon={Wrench} actions={<>
      <Button type="button" disabled={!project || loading} onClick={() => setRefresh(n => n + 1)}>
        <RefreshCw size={16} aria-hidden="true" className={loading ? 'spin' : ''} />{loading ? 'Refreshing…' : 'Refresh tools'}
      </Button><PageCloseButton onClick={onClose} />
    </>} />
    <p className="capability-intro">All agents, models and projects share the same toolkit. Actual model support, connection health and explicit native permissions are reported here.</p>
    <McpConnections onChanged={() => setRefresh(n => n + 1)} />
    {!project ? <Panel title="Open a project to inspect the runtime"><p>The inventory needs a project context. Shared MCP connections can still be managed above.</p></Panel> : <>
      {loading && <p role="status">Checking capabilities…</p>}
      {error && <Panel title="Inventory unavailable"><p className="notice error" role="alert">{error}</p><Button type="button" onClick={() => setRefresh(n => n + 1)}>Retry</Button></Panel>}
      {inventory && <>
        <div className="capability-toolbar">
          <Field label="Filter inventory"><input type="search" value={filter} placeholder="Find a tool, skill, or service…" onChange={event => setFilter(event.target.value)} /></Field>
          <div className="capability-observation">
            <span>Observed through <strong>{data.project?.name ?? project}</strong></span>
            {observedAt && <time dateTime={observedAt.toISOString()}>Checked {observedAt.toLocaleString()}</time>}
          </div>
        </div>
        <div className="capability-result-count" role="status">{tools.length} tools · {skills.length} skills · {services.length} services{filter.trim() ? ' match this filter' : ' listed'}</div>
        <Panel title="Tools" className="capability-section">
          <p className="capability-section-description">Registration means the runtime loaded the tool. It does not confirm model exposure, permission, or a successful call.</p>
          <ul className="capability-rows" aria-label="Tool inventory">{tools.map(row => <li key={row.id}>
            <div className="capability-row-heading"><code>{row.id}</code><Badge tone={row.discovered === true ? 'success' : 'neutral'}>{capabilityStatus(row)}</Badge></div>
            <small>{row.origin}</small>{toolReason(row) && <p className="capability-reason">{toolReason(row)}</p>}
          </li>)}</ul>
          {!tools.length && <p>{filter.trim() ? 'No tools match this filter.' : 'No tools were returned by this inspection.'}</p>}
        </Panel>
        <Panel title="Skills" className="capability-section">
          <p className="capability-section-description">Shared instructions loaded on demand. Discovery does not verify a skill’s dependencies.</p>
          <ul className="capability-rows" aria-label="Skill inventory">{skills.map((row, index) => <li key={`${row.name}:${row.origin}:${index}`}>
            <div className="capability-row-heading"><strong>{row.name}</strong><Badge>{skillLabel(row, inventory.probes?.skills)}</Badge></div>
            <small className="capability-origin">{row.origin}</small>
            {row.discovered !== true && row.unavailableReason && <p className="capability-reason">{row.unavailableReason}</p>}
          </li>)}</ul>
          {!skills.length && <p>{filter.trim() ? 'No skills match this filter.' : inventory.probes?.skills?.state === 'unavailable'
            ? inventory.probes.skills.reason || 'Skill discovery is unavailable.' : 'No skills were returned by this inspection.'}</p>}
        </Panel>
        <Panel title="Connected services (MCP)" className="capability-section">
          <p className="capability-section-description">Connections are managed by OpenCode. Use the shared connection controls above to add, test or authenticate a service.</p>
          <ul className="capability-rows" aria-label="Connected service inventory">{services.map(row => <li key={row.name}>
            <div className="capability-row-heading"><strong>{row.name}</strong><Badge tone={row.status === 'connected' ? 'success' : 'neutral'}>{serviceLabel(row.status)}</Badge></div>
            {row.unavailableReason && <p className="capability-reason">{row.unavailableReason}</p>}
          </li>)}</ul>
          {!services.length && <p>{filter.trim() ? 'No services match this filter.' : serviceProbeFailed
            ? 'Service inventory is incomplete because native inspection is unavailable. Retry with Refresh.' : 'No configured services were returned by this inspection.'}</p>}
        </Panel>
        {inventory.instructions && <details className="capability-native-details"><summary>Instruction sources (read-only)</summary>
          <p>{inventory.instructions.composition} This source map is not a complete provider prompt.</p>
          <p>Request: {inventory.instructions.requestID || 'No captured request'}</p>
          <ul className="capability-rows">{inventory.instructions.sources.map(row => <li key={row.id}>
            <strong>{row.origin}</strong> — {row.state}<small>{row.note}</small>
          </li>)}</ul>
        </details>}
      </>}
    </>}
  </div>;
}
