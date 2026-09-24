import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { ProgressStatus } from './echoflex/ProgressStatus';
import { Dialog } from './echoflex/Dialog';
import {
  Check,
  ChevronDown,
  FolderOpen,
  LoaderCircle,
  Plus,
  Search,
} from "lucide-react";

export function ProjectPicker({
  projects,
  selected,
  disabled,
  onSelect,
  onAdd,
  onManage,
}: {
  projects: any[];
  selected: string;
  disabled?: boolean;
  onSelect: (project: any) => void;
  onAdd: () => void;
  onManage: (project: any) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 390 });
  const current = projects.find((p) => p.id === selected);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !menu.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    const resize = () => setOpen(false);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  return (
    <div
      className="project-picker"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        className="project-trigger"
        disabled={disabled}
        aria-label="Project picker"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          const rect = trigger.current!.getBoundingClientRect(),
            width = Math.min(390, window.innerWidth - 24);
          setPosition({
            top: rect.bottom + 8,
            left: Math.max(
              12,
              Math.min(rect.left, window.innerWidth - width - 12),
            ),
            width,
          });
          setSearch("");
          setOpen(!open);
        }}
      >
        <FolderOpen size={18} />
        <span>{current?.name ?? "Choose a project"}</span>
        <ChevronDown size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            style={position}
            className="project-menu"
            role="dialog"
            aria-label="Choose a project"
          >
            <label className="project-search">
              <Search size={16} />
              <input
                autoFocus
                aria-label="Find a project"
                placeholder="Find a project…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="project-options">
              {projects
                .filter((p) =>
                  `${p.name} ${p.directory}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((p) => (
                  <div key={p.id}>
                    <button
                      className={p.id === selected ? "selected" : ""}
                      aria-current={p.id === selected ? "true" : undefined}
                      onClick={() => { close(); onSelect(p); }}
                    >
                      <FolderOpen size={17} />
                      <span><strong>{p.name}</strong><small>{p.directory}</small></span>
                      {p.id === selected && <Check size={16} />}
                    </button>
                    <div className="project-option-actions">
                      <button type="button" aria-label={`Manage ${p.name}`} onClick={(e) => { e.stopPropagation(); close(); onManage(p); }}>Manage</button>
                    </div>
                  </div>
                ))}
              {!projects.some((p) =>
                `${p.name} ${p.directory}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              ) && <p>No matching projects</p>}
            </div>
            <button
              className="project-add"
              onClick={() => {
                close();
                onAdd();
              }}
            >
              <Plus size={17} />
              Open a project…
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

export function ProjectProgress({
  name,
  phase,
  step = 'project',
  onStop,
}: {
  name: string;
  phase: string;
  step?: string;
  onStop?: () => void;
}) {
  const steps = [['project', 'Open project folder'], ['import', 'Import selected chats (optional)'], ['workspace', 'Load models, agents and settings'],
    ['files', 'Build the project file index'], ['chats', 'Build the conversation index']];
  const current = Math.max(0, steps.findIndex(([key]) => key === step));
  return (
    <Dialog
      className="project-progress"
      title="Preparing your workspace" description={name} icon={<FolderOpen />} size="compact"
    >
      <ProgressStatus label={phase} action={onStop ? { label: 'Stop indexing', onClick: onStop } : undefined} />
      <ol className="project-progress-steps">{steps.map(([key, label], index) => <li key={key}
        aria-current={index === current ? 'step' : undefined} className={index < current ? 'complete' : ''}>
        {index < current ? <Check size={15} aria-label="Complete" /> : <span aria-hidden="true">{index + 1}</span>}{label}
      </li>)}</ol>
      <p>Indexes make project files and past conversations searchable. Existing indexes are reused after the first successful setup.</p>
    </Dialog>
  );
}
