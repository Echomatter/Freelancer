import { useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Panel } from './echoflex/Controls';
import './remote-access.css';

const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);
const pairToken = new URLSearchParams(window.location.hash.slice(1)).get('pair') || '';
if (pairToken) window.history.replaceState(null, document.title, window.location.pathname + window.location.search);

export function RemoteGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(loopback), [loading, setLoading] = useState(!loopback && !pairToken);
  const [name, setName] = useState('My device'), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (loopback || pairToken) return;
    let active = true;
    fetch('/api/access/session', { headers: { 'X-Freelancer-Client': 'webpage' } })
      .then(response => { if (active) setReady(response.ok); })
      .catch(() => { if (active) setError('Could not reach Freelancer. Check that your computer is running.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  if (ready) return children;
  return <main className="remote-gate"><Panel title={pairToken ? 'Remember this device' : 'Connect to Freelancer'}>
    {loading ? <p role="status">Checking device…</p> : pairToken ? <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('');
      try {
        const response = await fetch('/api/access/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Freelancer-Client': 'webpage' }, body: JSON.stringify({ token: pairToken, name }) });
        const value = await response.json();
        if (!response.ok) throw Error(value.error);
        setReady(true);
      } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    }}>
      <p>Connect this browser to your computer. It will stay remembered across server restarts.</p>
      <Field label="Device name"><input required maxLength={80} autoComplete="off" value={name} onChange={e => setName(e.target.value)} /></Field>
      <p className="muted">Use your own device on trusted Wi-Fi. This HTTP connection is not encrypted.</p>
      <Button variant="primary" disabled={busy}>{busy ? 'Connecting…' : 'Remember this device'}</Button>
    </form> : <p>On your computer, open Application settings → Remote access and scan a new QR code to remember this browser.</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </Panel></main>;
}
