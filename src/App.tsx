const HistoryPage = lazy(() => import('./History').then(module => ({ default: module.HistoryPage })));
import { ModelRatingDialog, ModelRatingProgress, useModelRatings } from './ModelRatings';
import { IndexJobsContext, IndexJobProgress, useIndexJobs } from './IndexJobs';
import { ProgressStatus } from './echoflex/ProgressStatus';
import { useDrafts } from "./useDrafts";
import { lazy, Suspense, startTransition, useEffect, useRef, useState } from "react";
import {
  Route,
  Plus,
  FolderOpen,
  ChevronDown,
  ArrowUpRight,
  RefreshCw,
  Activity,
  Check,
  X,
  PanelLeftClose,
  Search,
  LoaderCircle,
} from "lucide-react";
import { api, query, subscribe } from "./api";
import { Button, Panel, Badge, Empty } from "./echoflex/Controls";
import { Chat } from "./Chat";
const GitHubProject = lazy(() => import('./GitHubProject').then(module => ({ default: module.GitHubProject })));
import { PanelResize, usePanelLayout } from "./PanelResize";
import { applyTheme } from "../domain/theme.mjs";
const Settings = lazy(() => import('./Settings').then(module => ({ default: module.Settings })));
import { SettingsNavigation, settingsItemLabel, type SettingsScope } from "./SettingsNavigation";
import { Details, Files } from "./WorkspacePanels";
import { ChatActions } from "./ChatActions";
import { browseModels } from "../shared/view.mjs";
const WorkspaceCatalog = lazy(() => import('./WorkspaceCatalog').then(module => ({ default: module.WorkspaceCatalog })));
import { startingChoices } from "../domain/session-defaults.mjs";
import { compatibleApplication } from "../domain/protocol.mjs";
import { ProjectProgress } from "./ProjectPicker";
import { ChatNavigation, ProjectNavigation } from "./NavigationMenus";
import { Questions } from "./Question";
import { Permissions } from './Permissions';
import { Dialog, useConfirmation } from './echoflex/Dialog';
import { FolderPicker, ProjectImport } from './ProjectImport';
import { useProjectActivity } from "./SessionActivity";
import { UsageHero, UsageSidebar, UsageProviders } from "./AvailableUsage";
import { useAvailability } from "./useAvailability";
import { applyTodoLayout } from "../domain/appearance.mjs";
import { ContributionRows } from "./Contributions";
import { AppearanceContext, ProviderText, ProviderSelect, providerAttributes, type ColorPatch } from "./ProviderColors";
import { mergeProviderColors } from "../domain/provider-colors.mjs";
import { senderState } from "../domain/sender.mjs";

const EMPTY_TODOS: any[] = [];

function modelStatus(availability: string, used = false) {
  if (availability === 'deprecated') return { label: 'Deprecated', tone: 'error' };
  if (availability === 'quota constrained') return { label: 'Quota limited', tone: 'warning' };
  if (used) return { label: 'Used', tone: 'success' };
  return { label: 'Not tested', tone: 'neutral' };
}

function modelQuantity(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export default function App() {
  const confirmation = useConfirmation();
  const [folderPicker, setFolderPicker] = useState(false), [importPreview, setImportPreview] = useState<any>(null);
  const [importBusy, setImportBusy] = useState(false), [importError, setImportError] = useState('');
  const [data, setData] = useState<any>(null),
    [project, setProject] = useState(""),
    [session, setSession] = useState(""),
    [chat, setChat] = useState<any>({
      messages: [],
      status: {},
      permissions: [],
      questions: [],
    });
  useEffect(() => {
    if (!project || !session) return;
    try { localStorage.setItem(`freelancer:last-chat:${project}`, session); }
    catch { /* Storage can be unavailable in restricted browser contexts. */ }
  }, [project, session]);
  const [view, setViewState] = useState("chat"),
    [tab, setTab] = useState("providers"),
    [settingsScope, setSettingsScope] = useState<SettingsScope>("application"),
    [expandedSettings, setExpandedSettings] = useState<SettingsScope | null>(null),
    [model, setModel] = useState("inherit"),
    [variant, setVariant] = useState("inherit");
  const [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [folderOpen, setFolderOpen] = useState(false),
    [folder, setFolder] = useState("");
  const [projectEdit, setProjectEdit] = useState<any>(null),
    [projectName, setProjectName] = useState("");
  const [projectLoading, setProjectLoading] = useState<{
    name: string;
    phase: string;
    step?: string;
  } | null>(null);
  const projectTransition = useRef(false);
  const initialProject = useRef(false);
  const indexJobs = useIndexJobs();
  const decisions = useRef<HTMLDivElement>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [ratingDialog, setRatingDialog] = useState(false);
  const [modelProvider, setModelProvider] = useState(""),
    [modelSort, setModelSort] = useState("cost"),
    [freeOnly, setFreeOnly] = useState(false);
  const [sending, setSending] = useState(false);
  const attachmentStore = useRef(new Map<string, any[]>());
  const [creatingChat, setCreatingChat] = useState(false);
  const [startingSession, setStartingSession] = useState("");
  const [choicesKey, setChoicesKey] = useState("");
  const [historySelection, setHistorySelection] = useState<string | undefined>();
  const historyOpen = view === "history";
  const setView = (next: React.SetStateAction<string>) => startTransition(() => setViewState(next));
  const openHistory = (id?: string) => { setHistorySelection(id); setExpandedSettings("application"); setView("history"); };
  const openSettings = (scope: SettingsScope, item: string) => {
    if (item === "history") { openHistory(); return; }
    setSettingsScope(scope);
    setExpandedSettings(scope);
    setTab(item);
    setView(({ workspace: "chat", github: "github", models: "models", usage: "overview", agents: "agents", workflows: "workflows", files: "files" } as Record<string, string>)[item] ?? "settings");
  };
  const navigationScope: SettingsScope = historyOpen ? "application" : view === "settings" ? settingsScope : view === "models" || view === "overview" ? "application" : "project";
  const navigationTab = historyOpen ? "history" : view === "settings" ? tab : view === "chat" ? "workspace" : view === "overview" ? "usage" : view;
  const [details, setDetails] = useState(false),
    [detailsSel, setDetailsSel] = useState({ tab: "activity", n: 0 }),
    [agentID, setAgentID] = useState("inherit"),
    [workflowID, setWorkflowID] = useState("build");
  const openDetails = (tab: string) => {
    setDetailsSel((sel) => ({ tab, n: sel.n + 1 }));
    setDetails(true);
  };
  const sessionActivity = useProjectActivity(project, !!data && compatibleApplication(data) && !projectLoading);
  const restoredChoices = useRef("");
  useEffect(() => {
    const key = query(project, session);
    const restorationKey = session
      ? key
      : `${key}:${data?.sessionDefaults?.revision ?? 0}`;
    if (
      data?.selectionKey !== key ||
      data?.project?.id !== project ||
      restoredChoices.current === restorationKey
    )
      return;
    restoredChoices.current = restorationKey;
    const choice = session
      ? data.settings.chatChoices?.[session]
      : data.sessionDefaults &&
        startingChoices(data.sessionDefaults, data.settings);
    if (choice) {
      setAgentID(
        ["inherit"].includes(choice.agentID) ||
          data.settings.agents.some((a) => a.id === choice.agentID)
          ? choice.agentID
          : "inherit",
      );
      setWorkflowID(
        data.settings.workflows.some((w) => w.id === choice.workflowID)
          ? choice.workflowID
          : "build",
      );
      setModel(choice.model ?? "inherit");
      setVariant(choice.variant ?? "inherit");
    } else {
      setAgentID("inherit");
      setWorkflowID("build");
      setModel("inherit");
      setVariant("inherit");
    }
    setChoicesKey(restorationKey);
  }, [data, project, session]);
  useEffect(() => {
    if (!data) return;
    if (
      !["inherit"].includes(agentID) &&
      !data.settings.agents.some((a) => a.id === agentID)
    )
      setAgentID("inherit");
    if (!data.settings.workflows.some((w) => w.id === workflowID))
      setWorkflowID("build");
  }, [data?.settings.agents, data?.settings.workflows]);
  const useWorkflow = (workflow) => {
    setWorkflowID(workflow.id);
    setVariant("inherit");
  };
  useEffect(() => {
    if (!data) return;
    if (
      !["inherit"].includes(agentID) &&
      !data.settings.agents.some((a) => a.id === agentID)
    )
      setAgentID("inherit");
    if (!data.settings.workflows.some((w) => w.id === workflowID))
      setWorkflowID("build");
  }, [data, agentID, workflowID]);
  const panelLayout = usePanelLayout(data ? data.settings.appearance ?? {} : undefined, view === "chat" && details);
  const pending = useRef(0);
  const bootstrapVersion = useRef(0),
    chatVersion = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout>>();
  const navigation = useRef("");
  const draftMemory = useDrafts(project, session, !!data && compatibleApplication(data));
  const draft = draftMemory.text, setDraft = draftMemory.setText;
  navigation.current = query(project, session);
  const refresh = async (signal?: AbortSignal) => {
    if (projectTransition.current) return;
    const key = query(project, session),
      id = ++bootstrapVersion.current;
    const next = await api("bootstrap?" + key, undefined, "GET", signal);
    if (!initialProject.current && next.indexPreparation && next.project && compatibleApplication(next) && id === bootstrapVersion.current && navigation.current === key) {
      initialProject.current = true;
      projectTransition.current = true;
      setProjectLoading({ name: next.project.name, phase: 'Checking project indexes…', step: 'files' });
      try {
        await indexJobs.prepare(next.project.id, job => setProjectLoading({ name: next.project.name, phase: job.label, step: job.step }));
      } catch (e) { setError(`Workspace opened; index preparation needs attention: ${(e as Error).message}`); }
      finally { projectTransition.current = false; setProjectLoading(null); }
    }
    if (id === bootstrapVersion.current && navigation.current === key)
      setData({ ...next, selectionKey: key });
  };
  const availableUsage = useAvailability(data, refresh);
  const appearanceSaved = (layout: string) => {
    // A bootstrap started before this save must not restore the old selection.
    bootstrapVersion.current++;
    setData((current) => applyTodoLayout(current, layout));
  };
  const colorsSaved = (patch: ColorPatch) => {
    bootstrapVersion.current++;
    setData(current => current ? ({ ...current, settings: { ...current.settings, appearance: {
      ...current.settings.appearance, ...(patch.theme ? { theme: patch.theme } : {}),
      ...(patch.providerColors ? { providerColors: mergeProviderColors(current.settings.appearance?.providerColors, patch.providerColors) } : {}),
    } } }) : current);
  };
  const refreshChat = async (targetProject = project, targetSession = session, originKey = "") => {
    if (projectTransition.current) return;
    if (targetProject && targetSession) {
      const key = query(targetProject, targetSession),
        id = ++chatVersion.current,
        next = await api("chat?" + key);
      if (id === chatVersion.current && (navigation.current === key || navigation.current === originKey)) {
        setChat({ ...next, loaded: true, selectionKey: key });
      }
    }
  };
  const modelRatings = useModelRatings(() => refresh());
  const refreshCurrent = useRef<() => Promise<unknown>>(() => Promise.resolve());
  refreshCurrent.current = () => Promise.all([refreshChat(), refresh()]);
  async function run(fn: () => Promise<any>) {
    pending.current++;
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      pending.current--;
      setWorking(pending.current > 0);
    }
  }
  useEffect(() => {
    if (
      data?.selectionKey !== query(project, session) ||
      data?.project?.id !== project
    )
      void run(refresh);
  }, [project, session]);
  useEffect(() => {
    if (!project && data?.project) setProject(data.project.id);
  }, [data?.project?.id]);
  useEffect(() => {
    const theme = data?.settings.appearance?.theme;
    if (theme) applyTheme(theme);
  }, [data?.settings.appearance?.theme]);
  useEffect(() => {
    setChat({ messages: [], status: {}, permissions: [], questions: [] });
    if (project && session) void run(refreshChat);
  }, [project, session]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (projectTransition.current) return;
        setFolderOpen(false);
        setView((current) => current === "history" ? "chat" : current);
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    if (!project) return;
    const abort = new AbortController();
    let refreshing = false,
      dirty = false;
    const update = () => {
      if (abort.signal.aborted) return;
      if (refreshing) {
        dirty = true;
        return;
      }
      if (timer.current) return;
      timer.current = setTimeout(async () => {
        timer.current = undefined;
        refreshing = true;
        try {
          await refreshCurrent.current();
        } catch {
        } finally {
          refreshing = false;
          if (dirty) {
            dirty = false;
            update();
          }
        }
      }, 500);
    };
    void subscribe(project, update, abort.signal);
    return () => {
      abort.abort();
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [project]);
  const current = data?.sessions.find((s) => s.id === session),
    turnState = session ? senderState(chat, session) : { busy: false },
    busy = sending || turnState.busy;
  const selectedKey = query(project, session);
  const selectedChoicesKey = session
    ? selectedKey
    : `${selectedKey}:${data?.sessionDefaults?.revision ?? 0}`;
  const chatLoading =
    (Boolean(session) &&
      (chat.selectionKey !== selectedKey || !chat.loaded || startingSession === session)) ||
    startingSession === "__new__" ||
    data?.selectionKey !== selectedKey ||
    choicesKey !== selectedChoicesKey;
  async function createChat() {
    if (!project) {
      setFolderOpen(true);
      return;
    }
    setCreatingChat(true);
    try {
      const next = await api("chats", { project });
      setSession(next.id);
      setView("chat");
    } finally {
      setCreatingChat(false);
    }
  }
  async function send(intelligence: string, attachments: { filename: string; mime: string; url: string }[] = []) {
    if (!model || !project || (!draft.trim() && !attachments.length) || busy || draftMemory.loading || current?.organization?.archived || data.project?.organization?.archivedAt) return { accepted: false, sessionID: session };
    let captured = draftMemory.capture();
    const capturedDraft = captured.text;
    const origin = query(project, session);
    setSending(true);
    if (!session) setStartingSession("__new__");
    let createdSession = "";
    let accepted = false;
    try {
      await run(async () => {
        await draftMemory.controller.flush(project, session);
        let id = session;
        if (!id) {
          const next = await api("chats", { project });
          id = next.id;
          captured = await draftMemory.controller.rebind(captured, id);
          restoredChoices.current = query(project, id);
          setChoicesKey(restoredChoices.current);
          createdSession = id;
          setStartingSession(id);
          setSession(id);
        }
        await api("send", {
          project,
          session: id,
          text: capturedDraft,
          agentID,
          workflowID,
          model,
          variant: intelligence,
          attachments,
        });
        accepted = true;
        draftMemory.controller.accept(captured);
        if (
          navigation.current === query(project, id) ||
          navigation.current === origin
        ) {
          setChat((c) => ({
            ...c,
            status: { ...c.status, [id]: { type: "busy" } },
          }));
        }
        if (createdSession) await refreshChat(project, createdSession, origin);
      });
    } finally {
      setStartingSession("");
      setSending(false);
    }
    return { accepted, sessionID: createdSession || session };
  }
  async function openProject(existing?: any) {
    if (projectTransition.current) return;
    projectTransition.current = true;
    bootstrapVersion.current++;
    chatVersion.current++;
    const name = existing?.name ?? folder.trim();
    setProjectLoading({
      name,
      phase: existing ? "Opening project…" : "Setting up project…",
      step: 'project',
    });
    await run(async () => {
      try {
        const p =
          existing ?? (await api("projects", { directory: folder.trim() }));
        await api("projects/selection", { project: p.id }, "PUT");
        setProjectLoading({ name: p.name, phase: "Loading models, agents and saved workspace settings…", step: 'workspace' });
        const key = query(p.id);
        const next = await api("bootstrap?" + key);
        if (!compatibleApplication(next))
          throw Error(
            "Restart Freelancer to finish updating, then open the project again.",
          );
        if (next.project?.id !== p.id)
          throw Error("The project could not be loaded. Please try again.");
        initialProject.current = true;
        setProjectLoading({ name: p.name, phase: 'Checking project indexes…', step: 'files' });
        try {
          if (next.indexPreparation) await indexJobs.prepare(p.id, job => setProjectLoading({ name: p.name, phase: job.label, step: job.step }));
        } catch (e) { setError(`Workspace opened; index preparation needs attention: ${(e as Error).message}`); }
        bootstrapVersion.current++;
        chatVersion.current++;
        navigation.current = key;
        restoredChoices.current = "";
        setData({ ...next, selectionKey: key });
        setProject(p.id);
        let remembered = "";
        try { remembered = localStorage.getItem(`freelancer:last-chat:${p.id}`) ?? ""; }
        catch { /* Fall back to the project with no chat selected. */ }
        setSession(next.sessions.some((item: any) => item.id === remembered) ? remembered : "");
        setChat({ messages: [], status: {}, permissions: [], questions: [] });
        setFolderOpen(false);
        setFolder("");
        setView("chat");
      } finally {
        projectTransition.current = false;
        setProjectLoading(null);
      }
    });
  }
  async function previewProject() {
    setImportBusy(true); setImportError('');
    try {
      const preview = await api('projects/import-preview', { directory: folder.trim() });
      if (preview.existing) await openProject(preview.existing);
      else setImportPreview(preview);
    } catch (error) { setImportError((error as Error).message); }
    finally { setImportBusy(false); }
  }
  async function finishProjectSetup(selected: string[]) {
    if (importBusy) return;
    setImportBusy(true); setImportError(''); projectTransition.current = true;
    setProjectLoading({ name: importPreview.directory, phase: selected.length ? `Importing ${selected.length} ChatGPT / Codex conversations…` : 'Finishing project setup…', step: 'import' });
    try {
      const result = await api('projects/setup', { token: importPreview.token, selected });
      setImportPreview(null); projectTransition.current = false;
      await openProject(result.project);
    } catch (error) { setImportError((error as Error).message); }
    finally { projectTransition.current = false; setProjectLoading(null); setImportBusy(false); }
  }
  async function saveProjectName() {
    if (!projectEdit) return;
    const updated = await api("projects", { project: projectEdit.id, name: projectName }, "PATCH");
    setData((current) => current ? ({ ...current, settings: { ...current.settings, projects: current.settings.projects.map((p) => p.id === updated.id ? { ...p, ...updated } : p) } }) : current);
    setProjectEdit(null);
  }
  async function removeProject(item: any) {
    if (!await confirmation.ask({ title: `Remove “${item.name}”?`, description: 'Its folder, files, native chats, and history will remain on disk.', confirmLabel: 'Remove from Freelancer', danger: true })) return;
    await api("projects", { project: item.id }, "DELETE");
    const remaining = data.settings.projects.filter((p) => p.id !== item.id);
      setData((current) => ({ ...current, settings: { ...current.settings, projects: remaining }, project: item.id === project ? null : current.project }));
    if (item.id === project) {
      setProject("");
      setSession("");
      if (remaining.length) void openProject(remaining[0]);
      else setFolderOpen(true);
    }
  }
  async function continueChatInNew(sessionRow: any) {
    await run(async () => {
      const next = await api("chat/action", { project, session: sessionRow.id, action: "fork" });
      setSession(next.id);
      setView("chat");
    });
  }
  async function archiveChat(sessionRow: any) {
    if (!await confirmation.ask({ title: `Archive “${sessionRow.title || "New chat"}”?`,
      description: "Archived chats stay in history and can be restored later.", confirmLabel: "Archive chat", danger: true })) return;
    await run(async () => {
      await api("history/archive", { project, session: sessionRow.id, archived: true,
        revision: sessionRow.organization?.revision ?? 0 }, "PUT");
      if (session === sessionRow.id) setSession("");
      await refresh();
    });
  }
  async function pinChat(sessionRow: any) {
    await run(async () => {
      await api("history/pin", { project, session: sessionRow.id, pinned: !sessionRow.organization?.pinnedAt,
        revision: sessionRow.organization?.revision ?? 0 }, "PUT");
      await refresh();
    });
  }
  async function exportChat(sessionRow: any) {
    await run(async () => {
      const saved = await api("history/export", { project, sessions: [sessionRow.id], format: "markdown", includeWorkers: false });
      const url = URL.createObjectURL(new Blob([saved.content], { type: saved.mime }));
      const link = document.createElement("a");
      link.href = url; link.download = saved.filename; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  return (
    <AppearanceContext.Provider value={data?.settings.appearance ?? {}}>
    <IndexJobsContext.Provider value={indexJobs}>
    <div className="workspace resizable-workspace" style={panelLayout.style}>
      <aside className="sidebar" id="workspace-navigation">
        <div className="brand">
          <span>
            <Route size={21} />
          </span>
          Freelancer
        </div>
        <ProjectNavigation
          projects={(data?.settings.projects ?? []).filter(p => !p.organization?.archivedAt || p.id === project)}
          selected={project}
          disabled={!!projectLoading || !data || !compatibleApplication(data)}
          onSelect={(p) => {
            void openProject(p);
          }}
          onAdd={() => {
            setError("");
            setImportError('');
            setFolderOpen(true);
          }}
          onManage={(p) => { setProjectEdit(p); setProjectName(p.name); }}
        />
        <ChatNavigation
          sessions={(data?.sessions ?? []).filter((s) => !s.parentID && !s.organization?.archived).slice(0, 40)
            .map((s) => ({ ...s, activity: sessionActivity?.[s.id] }))}
          selected={session} disabled={!!projectLoading || !data || !compatibleApplication(data)} creating={creatingChat}
          onNew={() => run(createChat)}
          onSelect={(s) => { setSession(s.id); setView("chat"); }}
          onContinue={continueChatInNew} onArchive={archiveChat} onPin={pinChat} onExport={exportChat}
        />
        <div className="sidebar-bottom usage-dock">
          <SettingsNavigation expanded={expandedSettings} scope={navigationScope} tab={navigationTab}
            project={!!project} onToggle={(scope) => setExpandedSettings(expandedSettings === scope ? null : scope)}
            onSelect={openSettings} />
          <UsageSidebar view={availableUsage.view} state={availableUsage.state}
            onRefresh={availableUsage.refresh} onOpen={() => setView("overview")} />
        </div>
      </aside>
      {panelLayout.fitted.navigationResizable && <PanelResize panel="navigation" layout={panelLayout} />}
      <main className="main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              {data?.project?.name ?? "Your workspace"}
            </span>
            <span className="slash">/</span>
            {view !== "chat" && view !== "overview" && <><span className="breadcrumb">{navigationScope === "project" ? "Project settings" : "Application settings"}</span><span className="slash">/</span></>}
            <strong>{view === "chat" ? current?.title ?? "New chat" : view === "overview" ? "Available Usage" : settingsItemLabel(navigationScope, navigationTab)}</strong>
          </div>
          <div className="topbar-right">
            {view === "chat" && current?.parentID && (
              <Button
                variant="quiet"
                onClick={() => setSession(current.parentID)}
              >
                Back to parent chat
              </Button>
            )}
            {!!project && (
              <ChatActions
                key={project}
                project={project}
                session={current}
                model={model}
                run={run}
                refresh={refresh}
                onSession={setSession}
                onHistory={() => openHistory(current?.parentID ?? current?.id)}
              />
            )}
            {view === "chat" && session && (
              <Button variant="quiet" onClick={() => setDetails(!details)}>
                <PanelLeftClose size={16} />
                Details
              </Button>
            )}
            <Badge tone="success">
              <span className="dot" />
              {projectLoading
                ? "Opening project"
                : !data
                  ? "Connecting"
                  : !compatibleApplication(data)
                    ? "Restart needed"
                    : "Connected"}
            </Badge>
            <button
              aria-label="Refresh"
              className="icon-button"
              onClick={() => run(() => Promise.all([refresh(), refreshChat()]))}
            >
              <RefreshCw size={17} className={working ? "spin" : ""} />
            </button>
          </div>
        </header>
        <div className="workspace-progress"><ModelRatingProgress ratings={modelRatings} />
          {!projectLoading && <IndexJobProgress jobs={indexJobs} />}</div>
        {panelLayout.error && (
          <div className="error-banner" role="alert">{panelLayout.error}
            <button aria-label="Dismiss layout error" onClick={panelLayout.dismissError}><X size={16} /></button>
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {data?.localDataError && (
          <div className="error-banner" role="alert">
            Freelancer could not open its local SQLite data: {data.localDataError}. Native OpenCode chats remain available; local pins, archives, drafts, and search may be unavailable. The database was left untouched.
          </div>
        )}
        {chat.availabilityWarnings?.length > 0 && (
          <div className="error-banner" role="alert">
            This chat loaded with incomplete live data: {chat.availabilityWarnings.join(" · ")}
          </div>
        )}
        {!data ? (
          <Empty
            icon={LoaderCircle}
            title="Opening your workspace…"
            action={
              error ? (
                <Button onClick={() => run(refresh)}>Try again</Button>
              ) : undefined
            }
          ><ProgressStatus label="Connecting to OpenCode and loading projects, models and saved settings…" /></Empty>
        ) : !compatibleApplication(data) ? (
          <Empty icon={RefreshCw} title="Restart Freelancer to finish updating">
            The app has been updated. Close and reopen Freelancer to load its
            new settings and model choices.
          </Empty>
        ) : project && data.project?.id !== project ? (
          <Empty icon={LoaderCircle} title="Loading project…" />
        ) : (
          <Suspense fallback={<Empty icon={LoaderCircle} title="Opening page…" />}>
              <div className="chat-workspace" hidden={view !== "chat"}>
                {chat.imported && <div className="imported-chat-notice"><span>Imported from ChatGPT / Codex · one-time snapshot. Continue to orient a new chat from this history.</span>
                  <Button disabled={working || current?.organization?.archived || data.project?.organization?.archivedAt} onClick={() => void run(async () => {
                    const next = await api('chat/imported/continue', { project, session }); setSession(next.id);
                  })}>Continue in Freelancer</Button></div>}
                {chat.continuation && <div className="imported-chat-notice" role="status"><span>{(sending && !chat.receipts?.length) || (busy && chat.receipts?.at(-1)?.orienting) ? 'Orienting…' : 'Continued from a ChatGPT / Codex snapshot. Saved history provides the starting context.'}</span></div>}
                {(current?.organization?.archived || data.project?.organization?.archivedAt) && <div className="archive-banner" role="status">This work is archived{current?.organization?.archiveScope === 'freelancer' ? ' in Freelancer only' : ''}. Restore it before sending. <Button onClick={() => { if (data.project?.organization?.archivedAt) openSettings('application', 'storage'); else openHistory(current?.parentID ?? current?.id); }}>Manage archive</Button></div>}
                {(draftMemory.status || draftMemory.error) && <div className="draft-status" role={draftMemory.error ? 'alert' : 'status'}>{draftMemory.error || draftMemory.status}{draftMemory.error && <><Button onClick={() => run(draftMemory.retry)}>Retry save</Button><Button title="Replace this box with the saved draft. Copy current text first." onClick={async () => { if (await confirmation.ask({ title: 'Load the saved draft?', description: 'Copy your current text first; this replaces the text in the box.', confirmLabel: 'Load saved draft' })) void run(draftMemory.reload); }}>Load saved draft</Button></>}</div>}
                <div className="requests" ref={decisions} tabIndex={-1} aria-label="Pending decisions">
                  <Permissions key={`permissions-${query(project, session)}`} requests={chat.permissions}
                    suspended={view !== 'chat' || folderOpen || !!projectLoading}
                    onRespond={async (id, reply) => {
                      await api("respond", { project, type: 'permission', id, response: { reply } });
                      void refreshChat().catch(() => {});
                    }} />
                  <Questions
                    key={query(project, session)}
                    requests={chat.questions}
                    suspended={view !== "chat" || historyOpen || folderOpen || !!projectLoading}
                    onRespond={async (id, response) => {
                      // Let the dialog display failures; run() intentionally swallows them.
                      await api("respond", { project, type: "question", id, response });
                      // A successful answer must not be resubmitted if this read fails.
                      void refreshChat().catch(() => {});
                    }}
                  />
                </div>
                <div
                  className={`conversation-layout ${details ? "with-details" : ""}`}
                >
                  <Chat
                    data={data}
                    loading={chatLoading}
                    loadingLabel={startingSession === "__new__" || startingSession === session && !!session ? "Sending your first message…" : "Opening chat and choices…"}
                    messages={chat.messages}
                    todos={chat.todos ?? EMPTY_TODOS}
                    session={current}
                    busy={busy}
                    draft={draft}
                    setDraft={setDraft}
                    draftLoading={draftMemory.loading}
                    captureDraft={draftMemory.capture}
                    acceptDraft={draftMemory.controller.accept}
                    model={model}
                    setModel={setModel}
                    variant={variant}
                    setVariant={setVariant}
                    onSend={send}
                    attachmentStore={attachmentStore.current}
                    onStop={() =>
                      run(async () => {
                        await api("stop", { project, session });
                        await refreshChat();
                      })
                    }
                    onChild={setSession}
                    agentID={agentID}
                    setAgentID={setAgentID}
                    workflowID={workflowID}
                    onWorkflow={useWorkflow}
                    changeCount={new Set((chat.diff ?? []).map(file => file.file ?? file.path)).size}
                    pendingDecisions={(chat.permissions ?? []).length + (chat.questions ?? []).length}
                    onReviewDecisions={() => {
                      decisions.current?.scrollTo({ top: 0 });
                      (decisions.current?.querySelector("button") as HTMLButtonElement | null)?.focus();
                    }}
                    onOpenDetails={openDetails}
                  />
                  {panelLayout.fitted.detailsResizable && <PanelResize panel="details" layout={panelLayout} />}
                  {details && (
                    <Details
                      chat={chat}
                      busy={busy}
                      project={project}
                      appearance={data.settings.appearance}
                      contributions={data.costs.contributions?.chats.find(
                        (c) => c.sessionID === session,
                      )}
                      requestTab={detailsSel}
                      onChild={setSession}
                    />
                  )}
                </div>
              </div>
            {view === "github" && <GitHubProject key={project} project={project} onUseSync={() => {
              setAgentID("git"); setWorkflowID("sync"); setModel("inherit"); setVariant("inherit"); setView("chat");
            }} />}
            {view === "overview" && (
              <div className="page overview">
                <div className="page-title">
                  <div>
                    <h1>Available Usage</h1>
                  </div>
                </div>
                <UsageHero view={availableUsage.view} state={availableUsage.state} onRefresh={availableUsage.refresh} />
                <div className="overview-grid">
                  <Panel title="Your providers">
                    <UsageProviders view={availableUsage.view} />
                    <Button
                      variant="quiet"
                      onClick={() => {
                        openSettings("application", "providers");
                      }}
                    >
                      Manage providers
                      <ArrowUpRight size={16} />
                    </Button>
                  </Panel>
                  <Panel title="Model contributions">
                    <small>Recorded activity this month, not a quality score.</small>
                    <ContributionRows breakdown={data.costs.contributions?.models} />
                  </Panel>
                </div>
                {!!data.costs.contributions?.agents.rows.length && (
                  <Panel title="Agent contributions">
                    <small>Recorded activity this month, not a quality score.</small>
                    <ContributionRows breakdown={data.costs.contributions.agents} />
                  </Panel>
                )}
                <Panel title="Pick up where you left off">
                  <div className="project-cards">
                    {data.settings.projects.filter(p => !p.organization?.archivedAt).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => void openProject(p)}
                      >
                        <FolderOpen size={23} />
                        <strong>{p.name}</strong>
                        <small>{p.directory}</small>
                        <ArrowUpRight size={17} />
                      </button>
                    ))}
                    <button onClick={() => setFolderOpen(true)}>
                      <Plus size={23} />
                      <strong>Open a project</strong>
                    </button>
                  </div>
                </Panel>
              </div>
            )}
            {view === "files" && project && (
              <Files project={project} run={run} />
            )}
            {view === "history" && project && <HistoryPage key={historySelection ?? "all"} data={data} project={project} activity={sessionActivity} initialSession={historySelection} onClose={() => setView("chat")} onChange={refresh} onOpen={async (projectID, id) => {
              if (projectID !== project) {
                const selected = data.settings.projects.find(p => p.id === projectID);
                if (!selected) return;
                await openProject(selected);
                if (navigation.current !== query(projectID)) return;
              }
              setSession(id); setView("chat");
            }} />}
            {(view === "agents" || view === "workflows") && (
              <WorkspaceCatalog
                key={view}
                kind={view}
                data={data}
                run={run}
                refresh={refresh}
                onUse={(item) => {
                  setVariant("inherit");
                  if (view === "agents") {
                    setAgentID(item.id);
                    setModel("inherit");
                  } else useWorkflow(item);
                  setView("chat");
                }}
              />
            )}
            {view === "settings" && (
              <div className="page">
                <Settings
                  sessionID={session}
                  onHistory={() => openHistory()}
                  data={data}
                  onAppearanceSaved={appearanceSaved}
                  onColorsSaved={colorsSaved}
                  onNavigate={setView}
                  tab={tab}
                  run={run}
                  refresh={refresh}
                />
              </div>
            )}
            {view === "models" && (
              <div className="page">
                 <div className="page-title">
                   <h1>Models</h1>
                   <Button disabled={modelRatings.pending} onClick={async () => {
                     if (['starting', 'running'].includes(modelRatings.job?.status)) { modelRatings.reveal(); return; }
                     if (!modelRatings.job || await modelRatings.dismiss()) setRatingDialog(true);
                   }}>
                     Update Model Ratings
                   </Button>
                 </div>
                 <div className="model-filters">
                   <FieldSearch value={modelQuery} onChange={setModelQuery} />
                  <ProviderSelect provider={modelProvider}
                    aria-label="Provider filter"
                    value={modelProvider}
                    onChange={(e) => setModelProvider(e.target.value)}
                  >
                    <option value="">All providers</option>
                    {data.providers.all.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </ProviderSelect>
                  <select
                    aria-label="Sort models"
                    value={modelSort}
                    onChange={(e) => setModelSort(e.target.value)}
                  >
                    {[
                      ["cost", "Access type"],
                      ["context", "Context"],
                      ["coding", "Coding"],
                      ["reasoning", "Reasoning"],
                      ["outcomes", "Checked outcomes"],
                      ["recent", "Recent use"],
                    ].map(([id, label]) => (
                      <option value={id} key={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                   <div className="access-toggle" role="group" aria-label="Model access">
                     <Button aria-pressed={!freeOnly} onClick={() => setFreeOnly(false)}>All</Button>
                     <Button aria-pressed={freeOnly} onClick={() => setFreeOnly(true)}>Free</Button>
                   </div>
                 </div>
                 {!browseModels(data.models, { query: modelQuery, provider: modelProvider, sort: modelSort, freeOnly }).length &&
                   <p role="status">No models match these filters.</p>}
                 <div className="model-grid">
                  {browseModels(data.models, {
                    query: modelQuery,
                    provider: modelProvider,
                    sort: modelSort,
                    freeOnly,
                  }).map((m) => {
                    const used = !!m.recent || m.outcomes?.total > 0 ||
                      data.costs.contributions?.models?.rows?.some((row: any) => row.id === m.id);
                    const status = modelStatus(m.availability, used);
                    const facts = [
                      m.context ? `Context ${modelQuantity(m.context)}` : null,
                      m.output ? `Output ${modelQuantity(m.output)}` : null,
                      m.tools === true ? 'Tool use' : m.tools === false ? 'No tool use' : null,
                      ...(m.variants ?? []).map((variant: string) => `Variant ${variant}`),
                    ].filter(Boolean);
                    return <Panel key={m.id} {...providerAttributes(m.provider, data.settings.appearance ?? {})} className="provider-model-card">
                      <div className="balance-row">
                        <h3><ProviderText provider={m.provider} mark>{m.name}</ProviderText></h3>
                        <span className={`model-status ${status.tone}`} title={m.availability}
                          aria-label={`Model status: ${status.label} (${m.availability})`}>
                          <span className="model-status-dot" aria-hidden="true" />{status.label}
                        </span>
                      </div>
                      <div className="model-provider-name"><ProviderText provider={m.provider}>
                        {data.providers.all.find((p) => p.id === m.provider)?.name ?? m.provider}
                      </ProviderText></div>
                      <div className="model-facts" aria-label="Native model characteristics">
                        <Badge tone={m.costClass === 'free' ? 'success' : 'neutral'}>
                          {m.costClass === 'free' ? 'Free' : m.costClass === 'metered' ? 'Metered' : m.costClass === 'credits' ? 'Credits' : 'Plan'}
                        </Badge>
                        {facts.map((fact: string) => <span className="model-fact" key={fact}>{fact}</span>)}
                      </div>
                      <Button
                        onClick={() => {
                          setModel(m.id);
                          setView("chat");
                        }}
                      >
                        Use model
                        <ArrowUpRight size={14} />
                      </Button>
                    </Panel>;
                  })}
                </div>
              </div>
            )}
          </Suspense>
        )}
      </main>
      {confirmation.ui}
      {ratingDialog && data && <ModelRatingDialog models={data.models} connected={data.providers.connected} project={project}
        pending={modelRatings.pending} error={modelRatings.error} onClose={() => setRatingDialog(false)} onStart={modelRatings.start} />}
      {projectLoading && <ProjectProgress {...projectLoading} onStop={indexJobs.job?.status === 'running' && indexJobs.job?.stoppable
        ? () => { void indexJobs.stop().catch(() => {}); } : undefined} />}
      {folderOpen && (
            <Dialog title="Where are we working?" ariaLabel="Open project" description="Choose a project folder to get started."
            icon={<FolderOpen />} onClose={() => setFolderOpen(false)} busy={!!projectLoading || importBusy} initialFocus="first"
            size={data?.settings.projects.length ? 'wide' : 'compact'} layout={data?.settings.projects.length ? 'split' : 'stack'}
            footer={<>
              <Button
                type="button"
                disabled={!!projectLoading || importBusy}
                onClick={() => setFolderOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="primary" disabled={!folder.trim() || working || importBusy}>
                {importBusy ? 'Checking for chats…' : 'Next'}
                <ArrowUpRight size={16} />
              </Button>
            </>}
            onSubmit={(e) => {
              e.preventDefault();
              void previewProject();
            }}
          >
            <div className="ef-dialog-stack">
            <label className="field">
              <span>Project folder</span>
              <input
                autoFocus
                placeholder="F:\MyProject"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              />
            </label>
            <Button type="button" disabled={importBusy || !!projectLoading} onClick={() => setFolderPicker(true)}><FolderOpen size={16} />Browse folders…</Button>
            {importError && <p role="alert" className="notice error">{importError}</p>}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            </div>
            {!!data?.settings.projects.length && <section className="project-choices"><h3>Recent projects</h3>
            {data?.settings.projects.filter(p => !p.organization?.archivedAt).map((p) => (
              <button
                type="button"
                className="recent-project"
                key={p.id}
                disabled={!!projectLoading || importBusy}
                onClick={() => {
                  void openProject(p);
                }}
              >
                <FolderOpen size={16} />
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.directory}</small>
                </span>
              </button>
            ))}
            </section>}
          </Dialog>
      )}
      {folderPicker && <FolderPicker initial={folder.trim()} onClose={() => setFolderPicker(false)} onPick={directory => { setFolder(directory); setFolderPicker(false); }} />}
      {importPreview && <ProjectImport preview={importPreview} busy={importBusy} error={importError} onClose={() => setImportPreview(null)} onComplete={selected => void finishProjectSetup(selected)} />}
      {projectEdit && (
          <Dialog title="Manage project" icon={<FolderOpen />} onClose={() => setProjectEdit(null)} busy={working} initialFocus="first"
            description="This changes the name shown in Freelancer. The folder and native workspace stay where they are."
            footer={<>
              <Button type="button" onClick={() => setProjectEdit(null)}>Done</Button>
              <Button type="button" onClick={() => void run(() => removeProject(projectEdit))}>Delete from Freelancer</Button>
              <Button variant="primary" disabled={!projectName.trim() || working}>Save name</Button>
            </>}
            onSubmit={(e) => { e.preventDefault(); void run(saveProjectName); }}>
            <label className="field"><span>Project name</span><input autoFocus value={projectName} maxLength={80} onChange={(e) => setProjectName(e.target.value)} /></label>
            <label className="field"><span>Folder</span><input value={projectEdit.directory} readOnly /></label>
            {error && <p className="notice error" role="alert">{error}</p>}
          </Dialog>
      )}
    </div>
    </IndexJobsContext.Provider>
    </AppearanceContext.Provider>
  );
}
function FieldSearch({ value, onChange }) {
  return (
    <label className="search">
      <Search size={17} />
      <input
        aria-label="Search models"
        placeholder="Find a model…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
