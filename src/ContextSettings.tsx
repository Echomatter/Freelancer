import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from './api';
import { Button, Panel } from './echoflex/Controls';
import './context-settings.css';

export function ContextSettings({ project }: { project: string }) {
  const [automatic, setAutomatic] = useState<boolean | null>(null), [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const [revision, reload] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setSaved(false); setAutomatic(null);
    api(`context-settings?project=${encodeURIComponent(project)}`).then(result => {
      if (typeof result.autoCompact !== 'boolean') throw Error('Restart Freelancer to load context settings.');
      if (current) setAutomatic(result.autoCompact);
    }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [project, revision]);
  async function save() {
    setSaving(true); setSaved(false); setError('');
    try {
      const result = await api('context-settings', { project, autoCompact: automatic }, 'PUT');
      if (result.saved !== true || result.autoCompact !== automatic) throw Error('OpenCode did not confirm this setting. Restart Freelancer and try again.');
      setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }
  return <Panel title="Context window" help="context-compaction" className="context-settings">
    {loading ? <p role="status">Loading context settings…</p> : automatic !== null && <label className="context-settings-toggle">
      <input type="checkbox" checked={automatic} disabled={saving} onChange={event => { setAutomatic(event.target.checked); setSaved(false); setError(''); }} />
      <span>Automatic compaction</span>
    </label>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="session-defaults-save">
      {automatic !== null && <Button type="button" disabled={saving || loading} onClick={() => void save()}>{saving ? 'Saving…' : 'Save context settings'}<Check size={16} /></Button>}
      {!loading && automatic === null && <Button type="button" onClick={() => reload(v => v + 1)}>Retry</Button>}
      <span role="status">{saved ? 'Saved for this project' : ''}</span>
    </div>
  </Panel>;
}
