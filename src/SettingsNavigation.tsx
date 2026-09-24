import { Bot, BrainCircuit, ChevronUp, Database, Files, GitBranch, Github, History, MessageSquare, Palette, Search, Settings2, SlidersHorizontal, Wallet, Workflow } from "lucide-react";

export type SettingsScope = "project" | "application";

const groups = {
  project: {
    label: "Project settings",
    icon: GitBranch,
    items: [
      { id: "workspace", label: "Workspace", icon: MessageSquare },
      { id: "files", label: "Files", icon: Files },
      { id: "agents", label: "Agents", icon: Bot },
      { id: "workflows", label: "Workflows", icon: Workflow },
      { id: "github", label: "GitHub", icon: Github },
      { id: "sessions", label: "Session defaults", icon: SlidersHorizontal },
      { id: "delegation", label: "Delegation", icon: SlidersHorizontal },
    ],
  },
  application: {
    label: "Application settings",
    icon: Settings2,
    items: [
      { id: "models", label: "Models", icon: BrainCircuit },
      { id: "providers", label: "Providers", icon: Wallet },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "storage", label: "Data & Storage", icon: Database },
      { id: "index", label: "Content index", icon: Search },
      { id: "git-defaults", label: "Git defaults", icon: GitBranch },
      { id: "history", label: "History", icon: History },
    ],
  },
} as const;

export function settingsItemLabel(scope: SettingsScope, id: string) {
  return groups[scope].items.find((item) => item.id === id)?.label ?? "Settings";
}

export function SettingsNavigation({ expanded, scope, tab, project, onToggle, onSelect }: {
  expanded: SettingsScope | null;
  scope: SettingsScope;
  tab: string;
  project: boolean;
  onToggle: (scope: SettingsScope) => void;
  onSelect: (scope: SettingsScope, tab: string) => void;
}) {
  return <nav className="settings-drawers" aria-label="Settings">
    {(["project", "application"] as const).map((group) => {
      const config = groups[group], Icon = config.icon, open = expanded === group;
      return <section key={group} className="settings-drawer">
        <button type="button" className="settings-drawer-trigger" aria-label={config.label} title={config.label} aria-expanded={open}
          aria-controls={`${group}-settings-links`} disabled={group === "project" && !project}
          onClick={() => onToggle(group)}>
          <Icon size={18} aria-hidden="true" /><span>{config.label}</span><ChevronUp size={15} className={open ? "drawer-chevron open" : "drawer-chevron"} aria-hidden="true" />
        </button>
        <div id={`${group}-settings-links`} className="settings-drawer-links" hidden={!open}>
          {config.items.map(({ id, label, icon: ItemIcon }) => <button key={id} type="button"
            className={scope === group && tab === id ? "selected" : ""}
            aria-current={scope === group && tab === id ? "page" : undefined} aria-label={label}
            title={label} onClick={() => onSelect(group, id)}>
            <ItemIcon size={17} aria-hidden="true" /><span>{label}</span>
          </button>)}
        </div>
      </section>;
    })}
  </nav>;
}
