import { useEffect, useRef, useState } from 'react';
import { FolderOpen, ArrowUp } from 'lucide-react';
import { api } from './api';
import { Dialog } from './echoflex/Dialog';
import { Button, Field } from './echoflex/Controls';
import './project-folders.css';

export function FolderPicker({ initial, onPick, onClose, title = 'Choose project folder' }: { initial: string; onPick: (path: string) => void; onClose: () => void; title?: string }) {
  const [listing, setListing] = useState<any>(null), [directory, setDirectory] = useState(initial), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const version = useRef(0);
  const pathEdits = useRef(0);
  async function browse(value: string) {
    const current = ++version.current, capturedEdits = pathEdits.current; setBusy(true); setError('');
    try { const next = await api('projects/folders?' + new URLSearchParams({ directory: value }));
      if (current === version.current) {
        setListing(next);
        // A slow listing (including the initial Home read) must not overwrite
        // a path the user has typed while that request was in flight.
        if (capturedEdits === pathEdits.current) setDirectory(next.directory);
      }
    } catch (error) { if (current === version.current) setError((error as Error).message); }
    finally { if (current === version.current) setBusy(false); }
  }
  useEffect(() => { void browse(initial); return () => { version.current++; }; }, []);
  return <Dialog title={title} icon={<FolderOpen />} onClose={onClose} initialFocus="first"
    onSubmit={event => { event.preventDefault(); void browse(directory); }}
    footer={<><Button type="button" onClick={onClose}>Cancel</Button>
      <Button type="button" variant="primary" disabled={busy || !listing || !!error || directory !== listing.directory} onClick={() => onPick(listing.directory)}>Use this folder</Button></>}>
    <Field label="Folder path"><input value={directory} onChange={event => { pathEdits.current++; setDirectory(event.target.value); }} /></Field>
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
