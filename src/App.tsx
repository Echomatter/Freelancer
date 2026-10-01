import {
  ArrowUpRight,
  BrainCircuit,
  FolderOpen,
  Gauge,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  Suspense,
  lazy,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { delegateChildSession } from "../domain/chat-view.mjs";
import { compatibleApplication } from "../domain/protocol.mjs";
import { mergeProviderColors } from "../domain/provider-colors.mjs";
import { senderState } from "../domain/sender.mjs";
import { startingChoices } from "../domain/session-defaults.mjs";
import { applyTheme } from "../domain/theme.mjs";
import { browseModels } from "../shared/view.mjs";
import { api, query, subscribe } from "./api";
import {
  UsageHero,
  UsagePreferences,
  UsageProviders,
  UsageSidebar,
} from "./AvailableUsage";
import { Chat } from "./Chat";
import { ContributionRows } from "./Contributions";
import {
  Badge,
  Button,
  Empty,
  Field,
  PageCloseButton,
  PageHeading,
  Panel,
} from "./echoflex/Controls";
import { Dialog, useConfirmation } from "./echoflex/Dialog";
import { Goals, useGoals } from "./Goals";
import { ContentSearch } from "./IndexedSearch";
import { IndexJobProgress, IndexJobsContext, useIndexJobs } from "./IndexJobs";
import { eventRefreshScope } from "./live-events.mjs";
import {
  ModelRatingDialog,
  ModelRatingProgress,
  useModelRatings,
} from "./ModelRatings";
import { ChatNavigation, ProjectNavigation } from "./NavigationMenus";
import { PanelResize, usePanelLayout } from "./PanelResize";
import { Permissions } from "./Permissions";
import { FolderPicker, ProjectImport } from "./ProjectImport";
import {
  AppearanceContext,
  ProviderSelect,
  ProviderText,
  providerAttributes,
  type ColorPatch,
} from "./ProviderColors";
import { Questions } from "./Question";
import { RecentChats, chatWarmTargets } from "./recent-chats.mjs";
import { RenderBoundary } from "./RenderBoundary";
import { useProjectActivity } from "./SessionActivity";
import { SettingsNavigation, type SettingsScope } from "./SettingsNavigation";
import { shareSnapshot } from "./snapshot-sharing.mjs";
import { useAvailability } from "./useAvailability";
import { useDrafts } from "./useDrafts";
import { useWorkspaceViewState } from "./useWorkspaceViewState";
import { Files } from "./WorkspacePanels";
const HistoryPage = lazy(() =>
  import("./History").then((module) => ({ default: module.HistoryPage })),
);
const GitHubProject = lazy(() =>
  import("./GitHubProject").then((module) => ({
    default: module.GitHubProject,
  })),
);
const Settings = lazy(() =>
  import("./Settings").then((module) => ({ default: module.Settings })),
);
const WorkspaceCatalog = lazy(() =>
  import("./WorkspaceCatalog").then((module) => ({
    default: module.WorkspaceCatalog,
  })),
);

const EMPTY_TODOS: any[] = [];
const parentDirectory = (path: string) => {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
};
const compactModelNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function modelStatus(availability: string, used = false) {
  if (availability === "deprecated")
    return { label: "Deprecated", tone: "error" };
  if (availability === "quota constrained")
    return { label: "Quota limited", tone: "warning" };
  if (used) return { label: "Used", tone: "success" };
  return { label: "Not tested", tone: "neutral" };
}

function modelQuantity(value: number) {
  return compactModelNumber.format(value);
}

function ChatLoading({
  label,
  title = "Opening your chat",
  children,
}: {
  label: string;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="chat-loading-stage"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="chat-loading-content">
        <div className="chat-loading-halo" aria-hidden="true">
          <LoaderCircle size={34} strokeWidth={1.6} />
        </div>
        <strong>{title}</strong>
        <span>{label}</span>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const confirmation = useConfirmation();
  const workspaceView = useWorkspaceViewState();
  const navigationCollapsed = workspaceView.state?.navigationCollapsed === true;
  const setNavigationCollapsed = (value: boolean) => {
    void workspaceView.save({ navigationCollapsed: value });
  };
  const [navigationHiddenMobile, setNavigationHiddenMobile] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 720px)").matches,
  );
  const navigationTouch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setNarrowViewport(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const toggleNavigation = () => {
    collapseNavigation();
    if (narrowViewport) setNavigationHiddenMobile((value) => !value);
    else {
      const next = !navigationCollapsed;
      setNavigationCollapsed(next);
    }
  };
  const navigationControlLabel = narrowViewport
    ? navigationHiddenMobile
      ? "Show navigation"
      : "Hide navigation"
    : navigationCollapsed
      ? "Expand navigation"
      : "Collapse navigation";
  const [folderPicker, setFolderPicker] = useState(false),
    [importPreview, setImportPreview] = useState<any>(null);
  const [indexedFilePath, setIndexedFilePath] = useState("");
  const [fileFolderPath, setFileFolderPath] = useState("");
  const [fileNavigation, setFileNavigation] = useState(0);
  const [importBusy, setImportBusy] = useState(false),
    [importError, setImportError] = useState("");
  const [data, setData] = useState<any>(null),
    [project, setProject] = useState(""),
    [session, setSession] = useState(""),
    [chatState, setChat] = useState<any>({
      messages: [],
      status: {},
      permissions: [],
      questions: [],
    });
  useEffect(() => {
    if (!project || !session) return;
    if (workspaceView.state)
      void workspaceView.save({ lastChats: { [project]: session } });
  }, [project, session]);
  const [view, setViewState] = useState("chat"),
    [tab, setTab] = useState("providers"),
    [settingsScope, setSettingsScope] = useState<SettingsScope>("application"),
    [expandedNavigation, setExpandedNavigation] =
      useState<SettingsScope | null>(null),
    [expandedProjects, setExpandedProjects] = useState(false),
    [expandedChats, setExpandedChats] = useState(false),
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
  const continuePreparation = useRef<(() => void) | null>(null);
  const indexJobs = useIndexJobs();
  const decisions = useRef<HTMLDivElement>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [ratingDialog, setRatingDialog] = useState(false);
  const [modelProvider, setModelProvider] = useState(""),
    [modelSort, setModelSort] = useState("cost"),
    [freeOnly, setFreeOnly] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingKey, setSendingKey] = useState("");
  const sendFlight = useRef(false);
  const stopFlight = useRef(false);
  const [pendingSend, setPendingSend] = useState<{
    key: string;
    text: string;
    attachments: { filename: string; mime: string; url: string }[];
    previousIDs: string[];
    state: "sending" | "accepted" | "unconfirmed";
  } | null>(null);
  const attachmentStore = useRef(new Map<string, any[]>());
  const [creatingChat, setCreatingChat] = useState(false);
  const [startingSession, setStartingSession] = useState("");
  const recentChats = useRef(new RecentChats());
  const cacheVersion = useRef(0);
  const warmQueue = useRef<
    { project: string; session: string; depth: number; refresh: boolean }[]
  >([]);
  const warmQueued = useRef(new Set<string>()),
    warming = useRef(new Set<string>());
  const warmRetryAfter = useRef(new Map<string, number>());
  const warmRunning = useRef(0),
    otherProjectActivityAt = useRef(new Map<string, number>());
  const [choicesKey, setChoicesKey] = useState("");
  const [historySelection, setHistorySelection] = useState<
    string | undefined
  >();
  const historyOpen = view === "history";
  const compactNavigation = narrowViewport || navigationCollapsed;
  const collapseNavigation = () => {
    setExpandedNavigation(null);
    setExpandedProjects(false);
    setExpandedChats(false);
  };
  const dismissCompactNavigation = () => {
    if (!compactNavigation) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.closest("#workspace-navigation")
    )
      active
        .closest(".nav-accordion, .settings-drawer")
        ?.querySelector<HTMLButtonElement>(".nav-card-trigger")
        ?.focus();
    collapseNavigation();
  };
  const toggleNavigationGroup = (
    group: SettingsScope | "projects" | "chats",
  ) => {
    if (group === "projects") setExpandedProjects((value) => !value);
    else if (group === "chats") setExpandedChats((value) => !value);
    else setExpandedNavigation((value) => (value === group ? null : group));
    if (compactNavigation) {
      if (group !== "projects") setExpandedProjects(false);
      if (group !== "chats") setExpandedChats(false);
      if (group === "projects" || group === "chats")
        setExpandedNavigation(null);
    }
  };
  useEffect(() => {
    setExpandedProjects(false);
  }, [project]);
  useEffect(() => {
    collapseNavigation();
  }, [narrowViewport, navigationCollapsed]);
  useEffect(() => {
    const dismiss = collapseNavigation;
    window.addEventListener("popstate", dismiss);
    return () => window.removeEventListener("popstate", dismiss);
  }, []);
  const setView = (next: React.SetStateAction<string>) => {
    dismissCompactNavigation();
    startTransition(() => setViewState(next));
  };
  const openHistory = (id?: string) => {
    setHistorySelection(id);
    setExpandedNavigation("application");
    setView("history");
  };
  const closeSettings = () => {
    setExpandedNavigation(null);
    setHistorySelection(undefined);
    setIndexedFilePath("");
    setFileFolderPath("");
    setView("chat");
  };
  const openSettings = (scope: SettingsScope, item: string) => {
    if (item === "history") {
      openHistory();
      return;
    }
    if (item === "files") {
      setIndexedFilePath("");
      setFileFolderPath("");
      setFileNavigation((value) => value + 1);
    }
    setSettingsScope(scope);
    setExpandedNavigation(scope);
    setTab(item);
    setView(
      (
        {
          github: "github",
          models: "models",
          usage: "overview",
          agents: "agents",
          files: "files",
          search: "search",
        } as Record<string, string>
      )[item] ?? "settings",
    );
  };
  const openDirectory = (relativePath: string) => {
    setFileNavigation((value) => value + 1);
    setIndexedFilePath("");
    setFileFolderPath(relativePath);
    setSettingsScope("project");
    setExpandedNavigation("project");
    setTab("files");
    setView("files");
  };
  const navigationScope: SettingsScope = historyOpen
    ? "application"
    : view === "search"
      ? settingsScope
      : view === "settings"
        ? settingsScope
        : view === "models" || view === "overview"
          ? "application"
          : "project";
  const navigationTab = historyOpen
    ? "history"
    : view === "settings"
      ? tab
      : view === "chat"
        ? ""
        : view === "overview"
          ? "usage"
          : view;
  const [agentID, setAgentID] = useState("engineer");
  const sessionActivity = useProjectActivity(
    project,
    !!data && compatibleApplication(data) && !projectLoading,
  );
  const restoredChoices = useRef("");
  useEffect(() => {
    const key = query(project, session);
    const restorationKey = session
      ? key
      : `${key}:${data?.sessionDefaults?.revision ?? 0}`;
    if (
      data?.project?.id !== project ||
      (!session && data.selectionKey !== key) ||
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
        data.settings.agents.some((a) => a.id === choice.agentID)
          ? choice.agentID
          : "engineer",
      );
      setModel(choice.model ?? "inherit");
      setVariant(choice.variant ?? "inherit");
    } else {
      setAgentID("engineer");
      setModel("inherit");
      setVariant("inherit");
    }
    setChoicesKey(restorationKey);
  }, [data, project, session]);
  useEffect(() => {
    if (!data) return;
    if (!data.settings.agents.some((a) => a.id === agentID))
      setAgentID("engineer");
  }, [data?.settings.agents, agentID]);
  const panelLayout = usePanelLayout(
    data ? (data.settings.appearance ?? {}) : undefined,
    false,
  );
  const pending = useRef(0);
  const bootstrapVersion = useRef(0),
    chatVersion = useRef(0),
    chatRequests = useRef(
      new Map<string, { version: number; promise: Promise<any> }>(),
    ),
    timer = useRef<ReturnType<typeof setTimeout>>();
  const navigation = useRef("");
  const draftMemory = useDrafts(
    project,
    session,
    !!data && compatibleApplication(data),
  );
  const draftSaving = draftMemory.status === "Saving draft…";
  const draft = draftMemory.text,
    setDraft = draftMemory.setText;
  navigation.current = query(project, session);
  const prepareProject = async (target: { id: string; name: string }) => {
    let waiting = true;
    const preparation = indexJobs
      .prepare(target.id, (job) => {
        if (waiting)
          setProjectLoading({
            name: target.name,
            phase: job.label,
            step: job.step,
          });
      })
      .catch((e) => {
        setError(
          `Index preparation for ${target.name} needs attention: ${(e as Error).message}`,
        );
      });
    try {
      await Promise.race([
        preparation,
        new Promise<void>((resolve) => {
          continuePreparation.current = resolve;
        }),
      ]);
    } finally {
      waiting = false;
      continuePreparation.current = null;
    }
  };
  const refresh = async (signal?: AbortSignal) => {
    if (projectTransition.current) return;
    const key = query(project, session),
      id = ++bootstrapVersion.current;
    const next = await api("bootstrap?" + key, undefined, "GET", signal);
    if (
      !initialProject.current &&
      next.indexPreparation &&
      next.project &&
      compatibleApplication(next) &&
      id === bootstrapVersion.current &&
      navigation.current === key
    ) {
      initialProject.current = true;
      projectTransition.current = true;
      setProjectLoading({
        name: next.project.name,
        phase: "Checking project indexes…",
        step: "files",
      });
      try {
        await prepareProject(next.project);
      } catch (e) {
        setError(
          `Workspace opened; index preparation needs attention: ${(e as Error).message}`,
        );
      } finally {
        projectTransition.current = false;
        setProjectLoading(null);
      }
    }
    if (id === bootstrapVersion.current && navigation.current === key)
      setData((previous) =>
        shareSnapshot(previous, { ...next, selectionKey: key }),
      );
  };
  const availableUsage = useAvailability(data, refresh);
  const colorsSaved = (patch: ColorPatch) => {
    bootstrapVersion.current++;
    setData((current) =>
      current
        ? {
            ...current,
            settings: {
              ...current.settings,
              appearance: {
                ...current.settings.appearance,
                ...(patch.theme ? { theme: patch.theme } : {}),
                ...(patch.customThemes
                  ? { customThemes: patch.customThemes }
                  : {}),
                ...(patch.providerColors
                  ? {
                      providerColors: mergeProviderColors(
                        current.settings.appearance?.providerColors,
                        patch.providerColors,
                      ),
                    }
                  : {}),
              },
            },
          }
        : current,
    );
  };
  const refreshChat = async (
    targetProject = project,
    targetSession = session,
    originKey = "",
  ) => {
    if (projectTransition.current) return;
    if (targetProject && targetSession) {
      const key = query(targetProject, targetSession),
        existing = chatRequests.current.get(key),
        reusable = existing?.version === chatVersion.current,
        id = reusable ? existing.version : ++chatVersion.current;
      let request = reusable ? existing : undefined;
      if (!request) {
        const cacheID = ++cacheVersion.current;
        const promise = api("chat?" + key)
          .then((next) => {
            recentChats.current.put(
              targetProject,
              targetSession,
              next,
              cacheID,
            );
            return next;
          })
          .finally(() => {
            if (chatRequests.current.get(key)?.version === id)
              chatRequests.current.delete(key);
          });
        request = { version: id, promise };
        chatRequests.current.set(key, request);
      }
      const next = await request.promise;
      queueLinkedChildren(targetProject, next, 0);
      if (
        id === chatVersion.current &&
        (navigation.current === key || navigation.current === originKey)
      ) {
        setChat((previous) =>
          shareSnapshot(previous, { ...next, loaded: true, selectionKey: key }),
        );
      }
    }
  };
  const drainWarmQueue = () => {
    while (
      !document.hidden &&
      warmRunning.current < 2 &&
      warmQueue.current.length
    ) {
      const target = warmQueue.current.shift()!,
        key = query(target.project, target.session);
      warmQueued.current.delete(key);
      const cached = recentChats.current.get(target.project, target.session);
      if (
        (cached &&
          (!target.refresh ||
            recentChats.current.isFresh(
              target.project,
              target.session,
              15_000,
            ))) ||
        chatRequests.current.has(key) ||
        warming.current.has(key)
      )
        continue;
      warming.current.add(key);
      warmRunning.current++;
      const version = ++cacheVersion.current;
      void api(`chat?${key}&preview=1`)
        .then((preview) => {
          warmRetryAfter.current.delete(key);
          recentChats.current.put(
            target.project,
            target.session,
            preview,
            version,
          );
          queueLinkedChildren(
            target.project,
            preview,
            target.depth,
            target.refresh,
          );
        })
        .catch(() => {
          warmRetryAfter.current.delete(key);
          warmRetryAfter.current.set(key, Date.now() + 30_000);
          while (warmRetryAfter.current.size > 128)
            warmRetryAfter.current.delete(
              warmRetryAfter.current.keys().next().value!,
            );
        })
        .finally(() => {
          warming.current.delete(key);
          warmRunning.current--;
          drainWarmQueue();
        });
    }
  };
  const queueWarmChat = (
    targetProject: string,
    targetSession: string,
    depth = 0,
    refreshWarm = false,
  ) => {
    if (
      !targetProject ||
      !targetSession ||
      document.hidden ||
      warmQueue.current.length >= 32
    )
      return;
    const key = query(targetProject, targetSession);
    const cached = recentChats.current.get(targetProject, targetSession);
    const retryAfter = warmRetryAfter.current.get(key) ?? 0;
    if (retryAfter > Date.now()) return;
    if (retryAfter) warmRetryAfter.current.delete(key);
    if (
      (cached &&
        (!refreshWarm ||
          recentChats.current.isFresh(targetProject, targetSession, 15_000))) ||
      chatRequests.current.has(key) ||
      warmQueued.current.has(key) ||
      warming.current.has(key)
    )
      return;
    warmQueued.current.add(key);
    warmQueue.current.push({
      project: targetProject,
      session: targetSession,
      depth,
      refresh: refreshWarm,
    });
    drainWarmQueue();
  };
  const queueLinkedChildren = (
    targetProject: string,
    chat: any,
    depth: number,
    refreshWarm = false,
  ) => {
    if (depth >= 2) return;
    const children = new Set<string>();
    for (const message of chat.messages ?? [])
      for (const part of message.parts ?? []) {
        const child = delegateChildSession(part);
        if (child) children.add(child);
      }
    for (const child of children)
      queueWarmChat(targetProject, child, depth + 1, refreshWarm);
  };
  const queueProjectWarmup = (
    targetProject: string,
    sessions: any[],
    activity: Record<string, any>,
  ) => {
    for (const target of chatWarmTargets(sessions, activity, 3).slice(0, 8))
      if (!(targetProject === project && target.id === session)) {
        const state = activity[target.id];
        queueWarmChat(
          targetProject,
          target.id,
          0,
          !!(state?.active || state?.waiting || state?.retry),
        );
      }
  };
  const modelRatings = useModelRatings(() => refresh());
  const browsedModels = useMemo(
    () =>
      browseModels(data?.models ?? [], {
        query: modelQuery,
        provider: modelProvider,
        sort: modelSort,
        freeOnly,
      }),
    [data?.models, modelQuery, modelProvider, modelSort, freeOnly],
  );
  const refreshCurrent = useRef<
    (scope: { chat: boolean; bootstrap: boolean }) => Promise<unknown>
  >(() => Promise.resolve());
  refreshCurrent.current = (scope) =>
    Promise.all([scope.chat && refreshChat(), scope.bootstrap && refresh()]);
  const eventSessions = useRef(new Set<string>());
  eventSessions.current = useMemo(() => {
    const related = new Set([session]);
    for (const message of chatState.messages ?? [])
      for (const part of message.parts ?? []) {
        const child = delegateChildSession(part);
        if (child) related.add(child);
      }
    return related;
  }, [session, chatState.messages]);
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
    if (theme)
      applyTheme(
        theme,
        document.documentElement,
        data.settings.appearance?.customThemes,
      );
  }, [
    data?.settings.appearance?.theme,
    data?.settings.appearance?.customThemes,
  ]);
  useEffect(() => {
    chatVersion.current++;
    setChat({ messages: [], status: {}, permissions: [], questions: [] });
    if (project && session) void run(refreshChat);
  }, [project, session]);
  useEffect(() => {
    if (data?.project?.id !== project || !project) return;
    queueProjectWarmup(project, data.sessions ?? [], sessionActivity ?? {});
  }, [data?.selectionKey, data?.sessions, project, session, sessionActivity]);
  const warmProjects = [
    ...new Set([
      project,
      ...(data?.settings.projects ?? [])
        .filter((item: any) => !item.organization?.archivedAt)
        .toSorted(
          (a: any, b: any) =>
            Date.parse(b.openedAt ?? "") - Date.parse(a.openedAt ?? ""),
        )
        .slice(0, 3)
        .map((item: any) => item.id),
    ]),
  ]
    .filter(Boolean)
    .slice(0, 3);
  const warmProjectKey = warmProjects.join("\0");
  useEffect(() => {
    if (!project || !data || data.project?.id !== project) return;
    const otherProjects = warmProjects.filter((id) => id !== project);
    const refreshOtherProjects = () => {
      if (document.hidden) return;
      for (const id of otherProjects) {
        const last = otherProjectActivityAt.current.get(id) ?? 0;
        if (Date.now() - last < 45_000) continue;
        otherProjectActivityAt.current.set(id, Date.now());
        void api("activity?" + query(id))
          .then((result) => {
            if (result?.project === id)
              queueProjectWarmup(
                id,
                result.recent ?? [],
                result.sessions ?? {},
              );
          })
          .catch(() => {
            otherProjectActivityAt.current.delete(id);
          });
      }
    };
    refreshOtherProjects();
    const timer = window.setInterval(refreshOtherProjects, 60_000);
    return () => window.clearInterval(timer);
  }, [project, data?.project?.id, warmProjectKey]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        const sidebar = document.getElementById("workspace-navigation");
        const compact =
          window.matchMedia("(max-width: 720px)").matches ||
          sidebar?.closest(".navigation-collapsed");
        // Navigation handles its own innermost dismissal before page-level Back.
        if (
          sidebar?.contains(e.target as Node) ||
          (compact &&
            sidebar?.querySelector('.nav-card-trigger[aria-expanded="true"]'))
        )
          return;
        if (projectTransition.current) return;
        setFolderOpen(false);
        setView((current) => (current === "history" ? "chat" : current));
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    if (!project) return;
    const abort = new AbortController();
    let refreshing = false;
    let dirty = { chat: false, bootstrap: false };
    const update = (events?: any[]) => {
      if (abort.signal.aborted) return;
      if (events) {
        const scope = eventRefreshScope(events, eventSessions.current);
        dirty.chat ||= scope.chat;
        dirty.bootstrap ||= scope.bootstrap;
      }
      if (
        document.hidden ||
        refreshing ||
        timer.current ||
        (!dirty.chat && !dirty.bootstrap)
      )
        return;
      timer.current = setTimeout(async () => {
        timer.current = undefined;
        if (document.hidden || abort.signal.aborted) return;
        // Keep notifications queued while navigation suppresses reads. If the
        // project fails to open, the old chat still needs its final updates.
        if (projectTransition.current) {
          update();
          return;
        }
        refreshing = true;
        const scope = dirty;
        dirty = { chat: false, bootstrap: false };
        try {
          await refreshCurrent.current(scope);
        } catch {
        } finally {
          refreshing = false;
          update();
        }
      }, 500);
    };
    const visible = () => {
      if (!document.hidden) update([null]);
    };
    document.addEventListener("visibilitychange", visible);
    void subscribe(project, update, abort.signal);
    return () => {
      abort.abort();
      document.removeEventListener("visibilitychange", visible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [project]);
  const selectedKey = query(project, session);
  const liveChatReady =
    !session || (chatState.selectionKey === selectedKey && chatState.loaded);
  const cachedChat =
    project && session ? recentChats.current.get(project, session) : null;
  const chat =
    chatState.selectionKey === selectedKey
      ? chatState
      : (cachedChat ?? {
          messages: [],
          status: {},
          permissions: [],
          questions: [],
        });
  const goalState = useGoals(project);
  const currentGoal = goalState.rows.find((g) => g.session === session);
  const current =
      data?.sessions.find((s) => s.id === session) ??
      (session && chat.selectionKey === selectedKey ? chat.session : undefined),
    turnState = session ? senderState(chat, session) : { busy: false },
    busy =
      (sending && sendingKey === selectedKey) ||
      (liveChatReady && turnState.busy);
  const selectedChoicesKey = session
    ? selectedKey
    : `${selectedKey}:${data?.sessionDefaults?.revision ?? 0}`;
  const chatLoading =
    (Boolean(session) &&
      (chat.selectionKey !== selectedKey ||
        !chat.loaded ||
        startingSession === session)) ||
    startingSession === "__new__" ||
    (!cachedChat &&
      (data?.selectionKey !== selectedKey ||
        choicesKey !== selectedChoicesKey));
  const chatSyncing =
    !chatLoading &&
    !!session &&
    (!liveChatReady ||
      data?.selectionKey !== selectedKey ||
      choicesKey !== selectedChoicesKey);
  const visibleSend = pendingSend?.key === selectedKey ? pendingSend : null;
  const sendObserved =
    !!visibleSend &&
    chat.messages.some(
      (message) =>
        message.info?.role === "user" &&
        !visibleSend.previousIDs.includes(message.info.id) &&
        (message.parts ?? [])
          .filter((part) => part.type === "text" && !part.synthetic)
          .map((part) => part.text)
          .join("") === visibleSend.text &&
        visibleSend.attachments.every((file) =>
          (message.parts ?? []).some(
            (part) => part.type === "file" && part.filename === file.filename,
          ),
        ),
    );
  // Native events may arrive before the POST acknowledgement or bootstrap.
  // Keep the display bridge until the real chat can stay mounted on its own.
  useEffect(() => {
    if (sendObserved && !chatLoading) setPendingSend(null);
  }, [sendObserved, chatLoading]);
  const selectSession = (id: string) => {
    if (!id) return;
    if (id !== session) chatVersion.current++;
    setSession(id);
    setView("chat");
  };
  async function createChat() {
    if (!project) {
      setFolderOpen(true);
      return;
    }
    setCreatingChat(true);
    try {
      const next = await api("chats", { project });
      selectSession(next.id);
    } finally {
      setCreatingChat(false);
    }
  }
  async function send(
    intelligence: string,
    attachments: { filename: string; mime: string; url: string }[] = [],
  ) {
    if (
      sendFlight.current ||
      !model ||
      !project ||
      (!draft.trim() && !attachments.length) ||
      busy ||
      draftMemory.loading ||
      current?.organization?.archived ||
      data.project?.organization?.archivedAt
    )
      return { accepted: false, sessionID: session };
    let captured = draftMemory.capture();
    const capturedDraft = captured.text;
    const origin = query(project, session);
    sendFlight.current = true;
    setSending(true);
    setSendingKey(origin);
    setPendingSend({
      key: origin,
      text: capturedDraft,
      attachments,
      previousIDs: chat.messages.map((message) => message.info?.id),
      state: "sending",
    });
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
          setSendingKey(query(project, id));
          setStartingSession(id);
          setPendingSend((value) =>
            value?.key === origin
              ? { ...value, key: query(project, id) }
              : value,
          );
          if (navigation.current === origin) selectSession(id);
        }
        await api("send", {
          project,
          session: id,
          text: capturedDraft,
          agentID,
          model,
          variant: intelligence,
          attachments,
        });
        accepted = true;
        setPendingSend((value) =>
          value ? { ...value, state: "accepted" } : value,
        );
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
        await refreshChat(project, id, origin);
      });
    } finally {
      if (!accepted)
        setPendingSend((value) =>
          value ? { ...value, state: "unconfirmed" } : value,
        );
      sendFlight.current = false;
      setStartingSession("");
      setSending(false);
      setSendingKey("");
    }
    return { accepted, sessionID: createdSession || session };
  }
  async function openProject(existing?: any) {
    if (projectTransition.current) return false;
    setFolderOpen(false);
    setFolderPicker(false);
    setImportPreview(null);
    let opened = false;
    projectTransition.current = true;
    bootstrapVersion.current++;
    chatVersion.current++;
    const name = existing?.name ?? folder.trim();
    setProjectLoading({
      name,
      phase: existing ? "Opening project…" : "Setting up project…",
      step: "project",
    });
    await run(async () => {
      try {
        const p =
          existing ?? (await api("projects", { directory: folder.trim() }));
        await api("projects/selection", { project: p.id }, "PUT");
        setProjectLoading({
          name: p.name,
          phase: "Loading models, agents and saved workspace settings…",
          step: "workspace",
        });
        const key = query(p.id);
        const next = await api("bootstrap?" + key);
        if (!compatibleApplication(next))
          throw Error(
            "Restart Freelancer to finish updating, then open the project again.",
          );
        if (next.project?.id !== p.id)
          throw Error("The project could not be loaded. Please try again.");
        initialProject.current = true;
        setProjectLoading({
          name: p.name,
          phase: "Checking project indexes…",
          step: "files",
        });
        try {
          if (next.indexPreparation) await prepareProject(p);
        } catch (e) {
          setError(
            `Workspace opened; index preparation needs attention: ${(e as Error).message}`,
          );
        }
        bootstrapVersion.current++;
        chatVersion.current++;
        navigation.current = key;
        restoredChoices.current = "";
        setData({ ...next, selectionKey: key });
        setProject(p.id);
        setFileFolderPath("");
        setIndexedFilePath("");
        let remembered = "";
        remembered = workspaceView.state?.lastChats?.[p.id] ?? "";
        setSession(
          next.sessions.some((item: any) => item.id === remembered)
            ? remembered
            : "",
        );
        setChat({ messages: [], status: {}, permissions: [], questions: [] });
        setFolderOpen(false);
        setFolder("");
        setView("chat");
        opened = true;
      } finally {
        projectTransition.current = false;
        setProjectLoading(null);
      }
    });
    return opened;
  }
  async function openIndexedFile(projectID: string, filePath: string) {
    const selected = data?.settings.projects.find(
      (item: any) => item.id === projectID,
    );
    if (!selected) throw Error("This project is no longer registered.");
    if (projectID !== project && !(await openProject(selected)))
      throw Error(
        "The project could not be opened. Check the workspace status and try again.",
      );
    setIndexedFilePath(filePath);
    setFileNavigation((value) => value + 1);
    setFileFolderPath(parentDirectory(filePath));
    setSettingsScope("project");
    setExpandedNavigation("project");
    setTab("files");
    setView("files");
  }
  const renameChat = (chat: any, title: string) =>
    run(async () => {
      await api(
        "chat",
        { project, session: chat.id, title: title.trim() },
        "PATCH",
      );
      await refresh();
    });
  async function openIndexedConversation(projectID: string, id: string) {
    if (projectID !== project) {
      const selected = data?.settings.projects.find(
        (item: any) => item.id === projectID,
      );
      if (!selected) throw Error("This project is no longer registered.");
      if (!(await openProject(selected)))
        throw Error(
          "The project could not be opened. Check the workspace status and try again.",
        );
      if (navigation.current !== query(projectID)) return;
    }
    selectSession(id);
  }
  async function previewProject() {
    setImportBusy(true);
    setImportError("");
    try {
      const preview = await api("projects/import-preview", {
        directory: folder.trim(),
      });
      if (preview.existing) await openProject(preview.existing);
      else setImportPreview(preview);
    } catch (error) {
      setImportError((error as Error).message);
    } finally {
      setImportBusy(false);
    }
  }
  async function finishProjectSetup(selected: string[]) {
    if (importBusy) return;
    setImportBusy(true);
    setImportError("");
    projectTransition.current = true;
    setProjectLoading({
      name: importPreview.directory,
      phase: selected.length
        ? `Importing ${selected.length} ChatGPT / Codex conversations…`
        : "Finishing project setup…",
      step: "import",
    });
    try {
      const result = await api("projects/setup", {
        token: importPreview.token,
        selected,
      });
      setImportPreview(null);
      projectTransition.current = false;
      await openProject(result.project);
    } catch (error) {
      setImportError((error as Error).message);
    } finally {
      projectTransition.current = false;
      setProjectLoading(null);
      setImportBusy(false);
    }
  }
  async function saveProjectName() {
    if (!projectEdit) return;
    const updated = await api(
      "projects",
      { project: projectEdit.id, name: projectName },
      "PATCH",
    );
    setData((current) =>
      current
        ? {
            ...current,
            settings: {
              ...current.settings,
              projects: current.settings.projects.map((p) =>
                p.id === updated.id ? { ...p, ...updated } : p,
              ),
            },
          }
        : current,
    );
    setProjectEdit(null);
  }
  async function removeProject(item: any) {
    if (
      !(await confirmation.ask({
        title: `Remove “${item.name}”?`,
        description:
          "Its folder, files, native chats, and history will remain on disk.",
        confirmLabel: "Remove from Freelancer",
        danger: true,
      }))
    )
      return;
    await api("projects", { project: item.id }, "DELETE");
    recentChats.current.deleteProject(item.id);
    const remaining = data.settings.projects.filter((p) => p.id !== item.id);
    setData((current) => ({
      ...current,
      settings: { ...current.settings, projects: remaining },
      project: item.id === project ? null : current.project,
    }));
    if (item.id === project) {
      setProject("");
      setSession("");
      if (remaining.length) void openProject(remaining[0]);
      else setFolderOpen(true);
    }
  }
  async function continueChatInNew(sessionRow: any) {
    await run(async () => {
      const next = await api("chat/action", {
        project,
        session: sessionRow.id,
        action: "fork",
      });
      selectSession(next.id);
    });
  }
  async function archiveChat(sessionRow: any) {
    if (
      !(await confirmation.ask({
        title: `Archive “${sessionRow.title || "New chat"}”?`,
        description:
          "Archived chats stay in history and can be restored later.",
        confirmLabel: "Archive chat",
        danger: true,
      }))
    )
      return;
    await run(async () => {
      await api(
        "history/archive",
        {
          project,
          session: sessionRow.id,
          archived: true,
          revision: sessionRow.organization?.revision ?? 0,
        },
        "PUT",
      );
      recentChats.current.delete(project, sessionRow.id);
      if (session === sessionRow.id) setSession("");
      await refresh();
    });
  }
  async function pinChat(sessionRow: any) {
    await run(async () => {
      await api(
        "history/pin",
        {
          project,
          session: sessionRow.id,
          pinned: !sessionRow.organization?.pinnedAt,
          revision: sessionRow.organization?.revision ?? 0,
        },
        "PUT",
      );
      await refresh();
    });
  }
  async function exportChat(sessionRow: any) {
    await run(async () => {
      const saved = await api("history/export", {
        project,
        sessions: [sessionRow.id],
        format: "markdown",
        includeWorkers: false,
      });
      const url = URL.createObjectURL(
        new Blob([saved.content], { type: saved.mime }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = saved.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  const connectionStatus = projectLoading
    ? "Opening project"
    : !data
      ? "Connecting"
      : !compatibleApplication(data)
        ? "Restart needed"
        : "Connected";
  return (
    <AppearanceContext.Provider value={data?.settings.appearance ?? {}}>
      <IndexJobsContext.Provider value={indexJobs}>
        <div
          className={`workspace resizable-workspace${navigationCollapsed ? " navigation-collapsed" : ""}${narrowViewport && navigationHiddenMobile ? " navigation-hidden" : ""}`}
          style={panelLayout.style}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            navigationTouch.current = touch
              ? { x: touch.clientX, y: touch.clientY }
              : null;
          }}
          onTouchEnd={(event) => {
            const start = navigationTouch.current,
              touch = event.changedTouches[0];
            navigationTouch.current = null;
            if (!start || !touch || !narrowViewport) return;
            const dx = touch.clientX - start.x,
              dy = touch.clientY - start.y;
            if (Math.abs(dx) < 54 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
            if (!navigationHiddenMobile && start.x < 76 && dx < 0) {
              collapseNavigation();
              setNavigationHiddenMobile(true);
            } else if (navigationHiddenMobile && start.x < 28 && dx > 0)
              setNavigationHiddenMobile(false);
          }}
          onTouchCancel={() => {
            navigationTouch.current = null;
          }}
        >
          <aside className="sidebar" id="workspace-navigation">
            <div className="brand">
              <span>
                <svg
                  width="21"
                  height="21"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <g
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6.5 16V5.5H15M6.5 12H13" />
                  </g>
                  <g stroke="currentColor" strokeWidth="1.6">
                    <circle cx="18" cy="5.5" r="2.4" />
                    <circle cx="16" cy="12" r="2.4" />
                    <circle cx="6.5" cy="19" r="2.4" />
                  </g>
                </svg>
              </span>
              Freelancer
            </div>
            <ProjectNavigation
              expanded={expandedProjects}
              onToggle={() => toggleNavigationGroup("projects")}
              onDismiss={() => setExpandedProjects(false)}
              projects={(data?.settings.projects ?? []).filter(
                (p) => !p.organization?.archivedAt || p.id === project,
              )}
              selected={project}
              disabled={
                !!projectLoading || !data || !compatibleApplication(data)
              }
              onSelect={(p) => {
                dismissCompactNavigation();
                void openProject(p);
              }}
              onAdd={() => {
                dismissCompactNavigation();
                setError("");
                setImportError("");
                setFolderOpen(true);
              }}
              onManage={(p) => {
                dismissCompactNavigation();
                setProjectEdit(p);
                setProjectName(p.name);
              }}
            />
            <ChatNavigation
              expanded={expandedChats}
              onToggle={() => toggleNavigationGroup("chats")}
              onDismiss={() => setExpandedChats(false)}
              sessions={(data?.sessions ?? [])
                .filter((s) => !s.parentID && !s.organization?.archived)
                .slice(0, 40)
                .map((s) => ({
                  ...s,
                  goal:
                    goalState.rows.find((g) => g.session === s.id) ?? s.goal,
                  activity: sessionActivity?.[s.id],
                }))}
              selected={session}
              disabled={
                !!projectLoading || !data || !compatibleApplication(data)
              }
              creating={creatingChat}
              onNew={() => {
                dismissCompactNavigation();
                return run(createChat);
              }}
              onSelect={(s) => selectSession(s.id)}
              onContinue={(s) => {
                dismissCompactNavigation();
                return continueChatInNew(s);
              }}
              onArchive={archiveChat}
              onPin={pinChat}
              onExport={exportChat}
              onRename={renameChat}
            />
            <div className="sidebar-bottom usage-dock">
              <SettingsNavigation
                expanded={expandedNavigation}
                scope={navigationScope}
                tab={navigationTab}
                project={!!project}
                onToggle={toggleNavigationGroup}
                onDismiss={() => setExpandedNavigation(null)}
                onSelect={openSettings}
              />
              <UsageSidebar
                onManageProviders={() => openSettings("application", "providers")}
                view={availableUsage.view}
                state={availableUsage.state}
                onRefresh={availableUsage.refresh}
                onOpen={() => setView("overview")}
              />
            </div>
          </aside>
          {panelLayout.fitted.navigationResizable && (
            <PanelResize panel="navigation" layout={panelLayout} />
          )}
          <main className="main">
            <header className="topbar">
              <Button
                variant="quiet"
                className="navigation-layout-toggle"
                aria-label={navigationControlLabel}
                title={navigationControlLabel}
                aria-expanded={
                  narrowViewport
                    ? !navigationHiddenMobile
                    : !navigationCollapsed
                }
                aria-controls="workspace-navigation"
                onClick={toggleNavigation}
              >
                {narrowViewport ? (
                  navigationHiddenMobile ? (
                    <PanelLeftOpen size={17} />
                  ) : (
                    <PanelLeftClose size={17} />
                  )
                ) : navigationCollapsed ? (
                  <PanelLeftOpen size={17} />
                ) : (
                  <PanelLeftClose size={17} />
                )}
              </Button>
              <div id="chat-toolbar-host" hidden={view !== "chat"} />
              <div className="topbar-right">
                <span
                  className="badge success connection-status"
                  role="status"
                  aria-label={connectionStatus}
                  title={connectionStatus}
                >
                  <span className="dot" />
                  <span className="connection-status-label">
                    {connectionStatus}
                  </span>
                </span>
                <button
                  aria-label={draftSaving ? "Saving draft" : "Refresh"}
                  title={draftSaving ? "Saving draft" : "Refresh"}
                  aria-busy={draftSaving || undefined}
                  className="icon-button"
                  onClick={() =>
                    run(() => Promise.all([refresh(), refreshChat()]))
                  }
                >
                  <RefreshCw
                    size={17}
                    className={working || draftSaving ? "spin" : ""}
                  />
                </button>
              </div>
            </header>
            <div className="workspace-progress">
              <ModelRatingProgress ratings={modelRatings} />
              {!projectLoading && <IndexJobProgress jobs={indexJobs} />}
            </div>
            {workspaceView.error && (
              <div className="error-banner" role="alert">
                {workspaceView.error}
              </div>
            )}
            {panelLayout.error && (
              <div className="error-banner" role="alert">
                {panelLayout.error}
                <button
                  aria-label="Dismiss layout error"
                  onClick={panelLayout.dismissError}
                >
                  <X size={16} />
                </button>
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
                Freelancer could not open its local SQLite data:{" "}
                {data.localDataError}. Native OpenCode chats remain available;
                local pins, archives, drafts, and search may be unavailable. The
                database was left untouched.
              </div>
            )}
            {chat.availabilityWarnings?.length > 0 && (
              <div className="error-banner" role="alert">
                This chat loaded with incomplete live data:{" "}
                {chat.availabilityWarnings.join(" · ")}
              </div>
            )}
            {projectLoading ? (
              <ChatLoading
                title={`Opening ${projectLoading.name}`}
                label={projectLoading.phase}
              >
                {["files", "chats"].includes(projectLoading.step ?? "") && (
                  <Button onClick={() => continuePreparation.current?.()}>
                    Continue in background
                  </Button>
                )}
              </ChatLoading>
            ) : !data ? (
              <ChatLoading
                title="Opening your workspace…"
                label="Connecting to OpenCode and loading projects, models and saved settings…"
              >
                {error && (
                  <Button onClick={() => run(refresh)}>Try again</Button>
                )}
              </ChatLoading>
            ) : !compatibleApplication(data) ? (
              <Empty
                icon={RefreshCw}
                title="Restart Freelancer to finish updating"
              >
                The app has been updated. Close and reopen Freelancer to load
                its new settings and model choices.
              </Empty>
            ) : project && data.project?.id !== project ? (
              <ChatLoading
                title="Opening your project"
                label="Loading the workspace…"
              />
            ) : (
              <Suspense
                fallback={<Empty icon={LoaderCircle} title="Opening page…" />}
              >
                <div className="chat-workspace" hidden={view !== "chat"}>
                  {chat.imported && (
                    <div className="imported-chat-notice">
                      <span>
                        Imported from ChatGPT / Codex · one-time snapshot.
                        Continue to orient a new chat from this history.
                      </span>
                      <Button
                        disabled={
                          working ||
                          current?.organization?.archived ||
                          data.project?.organization?.archivedAt
                        }
                        onClick={() =>
                          void run(async () => {
                            const next = await api("chat/imported/continue", {
                              project,
                              session,
                            });
                            selectSession(next.id);
                          })
                        }
                      >
                        Continue in Freelancer
                      </Button>
                    </div>
                  )}
                  {chat.continuation && (
                    <div className="imported-chat-notice" role="status">
                      <span>
                        {(sending && !chat.receipts?.length) ||
                        (busy && chat.receipts?.at(-1)?.orienting)
                          ? "Orienting…"
                          : "Continued from a ChatGPT / Codex snapshot. Saved history provides the starting context."}
                      </span>
                    </div>
                  )}
                  {(current?.organization?.archived ||
                    data.project?.organization?.archivedAt) && (
                    <div className="archive-banner" role="status">
                      This work is archived
                      {current?.organization?.archiveScope === "freelancer"
                        ? " in Freelancer only"
                        : ""}
                      . Restore it before sending.{" "}
                      <Button
                        onClick={() => {
                          if (data.project?.organization?.archivedAt)
                            openSettings("application", "content-storage");
                          else openHistory(current?.parentID ?? current?.id);
                        }}
                      >
                        Manage archive
                      </Button>
                    </div>
                  )}
                  {draftMemory.error ? (
                    <div className="draft-status" role="alert">
                      {draftMemory.error}
                      <>
                        <Button onClick={() => run(draftMemory.retry)}>
                          Retry save
                        </Button>
                        <Button
                          title="Replace this box with the saved draft. Copy current text first."
                          onClick={async () => {
                            if (
                              await confirmation.ask({
                                title: "Load the saved draft?",
                                description:
                                  "Copy your current text first; this replaces the text in the box.",
                                confirmLabel: "Load saved draft",
                              })
                            )
                              void run(draftMemory.reload);
                          }}
                        >
                          Load saved draft
                        </Button>
                      </>
                    </div>
                  ) : null}
                  <div
                    className="requests"
                    ref={decisions}
                    tabIndex={-1}
                    aria-label="Pending decisions"
                  >
                    <Permissions
                      key={`permissions-${query(project, session)}`}
                      requests={chat.permissions}
                      suspended={
                        view !== "chat" || folderOpen || !!projectLoading
                      }
                      onRespond={async (id, reply) => {
                        await api("respond", {
                          project,
                          type: "permission",
                          id,
                          response: { reply },
                        });
                        void refreshChat().catch(() => {});
                      }}
                    />
                    <Questions
                      key={query(project, session)}
                      requests={chat.questions}
                      suspended={
                        view !== "chat" ||
                        historyOpen ||
                        folderOpen ||
                        !!projectLoading
                      }
                      onRespond={async (id, response) => {
                        // Let the dialog display failures; run() intentionally swallows them.
                        await api("respond", {
                          project,
                          type: "question",
                          id,
                          response,
                        });
                        // A successful answer must not be resubmitted if this read fails.
                        void refreshChat().catch(() => {});
                      }}
                    />
                  </div>
                  <div className="conversation-layout">
                    {chatLoading && !visibleSend ? (
                      <ChatLoading
                        label={
                          startingSession === "__new__" ||
                          (startingSession === session && !!session)
                            ? "Sending your first message…"
                            : "Loading recent conversation…"
                        }
                      />
                    ) : (
                      <>
                        <RenderBoundary key={`${project}/${session}`}>
                          <Chat
                            data={data}
                            syncing={chatSyncing || chatLoading}
                            pendingSend={sendObserved ? null : visibleSend}
                            sending={sending && sendingKey === selectedKey}
                            messages={chat.messages}
                            todos={chat.todos ?? EMPTY_TODOS}
                            session={
                              current ?? (session ? { id: session } : undefined)
                            }
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
                            onStop={() => {
                              if (stopFlight.current) return Promise.resolve();
                              stopFlight.current = true;
                              return run(async () => {
                                await api("stop", { project, session });
                                await refreshChat();
                              }).finally(() => {
                                stopFlight.current = false;
                              });
                            }}
                            onChild={selectSession}
                            agentID={agentID}
                            setAgentID={setAgentID}
                            changeCount={
                              new Set(
                                (chat.diff ?? []).map(
                                  (file) => file.file ?? file.path,
                                ),
                              ).size
                            }
                            pendingDecisions={
                              (chat.permissions ?? []).length +
                              (chat.questions ?? []).length
                            }
                            onReviewDecisions={() => {
                              // Reopen the existing dialog, retaining its draft. These
                              // triggers only review; they cannot answer or grant consent.
                              const next =
                                decisions.current?.querySelector<HTMLButtonElement>(
                                  '[data-review-decision="worker"]',
                                ) ??
                                decisions.current?.querySelector<HTMLButtonElement>(
                                  "[data-review-decision]",
                                );
                              next?.click();
                            }}
                            toolbarData={{
                              chat,
                              goal: currentGoal,
                              contributions:
                                data.costs.contributions?.chats.find(
                                  (c) => c.sessionID === session,
                                ),
                              onManageGoal: () =>
                                openSettings("project", "goals"),
                              onGoalChange: async () => {
                                await Promise.all([
                                  goalState.refresh(),
                                  refreshChat(),
                                ]);
                              },
                            }}
                          />
                        </RenderBoundary>
                      </>
                    )}
                  </div>
                </div>
                {view === "github" && (
                  <GitHubProject
                    key={project}
                    project={project}
                    onClose={closeSettings}
                    onAsk={() => {
                      setView("chat");
                    }}
                  />
                )}
                {view === "overview" && (
                  <div className="page overview">
                    <PageHeading
                      title="Available Usage"
                      icon={Gauge}
                      actions={<PageCloseButton onClick={closeSettings} />}
                    />
                    <UsageHero
                      onManageProviders={() => openSettings("application", "providers")}
                      view={availableUsage.view}
                      state={availableUsage.state}
                      onRefresh={availableUsage.refresh}
                    />
                    <UsagePreferences
                      showDepletedModels={
                        data.settings.appearance?.showDepletedModels
                      }
                      refresh={refresh}
                    />
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
                      <Panel title="Model contributions" help="contributions">
                        <ContributionRows
                          breakdown={data.costs.contributions?.models}
                        />
                      </Panel>
                    </div>
                    {!!data.costs.contributions?.agents.rows.length && (
                      <Panel title="Agent contributions">
                        <ContributionRows
                          breakdown={data.costs.contributions.agents}
                        />
                      </Panel>
                    )}
                    <Panel title="Recent projects">
                      <div className="project-cards">
                        {data.settings.projects
                          .filter((p) => !p.organization?.archivedAt)
                          .map((p) => (
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
                  <Files
                    key={`${project}:${fileNavigation}`}
                    project={project}
                    run={run}
                    onClose={closeSettings}
                    changes={chat.diff}
                    messages={chat.messages}
                    directory={data.project?.directory}
                    chatTitle={current?.title}
                    changesUnavailable={chat.changesUnavailable}
                    initialPath={indexedFilePath}
                    initialFolder={fileFolderPath}
                    onLocationChange={(folder, file = "") => {
                      setFileFolderPath(folder);
                      setIndexedFilePath(file);
                    }}
                    onSearch={() => openSettings("project", "search")}
                  />
                )}
                {view === "search" && (
                  <ContentSearch
                    key={`${settingsScope}:${settingsScope === "project" ? project : "all"}`}
                    project={
                      settingsScope === "project" ? data.project : undefined
                    }
                    onOpenFile={openIndexedFile}
                    onOpenConversation={openIndexedConversation}
                    onIndex={() =>
                      openSettings("application", "content-storage")
                    }
                    onClose={closeSettings}
                  />
                )}
                {view === "history" && project && (
                  <HistoryPage
                    key={historySelection ?? "all"}
                    data={data}
                    project={project}
                    activity={sessionActivity}
                    initialSession={historySelection}
                    onClose={closeSettings}
                    onChange={refresh}
                    onOpen={async (projectID, id) => {
                      if (projectID !== project) {
                        const selected = data.settings.projects.find(
                          (p) => p.id === projectID,
                        );
                        if (!selected) return;
                        await openProject(selected);
                        if (navigation.current !== query(projectID)) return;
                      }
                      selectSession(id);
                    }}
                  />
                )}
                {view === "agents" && (
                  <WorkspaceCatalog
                    key={view}
                    data={data}
                    run={run}
                    refresh={refresh}
                    onClose={closeSettings}
                    onUse={(item) => {
                      setAgentID(item.id);
                      setModel("inherit");
                      setVariant("inherit");
                      setView("chat");
                    }}
                  />
                )}
                {view === "settings" && (
                  <div className="page">
                    {tab === "goals" ? (
                      <Goals
                        key={project}
                        data={data}
                        goals={goalState.rows}
                        refresh={async () => {
                          await goalState.refresh();
                          await refresh();
                        }}
                        error={goalState.error}
                        onOpen={async (_p, id) => {
                          await refresh();
                          selectSession(id);
                        }}
                        onClose={closeSettings}
                      />
                    ) : (
                      <Settings
                        sessionID={session}
                        onHistory={() => openHistory()}
                        onOpenChat={async (projectID, id) => {
                          if (projectID !== project) {
                            const selected = data.settings.projects.find(
                              (p) => p.id === projectID,
                            );
                            if (!selected)
                              throw Error(
                                "This project is no longer available.",
                              );
                            await openProject(selected);
                            if (navigation.current !== query(projectID)) return;
                          }
                          selectSession(id);
                        }}
                        onClose={closeSettings}
                        data={data}
                        onColorsSaved={colorsSaved}
                        onNavigate={setView}
                        onSetting={openSettings}
                        tab={tab}
                        run={run}
                        refresh={refresh}
                      />
                    )}
                  </div>
                )}
                {view === "models" && (
                  <div className="page">
                    <PageHeading
                      title="Models"
                      icon={BrainCircuit}
                      help="model-ratings"
                      actions={
                        <>
                          <Button
                            disabled={modelRatings.pending}
                            onClick={async () => {
                              if (
                                ["starting", "running"].includes(
                                  modelRatings.job?.status,
                                )
                              ) {
                                modelRatings.reveal();
                                return;
                              }
                              if (
                                !modelRatings.job ||
                                (await modelRatings.dismiss())
                              )
                                setRatingDialog(true);
                            }}
                          >
                            Update Model Ratings
                          </Button>
                          <PageCloseButton onClick={closeSettings} />
                        </>
                      }
                    />
                    <div className="model-filters">
                      <FieldSearch
                        value={modelQuery}
                        onChange={setModelQuery}
                      />
                      <ProviderSelect
                        provider={modelProvider}
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
                      <div
                        className="access-toggle"
                        role="group"
                        aria-label="Model access"
                      >
                        <Button
                          aria-pressed={!freeOnly}
                          onClick={() => setFreeOnly(false)}
                        >
                          All
                        </Button>
                        <Button
                          aria-pressed={freeOnly}
                          onClick={() => setFreeOnly(true)}
                        >
                          Free
                        </Button>
                      </div>
                    </div>
                    {!browsedModels.length && (
                      <p role="status">No models match these filters.</p>
                    )}
                    <div className="model-grid">
                      {browsedModels.map((m) => {
                        const used =
                          !!m.recent ||
                          m.outcomes?.total > 0 ||
                          data.costs.contributions?.models?.rows?.some(
                            (row: any) => row.id === m.id,
                          );
                        const status = modelStatus(m.availability, used);
                        const facts = [
                          m.context
                            ? `Context ${modelQuantity(m.context)}`
                            : null,
                          m.output ? `Output ${modelQuantity(m.output)}` : null,
                          m.tools === true
                            ? "Tool use"
                            : m.tools === false
                              ? "No tool use"
                              : null,
                          ...(m.variants ?? []).map(
                            (variant: string) => `Variant ${variant}`,
                          ),
                        ].filter(Boolean);
                        return (
                          <Panel
                            key={m.id}
                            {...providerAttributes(
                              m.provider,
                              data.settings.appearance ?? {},
                            )}
                            className="provider-model-card"
                          >
                            <div className="balance-row">
                              <h3>
                                <ProviderText provider={m.provider} mark>
                                  {m.name}
                                </ProviderText>
                              </h3>
                              <span
                                className={`model-status ${status.tone}`}
                                title={m.availability}
                                aria-label={`Model status: ${status.label} (${m.availability})`}
                              >
                                <span
                                  className="model-status-dot"
                                  aria-hidden="true"
                                />
                                {status.label}
                              </span>
                            </div>
                            <div className="model-provider-name">
                              <ProviderText provider={m.provider}>
                                {data.providers.all.find(
                                  (p) => p.id === m.provider,
                                )?.name ?? m.provider}
                              </ProviderText>
                            </div>
                            <div
                              className="model-facts"
                              aria-label="Native model characteristics"
                            >
                              <Badge
                                tone={
                                  m.costClass === "free" ? "success" : "neutral"
                                }
                              >
                                {m.costClass === "free"
                                  ? "Free"
                                  : m.costClass === "metered"
                                    ? "Metered"
                                    : m.costClass === "credits"
                                      ? "Credits"
                                      : "Plan"}
                              </Badge>
                              {facts.map((fact: string) => (
                                <span className="model-fact" key={fact}>
                                  {fact}
                                </span>
                              ))}
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
                          </Panel>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Suspense>
            )}
          </main>
          {confirmation.ui}
          {ratingDialog && data && (
            <ModelRatingDialog
              models={data.models}
              connected={data.providers.connected}
              project={project}
              pending={modelRatings.pending}
              error={modelRatings.error}
              onClose={() => setRatingDialog(false)}
              onStart={modelRatings.start}
            />
          )}
          {folderOpen && !projectLoading && (
            <Dialog
              title="Open project"
              ariaLabel="Open project"
              icon={<FolderOpen />}
              onClose={() => setFolderOpen(false)}
              busy={!!projectLoading || importBusy}
              initialFocus="first"
              size="compact"
              layout="stack"
              footer={
                <>
                  <Button
                    type="button"
                    disabled={!!projectLoading || importBusy}
                    onClick={() => setFolderOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!folder.trim() || working || importBusy}
                  >
                    {importBusy ? "Checking for chats…" : "Next"}
                    <ArrowUpRight size={16} />
                  </Button>
                </>
              }
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
                <Button
                  type="button"
                  disabled={importBusy || !!projectLoading}
                  onClick={() => setFolderPicker(true)}
                >
                  <FolderOpen size={16} />
                  Browse folders…
                </Button>
                {importError && (
                  <p role="alert" className="notice error">
                    {importError}
                  </p>
                )}
                {error && (
                  <p className="notice error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            </Dialog>
          )}
          {folderPicker && (
            <FolderPicker
              initial={folder.trim()}
              onClose={() => setFolderPicker(false)}
              onPick={(directory) => {
                setFolder(directory);
                setFolderPicker(false);
              }}
            />
          )}
          {importPreview && (
            <ProjectImport
              preview={importPreview}
              busy={importBusy}
              error={importError}
              onClose={() => setImportPreview(null)}
              onComplete={(selected) => void finishProjectSetup(selected)}
            />
          )}
          {projectEdit && (
            <Dialog
              title="Manage project"
              icon={<FolderOpen />}
              onClose={() => setProjectEdit(null)}
              busy={working}
              initialFocus="first"
              footer={
                <>
                  <Button type="button" onClick={() => setProjectEdit(null)}>
                    Done
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void run(() => removeProject(projectEdit))}
                  >
                    Delete from Freelancer
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!projectName.trim() || working}
                  >
                    Save name
                  </Button>
                </>
              }
              onSubmit={(e) => {
                e.preventDefault();
                void run(saveProjectName);
              }}
            >
              <Field label="Project name" help="project-name">
                <input
                  autoFocus
                  value={projectName}
                  maxLength={80}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </Field>
              <label className="field">
                <span>Folder</span>
                <input value={projectEdit.directory} readOnly />
              </label>
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
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
