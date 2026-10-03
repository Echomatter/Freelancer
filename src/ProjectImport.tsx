import { HelpHint } from "./HelpHint";
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, ArrowUp, Import } from 'lucide-react';
import { api } from './api';
import { Dialog } from './echoflex/Dialog';
import { Button, Field } from './echoflex/Controls';
import './project-import.css';

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

export function ProjectImport({ preview, sourceDirectory, selected, busy, submitting, error, onClose, onBack, onSelect, onChooseSource, onSourceChange, onPreviewSource, onComplete }: {
  preview: any; sourceDirectory: string; selected: string[]; busy: boolean; submitting: boolean; error: string;
  onClose: () => void; onBack: () => void; onSelect: (ids: string[]) => void; onChooseSource: () => void;
  onSourceChange: (directory: string) => void; onPreviewSource: () => void; onComplete: (selected: string[]) => void;
}) {
  const [approvedSource, setApprovedSource] = useState(false);
  const supported = preview.chats.filter((chat: any) => chat.supported);
  const sourceChanged = sourceDirectory.trim() !== preview.recordedDirectory;
  const movedSource = preview.recordedDirectory !== preview.directory;
  const selectedBytes = preview.chats.filter((chat: any) => selected.includes(chat.id)).reduce((sum: number, chat: any) => sum + chat.bytes, 0);
  const withinLimit = selected.length <= 500 && selectedBytes <= 128 * 1024 * 1024;
  const allWithinLimit = supported.length <= 500 && supported.reduce((sum: number, chat: any) => sum + chat.bytes, 0) <= 128 * 1024 * 1024;
  return <Dialog title="Import conversations" icon={<Import />}
    size="wide" onClose={onClose} busy={submitting} footer={preview.setupComplete ? <>
      <Button type="button" disabled={submitting} onClick={onClose}>Close</Button>
      <Button type="button" variant="primary" disabled={busy} onClick={() => onComplete([])}>Open project</Button>
    </> : <>
      <Button type="button" disabled={submitting} onClick={onBack}>Back</Button>
      <Button type="button" disabled={busy} onClick={() => onComplete([])}>Skip import</Button>
      <Button type="button" variant="primary" disabled={busy || sourceChanged || !selected.length || !withinLimit || (movedSource && !approvedSource)} onClick={() => onComplete(selected)}>Import {selected.length || 'selected'} and open project</Button></>}>
    <p>Project folder: <strong className="project-import-path">{preview.directory}</strong></p>
    {preview.setupComplete ? <div role="status">
      <strong>History import already completed</strong>
      <p>{preview.importedCount} conversation {preview.importedCount === 1 ? 'snapshot was' : 'snapshots were'} saved. Saved history remains available in this project's chats. Import will not run again.</p>
      {preview.completedAt && <p>Setup completed {new Date(preview.completedAt).toLocaleString()}.</p>}
    </div> : <>
    {preview.previouslySkipped && <p role="status">Import was skipped earlier. You can choose local history to copy now.</p>}
    <p>Choose the project folder recorded in your local Codex conversations. Only chats from that exact folder are listed. ChatGPT cloud chats cannot be copied here.</p>
    <Field label="Recorded conversation folder"><input value={sourceDirectory} disabled={busy} onChange={event => onSourceChange(event.target.value)} /></Field>
    <div className="action-row"><Button type="button" disabled={busy} onClick={onChooseSource}><FolderOpen size={15} />Choose source folder…</Button>
      <Button type="button" disabled={busy || !sourceDirectory.trim()} onClick={onPreviewSource}>{busy ? 'Reading local history…' : 'Preview conversations'}</Button></div>
    {!!preview.relatedDirectories?.length && <Field label="Other recorded folders for this project"><select value="" disabled={busy} onChange={event => { if (event.target.value) onSourceChange(event.target.value); }}>
      <option value="">Choose a former folder…</option>{preview.relatedDirectories.map((directory: string) => <option value={directory} key={directory}>{directory}</option>)}
    </select></Field>}
    <p>{preview.notice}</p>
    {sourceChanged && <p role="status">Preview this source folder before choosing conversations. The previous list is no longer selected.</p>}
    {!sourceChanged && movedSource && <label className="check project-import-approval"><input type="checkbox" disabled={busy} checked={approvedSource} onChange={event => setApprovedSource(event.target.checked)} />
      <span>Copy the selected snapshots from <strong className="project-import-path">{preview.recordedDirectory}</strong> into this project. Keep the originals unchanged.</span></label>}
    <div className="context-actions"><span>Optional import</span><HelpHint topic="project-import" /></div>
    {!sourceChanged && !!supported.length && <label className="check"><input type="checkbox" disabled={busy || !allWithinLimit} checked={selected.length === supported.length} onChange={event => onSelect(event.target.checked ? supported.map((chat: any) => chat.id) : [])} />Select all matching chats ({supported.length})</label>}
    {!sourceChanged && !allWithinLimit && <p>Select conversations individually; importing every matching chat would exceed the limit.</p>}
    {!sourceChanged && !preview.chats.length && <p>{preview.notice?.includes('different path')
      ? 'Choose that recorded source folder above to review an explicit copy into this project.'
      : preview.notice?.includes('catalog could not be read') || preview.notice?.includes('Close Codex')
      ? 'The local conversation catalog could not be read yet. Close Codex and retry, or skip import.'
      : 'No matching local conversations were found for this exact folder. Chats are listed only when their saved working folder matches this project.'}</p>}
    {!sourceChanged && <div className="project-import-list">{preview.chats.map((chat: any) => <label className="check" key={chat.id}>
      <input type="checkbox" disabled={busy || !chat.supported} checked={selected.includes(chat.id)} onChange={event => onSelect(event.target.checked ? [...selected, chat.id] : selected.filter(id => id !== chat.id))} />
      <span><strong>{chat.title || 'Untitled chat'}</strong><small>{chat.updatedAt > 0 ? new Date(chat.updatedAt).toLocaleDateString() : 'Date unavailable'}{chat.archived ? ' · Archived in Codex' : ''}{!chat.supported ? ' · Too large for import (64 MB limit)' : ''}</small></span>
    </label>)}</div>
    }
    {!sourceChanged && <p>{selected.length} selected · {Math.ceil(selectedBytes / 1024 / 1024)} MB. Limit: 500 conversations and 128 MB.</p>}
    {!withinLimit && <p role="alert" className="notice error">Select fewer conversations to stay within the import limit.</p>}
    </>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </Dialog>;
}
