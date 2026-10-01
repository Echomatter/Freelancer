import { useEffect, useRef, useState } from "react";
import { Archive, Check, ChevronDown, Download, FolderKanban, FolderPlus, Pin, Plus, MessageSquareText, Settings, WandSparkles } from "lucide-react";
import { SessionActivity } from "./SessionActivity";
import "./navigation-menus.css";

export function useNavigationDismiss(expanded: boolean, onDismiss: () => void) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      const compact = window.matchMedia('(max-width: 720px)').matches || root.current?.closest('.navigation-collapsed');
      if (compact && !root.current?.contains(event.target as Node)) onDismiss();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open], [role="dialog"]')) return;
      const compact = window.matchMedia('(max-width: 720px)').matches || root.current?.closest('.navigation-collapsed');
      if (!compact && !root.current?.contains(event.target as Node)) return;
      event.preventDefault();
      root.current?.querySelector<HTMLButtonElement>('.nav-card-trigger[aria-expanded="true"]')?.focus();
      onDismiss();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown); };
  }, [expanded, onDismiss]);
  return root;
}

export function ProjectNavigation({ projects, selected, disabled, expanded, onToggle, onDismiss, onSelect, onAdd, onManage }: {
  projects: any[]; selected: string; disabled?: boolean;
  expanded: boolean; onToggle: () => void; onDismiss: () => void;
  onSelect: (project: any) => void; onAdd: () => void; onManage: (project: any) => void;
}) {
  const root = useNavigationDismiss(expanded, onDismiss);
  const current = projects.find((p) => p.id === selected);
  return <section ref={root} className="nav-accordion project-navigation">
    <button type="button" className="nav-card-trigger nav-accordion-trigger" title={expanded ? "Projects" : current?.name ?? "Projects"} aria-label={expanded ? "Projects" : current?.name ?? "Projects"} aria-expanded={expanded} aria-controls="project-navigation-links" onClick={onToggle}>
      <FolderKanban className="nav-card-icon" size={17} aria-hidden="true" /><span>{expanded ? "Projects" : current?.name ?? "Projects"}</span>
      <ChevronDown size={15} className={expanded ? "nav-chevron expanded" : "nav-chevron"} aria-hidden="true" />
    </button>
    {expanded && <div className="nav-accordion-content" id="project-navigation-links">
      <button type="button" className="nav-create" disabled={disabled} onClick={onAdd}><FolderPlus size={16} />New project</button>
      <div className="nav-project-list">
        {projects.map((project) => <div key={project.id} className={`nav-project-row ${project.id === selected ? "selected" : ""}`}>
          <button type="button" className="nav-project-select" disabled={disabled} title={project.name} aria-current={project.id === selected ? "page" : undefined} onClick={() => onSelect(project)}>
            <FolderKanban size={15} aria-hidden="true" /><span>{project.name}</span>
          </button>
          <button type="button" className="nav-manage" aria-label={`Manage ${project.name}`} title={`Manage ${project.name}`} disabled={disabled} onClick={() => onManage(project)}><Settings size={15} aria-hidden="true" /></button>
        </div>)}
        {!projects.length && <small className="nav-empty">Open a project to get started.</small>}
      </div>
    </div>}
  </section>;
}

export function ChatNavigation({ sessions, selected, disabled, creating, expanded, onToggle, onDismiss, onNew, onSelect, onContinue, onArchive, onPin, onExport, onRename }: {
  sessions: any[]; selected: string; disabled?: boolean; creating?: boolean;
  expanded: boolean; onToggle: () => void; onDismiss: () => void;
  onNew: () => void; onSelect: (session: any) => void; onContinue: (session: any) => void;
  onArchive: (session: any) => void; onPin: (session: any) => void; onExport: (session: any) => void;
  onRename: (session: any, title: string) => void;
}) {
  const [menu, setMenu] = useState(""), [renameTitle, setRenameTitle] = useState("");
  const root = useNavigationDismiss(expanded, onDismiss);
  const closeMenu = () => {
    root.current?.querySelector<HTMLButtonElement>('.nav-chat-manage-trigger[aria-expanded="true"]')?.focus();
    setMenu('');
  };
  useEffect(() => { if (!expanded) setMenu(''); }, [expanded]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.querySelector('.nav-chat-menu')?.parentElement?.contains(event.target as Node)) setMenu("");
    };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); };
  }, [menu]);
  return <section ref={root} className={`nav-accordion chat-navigation${expanded ? " expanded" : ""}`}
    onKeyDown={(event) => { if (event.key === 'Escape' && menu) { event.preventDefault(); event.stopPropagation(); closeMenu(); } }}>
    <button type="button" className="nav-card-trigger nav-accordion-trigger" title="Chats" aria-label="Chats" aria-expanded={expanded} aria-controls="chat-navigation-links" onClick={() => { onToggle(); setMenu(""); }}>
      <MessageSquareText className="nav-card-icon" size={17} aria-hidden="true" /><span>Chats</span>
      <ChevronDown size={15} className={expanded ? "nav-chevron expanded" : "nav-chevron"} aria-hidden="true" />
    </button>
    {expanded && <div className="nav-accordion-content" id="chat-navigation-links">
      <button type="button" className="nav-create" disabled={disabled || creating} onClick={onNew}>
        {creating ? <span className="nav-create-spinner" aria-hidden="true" /> : <Plus size={16} />}New chat
      </button>
      <div className="nav-chat-list">
        {sessions.map((session) => <div key={session.id} className={`nav-chat-row ${session.id === selected ? "selected" : ""}`}>
          <button type="button" className="nav-chat-select" disabled={disabled} title={session.title || "New chat"} aria-current={session.id === selected ? "page" : undefined} onClick={() => { setMenu(""); onSelect(session); }}>
            {!session.imported && <SessionActivity activity={session.activity} goal={session.goal} />}
            <span>{session.imported ? "Imported · " : ""}{session.title || "New chat"}</span>
            {session.organization?.pinnedAt && <Pin className="nav-chat-pinned" size={13} aria-label="Pinned" />}
          </button>
          <button type="button" className="nav-chat-manage-trigger" aria-label={`Manage ${session.title || "New chat"}`} title={`Manage ${session.title || "New chat"}`} aria-expanded={menu === session.id} disabled={disabled}
           onClick={() => { setRenameTitle(session.title ?? ""); setMenu((value) => value === session.id ? "" : session.id); }}><Settings size={15} aria-hidden="true" /></button>
          {menu === session.id && <div className="nav-chat-menu" role="group" aria-label={`Manage ${session.title || "New chat"}`}>
            {!session.imported && <form className="nav-chat-rename" onSubmit={(event) => { event.preventDefault(); closeMenu(); onRename(session, renameTitle); }}>
              <label><span>Chat name</span><input aria-label="Chat name" value={renameTitle} maxLength={session.goal ? 120 : 160} onChange={(event) => setRenameTitle(event.target.value)} /></label>
              <button type="submit" disabled={disabled || !renameTitle.trim() || renameTitle.trim() === session.title}><Check size={14} />Rename</button>
            </form>}
            {!session.goal && <button type="button" disabled={disabled} onClick={() => { closeMenu(); onContinue(session); }}><WandSparkles size={14} />Continue in new chat</button>}
            {!session.goal && <button type="button" disabled={disabled || !!session.organization?.archived} onClick={() => { closeMenu(); onArchive(session); }}><Archive size={14} />Archive</button>}
            <button type="button" disabled={disabled} aria-pressed={!!session.organization?.pinnedAt} onClick={() => { closeMenu(); onPin(session); }}><Pin size={14} />{session.organization?.pinnedAt ? "Unpin" : "Pin"}</button>
            <button type="button" disabled={disabled} onClick={() => { closeMenu(); onExport(session); }}><Download size={14} />Export</button>
          </div>}
        </div>)}
        {!sessions.length && <small className="nav-empty">Your chats will appear here.</small>}
      </div>
    </div>}
  </section>;
}
