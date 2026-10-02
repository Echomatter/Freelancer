import { useEffect, useState } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { api } from './api';
import { Badge, Button, PageCloseButton, PageHeading, Panel } from './echoflex/Controls';
import { skillLabel, toolLabel } from './capability-presentation.mjs';
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
  const tools = inventory?.tools ?? [];
  const skills = inventory?.skills ?? [];
  return <div className="capability-view">
    <PageHeading compact title="Capabilities" icon={Wrench} actions={<>
      <Button type="button" disabled={!project || loading} onClick={() => setRefresh(n => n + 1)}>
        <RefreshCw size={16} aria-hidden="true" className={loading ? 'spin' : ''} />{loading ? 'Refreshing…' : 'Refresh tools'}
      </Button><PageCloseButton onClick={onClose} />
    </>} />
    {!project ? <Panel><p>Open a project to see tools and skills.</p></Panel> : <>
      {loading && <p role="status">Checking capabilities…</p>}
      {error && <Panel title="Inventory unavailable"><p className="notice error" role="alert">{error}</p><Button type="button" onClick={() => setRefresh(n => n + 1)}>Retry</Button></Panel>}
      {inventory && <>
        <div className="capability-result-count" role="status">{tools.length} tools · {skills.length} skills</div>
        <Panel title="Tools" className="capability-section" help="capability-tools" helpDetails={<>
          <details><summary>Technical details</summary>
            <p>Project: {data.project?.name ?? project}</p>
            {inventory.observedAt && <p>Checked: {new Date(inventory.observedAt).toLocaleString()}</p>}
            {inventory.tools.map(row => <p key={row.id}><strong>{row.id}</strong> · {row.origin}{row.unavailableReason && <> — {row.unavailableReason}</>}</p>)}
            {inventory.instructions && <>
              <p>{inventory.instructions.composition}</p>
              <p>Request: {inventory.instructions.requestID || 'No captured request'}</p>
              {inventory.instructions.sources.map(row => <p key={row.id}><strong>{row.origin}</strong> — {row.state}<br />{row.note}</p>)}
            </>}
          </details>
        </>}>
          <ul className="capability-rows" aria-label="Tool inventory">{tools.map(row => <li key={row.id}>
            <div className="capability-row-heading"><code>{row.id}</code><Badge tone={row.discovered === true ? 'success' : 'neutral'}>{toolLabel(row)}</Badge></div>
          </li>)}</ul>
          {!tools.length && <p>No tools were returned by this inspection.</p>}
        </Panel>
        <Panel title="Skills" className="capability-section" help="capability-skills" helpDetails={<details><summary>Technical details</summary>
          {inventory.skills.map((row, index) => <p key={index}><strong>{row.name}</strong> · {row.origin}{row.unavailableReason && <> — {row.unavailableReason}</>}</p>)}
          {inventory.probes?.skills?.reason && <p>{inventory.probes.skills.reason}</p>}
        </details>}>
          <ul className="capability-rows" aria-label="Skill inventory">{skills.map((row, index) => <li key={`${row.name}:${row.origin}:${index}`}>
            <div className="capability-row-heading"><strong>{row.name}</strong><Badge>{skillLabel(row, inventory.probes?.skills)}</Badge></div>
          </li>)}</ul>
          {!skills.length && <p>{inventory.probes?.skills?.state === 'unavailable'
            ? inventory.probes.skills.reason || 'Skill discovery is unavailable.' : 'No skills were returned by this inspection.'}</p>}
        </Panel>

      </>}
    </>}
    <McpConnections onChanged={() => setRefresh(n => n + 1)} />
  </div>;
}
