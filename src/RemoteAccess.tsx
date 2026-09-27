import { useEffect, useState } from 'react';
import { QrCode, Smartphone, Wifi } from 'lucide-react';
import { api } from './api';
import { copyText } from './browser-capabilities.mjs';
import { Button, Field, PageCloseButton, PageHeading, Panel } from './echoflex/Controls';
import './remote-access.css';

export function RemoteAccess({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any>(null), [draft, setDraft] = useState<any>(null);
  const [pairing, setPairing] = useState<any>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [clock, setClock] = useState(Date.now());
  const apply = (value: any) => { setData(value); setDraft({ enabled: value.enabled, host: value.host || value.addresses[0] || '', port: value.port, trustDays: value.trustDays }); };
  useEffect(() => {
    let active = true;
    api('remote-access').then(value => { if (active) apply(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => {
      setClock(Date.now());
      api('remote-access').then(setData).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pairing]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const paired = pairing && data?.devices.some(d => d.createdAt >= pairing.expiresAt - 300000);
  const expired = pairing && clock >= pairing.expiresAt;
  return <div className="remote-access">
    <PageHeading title="Remote access" actions={<PageCloseButton onClick={onClose} />} />
    <p>Use Freelancer from another device on your private network. Keep this computer running.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading remote access…</p>}
    {data && draft && <>
      <Panel title="Connection">
        <form onSubmit={event => { event.preventDefault(); void run(async () => {
          apply(await api('remote-access', draft, 'PUT')); setPairing(null); setNotice(draft.enabled ? 'Remote access saved.' : 'Remote access is off. Remembered devices are retained.');
        }); }}>
          <label className="remote-toggle"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Enable remote access</label>
          <p className="muted">This choice is remembered when the server restarts.</p>
          <div className="remote-fields">
            <Field label="Network address"><select value={draft.host} onChange={e => setDraft({ ...draft, host: e.target.value })}>
              {!data.addresses.length && <option value="">No private network available</option>}
              {draft.host && !data.addresses.includes(draft.host) && <option value={draft.host}>{draft.host} (unavailable)</option>}
              {data.addresses.map(address => <option key={address}>{address}</option>)}
            </select></Field>
            <Field label="Port"><input type="number" required min={1024} max={65535} value={draft.port} onChange={e => setDraft({ ...draft, port: Number(e.target.value) })} /></Field>
            <Field label="Remember new devices for"><select value={draft.trustDays} onChange={e => setDraft({ ...draft, trustDays: Number(e.target.value) })}>
              <option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option>
            </select></Field>
          </div>
          <p className="muted">The port stays fixed. To keep the network address fixed too, reserve this computer’s IP address in your router.</p>
          <Button variant="primary" disabled={busy || (draft.enabled && !draft.host)}>Save connection</Button>
        </form>
        {data.error && <p className="notice error" role="alert">{data.error}</p>}
        <div className="remote-status"><Wifi size={17} /><strong>{data.active ? 'Available on your network' : 'Remote access is off'}</strong></div>
        {data.active && <div className="remote-url"><code>{data.url}</code><Button disabled={busy} onClick={() => void run(async () => { await copyText(data.url); setNotice('Address copied.'); })}>Copy address</Button></div>}
        <p className="notice">Private Wi-Fi or LAN only. This connection uses HTTP and is not encrypted. Paired devices can use your app; only this computer can manage remote access.</p>
      </Panel>
      <Panel title="Pair a device">
        <p>Scan a one-time QR code, name your device, then choose Remember this device. You can reopen the saved address after restarting Freelancer.</p>
        <Button disabled={busy || !data.active} onClick={() => void run(async () => { setPairing(await api('remote-access/pairing', {})); setClock(Date.now()); })}><QrCode size={17} />{pairing ? 'Generate new QR code' : 'Show QR code'}</Button>
        {pairing && <div className="remote-pairing">
          {paired ? <p role="status">Device remembered. Generate a new code to pair another.</p> : expired ? <p role="status">QR code expired. Generate a new code to continue.</p> : <>
            <img src={`data:image/png;base64,${pairing.qr}`} width={240} height={240} alt="Scan to pair this device with Freelancer" />
            <div><p>Use your camera on the same Wi-Fi. This code works once and expires at {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
              <Button disabled={busy} onClick={() => void run(async () => { await copyText(pairing.url); setNotice('One-time pairing link copied.'); })}>Copy pairing link</Button>
              <Button disabled={busy} onClick={() => void run(async () => { await api('remote-access/pairing', {}, 'DELETE'); setPairing(null); })}>Cancel pairing</Button>
            </div>
          </>}
        </div>}
      </Panel>
      <Panel title="Remembered devices">
        <p className="muted">Each browser has its own credential. Removing a device disconnects it immediately and requires a new QR code.</p>
        {!data.devices.length && <p>No devices remembered yet.</p>}
        {data.devices.map(device => <div className="remote-device" key={device.id}>
          <Smartphone size={20} /><div><strong>{device.name}</strong><small>Remembered until {new Date(device.expiresAt).toLocaleDateString()}</small></div>
          <Button disabled={busy} aria-label={`Remove ${device.name}`} onClick={() => void run(async () => { apply(await api('remote-access/devices', { id: device.id }, 'DELETE')); setNotice(`${device.name} removed.`); })}>Remove</Button>
        </div>)}
      </Panel>
    </>}
  </div>;
}
