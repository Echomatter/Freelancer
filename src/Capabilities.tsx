import { useEffect, useState } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { api } from './api';
import { Badge, Button, PageCloseButton, PageHeading, Panel } from './echoflex/Controls';
import { skillLabel, toolLabel } from './capability-presentation.mjs';
import { McpConnections } from './McpConnections';
import { ModelDataSettings, type useModelDataUpdate } from './ModelRatings';
import './capabilities.css';

type Probe = { state: string; reason?: string | null };
type Tool = { id: string; summary?: string; origin: string; discovered: boolean | null; configured?: boolean; dependency?: string;
  nativePermission?: string; applicationAccess?: string; modelExposure?: boolean | null; unavailableReason?: string | null };
type Skill = { name: string; summary?: string; origin: string; discovered: boolean; dependency?: string; unavailableReason?: string | null };
type Service = { name: string; status: string; unavailableReason?: string | null };
type Inventory = { observedAt: number; tools: Tool[]; skills: Skill[]; mcp: Service[];
  toolInventoryCoverage?: { registry: string; mcp: string };
  probes?: Record<string, Probe>; context: { model?: string }; instructions?: { composition: string; requestID?: string; sources: { id: string; origin: string; state: string; note: string }[] } };

export function Capabilities({ data, modelData, sessionID, onClose }: {
  data: any; modelData: ReturnType<typeof useModelDataUpdate>; sessionID?: string; onClose: () => void;
}) {
  const project = data.project?.id;
  const inspectedSession = project ? sessionID : undefined;
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setInventory(null); setError(''); setLoading(false);
    setLoading(true);
    const query = new URLSearchParams({ ...(project ? { project } : {}), ...(inspectedSession ? { session: inspectedSession } : {}) });
    const parameters = query.toString();
    api(parameters ? `capabilities?${parameters}` : 'capabilities', undefined, 'GET', controller.signal)
      .then(result => {
        if (!Array.isArray(result?.tools) || !Array.isArray(result?.skills) || !Array.isArray(result?.mcp))
          throw Error('The runtime returned an incomplete capability inventory. Retry the inspection.');
        if (!controller.signal.aborted) setInventory(result);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Capabilities are unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project, inspectedSession, refresh]);
  const tools = inventory?.tools ?? [];
  const skills = inventory?.skills ?? [];
  const availableTools = tools.filter(row => ['Available', 'Loaded'].includes(toolLabel(row))).length;
  const availableSkills = skills.filter(row => skillLabel(row, inventory?.probes?.skills) === 'Found').length;
  const skillInspectionNote = (row: Skill) => row.discovered ? null : row.unavailableReason;
  return <div className="capability-view">
    <PageHeading title="Capabilities" icon={Wrench} actions={<>
      <Button type="button" variant="primary" disabled={loading} onClick={() => setRefresh(n => n + 1)}>
        <RefreshCw size={16} aria-hidden="true" className={loading ? 'spin' : ''} />{loading ? 'Refreshing…' : 'Refresh tools'}
      </Button><PageCloseButton onClick={onClose} />
    </>} />
    <>
      {loading && <p role="status">Checking capabilities…</p>}
      {error && <Panel title="Inventory unavailable"><p className="notice error" role="alert">{error}</p><Button type="button" onClick={() => setRefresh(n => n + 1)}>Retry</Button></Panel>}
      {inventory && <>
        <Panel title="Tools" className="capability-section" collapsible storageKey="tools" summaryText={`${tools.length} · ${availableTools} available`} help="capability-tools" helpDetails={<>
          <details><summary>Technical details</summary>
            {inventory.toolInventoryCoverage && <p>{inventory.toolInventoryCoverage.registry} {inventory.toolInventoryCoverage.mcp}</p>}
            <p>{project ? `Project: ${data.project?.name ?? project}` : 'Context: Application · No project or chat selected'}</p>
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
            <details className="capability-item">
              <summary><span className="capability-name">{row.id}</span><Badge tone={toolLabel(row) === 'Available' ? 'success' : 'neutral'}>{toolLabel(row)}</Badge></summary>
              <p className="capability-description">{row.summary || 'Use this tool through OpenCode with its native inputs and permissions.'}</p>
            </details>
          </li>)}</ul>
          {!tools.length && <p>No tools were returned by this inspection.</p>}
        </Panel>
        <Panel title="Skills" className="capability-section" collapsible storageKey="skills" summaryText={`${skills.length} · ${availableSkills} found`} help="capability-skills" helpDetails={<details><summary>Technical details</summary>
          {inventory.skills.map((row, index) => <p key={index}><strong>{row.name}</strong> · {row.origin}{skillInspectionNote(row) && <> — {skillInspectionNote(row)}</>}</p>)}
          {inventory.probes?.skills?.reason && <p>{inventory.probes.skills.reason}</p>}
        </details>}>
          <ul className="capability-rows" aria-label="Skill inventory">{skills.map((row, index) => <li key={`${row.name}:${row.origin}:${index}`}>
            <details className="capability-item">
              <summary><span className="capability-name">{row.name}</span><Badge tone={skillLabel(row, inventory.probes?.skills) === 'Found' ? 'success' : 'neutral'}>{skillLabel(row, inventory.probes?.skills)}</Badge></summary>
              <p className="capability-description">{row.summary || 'Reusable guidance OpenCode can load when it fits your task. It does not control tool access.'}</p>
            </details>
          </li>)}</ul>
          {!skills.length && <p>{inventory.probes?.skills?.state === 'unavailable'
            ? inventory.probes.skills.reason || 'Skill discovery is unavailable.' : 'No skills were returned by this inspection.'}</p>}
        </Panel>

      </>}
    </>
    <McpConnections onChanged={() => setRefresh(n => n + 1)} />
    <ModelDataSettings sources={modelData.sources} onChange={modelData.clearError}
      busy={modelData.pending || ["running", "cancelling"].includes(modelData.job?.status)} />
  </div>;
}
