import { Target, Bot, BrainCircuit, CalendarClock, ChevronDown, FileSearch, Files, FolderOpen, Gauge, GitBranch, GitFork, Github, HardDrive, History, MessageSquare, Palette, Settings2, Smartphone, Wallet, Wrench } from "lucide-react";
import { useNavigationDismiss } from "./NavigationMenus";
import { settingsGroups, settingsPage } from "./settings-catalog.mjs";

export type SettingsScope = "project" | "application";
const scopes = {
  project: { label: "Project settings", icon: FolderOpen },
  application: { label: "Application settings", icon: Settings2 },
};
const icons = {
  files: Files, search: FileSearch, agents: Bot, goals: Target, sessions: MessageSquare,
  delegation: GitFork, github: Github, models: BrainCircuit, usage: Gauge, history: History,
  providers: Wallet, appearance: Palette, "remote-access": Smartphone, schedules: CalendarClock,
  "content-storage": HardDrive, "git-defaults": GitBranch, capabilities: Wrench,
};
export function settingsItemLabel(scope: SettingsScope, id: string) {
  if (id === "history") return "Conversation history";
  return settingsPage(scope, id)?.title ?? "Settings";
}
export function SettingsNavigation({ expanded, scope, tab, project, onToggle, onDismiss, onSelect }: {
  expanded: SettingsScope | null; scope: SettingsScope; tab: string; project: boolean;
  onToggle: (scope: SettingsScope) => void; onDismiss: () => void;
  onSelect: (scope: SettingsScope, tab: string) => void;
}) {
  const root = useNavigationDismiss(!!expanded, onDismiss);
  return <nav ref={root} className="settings-drawers" aria-label="Settings">
    {(["project", "application"] as const).map(group => {
      const config = scopes[group], Icon = config.icon, open = expanded === group;
      return <section key={group} className="settings-drawer">
        <button type="button" className="nav-card-trigger settings-drawer-trigger" aria-label={config.label} title={config.label} aria-expanded={open}
          aria-controls={`${group}-settings-links`} disabled={group === "project" && !project} onClick={() => onToggle(group)}>
          <Icon className="nav-card-icon" size={17} aria-hidden="true" /><span>{config.label}</span>
          <ChevronDown size={15} className={open ? "nav-chevron expanded" : "nav-chevron"} aria-hidden="true" />
        </button>
        <div id={`${group}-settings-links`} className="settings-drawer-links" hidden={!open}>
          {settingsGroups[group].flatMap(section => section.items).map(id => {
              const page = settingsPage(group, id)!;
              const ItemIcon = icons[page.icon as keyof typeof icons];
              const selected = scope === group && tab === id;
              return <button key={id} type="button" className={selected ? "selected" : ""}
                aria-current={selected ? "page" : undefined} aria-label={page.title} title={page.title}
                onClick={() => onSelect(group, id)}>
                <ItemIcon size={17} aria-hidden="true" />
                <span>{page.title}</span>
              </button>;
            })}

        </div>
      </section>;
    })}
  </nav>;
}
