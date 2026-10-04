import { useEffect, useState } from 'react';
import { Globe2, QrCode, Smartphone, Wifi } from 'lucide-react';
import { api } from './api';
import { copyText } from './browser-capabilities.mjs';
import { Button, Field, PageCloseButton, PageHeading, Panel } from './echoflex/Controls';
import './remote-access.css';

export function RemoteAccess({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any>(null), [draft, setDraft] = useState<any>(null), [webDraft, setWebDraft] = useState<any>(null);
  const [pairing, setPairing] = useState<any>(null), [transport, setTransport] = useState('lan'), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [clock, setClock] = useState(Date.now());
  const apply = (value: any) => {
    setData(value);
    setDraft({ enabled: value.enabled, host: value.host || value.addresses[0] || '', port: value.port, trustDays: value.trustDays });
    setWebDraft({ enabled: value.webEnabled, port: value.webPort });
  };
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
  const transports = [
    ...(data?.active ? [{ id: 'lan', label: 'Private network' }] : []),
    ...(data?.webActive ? [{ id: 'web', label: 'Internet · HTTPS' }] : []),
  ];
  const selectedTransport = transports.some(item => item.id === transport) ? transport : transports[0]?.id ?? 'lan';
  return <div className="remote-access">
    <PageHeading title="Remote access" icon={Smartphone} help="remote-access" actions={<PageCloseButton onClick={onClose} />} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading remote access…</p>}
    {data && draft && webDraft && <>
      <Panel title="Private network">
        <form onSubmit={event => { event.preventDefault(); void run(async () => {
          apply(await api('remote-access', draft, 'PUT')); setPairing(null); setNotice(draft.enabled ? 'Remote access saved.' : 'Private-network access is off. Remembered devices are retained.');
        }); }}>
          <label className="remote-toggle"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />Enable private-network access</label>
          <div className="remote-fields">
            <Field label="Network address" help="remote-address"><select value={draft.host} onChange={e => setDraft({ ...draft, host: e.target.value })}>
              {!data.addresses.length && <option value="">No private network available</option>}
              {draft.host && !data.addresses.includes(draft.host) && <option value={draft.host}>{draft.host} (unavailable)</option>}
              {data.addresses.map((address: string) => <option key={address}>{address}</option>)}
            </select></Field>
            <Field label="Port"><input type="number" required min={1024} max={65535} value={draft.port} onChange={e => setDraft({ ...draft, port: Number(e.target.value) })} /></Field>
            <Field label="Remember new devices for"><select value={draft.trustDays} onChange={e => setDraft({ ...draft, trustDays: Number(e.target.value) })}>
              <option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option>
            </select></Field>
          </div>
          <Button variant="primary" disabled={busy || (draft.enabled && !draft.host)}>Save connection</Button>
        </form>
        {data.error && <p className="notice error" role="alert">{data.error}</p>}
        <div className="remote-status"><Wifi size={17} /><strong>{data.active ? 'Available on your network' : 'Private-network access is off'}</strong></div>
        {data.active && <div className="remote-url"><code>{data.url}</code><Button disabled={busy} onClick={() => void run(async () => { await copyText(data.url); setNotice('Address copied.'); })}>Copy address</Button></div>}
        <p className="notice">Unencrypted HTTP · Use a trusted private network.</p>
      </Panel>

      <Panel title="Internet access" help="remote-web">
        {!data.funnelAvailable && <p className="notice" role="status">Tailscale CLI is unavailable. <a href="https://tailscale.com/download/windows" target="_blank" rel="noreferrer">Install Tailscale for Windows</a>, sign in, and enable Funnel in your tailnet first.</p>}
        <form onSubmit={event => { event.preventDefault(); void run(async () => {
          const value = await api('remote-access/web', webDraft, 'PUT');
          setData(value); setWebDraft({ enabled: value.webEnabled, port: value.webPort }); setPairing(null);
          setNotice(value.webActive ? 'Secure web access is active.' : value.webEnabled ? 'Web access is enabled locally; check the Tailscale status.' : 'Web access is off.');
        }); }}>
          <label className="remote-toggle"><input type="checkbox" checked={webDraft.enabled} onChange={e => setWebDraft({ ...webDraft, enabled: e.target.checked })} />Enable internet access</label>
          <div className="remote-fields web-fields">
            <Field label="HTTPS port"><select value={webDraft.port} onChange={e => setWebDraft({ ...webDraft, port: Number(e.target.value) })}>
              {data.funnelPorts.map((port: number) => <option key={port} value={port}>{port}</option>)}
            </select></Field>
          </div>
          <Button variant="primary" disabled={busy || (webDraft.enabled && !data.funnelAvailable)}>Save web access</Button>
        </form>
        {data.webError && <p className="notice error" role="alert">{data.webError}</p>}
        <div className="remote-status"><Globe2 size={17} /><strong>{data.webActive ? 'Available over HTTPS' : data.webEnabled ? 'Web access is not connected' : 'Internet access is off'}</strong></div>
        {data.webActive && <div className="remote-url"><code>{data.webUrl}</code><Button disabled={busy} onClick={() => void run(async () => { await copyText(data.webUrl); setNotice('Web address copied.'); })}>Copy web address</Button></div>}
      </Panel>

      <Panel title="Pair a device" help="remote-pairing">
        {transports.length > 1 && <div className="remote-pair-choice"><Field label="Connect through"><select value={selectedTransport} onChange={event => { setTransport(event.target.value); setPairing(null); }}>
          {transports.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></Field></div>}
        <Button disabled={busy || !transports.length} onClick={() => void run(async () => { setTransport(selectedTransport); setPairing(await api('remote-access/pairing', { transport: selectedTransport })); setClock(Date.now()); })}><QrCode size={17} />{pairing ? 'Generate new QR code' : 'Show QR code'}</Button>
        {pairing && <div className="remote-pairing">
          {paired ? <p role="status">Device remembered. Generate a new code to pair another.</p> : expired ? <p role="status">QR code expired. Generate a new code to continue.</p> : <>
            <img src={`data:image/png;base64,${pairing.qr}`} width={240} height={240} alt="Scan to pair this device with Freelancer" />
            <div><p>One-time code · Expires at {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
              <Button disabled={busy} onClick={() => void run(async () => { await copyText(pairing.url); setNotice('One-time pairing link copied.'); })}>Copy pairing link</Button>
              <Button disabled={busy} onClick={() => void run(async () => { await api('remote-access/pairing', {}, 'DELETE'); setPairing(null); })}>Cancel pairing</Button>
            </div>
          </>}
        </div>}
      </Panel>
      <Panel title="Remembered devices" help="remote-devices">
        {!data.devices.length && <p>No devices remembered yet.</p>}
        {data.devices.map((device: any) => <div className="remote-device" key={device.id}>
          <Smartphone size={20} /><div><strong>{device.name}</strong><small>Remembered until {new Date(device.expiresAt).toLocaleDateString()}</small></div>
          <Button disabled={busy} aria-label={`Remove ${device.name}`} onClick={() => void run(async () => { apply(await api('remote-access/devices', { id: device.id }, 'DELETE')); setNotice(`${device.name} removed.`); })}>Remove</Button>
        </div>)}
      </Panel>
    </>}
  </div>;
}
