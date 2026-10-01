import { useEffect, useState } from 'react';
import { Check, Wrench } from 'lucide-react';
import { api } from './api';
import { Button, PageCloseButton, PageHeading, Panel } from './echoflex/Controls';
import './capabilities.css';

const available = (value: boolean | null) => value === null ? 'Unknown' : value ? 'Available' : 'Not available';

// Platform-wide overview. Nothing here needs setup; the only control is the
// optional language-server opt-in.
export function Capabilities({ data, sessionID, onClose, onSaveLsp }: {
  data: any; sessionID?: string; onClose: () => void; onSaveLsp: (enabled: boolean) => Promise<void>;
}) {
  const project = data.project?.id;
  const value = data.settings.nativeLspToolEnabled;
  const hasSaved = typeof value === 'boolean';
  const [inventory, setInventory] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [lsp, setLsp] = useState(value === true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => { setLsp(value === true); }, [value]);
  useEffect(() => {
    const controller = new AbortController();
    setInventory(null); setError('');
    if (!project) return;
    setLoading(true);
    const query = new URLSearchParams({ project, agent: 'engineer', ...(sessionID ? { session: sessionID } : {}) });
    api(`capabilities?${query}`, undefined, 'GET', controller.signal)
      .then(result => { if (!controller.signal.aborted) setInventory(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Capabilities are unavailable.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project, sessionID, refresh]);
  const save = async () => {
    setSaving(true); setSaved(false); setSaveError('');
    try { await onSaveLsp(lsp); setSaved(true); }
    catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Could not save this choice.'); }
    finally { setSaving(false); }
  };
  const tools: any[] = inventory?.tools.filter((row: any) => row.discovered === true || row.origin !== 'OpenCode custom/plugin/MCP') ?? [];
  return <div className="capability-view">
    <PageHeading title="Capabilities" icon={Wrench} actions={<PageCloseButton onClick={onClose} />} />
    <p>Tools and skills belong to the platform and are shared by every agent. There is nothing to set up. Models that cannot use tools simply do not call them.</p>
    {!project ? <Panel><p>Open a project to see what this runtime provides.</p></Panel> : <>
      {loading && <p role="status">Checking capabilities…</p>}
      {error && <Panel><p className="notice error" role="alert">{error}</p><Button onClick={() => setRefresh(n => n + 1)}>Retry</Button></Panel>}
      {inventory && <>
        <Panel title="Tools"><div className="capability-table-scroll"><table className="capability-table">
          <thead><tr><th scope="col">Tool</th><th scope="col">Status</th></tr></thead>
          <tbody>{tools.map(row => <tr key={row.id}><th scope="row">{row.id}</th>
            <td>{available(row.discovered)}{row.discovered !== true && row.unavailableReason && <small>{row.unavailableReason}</small>}</td></tr>)}</tbody>
        </table></div></Panel>
        <Panel title="Skills"><p>{inventory.skills.filter((row: any) => row.discovered).map((row: any) => row.name).join(', ') || 'No skills found.'}</p></Panel>
        {inventory.mcp.length > 0 && <Panel title="Connected services (MCP)"><ul className="capability-list">
          {inventory.mcp.map((row: any) => <li key={row.name}><strong>{row.name}</strong> — {row.status}{row.unavailableReason && <small>{row.unavailableReason}</small>}</li>)}
        </ul></Panel>}
        <div className="save-row"><Button disabled={loading} onClick={() => setRefresh(n => n + 1)}>Refresh</Button></div>
      </>}
    </>}
    <Panel title="Language-server tool (advanced)">
      <p>Optional. Saving changes OpenCode's startup flag; quit and restart Freelancer to apply it. It does not install a language server.</p>
      <label className="capability-toggle">
        <input type="checkbox" checked={lsp} disabled={saving}
          onChange={event => { setLsp(event.target.checked); setSaved(false); setSaveError(''); }} />
        <span><strong>Enable native LSP tool</strong></span>
      </label>
      {saveError && <p className="notice error" role="alert">{saveError}</p>}
      {saved && <p role="status">Saved. Restart Freelancer to apply the native LSP tool setting.</p>}
      <Button variant="primary" disabled={saving || (hasSaved && value === lsp)} onClick={() => void save()}>
        <Check size={16} />{saving ? 'Saving…' : saveError ? 'Retry save' : 'Save native tool choice'}
      </Button>
    </Panel>
  </div>;
}
