import { Fragment, useLayoutEffect, useRef } from 'react';

type Session = { id: string; title?: string; parentID?: string };
type Crumb = { key: string; label: string; accessibleLabel?: string; onClick: () => void };

export function WorkspaceBreadcrumb({ directory, projectName, currentLabel, session, sessions = [], filePath = '', onDirectory, onSession }: {
  directory?: string; projectName?: string; currentLabel: string; session?: Session; sessions?: Session[]; filePath?: string;
  onDirectory: (path: string) => void; onSession: (id: string) => void;
}) {
  const trail = useRef<HTMLDivElement>(null);
  const ancestors: Crumb[] = [];
  const catalog = new Map(sessions.map(row => [row.id, row]));
  const seen = new Set([session?.id]);
  let parentID = session?.parentID;
  while (parentID && !seen.has(parentID) && ancestors.length < 32) {
    seen.add(parentID);
    const id = parentID, parent = catalog.get(id), label = parent?.title || 'Parent chat';
    ancestors.unshift({ key: id, label, accessibleLabel: id === session?.parentID ? 'Back to parent chat' : `Open ancestor chat: ${label}`, onClick: () => onSession(id) });
    parentID = parent?.parentID;
  }
  const folders = filePath.replaceAll('\\', '/').split('/').filter(Boolean);
  folders.slice(0, -1).forEach((label, index) => {
    const path = folders.slice(0, index + 1).join('/');
    ancestors.push({ key: path, label, onClick: () => onDirectory(path) });
  });
  const location = folders.at(-1) || currentLabel;
  const identity = `${directory}:${session?.id ?? ''}:${filePath}:${ancestors.map(crumb => crumb.key).join('/')}`;
  useLayoutEffect(() => {
    // Keep the nearest parent within reach in long desktop trails. On phones,
    // show just the folder and immediate parent above the current location.
    const node = trail.current;
    if (!node) return;
    const revealParent = () => { node.scrollLeft = node.scrollWidth; };
    revealParent();
    const observer = new ResizeObserver(revealParent);
    observer.observe(node);
    return () => observer.disconnect();
  }, [identity]);
  return <nav className="workspace-breadcrumb" aria-label="Breadcrumb">
    <div className={`breadcrumb-ancestors${ancestors.length ? ' has-parents' : ''}`}>
      {directory ? <button type="button" className="directory-root" aria-label={`Open project directory ${directory}`} title={directory} onClick={() => onDirectory('')}>{directory}</button>
        : <span className="directory-root">{projectName || 'Your workspace'}</span>}
      {!!ancestors.length && <span className="breadcrumb-separator" aria-hidden="true">/</span>}
      <div className="breadcrumb-parents" ref={trail}>{ancestors.map((crumb, index) => <Fragment key={crumb.key}>
        {index > 0 && <span className="breadcrumb-separator" aria-hidden="true">/</span>}
        <button type="button" title={crumb.label} aria-label={crumb.accessibleLabel} onClick={crumb.onClick}>{crumb.label}</button>
      </Fragment>)}</div>
    </div>
    <span className="breadcrumb-separator breadcrumb-current-separator" aria-hidden="true">/</span>
    <strong aria-current="page" title={location}>{location}</strong>
  </nav>;
}
