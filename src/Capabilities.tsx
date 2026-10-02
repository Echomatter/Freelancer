import { useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { api } from './api';
import { Button, PageCloseButton, PageHeading, Panel } from './echoflex/Controls';
import { capabilityStatus } from '../domain/mcp.mjs';
import { McpConnections } from './McpConnections';
import './capabilities.css';

export function Capabilities({ data, sessionID, onClose }: {
  data: any; sessionID?: string; onClose: () => void;
}) {
  const project = data.project?.id;
  const [inventory, setInventory] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setInventory(null); setError(''); setLoading(false);
    if (!project) return;
    setLoading(true);
    // Current context supplies evidence, not an entitlement or an access selector.
    const query = new URLSearchParams({ project, ...(sessionID ? { session: sessionID } : {}) });
    api(`capabilities?${query}`, undefined, 'GET', controller.signal)
      .then(result => { if (!controller.signal.aborted) setInventory(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Capabilities are unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project, sessionID, refresh]);
  return <div className="capability-view">
    <PageHeading title="Capabilities" icon={Wrench} actions={<PageCloseButton onClick={onClose} />} />
    <p>All agents, models and projects share the same toolkit. Actual model support, connection health and explicit native permissions are reported here, not configured as access rules.</p>
    <McpConnections onChanged={() => setRefresh(n => n + 1)} />
    {!project ? <Panel><p>Open a project to inspect native tools and skills in its current runtime context.</p></Panel> : <>
      {loading && <p role="status">Checking capabilities…</p>}
      {error && <Panel><p className="notice error" role="alert">{error}</p><Button onClick={() => setRefresh(n => n + 1)}>Retry</Button></Panel>}
      {inventory && <>
        <Panel title="Tools"><p>Registration alone does not prove successful use. {inventory.context.model ? `Observed model: ${inventory.context.model}.` : 'No model-specific exposure was observed.'}</p>
          <div className="capability-table-scroll"><table className="capability-table">
            <thead><tr><th scope="col">Tool</th><th scope="col">Status</th></tr></thead>
            <tbody>{inventory.tools.map((row: any) => <tr key={row.id}><th scope="row">{row.id}</th>
              <td>{capabilityStatus(row)}{row.unavailableReason && <small>{row.unavailableReason}</small>}</td></tr>)}</tbody>
          </table></div>
        </Panel>
        <Panel title="Skills"><ul className="capability-list">{inventory.skills.map((row: any) => <li key={`${row.origin}:${row.name}`}>
          <strong>{row.name}</strong> — {row.discovered ? 'Discovered' : 'Not discovered'}
          {row.unavailableReason && <small>{row.unavailableReason}</small>}
        </li>)}</ul></Panel>
        {inventory.instructions && <details><summary>Instruction sources (read-only)</summary>
          <p>{inventory.instructions.composition} This source map is not a complete provider prompt.</p>
          <p>Request: {inventory.instructions.requestID || 'No captured request'}</p>
          <ul className="capability-list">{inventory.instructions.sources.map((row: any) => <li key={row.id}>
            <strong>{row.origin}</strong> — {row.state}<small>{row.note}</small>
          </li>)}</ul>
        </details>}
        <div className="save-row"><Button disabled={loading} onClick={() => setRefresh(n => n + 1)}>Refresh tools</Button></div>
      </>}
    </>}
  </div>;
}
