import { useEffect, useRef, useState } from 'react';
import { FolderOpen, ArrowUp, Import } from 'lucide-react';
import { api } from './api';
import { Dialog } from './echoflex/Dialog';
import { Button, Field } from './echoflex/Controls';
import './project-import.css';

export function FolderPicker({ initial, onPick, onClose }: { initial: string; onPick: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<any>(null), [directory, setDirectory] = useState(initial), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const version = useRef(0);
  async function browse(value: string) {
    const current = ++version.current; setBusy(true); setError('');
    try { const next = await api('projects/folders?' + new URLSearchParams({ directory: value }));
      if (current === version.current) { setListing(next); setDirectory(next.directory); }
    } catch (error) { if (current === version.current) setError((error as Error).message); }
    finally { if (current === version.current) setBusy(false); }
  }
  useEffect(() => { void browse(initial); return () => { version.current++; }; }, []);
  return <Dialog title="Choose project folder" icon={<FolderOpen />} onClose={onClose} initialFocus="first"
    onSubmit={event => { event.preventDefault(); void browse(directory); }}
    footer={<><Button type="button" onClick={onClose}>Cancel</Button>
      <Button type="button" variant="primary" disabled={busy || !listing || !!error} onClick={() => onPick(listing.directory)}>Use this folder</Button></>}>
    <Field label="Folder path"><input value={directory} onChange={event => setDirectory(event.target.value)} /></Field>
    <div className="action-row"><Button type="submit" disabled={busy}>Go to folder</Button>
      <Button type="button" disabled={busy || !listing} onClick={() => void browse(listing.parent)}><ArrowUp size={15} />Up</Button>
      <Button type="button" disabled={busy} onClick={() => void browse('')}>Home</Button>
      {listing?.roots.map((root: string) => <Button type="button" key={root} disabled={busy} onClick={() => void browse(root)}>{root}</Button>)}</div>
    {error && <p role="alert" className="notice error">{error}</p>}
    <p role="status">{busy ? 'Reading folders…' : listing?.directory}</p>
    <div className="project-folder-list">{listing?.folders.map((folder: any) => <button type="button" key={folder.path} disabled={busy} onClick={() => void browse(folder.path)}><FolderOpen size={16} />{folder.name}</button>)}</div>
    {listing && !listing.folders.length && <p>No subfolders. You can use this folder.</p>}
    {listing?.truncated && <p>The first 1,000 folders are shown. Enter a path to go directly to another folder.</p>}
  </Dialog>;
}

export function ProjectImport({ preview, busy, error, onClose, onComplete }: { preview: any; busy: boolean; error: string;
  onClose: () => void; onComplete: (selected: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const supported = preview.chats.filter((chat: any) => chat.supported);
  return <Dialog title="Bring your chats along?" icon={<Import />} description="Optional · before building the project indexes"
    size="wide" onClose={onClose} busy={busy} footer={<>
      <Button type="button" disabled={busy} onClick={() => onComplete([])}>Skip import</Button>
      <Button type="button" variant="primary" disabled={busy || !selected.length} onClick={() => onComplete(selected)}>Import {selected.length || 'selected'} and open project</Button></>}>
    <strong>{preview.detected ? 'ChatGPT / Codex detected' : 'ChatGPT / Codex not detected'}</strong>
    <p>{preview.notice}</p><p className="project-import-path">{preview.directory}</p>
    <p>Saved messages open in the same chat layout. Continuing a chat uses its history to orient a new Freelancer conversation. The original app and its database stay unchanged.</p>
    {!!supported.length && <label className="check"><input type="checkbox" disabled={busy} checked={selected.length === supported.length} onChange={event => setSelected(event.target.checked ? supported.map((chat: any) => chat.id) : [])} />Select all matching chats ({supported.length})</label>}
    {!preview.chats.length && <p>No matching local conversations were found for this exact folder.</p>}
    <div className="project-import-list">{preview.chats.map((chat: any) => <label className="check" key={chat.id}>
      <input type="checkbox" disabled={busy || !chat.supported} checked={selected.includes(chat.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, chat.id] : previous.filter(id => id !== chat.id))} />
      <span><strong>{chat.title || 'Untitled chat'}</strong><small>{new Date(chat.updatedAt).toLocaleDateString()}{chat.archived ? ' · Archived in Codex' : ''}{!chat.supported ? ' · Too large for import (64 MB limit)' : ''}</small></span>
    </label>)}</div>
    <p>Local user/assistant messages and recorded tool output are copied once. Credentials, hidden reasoning, system instructions and external attachment files are excluded.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
  </Dialog>;
}
