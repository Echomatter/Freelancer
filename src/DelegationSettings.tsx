import { useEffect, useRef, useState } from 'react';
import { Button, Panel, Field } from './echoflex/Controls';
import { api, query } from './api';

// Edit the existing revision-checked preference authority, not a second store.
// Hidden model/context restrictions survive unless the user explicitly clears one.
export function DelegationSettings({ project, sessionID = '', refresh }: {
  project: string; sessionID?: string; refresh: () => Promise<void>;
}) {
  const [scope, setScope] = useState('project');
  const [loaded, setLoaded] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const session = scope === 'session' ? sessionID : '';
  useEffect(() => {
    const serial = ++generation.current;
    const controller = new AbortController();
    setLoaded(null); setDraft(null); setError(''); setSaved(false); setSaving(false);
    if (project && (scope !== 'session' || sessionID)) {
      api('preferences?' + query(project, session), undefined, 'GET', controller.signal)
        .then(value => { if (serial === generation.current) { setLoaded(value); setDraft(value.defaults); } })
        .catch(e => { if (!controller.signal.aborted && serial === generation.current) setError(e.message); });
    }
    return () => { ++generation.current; controller.abort(); };
  }, [project, session, scope, sessionID, reload]);
  const change = (patch: any) => { setDraft((p: any) => ({ ...p, ...patch })); setSaved(false); setError(''); };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || saving) return;
    const serial = generation.current;
    setSaving(true); setError(''); setSaved(false);
    try {
      const result = await api('preferences', {
        project, scope, ...(session ? { sessionID: session } : {}),
        revision: loaded.revision, preferences: draft,
      }, 'PUT');
      if (serial !== generation.current) return;
      setLoaded(result); setDraft(result.defaults); setSaved(true);
      await refresh();
    } catch (e) {
      if (serial === generation.current) setError(e instanceof Error ? e.message : 'Could not save delegation settings.');
    } finally { if (serial === generation.current) setSaving(false); }
  }
  if (!project) return <Panel><h3>Choose a project</h3><p>Open a project to set its delegation budget.</p></Panel>;
  const subscription = draft?.costPreference === 'free-only' ? 'never' : 'automatic';
  return <Panel title="Delegation budget" className="delegation-settings">
    <p>The main agent decides whether to work directly or assemble a team. These settings limit resources and consequences, not which expertise it may ask for.</p>
    <Field label="Apply to"><select value={scope} disabled={saving} onChange={e => setScope(e.target.value)}>
      <option value="project">This project</option><option value="session" disabled={!sessionID}>Selected chat</option>
    </select></Field>
    {scope === 'project' && <p>Project defaults apply to chats without their own override. A chat with saved limits keeps them; select that chat to edit its budget.</p>}
    {error && <p role="alert">{error} Your unsaved choices have not been discarded.</p>}
    {!draft ? <><p role="status">{error ? 'Settings could not be loaded.' : 'Loading delegation settings…'}</p>
      {error && <Button onClick={() => setReload(n => n + 1)}>Retry loading</Button>}</> : <form onSubmit={save}>
      <fieldset disabled={saving} className="delegation-fields">
        <div className="field-grid">
          <Field label="Delegation"><select value={draft.delegation === "ask" ? "automatic" : draft.delegation} onChange={e => change({ delegation: e.target.value })}>
            <option value="automatic">Agent decides</option><option value="manual">Work directly — no delegated agents</option>
          </select></Field>
          <Field label="Subscription capacity"><select value={subscription} onChange={e => change({
            costPreference: e.target.value === 'never' ? 'free-only' : draft.costPreference === 'free-only' ? 'prefer-free' : draft.costPreference,
            subscriptionDelegation: e.target.value === 'automatic' ? 'automatic' : 'ask',
          })}>
            <option value="never">Free models only</option><option value="automatic">Allow with native consent</option>
          </select></Field>
          <Field label="Simultaneous delegated agents"><input type="number" min="1" max="6" step="1" required value={draft.maxParallel}
            onChange={e => change({ maxParallel: Number(e.target.value) })} /></Field>
          <Field label="Maximum delegation depth"><input type="number" min="1" max="6" step="1" required value={draft.maxDepth ?? 2}
            onChange={e => change({ maxDepth: Number(e.target.value) })} /></Field>
          <Field label="Free-model preference"><select value={draft.costPreference === 'free-only' ? 'prefer-free' : draft.costPreference} disabled={subscription === 'never'} onChange={e => change({ costPreference: e.target.value })}>
            <option value="prefer-free">Prefer eligible free workers</option><option value="any">Prioritize capability within my budget</option><option value="balanced">Balance capability and capacity</option>
          </select></Field>
        </div>
        <p>OpenCode asks for paid-delegation permission when required and honors your saved native decisions. Separately metered API delegation is unavailable. The parallel limit is a ceiling, not a team-size target.</p>
        <details><summary>Existing advanced limits</summary>
          <p>Allowed models: {draft.allowedModels.length ? draft.allowedModels.join(', ') : 'All eligible connected models'}.</p>
          {!!draft.allowedModels.length && <Button type="button" onClick={() => change({ allowedModels: [] })}>Clear model allowlist</Button>}
          <p>Excluded models: {draft.excludedModels.join(', ') || 'None'}. Excluded providers: {draft.excludedProviders.join(', ') || 'None'}.</p>
          {!!(draft.excludedModels.length || draft.excludedProviders.length) && <Button type="button" onClick={() => change({ excludedModels: [], excludedProviders: [] })}>Clear model and provider exclusions</Button>}
          <p>Context policy: {draft.contextPolicy}. Child timeout: {draft.childTimeoutSeconds} seconds. These existing limits remain unchanged. Agent and workflow choices do not narrow the eligible model pool.</p>
        </details>
        <p>Saved changes govern the next main request. Active assignments keep their captured budget; tighter limits can block later dispatches, but never silently cancel work already running. Native permissions and project agreements cannot be overridden here.</p>
        <div className="action-row"><Button type="submit" variant="primary">{saving ? 'Saving…' : 'Save delegation budget'}</Button>
          {error && <Button type="button" onClick={() => setReload(n => n + 1)}>Discard edits and reload saved settings</Button>}</div>
        {saved && <p role="status">Delegation budget saved.</p>}
      </fieldset>
    </form>}
  </Panel>;
}
