import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Terminal, Bot, Cpu, Target, X } from "lucide-react";
import "./chat-toolbar.css";

export function ChatToolbar({
  commands,
  agents,
  models,
  goal,
  counts,
  working,
  selection,
  selectedSection = "commands",
}: {
  commands: ReactNode;
  agents: ReactNode;
  models: ReactNode;
  goal?: ReactNode;
  counts: { commands: number; agents: number; models: number; goals?: string };
  working: {
    commands: boolean;
    agents: boolean;
    models: boolean;
    goals?: boolean;
  };
  selection?: string | null;
  selectedSection?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selection) setOpen(selectedSection);
  }, [selection, selectedSection]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !root.current?.contains(event.target as Node)
      )
        return;
      setOpen(null);
      root.current
        .querySelector<HTMLButtonElement>(`[data-section="${open}"]`)
        ?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  const tabs = [
    { id: "commands", label: "Commands", icon: Terminal, content: commands },
    { id: "agents", label: "Agents", icon: Bot, content: agents },
    { id: "models", label: "Models", icon: Cpu, content: models },
    ...(goal
      ? [{ id: "goals", label: "Goals", icon: Target, content: goal }]
      : []),
  ];
  const host = document.getElementById("chat-toolbar-host");
  const content = (
    <div className="chat-toolbar" ref={root}>
      <div className="chat-toolbar-tabs" aria-label="Chat tools">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            data-section={id}
            aria-label={`${label} ${counts[id] ?? ''}`}
            title={`${label} · ${counts[id] ?? ''}`}
            className={open === id ? "selected" : ""}
            aria-expanded={open === id}
            aria-controls="chat-tool-dock"
            onClick={() => setOpen((current) => (current === id ? null : id))}
          >
            <Icon
              size={17}
              className={working[id] ? "tool-working" : ""}
              aria-hidden="true"
            />
            <span>{label}</span>
            <small>{counts[id]}</small>
          </button>
        ))}
      </div>
      {open && (
        <section
          className="chat-tool-overlay"
          id="chat-tool-dock"
          aria-label={`${tabs.find((tab) => tab.id === open)?.label} view`}
        >
          <header>
            <strong>{tabs.find((tab) => tab.id === open)?.label}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Close chat tools"
              onClick={() => setOpen(null)}
            >
              <X size={16} />
            </button>
          </header>
          <div className="chat-tool-content">
            {tabs.find((tab) => tab.id === open)?.content}
          </div>
        </section>
      )}
    </div>
  );
  return host ? createPortal(content, host) : content;
}
