import { Bot, BrainCircuit, CalendarClock, ChevronDown, FileSearch, Files, FolderOpen, Gauge, GitBranch, GitFork, Github, HardDrive, History, MessageSquare, Palette, Settings2, Smartphone, Wallet } from "lucide-react";
import { useNavigationDismiss } from "./NavigationMenus";

export type SettingsScope = "project" | "application";

const groups = {
  project: {
    label: "Project settings",
    icon: FolderOpen,
    items: [
      { id: "files", label: "Files", icon: Files },
      { id: "search", label: "Search project content", icon: FileSearch },
      { id: "agents", label: "Agents", icon: Bot },
      { id: "sessions", label: "Session defaults", icon: MessageSquare },
      { id: "delegation", label: "Delegation", icon: GitFork },
      { id: "github", label: "GitHub", icon: Github },
    ],
  },
  application: {
    label: "Application settings",
    icon: Settings2,
    items: [
      { id: "models", label: "Models", icon: BrainCircuit },
      { id: "usage", label: "Available Usage", icon: Gauge },
      { id: "history", label: "Conversation history", icon: History },
      { id: "providers", label: "Providers", icon: Wallet },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "remote-access", label: "Remote access", icon: Smartphone },
      { id: "schedules", label: "Scheduled prompts", icon: CalendarClock },
      { id: "search", label: "Search all content", icon: FileSearch },
      { id: "content-storage", label: "Content & Storage", icon: HardDrive },
      { id: "git-defaults", label: "Git defaults", icon: GitBranch },
    ],
  },
} as const;

export function settingsItemLabel(scope: SettingsScope, id: string) {
  if (id === "history") return "Conversation history";
  return groups[scope].items.find((item) => item.id === id)?.label ?? "Settings";
}

export function SettingsNavigation({ expanded, scope, tab, project, onToggle, onDismiss, onSelect }: {
  expanded: SettingsScope | null;
  scope: SettingsScope;
  tab: string;
  project: boolean;
  onToggle: (scope: SettingsScope) => void;
  onDismiss: () => void;
  onSelect: (scope: SettingsScope, tab: string) => void;
}) {
  const root = useNavigationDismiss(!!expanded, onDismiss);
  return <nav ref={root} className="settings-drawers" aria-label="Settings">
    {(["project", "application"] as const).map((group) => {
      const config = groups[group], Icon = config.icon, open = expanded === group;
      return <section key={group} className="settings-drawer">
        <button type="button" className="nav-card-trigger settings-drawer-trigger" aria-label={config.label} title={config.label} aria-expanded={open}
          aria-controls={`${group}-settings-links`} disabled={group === "project" && !project}
          onClick={() => onToggle(group)}>
          <Icon className="nav-card-icon" size={17} aria-hidden="true" /><span>{config.label}</span><ChevronDown size={15} className={open ? "nav-chevron expanded" : "nav-chevron"} aria-hidden="true" />
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
