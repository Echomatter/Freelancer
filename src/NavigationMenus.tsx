import { useEffect, useRef, useState } from "react";
import { Archive, ChevronDown, Download, FolderKanban, FolderPlus, MoreHorizontal, Pin, Plus, MessageSquareText, WandSparkles } from "lucide-react";
import { SessionActivity } from "./SessionActivity";
import "./navigation-menus.css";

export function ProjectNavigation({ projects, selected, disabled, onSelect, onAdd, onManage }: {
  projects: any[]; selected: string; disabled?: boolean;
  onSelect: (project: any) => void; onAdd: () => void; onManage: (project: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const current = projects.find((p) => p.id === selected);
  useEffect(() => setExpanded(false), [selected]);
  return <section className="nav-accordion project-navigation">
    <button type="button" className="nav-accordion-trigger" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <FolderKanban size={17} aria-hidden="true" /><span>{expanded ? "Projects" : current?.name ?? "Projects"}</span>
      <ChevronDown size={15} className={expanded ? "nav-chevron expanded" : "nav-chevron"} aria-hidden="true" />
    </button>
    {expanded && <div className="nav-accordion-content">
      <button type="button" className="nav-create" disabled={disabled} onClick={onAdd}><FolderPlus size={16} />New project</button>
      <div className="nav-project-list">
        {projects.map((project) => <div key={project.id} className={`nav-project-row ${project.id === selected ? "selected" : ""}`}>
          <button type="button" className="nav-project-select" disabled={disabled} aria-current={project.id === selected ? "page" : undefined} onClick={() => onSelect(project)}>
            <FolderKanban size={15} aria-hidden="true" /><span>{project.name}</span>
          </button>
          <button type="button" className="nav-manage" aria-label={`Manage ${project.name}`} disabled={disabled} onClick={() => onManage(project)}>Manage</button>
        </div>)}
        {!projects.length && <small className="nav-empty">Open a project to get started.</small>}
      </div>
    </div>}
  </section>;
}

export function ChatNavigation({ sessions, selected, disabled, creating, onNew, onSelect, onContinue, onArchive, onPin, onExport }: {
  sessions: any[]; selected: string; disabled?: boolean; creating?: boolean;
  onNew: () => void; onSelect: (session: any) => void; onContinue: (session: any) => void;
  onArchive: (session: any) => void; onPin: (session: any) => void; onExport: (session: any) => void;
}) {
  const [expanded, setExpanded] = useState(false), [menu, setMenu] = useState("");
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenu("");
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(""); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keydown); };
  }, [menu]);
  return <section ref={root} className="nav-accordion chat-navigation">
    <button type="button" className="nav-accordion-trigger" aria-expanded={expanded} onClick={() => { setExpanded((value) => !value); setMenu(""); }}>
      <MessageSquareText size={17} aria-hidden="true" /><span>Chats</span>
      <ChevronDown size={15} className={expanded ? "nav-chevron expanded" : "nav-chevron"} aria-hidden="true" />
    </button>
    {expanded && <div className="nav-accordion-content">
      <button type="button" className="nav-create" disabled={disabled || creating} onClick={onNew}>
        {creating ? <span className="nav-create-spinner" aria-hidden="true" /> : <Plus size={16} />}New chat
      </button>
      <div className="nav-chat-list">
        {sessions.map((session) => <div key={session.id} className={`nav-chat-row ${session.id === selected ? "selected" : ""}`}>
          <button type="button" className="nav-chat-select" disabled={disabled} aria-current={session.id === selected ? "page" : undefined} onClick={() => { setMenu(""); onSelect(session); }}>
            {!session.imported && <SessionActivity activity={session.activity} />}
            <span>{session.imported ? "Imported · " : ""}{session.title || "New chat"}</span>
            {session.organization?.pinnedAt && <Pin className="nav-chat-pinned" size={13} aria-label="Pinned" />}
          </button>
          <button type="button" className="nav-chat-manage-trigger" aria-label={`Manage ${session.title || "New chat"}`} aria-expanded={menu === session.id} disabled={disabled}
            onClick={() => setMenu((value) => value === session.id ? "" : session.id)}><MoreHorizontal size={15} />Manage</button>
          {menu === session.id && <div className="nav-chat-menu" role="group" aria-label={`Manage ${session.title || "New chat"}`}>
            <button type="button" disabled={disabled} onClick={() => { setMenu(""); onContinue(session); }}><WandSparkles size={14} />Continue in new chat</button>
            <button type="button" disabled={disabled || !!session.organization?.archived} onClick={() => { setMenu(""); onArchive(session); }}><Archive size={14} />Archive</button>
            <button type="button" disabled={disabled} aria-pressed={!!session.organization?.pinnedAt} onClick={() => { setMenu(""); onPin(session); }}><Pin size={14} />{session.organization?.pinnedAt ? "Unpin" : "Pin"}</button>
            <button type="button" disabled={disabled} onClick={() => { setMenu(""); onExport(session); }}><Download size={14} />Export</button>
          </div>}
        </div>)}
        {!sessions.length && <small className="nav-empty">Your chats will appear here.</small>}
      </div>
    </div>}
  </section>;
}
