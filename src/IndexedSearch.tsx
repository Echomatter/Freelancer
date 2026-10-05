import { useEffect, useRef, useState } from "react";
import { Archive, FileSearch, FolderOpen, MessageSquare, BookOpen, Plus, RefreshCw, Pencil, Trash2, CloudUpload } from "lucide-react";
import { api } from "./api";
import { settingsPage } from "./settings-catalog.mjs";
import { Button, Field, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";
import { ConfirmDialog, Dialog } from "./echoflex/Dialog";
import { HelpHint } from "./HelpHint";
import { ConversationResults, type ConversationResult, type RememberState } from "./ChatManagement";
import "./indexed-search.css";

type FileHit = {
  project: string; projectName: string; projectArchived: boolean; path: string; role: string;
  unit: number; locator: string; heading: string; excerpt: string;
  sourceIdentity?: string; revisionIdentity?: string; unitSha256?: string;
  originalSourceRef?: Record<string, unknown>; sourceRevision?: { hash?: string | null };
};
type ConversationHit = {
  project: string; projectName: string; session: string; title: string; excerpt: string; imported?: boolean;
  navigationSession?: string; navigationTitle?: string; evidence?: EvidenceRef | null; capturedAt?: number; indexedAt?: number;
  goal?: any; organization?: { revision?: number; archiveScope?: string; nativeArchived?: boolean; projectArchived?: boolean };
};
type CaptureJob = { id?: string; status: string; error?: string; attempts?: number };
type MemoryHit = {
  id: string; kind: string; sourceType?: "chat" | "file" | "custom"; project: string; projectName: string; session?: string; title: string;
  coverage: string; revision: number;
  messageCount: number; excerpt: string; job?: CaptureJob | null; status?: string; archiveRevision?: number;
};
const evidenceRelations = ["supports", "contradicts", "qualifies", "supersedes"];
type MemoryMember = { kind?: string; member_kind?: string; ref?: string; source_ref?: string; revision?: string; source_revision?: string; availability: string; hash?: string; content_hash?: string;
  locator?: { text?: string; [key: string]: unknown } };
type MemoryItem = MemoryHit & {
  body?: string; status?: string; snapshotHash?: string; capturedAt?: number | null;
  data?: Record<string, unknown>; evidence?: SelectedEvidence[]; provenance?: Record<string, unknown>;
  sourceUpdates?: { state: "newer-retained" | "unchanged-retained" | "unknown" | "not-applicable"; basis: "retained-local-data"; liveSource: "not-checked"; checkedAt: number; comparedSources: number; changedSources: number; unknownSources: number; truncated: boolean };
  boundary?: { status?: string; capturedAt?: number | null; attemptedAt?: number; snapshotCreatedAt?: number; messageCount?: number; missingSources?: unknown[]; truncated?: boolean; [key: string]: unknown };
  members?: MemoryMember[]; revisions?: { revision: number; createdAt: number; title?: string; reason?: string }[];
  messages: { ordinal: number; role: string; createdAt: number | null; text: string; providerID?: string | null; modelID?: string | null }[];
};
type EvidenceRef = { kind?: string; sourceIdentity?: string; revisionIdentity?: string; locator?: string; unitSha256?: string; revisionSha256?: string; projectID?: string; sessionID?: string; sourceSystemID?: string; snapshotRevisionSha256?: string; memoryID?: string; memoryRevision?: number; revision?: number };
type RetainedConversation = { status: string; snapshotRevisionSha256: string; capturedAt?: number; truncated?: boolean; coverage?: string;
  session?: { title: string; sourceSystemID: string; projectID: string; sessionID: string; sourceRef?: string };
  messages?: { messageID: string; role: string; revisionSha256: string; parts: { type: string; text?: string }[] }[];
  navigationProject: string; navigationSession: string };
type SelectedEvidence = EvidenceRef & { id: string; relation?: string; label?: string; ref?: EvidenceRef; [key: string]: unknown };
type MemoryEditor = { id?: string; revision?: number; title: string; body: string; projectID: string; data: string; evidence: SelectedEvidence[]; reason: string;
  originalTitle?: string; originalBody?: string; originalData?: string; originalEvidence?: string };
type EvidenceChoice = { id: string; label: string; evidence: SelectedEvidence };
type RetainedFile = { text?: string; availability: string; path?: string; project?: string; hash?: string; revisionIdentity?: string };
type SearchDomain = "files" | "conversations" | "memories";
type SearchPage = { limit: number; offset: number; returned: number; hasMore: boolean; continuation: string; consistency: "moving-index" };
type PageTarget = { cursor?: string; previousCursors: (string | undefined)[] };
type SearchState<T> = PageTarget & { results: T[]; error: string; loading: boolean; complete: boolean; coverage: string; truncated: boolean;
  nextCursor: string | null; page: SearchPage | null; retryPage?: PageTarget };
type ResultType = "all" | "files" | "conversations" | "memories";
const resultTypes: [ResultType, string][] = [["all", "All content"], ["files", "Files"], ["conversations", "Conversations"], ["memories", "Memories"]];
const empty = <T,>(): SearchState<T> => ({ results: [], error: "", loading: false, complete: false, coverage: "", truncated: false, nextCursor: null, page: null, previousCursors: [] });
const pending = <T,>(): SearchState<T> => ({ ...empty<T>(), loading: true });
const readResult = <T,>(value: any): SearchState<T> => {
  if (!Array.isArray(value?.results) || value.results.length > 100) throw Error("The content results could not be read. Retry the query.");
  const page = value.page && Number.isSafeInteger(value.page.offset) && value.page.offset >= 0 && value.page.consistency === "moving-index" ? value.page : null;
  return { ...empty<T>(), results: value.results, error: "", loading: false, complete: true, page,
    nextCursor: typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 1024 ? value.nextCursor : null,
    coverage: typeof value.coverage === "string" ? value.coverage : value.coverage?.summary ?? "", truncated: value.truncated === true || page?.hasMore === true };
};
const words = (value?: string) => (value ?? "Unknown").replaceAll("_", " ");
const when = (value?: number | null) => value == null ? "Not recorded" : new Date(value).toLocaleString();
const captureLabel = (item: MemoryHit) => item.job && ["queued", "running"].includes(item.job.status)
  ? `Capture ${item.job.status}` : words(item.coverage);
const memorySourceLabel = (item: Pick<MemoryHit, "sourceType" | "kind">) => item.sourceType === "file" ? "File"
  : item.sourceType === "chat" ? "Chat" : item.sourceType === "custom" ? "Custom"
  : item.kind === "conversation_snapshot" ? "Chat" : item.kind === "file_snapshot" ? "File" : "Custom";
const rememberKey = (ref: Record<string, unknown>) => JSON.stringify(ref);
const conversationSourceRef = (hit: ConversationResult) => {
  const ref = hit.originalSourceRef ?? hit.evidence ?? {};
  const snapshotRevisionSha256 = hit.sourceRevision?.hash ?? hit.evidence?.snapshotRevisionSha256 ?? ref.snapshotRevisionSha256;
  return { ...ref, kind: "conversation", projectID: ref.projectID ?? hit.project, sessionID: ref.sessionID ?? hit.session,
    ...(snapshotRevisionSha256 ? { snapshotRevisionSha256 } : {}) };
};
const fileSourceRef = (hit: FileHit) => ({ ...hit.originalSourceRef, kind: "file", projectID: hit.project, path: hit.path,
  sourceIdentity: hit.sourceIdentity, revisionIdentity: hit.revisionIdentity, locator: hit.locator, unitSha256: hit.unitSha256 });
const memoryEvidenceReference = (ref: EvidenceRef) => {
  if (!ref.memoryID || !["memory", "memory-revision"].includes(ref.kind ?? "")) return null;
  const revision = ref.kind === "memory" ? ref.memoryRevision : ref.revision;
  if (!Number.isSafeInteger(revision) || revision! < 1) return null;
  if (ref.memoryRevision !== undefined && ref.revision !== undefined && ref.memoryRevision !== ref.revision) return null;
  return { id: ref.memoryID, revision: revision! };
};

export function ContentSearch({ project, projects = [], onOpenFile, onOpenConversation, onClose, onChange,
  currentProject, activity, initialConversation }: {
  project?: { id: string; name: string };
  projects?: { id: string; name: string; organization?: { archivedAt?: number | null } }[];
  onOpenFile: (project: string, path: string) => Promise<void>;
  onOpenConversation: (project: string, session: string) => Promise<void>;
  onClose: () => void; onChange: () => Promise<void>;
  currentProject?: string; activity?: Record<string, any>;
  initialConversation?: { project: string; session: string };
}) {
  const [query, setQuery] = useState(""), [resultType, setResultType] = useState<ResultType>(initialConversation ? "conversations" : "all");
  const [filterProject, setFilterProject] = useState(initialConversation?.project ?? "");
  const [source, setSource] = useState(""), [role, setRole] = useState(""), [status, setStatus] = useState("");
  const [model, setModel] = useState(""), [phrase, setPhrase] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [files, setFiles] = useState<SearchState<FileHit>>(empty), [conversations, setConversations] = useState<SearchState<ConversationHit>>(empty);
  const [memories, setMemories] = useState<SearchState<MemoryHit>>(empty);
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null), [retainedFile, setRetainedFile] = useState<RetainedFile | null>(null);
  const [retainedConversation, setRetainedConversation] = useState<RetainedConversation | null>(null);
  const [opening, setOpening] = useState(""), [openError, setOpenError] = useState("");
  const [revision, setRevision] = useState(0), [limit, setLimit] = useState(25);
  const [readerError, setReaderError] = useState(""), [memoryWorking, setMemoryWorking] = useState("");
  const [captureUncertain, setCaptureUncertain] = useState(false), [capturePollEpoch, setCapturePollEpoch] = useState(0);
  const [editor, setEditor] = useState<MemoryEditor | null>(null);
  const [editorError, setEditorError] = useState(""), [forgetting, setForgetting] = useState<MemoryItem | null>(null);
  const [evidenceQuery, setEvidenceQuery] = useState(""), [evidenceOptions, setEvidenceOptions] = useState<EvidenceChoice[]>([]);
  const [evidenceChoice, setEvidenceChoice] = useState(""), [evidenceError, setEvidenceError] = useState(""), [evidenceLoading, setEvidenceLoading] = useState(false);
  const [rememberPending, setRememberPending] = useState(""), [rememberStates, setRememberStates] = useState<Record<string, RememberState>>({});
  const rememberRequest = useRef({ alive: true, pending: "", receipts: new Map<string, string>() });
  const evidenceRead = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const searchRead = useRef({ generation: 0, controllers: new Map<SearchDomain, AbortController>() });
  const trimmed = query.trim(), scoped = !!project?.id;
  const searchProject = project?.id || filterProject;
  const wantFiles = !!trimmed && (resultType === "all" || resultType === "files");
  const showConversations = resultType === "conversations" || resultType === "all";
  const wantConversations = !!trimmed && showConversations;
  const browseConversations = !trimmed && showConversations;
  const wantMemories = resultType === "all" || resultType === "memories";
  const searchLabel = scoped ? "Search project content" : "Search all content";
  const activeStates = [wantFiles ? files : null, wantConversations ? conversations : null, wantMemories ? memories : null].filter(Boolean) as SearchState<unknown>[];
  const loading = activeStates.some(value => value.loading), complete = !!activeStates.length && activeStates.every(value => value.complete);
  const total = activeStates.reduce((count, value) => count + value.results.length, 0);
  const needsMore = activeStates.some(value => value.truncated);
  const firstPages = activeStates.every(value => !value.cursor);
  const domainStates = { files, conversations, memories };
  const domainSetters = { files: setFiles, conversations: setConversations, memories: setMemories };

  useEffect(() => {
    if (!initialConversation) return;
    setResultType("conversations"); setQuery(""); setFilterProject(initialConversation.project);
  }, [initialConversation]);

  async function requestPage(domain: SearchDomain, target: PageTarget, generation = searchRead.current.generation) {
    searchRead.current.controllers.get(domain)?.abort();
    const controller = new AbortController();
    searchRead.current.controllers.set(domain, controller);
    const currentRequest = () => !controller.signal.aborted && searchRead.current.generation === generation
      && searchRead.current.controllers.get(domain) === controller;
    domainSetters[domain]((current: SearchState<any>) => ({ ...current, error: "", loading: true, retryPage: target }));
    const params = new URLSearchParams({ q: trimmed, limit: String(limit), ...(searchProject ? { project: searchProject } : {}),
      ...(phrase ? { phrase: "true" } : {}), ...(target.cursor ? { cursor: target.cursor } : {}) });
    try {
      let value;
      if (domain === "files") {
        for (const [key, filter] of [["source", source], ["role", role], ["status", status]]) if (filter) params.set(key, filter);
        value = await api(`index/search?${params}`, undefined, undefined, controller.signal);
      } else if (domain === "conversations") {
        if (model) params.set("model", model);
        value = await api(`history/search?${params}`, undefined, undefined, controller.signal);
      } else if (domain === "memories") {
        params.set("includeArchived", String(includeArchived));
        if (model) params.set("model", model);
        value = await api(`memory/search?${params}`, undefined, undefined, controller.signal);
      }
      if (!currentRequest()) return;
      const result = readResult<any>(value);
      if (domain === "conversations") {
        const unique = new Map<string, ConversationHit>();
        for (const hit of result.results) if (!unique.has(`${hit.project}:${hit.session}`)) unique.set(`${hit.project}:${hit.session}`, hit);
        result.results = [...unique.values()];
      }
      domainSetters[domain]({ ...result, ...target });
    } catch (error) {
      if (currentRequest()) domainSetters[domain]((current: SearchState<any>) => ({ ...current, error: (error as Error).message, loading: false, complete: true, retryPage: target }));
    } finally {
      if (currentRequest()) searchRead.current.controllers.delete(domain);
    }
  }

  function retrySearch(domain: SearchDomain) {
    const state = domainStates[domain];
    void requestPage(domain, state.retryPage ?? { cursor: state.cursor, previousCursors: state.previousCursors });
  }

  function pageNavigation(domain: SearchDomain, label: string, state: SearchState<unknown>) {
    if (!state.truncated && !state.nextCursor && !state.previousCursors.length && !state.error) return null;
    const offset = state.page?.offset ?? 0;
    const returned = state.page?.returned ?? state.results.length;
    return <div className="knowledge-actions" role="group" aria-label={`${label} pages`}>
      <span aria-live="polite">{returned ? `Matches ${offset + 1}–${offset + returned}` : "No matches on this page"}</span>
      <Button disabled={state.loading || !state.previousCursors.length} aria-label={`Previous ${label} page`} onClick={() => {
        const previousCursors = state.previousCursors.slice(0, -1);
        void requestPage(domain, { cursor: state.previousCursors.at(-1), previousCursors });
      }}>Previous</Button>
      <Button disabled={state.loading || !state.nextCursor} aria-label={`Next ${label} page`} onClick={() => {
        if (state.nextCursor) void requestPage(domain, { cursor: state.nextCursor, previousCursors: [...state.previousCursors, state.cursor] });
      }}>Next</Button>
      <Button disabled={state.loading || !state.cursor && !state.error} aria-label={`Start over ${label}`} onClick={() => void requestPage(domain, { previousCursors: [] })}>Start over</Button>
      {state.truncated && !state.nextCursor && <span>{state.page?.continuation === "offset-limit" ? "Continuation limit reached. Narrow the query or start over." : "Additional matches were reported without a continuation. Narrow the query or start over."}</span>}
    </div>;
  }

  useEffect(() => {
    setOpenError("");
    const generation = ++searchRead.current.generation;
    for (const controller of searchRead.current.controllers.values()) controller.abort();
    searchRead.current.controllers.clear();
    setFiles(wantFiles ? pending() : empty());
    setConversations(wantConversations ? pending() : empty());
    setMemories(wantMemories ? pending() : empty());
    const timer = setTimeout(() => {
      if (wantFiles) void requestPage("files", { previousCursors: [] }, generation);
      if (wantConversations) void requestPage("conversations", { previousCursors: [] }, generation);
      if (wantMemories) void requestPage("memories", { previousCursors: [] }, generation);
    }, 180);
    return () => {
      clearTimeout(timer); searchRead.current.generation++;
      for (const controller of searchRead.current.controllers.values()) controller.abort();
      searchRead.current.controllers.clear();
    };
  }, [trimmed, searchProject, source, role, status, model, phrase, includeArchived, resultType, limit, revision]);

  useEffect(() => {
    rememberRequest.current.alive = true;
    return () => { rememberRequest.current.alive = false; invalidateEvidenceRead(); };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const controller = new AbortController();
    setEvidenceLoading(true); setEvidenceError(""); setEvidenceChoice("");
    const params = new URLSearchParams({ q: evidenceQuery.trim(), limit: "25", ...(editor.projectID ? { project: editor.projectID } : {}) });
    const timer = setTimeout(async () => {
      const requests = await Promise.allSettled([
        api(`memory/search?${params}`, undefined, undefined, controller.signal),
        evidenceQuery.trim() ? api(`index/search?${params}`, undefined, undefined, controller.signal) : Promise.resolve({ results: [] }),
      ]);
      if (controller.signal.aborted) return;
      const choices: EvidenceChoice[] = [], errors: string[] = [];
      for (const [index, result] of requests.entries()) {
        if (result.status === "rejected") { errors.push(`${index ? "Files" : "Memories"}: ${result.reason.message}`); continue; }
        if (!Array.isArray(result.value?.results)) { errors.push("Retained evidence results could not be read."); continue; }
        if (index === 0) for (const memory of result.value.results as MemoryHit[]) {
          const id = `memory:${memory.id}@${memory.revision}`, label = `${memory.title} · retained revision ${memory.revision}`;
          choices.push({ id, label, evidence: { id, label, kind: "memory", memoryID: memory.id, memoryRevision: memory.revision, relation: "supports" } });
        }
        else for (const file of result.value.results as FileHit[]) {
          if (!file.sourceIdentity || !file.revisionIdentity || !file.unitSha256) continue;
          const id = `file:${file.sourceIdentity}@${file.revisionIdentity}:${file.locator}`, label = `${file.projectName}/${file.path} · ${file.locator}`;
          choices.push({ id, label, evidence: { id, label, kind: "file", sourceIdentity: file.sourceIdentity, revisionIdentity: file.revisionIdentity, locator: file.locator, unitSha256: file.unitSha256, relation: "supports" } });
        }
      }
      setEvidenceOptions(choices); setEvidenceError(errors.join(" · ")); setEvidenceLoading(false);
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [!!editor, editor?.projectID, evidenceQuery]);

  // Inspect the persisted job; polling never resubmits capture after uncertain delivery.
  useEffect(() => {
    if (!selectedMemory || !selectedMemory.job || !["queued", "running"].includes(selectedMemory.job.status)) return;
    const controller = new AbortController(), id = selectedMemory.id;
    let timer: ReturnType<typeof setTimeout>;
    const inspect = async () => {
      try {
        const latest = await api(`memory/item?${new URLSearchParams({ id })}`, undefined, undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (!latest) throw Error("The retained memory is no longer available.");
        setSelectedMemory(current => current?.id === id ? { ...current, job: latest.job, revisions: latest.revisions } : current);
        if (latest.job && ["queued", "running"].includes(latest.job.status)) timer = setTimeout(inspect, 2000);
        else setRevision(value => value + 1);
      } catch (error) { if (!controller.signal.aborted) setReaderError(`Capture status could not be read: ${(error as Error).message}`); }
    };
    timer = setTimeout(inspect, 1000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [selectedMemory?.id, selectedMemory?.job?.status, capturePollEpoch]);

  async function open(key: string, action: () => Promise<void>) {
    invalidateEvidenceRead();
    setOpening(key); setOpenError("");
    try { await action(); }
    catch (error) { setOpenError((error as Error).message); setOpening(""); }
  }
  function invalidateEvidenceRead() {
    evidenceRead.current.generation++;
    evidenceRead.current.controller?.abort();
    evidenceRead.current.controller = null;
  }
  function clearEvidenceOpening() {
    setOpening(current => current.startsWith("memory:") || current === "file-evidence" || current === "conversation-evidence" ? "" : current);
  }
  function closeMemoryReader() {
    invalidateEvidenceRead();
    setSelectedMemory(null); setReaderError("");
    clearEvidenceOpening();
  }
  function closeFileReader() {
    invalidateEvidenceRead();
    setRetainedFile(null); clearEvidenceOpening();
  }
  function closeConversationReader() {
    invalidateEvidenceRead(); setRetainedConversation(null); clearEvidenceOpening();
  }
  async function readConversationEvidence(hit: Pick<ConversationHit, "evidence" | "project" | "session" | "navigationSession">) {
    const ref = hit.evidence;
    if (ref?.kind !== "opencode-snapshot" || !ref.sourceSystemID || !ref.snapshotRevisionSha256) return;
    invalidateEvidenceRead();
    const generation = evidenceRead.current.generation, controller = new AbortController();
    evidenceRead.current.controller = controller;
    const currentRequest = () => !controller.signal.aborted && evidenceRead.current.generation === generation;
    setOpening("conversation-evidence"); setOpenError("");
    try {
      const result = await api("memory", { operation: "opencode-read", projectID: ref.projectID, sessionID: ref.sessionID,
        sourceSystemID: ref.sourceSystemID, snapshotRevisionSha256: ref.snapshotRevisionSha256, limit: 500 }, "POST", controller.signal);
      if (!currentRequest()) return;
      setSelectedMemory(null); setRetainedFile(null);
      setRetainedConversation({ ...result, navigationProject: hit.project, navigationSession: hit.navigationSession ?? hit.session });
    } catch (error) { if (currentRequest()) setOpenError((error as Error).message); }
    finally { if (currentRequest()) { evidenceRead.current.controller = null; setOpening(""); } }
  }
  async function readMemory(hit: Pick<MemoryHit, "id">, requestedRevision?: number, failurePrefix = "") {
    invalidateEvidenceRead();
    const generation = evidenceRead.current.generation, controller = new AbortController();
    evidenceRead.current.controller = controller;
    const currentRequest = () => !controller.signal.aborted && evidenceRead.current.generation === generation;
    setOpening(`memory:${hit.id}`); setReaderError("");
    try {
      const params = new URLSearchParams({ id: hit.id, ...(requestedRevision === undefined ? {} : { revision: String(requestedRevision) }) });
      const item = await api(`memory/item?${params}`, undefined, undefined, controller.signal);
      if (!currentRequest()) return;
      if (!item) throw Error("This retained memory is no longer available.");
      setRetainedFile(null); setRetainedConversation(null); setSelectedMemory(item); setCaptureUncertain(false); setCapturePollEpoch(value => value + 1);
    } catch (error) { if (currentRequest()) selectedMemory ? setReaderError(failurePrefix + (error as Error).message) : setOpenError(failurePrefix + (error as Error).message); }
    finally { if (currentRequest()) { evidenceRead.current.controller = null; setOpening(""); } }
  }
  async function refreshMemory() {
    if (!selectedMemory || memoryWorking || opening) return;
    setMemoryWorking("capture"); setReaderError("");
    try {
      const result = await api("memory/refresh", { id: selectedMemory.id });
      const job = result.job ?? result.capture;
      if (job && ["queued", "running", "completed", "failed"].includes(job.status)) {
        setSelectedMemory(current => current ? { ...current, job } : current);
        setCapturePollEpoch(value => value + 1);
      } else await readMemory({ id: result.id ?? selectedMemory.id }, undefined, "Source saved, but its latest revision could not be opened. ");
      setRevision(value => value + 1);
    } catch (error) { setCaptureUncertain(true); setReaderError(`Capture was not confirmed. Check the latest revision before retrying. ${(error as Error).message}`); }
    finally { setMemoryWorking(""); }
  }
  async function archiveMemory() {
    if (!selectedMemory || memoryWorking || opening) return;
    setMemoryWorking("archive"); setReaderError("");
    try {
      await api("memory", { operation: "archive", id: selectedMemory.id, archived: selectedMemory.status !== "archived", expectedRevision: selectedMemory.archiveRevision ?? 0 });
      await readMemory(selectedMemory, selectedMemory.revision); setRevision(value => value + 1); await onChange();
    } catch (error) { setReaderError((error as Error).message); }
    finally { setMemoryWorking(""); }
  }
  function editMemory(item?: MemoryItem) {
    setEditorError(""); setEvidenceQuery(""); setEvidenceOptions([]); setEvidenceChoice(""); setEvidenceError("");
    const data = item && Object.keys(item.data ?? {}).length ? JSON.stringify(item.data, null, 2) : "";
    setEditor(item ? { id: item.id, revision: item.revision, title: item.title, body: item.body ?? "", projectID: item.project,
      data, evidence: item.evidence ?? [], reason: "", originalTitle: item.title, originalBody: item.body ?? "",
      originalData: data, originalEvidence: JSON.stringify(item.evidence ?? []) }
      : { title: "", body: "", projectID: searchProject, data: "", evidence: [], reason: "" });
  }
  async function rememberSource(ref: Record<string, unknown>) {
    if (rememberRequest.current.pending || memoryWorking || opening) return;
    const key = rememberKey(ref), savedID = rememberRequest.current.receipts.get(key);
    if (savedID) { await readMemory({ id: savedID }, undefined, "Memory is saved, but could not be opened. "); return; }
    rememberRequest.current.pending = key;
    setRememberPending(key); setOpenError(""); invalidateEvidenceRead();
    setRememberStates(current => ({ ...current, [key]: { status: "saving" } }));
    try {
      const result = await api("memory", { operation: "remember", sourceRefJson: JSON.stringify(ref) });
      if (typeof result?.id !== "string" || !result.id) throw Error("The server did not return a saved memory ID.");
      rememberRequest.current.receipts.set(key, result.id);
      if (!rememberRequest.current.alive || rememberRequest.current.pending !== key) return;
      setRememberStates(current => ({ ...current, [key]: { status: "saved", id: result.id } }));
      setRevision(value => value + 1);
      if (result.memory?.id === result.id && Number.isSafeInteger(result.memory.revision) && result.memory.revision > 0) {
        setRetainedFile(null); setRetainedConversation(null); setReaderError("");
        setSelectedMemory(result.memory); setCaptureUncertain(false); setCapturePollEpoch(value => value + 1);
      } else await readMemory({ id: result.id }, undefined, "Memory is saved, but could not be opened. ");
    } catch (error) {
      if (rememberRequest.current.alive && rememberRequest.current.pending === key)
        setRememberStates(current => ({ ...current, [key]: { status: "error", error: `Save was not confirmed. ${(error as Error).message}` } }));
    } finally {
      if (rememberRequest.current.pending === key) {
        rememberRequest.current.pending = "";
        if (rememberRequest.current.alive) setRememberPending("");
      }
    }
  }
  async function rememberConversation(hit: ConversationResult) {
    if (!hit.project || !hit.session) return;
    await rememberSource(conversationSourceRef(hit));
  }
  async function rememberFile(hit: FileHit) {
    if (!hit.sourceIdentity || !hit.revisionIdentity || !hit.unitSha256) return;
    await rememberSource(fileSourceRef(hit));
  }
  async function saveMemory() {
    if (!editor || memoryWorking) return;
    setMemoryWorking("save"); setEditorError("");
    try {
      const data = editor.data.trim() ? JSON.parse(editor.data) : {};
      if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("Structured memory data must be a JSON object.");
      const content = { title: !editor.id || editor.title !== editor.originalTitle ? editor.title : undefined,
        body: !editor.id || editor.body !== editor.originalBody ? editor.body : undefined,
        dataJson: !editor.id || editor.data !== editor.originalData ? JSON.stringify(data) : undefined,
        evidenceJson: !editor.id || JSON.stringify(editor.evidence) !== editor.originalEvidence ? JSON.stringify({ items: editor.evidence }) : undefined,
        reason: editor.reason || undefined };
      const result = await api("memory", editor.id
        ? { operation: "revise", id: editor.id, expectedRevision: editor.revision, ...content }
        : { operation: "remember", ...content, projectID: editor.projectID || undefined });
      setEditor(null); setResultType("memories"); setQuery(""); setRevision(value => value + 1);
      await readMemory({ id: result.id });
    } catch (error) { setEditorError((error as Error).message); }
    finally { setMemoryWorking(""); }
  }
  async function forgetMemory() {
    if (!forgetting || memoryWorking || opening) return;
    setMemoryWorking("forget"); setReaderError("");
    try {
      await api("memory", { operation: "forget", id: forgetting.id, reason: "Forgotten from the memory view" });
      for (const [key, id] of rememberRequest.current.receipts) if (id === forgetting.id) rememberRequest.current.receipts.delete(key);
      setRememberStates(current => Object.fromEntries(Object.entries(current).filter(([, value]) => value.id !== forgetting.id)));
      setForgetting(null); closeMemoryReader(); setRevision(value => value + 1); await onChange();
    } catch (error) { setReaderError((error as Error).message); }
    finally { setMemoryWorking(""); }
  }
  async function readFileEvidence(ref: EvidenceRef, fallback?: FileHit) {
    invalidateEvidenceRead();
    const generation = evidenceRead.current.generation, controller = new AbortController();
    evidenceRead.current.controller = controller;
    const currentRequest = () => !controller.signal.aborted && evidenceRead.current.generation === generation;
    setOpening("file-evidence"); setOpenError("");
    try {
      const params = new URLSearchParams({ sourceIdentity: ref.sourceIdentity!, revisionIdentity: ref.revisionIdentity!, locator: ref.locator!, unitHash: ref.unitSha256! });
      const result = await api(`memory/evidence?${params}`, undefined, undefined, controller.signal);
      if (!currentRequest()) return;
      setSelectedMemory(null); setRetainedConversation(null); setReaderError("");
      setRetainedFile({ ...result, path: result.path ?? fallback?.path, project: result.project ?? fallback?.project });
    } catch (error) { if (currentRequest()) setOpenError((error as Error).message); }
    finally { if (currentRequest()) { evidenceRead.current.controller = null; setOpening(""); } }
  }
  const canReadFileEvidence = (ref?: { sourceIdentity?: string; revisionIdentity?: string; locator?: string; unitSha256?: string }) => !!(ref?.sourceIdentity && ref.revisionIdentity && ref.locator && ref.unitSha256);
  const memoryTitle = "Memories";
  const memoryRevisions = selectedMemory ? [...new Set([selectedMemory.revision, ...(selectedMemory.revisions ?? []).map(row => row.revision)])].sort((a, b) => b - a) : [];
  const captureBusy = memoryWorking === "capture" || !!selectedMemory?.job && ["queued", "running"].includes(selectedMemory.job.status);
  const editedMemoryText = selectedMemory?.boundary?.bodyEdited === true || selectedMemory?.provenance?.userEditedText === true;
  const editedFileText = selectedMemory?.kind === "file_snapshot" && editedMemoryText;
  const capturedFileMembers = selectedMemory?.kind === "file_snapshot" ? (selectedMemory.members ?? []).filter(member =>
    (member.kind ?? member.member_kind) === "content-unit" && typeof member.locator?.text === "string") : [];
  const showCapturedFileText = selectedMemory?.kind === "file_snapshot" && (editedFileText || !selectedMemory.body);

  return <div className="page indexed-search-page">
    <PageHeading title={searchLabel} icon={FileSearch} help="file-search" description={settingsPage(scoped ? "project" : "application", "search")?.description}
      helpDetails={<><p>Remember saves a chat or file immediately and opens its memory. Edit afterward to add an optional summary, structured data or evidence. New memory creates a custom memory. File, Chat and Custom labels identify the source; all use the same retained object and revision history.</p>{activeStates.filter(value => value.coverage).map((value, index) => <p key={index}>{value.coverage}</p>)}</>}
      actions={<PageCloseButton onClick={onClose} />} />
    <div className="knowledge-type-filters" role="tablist" aria-label="Content result types">{resultTypes.map(([id, name]) => <Button key={id} type="button" role="tab" aria-selected={resultType === id}
      variant={resultType === id ? "primary" : "secondary"} onClick={() => { setResultType(id); setLimit(25); }}>{name}</Button>)}</div>
    <section className="indexed-search-controls" aria-label={searchLabel}>
      <div className="indexed-search-query"><Field label={searchLabel}><input autoFocus type="search" maxLength={200} value={query}
        placeholder={scoped ? `Search content in ${project.name}…` : "Search content across every project…"} onChange={event => { setQuery(event.target.value); setLimit(25); }} /></Field></div>
      {!scoped && <Field label="Project"><select value={filterProject} onChange={event => setFilterProject(event.target.value)}><option value="">All registered projects</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
      {(resultType === "all" || resultType === "files") && <>
        <Field label="Source path"><input type="search" maxLength={500} value={source} placeholder="Any indexed path" onChange={event => setSource(event.target.value)} /></Field>
        <Field label="Source role"><select value={role} onChange={event => setRole(event.target.value)}><option value="">All roles</option><option value="current_project_source">Current project</option><option value="reference_source">Reference</option><option value="project_source">Project source</option><option value="project_archive">Archive</option></select></Field>
        <Field label="Source status"><select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="current">Current</option><option value="reference">Reference</option><option value="source">Source</option><option value="archive">Archive</option></select></Field>
      </>}
      {resultType !== "files" && <Field label={browseConversations && resultType !== "conversations" ? "Memory model ID" : "Model ID"}><input type="search" maxLength={200} value={model} disabled={resultType === "conversations" && !trimmed} placeholder={resultType === "conversations" && !trimmed ? "Enter search words to filter by model" : "Any provider/model"} onChange={event => setModel(event.target.value)} /></Field>}
      <label className="content-search-phrase"><input type="checkbox" checked={phrase} onChange={event => setPhrase(event.target.checked)} /> Exact phrase</label>
      <div className="content-search-scope"><span>Scope</span><strong>{scoped ? project.name : projects.find(item => item.id === filterProject)?.name ?? "All registered projects"}</strong></div>
    </section>
    {wantMemories && <div className="knowledge-actions"><Button variant="primary" disabled={!!rememberPending || !!memoryWorking} onClick={() => editMemory()}><Plus size={16} />New memory</Button><label className="content-search-phrase"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />Include archived memories</label></div>}
    {openError && <p className="notice error" role="alert">{openError}</p>}
    {([["files", "Files", files], ["conversations", "Conversations", conversations], ["memories", memoryTitle, memories]] as const).map(([domain, label, value]) => value.error && <div key={label} className="notice error content-search-error" role="alert"><span>{label}: {value.error}</span><Button onClick={() => retrySearch(domain)}>Retry search</Button></div>)}
    <div className="indexed-search-status" aria-live="polite">{loading ? <span role="status">Searching indexed content…</span> : complete && !browseConversations ? <span>{total ? `${total} matching ${total === 1 ? "result" : "results"}` : "No indexed content matched."}</span> : !browseConversations ? <span>Enter search words to find {resultType}.</span> : null}</div>

    {showConversations && <ConversationResults
      projects={projects} project={searchProject || undefined} results={conversations.results}
      searching={!!trimmed} loading={conversations.loading}
      currentProject={currentProject} activity={activity} initialConversation={initialConversation}
      selectionScope={JSON.stringify([searchProject, trimmed, model, phrase, resultType, source, role, status,
        limit, conversations.cursor ?? null])}
      revision={revision} pages={pageNavigation("conversations", "Conversations", conversations)}
      rememberBusy={!!rememberPending || !!memoryWorking || !!opening}
      rememberState={hit => rememberStates[rememberKey(conversationSourceRef(hit))]}
      onOpen={onOpenConversation} onReadEvidence={readConversationEvidence} onRemember={rememberConversation}
      onChange={async () => { setRevision(value => value + 1); await onChange(); }} />}
    {wantMemories && (!!memories.results.length || !!memories.previousCursors.length || !!memories.cursor || !!memories.error) && <section className="content-search-group" aria-label="Memory results"><h2><BookOpen size={17} />{memoryTitle} <span>{memories.results.length}</span></h2>
      <div className="indexed-search-results">{memories.results.map(hit => <button type="button" className="indexed-search-result" key={hit.id} aria-label={`Read memory ${hit.title}`} disabled={!!opening || !!rememberPending} onClick={() => void readMemory(hit, hit.revision)}>
        <span className="indexed-result-heading"><strong>{hit.title}</strong><span className="memory-result-meta"><span className="memory-source-badge">{memorySourceLabel(hit)}</span><small>Revision {hit.revision}{hit.status === "archived" ? " · archived" : ""}</small></span></span><span className="indexed-result-path"><span>{hit.projectName || "Global memory"}</span><span>{captureLabel(hit)}</span></span>
        <span className="indexed-result-excerpt">{hit.excerpt || (hit.kind === "conversation_snapshot" ? `${hit.messageCount} captured messages` : "Retained memory")}</span>
      </button>)}</div>{pageNavigation("memories", "Memories", memories)}</section>}
    {wantFiles && (!!files.results.length || !!files.previousCursors.length || !!files.cursor || !!files.error) && <section className="content-search-group" aria-label="File results"><h2><FolderOpen size={17} />Files <span>{files.results.length}</span></h2>
      <div className="indexed-search-results">{files.results.map(hit => {
        const key = `file:${hit.project}:${hit.path}`, remembered = rememberStates[rememberKey(fileSourceRef(hit))];
        const rememberLabel = remembered?.status === "saved" ? "Open memory" : remembered?.status === "saving" ? "Saving…" : remembered?.status === "error" ? "Retry save" : "Remember";
        return <div className="knowledge-file-result" key={`${key}:${hit.unit}:${hit.locator}`}><button type="button" className="indexed-search-result" aria-label={`Open file ${hit.projectName}/${hit.path}`} disabled={!!opening || !!rememberPending} onClick={() => void open(key, () => onOpenFile(hit.project, hit.path))}>
          <span className="indexed-result-heading"><strong>{hit.heading || hit.path.split(/[\\/]/).at(-1)}</strong><small>{opening === key ? "Opening project file…" : hit.role}</small></span><span className="indexed-result-path"><span>{hit.projectName}{hit.projectArchived ? " · archived" : ""}</span><span>{hit.path}</span></span>
          <span className="indexed-result-excerpt">{hit.excerpt}</span><span className="indexed-result-open"><FolderOpen size={15} />Open in project Files</span>
        </button>{canReadFileEvidence(hit) && <div className="knowledge-source-actions"><Button disabled={!!opening || !!rememberPending || !!memoryWorking} aria-label={`${rememberLabel} file ${hit.projectName}/${hit.path}`} title={remembered?.status === "saved" ? "Open the saved memory" : "Save this file to memory"} onClick={() => void rememberFile(hit)}><CloudUpload size={15} />{rememberLabel}</Button><Button disabled={!!opening || !!rememberPending} aria-label={`Read retained file evidence ${hit.projectName}/${hit.path}`} onClick={() => void readFileEvidence(hit, hit)}><BookOpen size={15} />Read retained evidence</Button></div>}{remembered?.error && <p className="notice error memory-source-error" role="alert">{remembered.error}</p>}</div>;
      })}</div>{pageNavigation("files", "Files", files)}</section>}
    {needsMore && firstPages && limit < 100 && <div className="knowledge-actions"><Button onClick={() => setLimit(current => Math.min(100, current + 25))}>Show more results</Button></div>}
    {complete && !total && activeStates.every(value => !value.error) && <Panel className="indexed-search-empty" help="file-search"><FileSearch size={22} aria-hidden="true" /><strong>No indexed content found</strong></Panel>}

    {selectedMemory && <Dialog title={selectedMemory.title} description={`${memorySourceLabel(selectedMemory)} · ${selectedMemory.projectName || "Global memory"} · retained revision ${selectedMemory.revision} · ${words(selectedMemory.coverage)}`} size="wide" className="memory-reader" bodyClassName="memory-reader-body" busy={!!memoryWorking} onClose={closeMemoryReader}
      footer={<><Button disabled={!!memoryWorking || !!opening} onClick={() => void archiveMemory()}><Archive size={15} />{selectedMemory.status === "archived" ? "Restore memory" : "Archive memory"}</Button><Button disabled={!!memoryWorking || !!opening} onClick={() => editMemory(selectedMemory)}><Pencil size={15} />Edit memory</Button><Button variant="danger" disabled={!!memoryWorking || !!opening} onClick={() => setForgetting(selectedMemory)}><Trash2 size={15} />Forget memory</Button></>}>
      {readerError && <p className="notice error" role="alert">{readerError}</p>}
      {selectedMemory.status === "archived" && <p className="notice">This memory is archived. Its retained revisions are preserved.</p>}
      <div className="knowledge-reader-actions"><Field label="Retained revision"><select value={selectedMemory.revision} disabled={!!opening || !!memoryWorking} onChange={event => void readMemory(selectedMemory, Number(event.target.value))}>{memoryRevisions.map(value => <option key={value} value={value}>Revision {value}</option>)}</select></Field>
        <Button disabled={!!opening || !!memoryWorking} onClick={() => void readMemory(selectedMemory)}>Check latest revision</Button>
        {["conversation_snapshot", "file_snapshot"].includes(selectedMemory.kind) && <Button disabled={captureBusy || captureUncertain || !!opening || !!memoryWorking} onClick={() => void refreshMemory()}><RefreshCw size={15} />{memoryWorking === "capture" ? "Refreshing…" : captureBusy ? `Capture ${selectedMemory.job?.status}…` : "Refresh snapshot"}</Button>}
        {selectedMemory.kind === "conversation_snapshot" && selectedMemory.project && selectedMemory.session && <Button disabled={!!opening || !!memoryWorking} onClick={() => { const item = selectedMemory; closeMemoryReader(); void open("live-memory-source", () => onOpenConversation(item.project, item.session!)); }}><MessageSquare size={15} />Open live conversation</Button>}
      </div>
      {memoryRevisions[0] > selectedMemory.revision && <p role="status">A newer retained revision is available. Select it above to read its evidence.</p>}
      {selectedMemory.sourceUpdates?.state === "newer-retained" && <p className="notice" role="status">A newer retained source revision is available. This memory still shows its captured revision.{selectedMemory.kind === "conversation_snapshot" ? " Refresh snapshot creates another memory revision." : " Its retained evidence has not been replaced."}</p>}
      {selectedMemory.sourceUpdates?.state === "unknown" && <p className="notice">Current source content is unknown. A comparable retained source revision could not be confirmed.</p>}
      {selectedMemory.job && <p role="status">Capture {words(selectedMemory.job.status)}{selectedMemory.job.error ? `: ${selectedMemory.job.error}` : ""}.</p>}
      {selectedMemory.kind === "conversation_snapshot" && selectedMemory.coverage === "unknown_source" && <p className="notice">The source could not be checked. Its availability is unknown. Any transcript below is from the last retained capture.</p>}
      {selectedMemory.kind === "conversation_snapshot" && selectedMemory.coverage === "missing_source" && <p className="notice">OpenCode reported this conversation missing. Any transcript below is retained from an earlier capture.</p>}
      {selectedMemory.kind === "conversation_snapshot" && !(selectedMemory.messages ?? []).length && <p className="notice">This revision has no captured transcript. Its coverage is shown above.</p>}
      {!!selectedMemory.body && selectedMemory.kind !== "conversation_snapshot" && !editedFileText && <p className="knowledge-memory-body">{selectedMemory.body}</p>}
      {!!selectedMemory.body && (selectedMemory.kind === "conversation_snapshot" || editedFileText) && editedMemoryText && <section className="memory-authored-text"><h3>Edited memory text</h3><p className="knowledge-memory-body">{selectedMemory.body}</p></section>}
      {showCapturedFileText && (capturedFileMembers.length ? <details className="memory-structured-data"><summary>Captured file text</summary><p className="knowledge-identity">Extracted text from this retained indexed revision; binary bytes and unsupported content were excluded.{selectedMemory.boundary?.truncated ? " This capture is bounded." : ""}</p><pre className="knowledge-retained-text">{capturedFileMembers.map(member => member.locator!.text!).join("\n\n")}</pre></details>
        : <p className="notice">This revision has no retained file text available. Its source coverage is shown above.</p>)}
      {!!Object.keys(selectedMemory.data ?? {}).length && <details className="memory-structured-data"><summary>Structured data</summary><dl className="knowledge-metadata">{Object.entries(selectedMemory.data ?? {}).map(([key, value]) => <div className="memory-data-entry" key={key}><dt>{key}</dt><dd>{value !== null && typeof value === "object" ? <pre className="knowledge-retained-text">{JSON.stringify(value, null, 2)}</pre> : String(value)}</dd></div>)}</dl></details>}
      {!!selectedMemory.evidence?.length && <details className="knowledge-provenance"><summary>Retained evidence · {selectedMemory.evidence.length}</summary>{selectedMemory.evidence.map((evidence, index) => {
        const ref = evidence.ref ?? evidence, memoryRef = memoryEvidenceReference(ref);
        return <div className="knowledge-evidence" key={`${evidence.id}:${index}`}><strong>{evidence.relation || "Source"}</strong><span>{evidence.label || evidence.id}</span>{canReadFileEvidence(ref) && <Button disabled={!!opening || !!memoryWorking} onClick={() => void readFileEvidence(ref)}>Read retained evidence</Button>}{memoryRef && <Button disabled={!!opening || !!memoryWorking} onClick={() => void readMemory(memoryRef, memoryRef.revision)}>Read memory revision</Button>}<details><summary>Source reference</summary><pre className="knowledge-retained-text">{JSON.stringify(evidence, null, 2)}</pre></details></div>;
      })}</details>}
      {editedMemoryText && !!selectedMemory.messages?.length && <h3 className="memory-transcript-title">Captured transcript</h3>}
      <div className="memory-reader-messages">{(selectedMemory.messages ?? []).map(message => <article key={`${message.ordinal}:${message.role}`} className={`memory-reader-message ${message.role}`}><strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : words(message.role)}</strong><p>{message.text}</p></article>)}</div>
      <details className="knowledge-provenance"><summary>Source and revision history</summary><dl className="knowledge-metadata"><dt>Memory ID</dt><dd>{selectedMemory.id}</dd><dt>Source captured</dt><dd>{when(selectedMemory.capturedAt ?? selectedMemory.boundary?.capturedAt)}</dd>{selectedMemory.boundary?.attemptedAt != null && <><dt>Last source check</dt><dd>{when(selectedMemory.boundary.attemptedAt)}</dd></>}{selectedMemory.boundary?.snapshotCreatedAt != null && <><dt>Retained revision recorded</dt><dd>{when(selectedMemory.boundary.snapshotCreatedAt)}</dd></>}<dt>Coverage</dt><dd>{words(selectedMemory.coverage)}</dd><dt>Captured messages</dt><dd>{selectedMemory.messageCount}</dd>{selectedMemory.snapshotHash && <><dt>Snapshot hash</dt><dd>{selectedMemory.snapshotHash}</dd></>}</dl>
        {selectedMemory.sourceUpdates && selectedMemory.sourceUpdates.state !== "not-applicable" && <p>Source comparison: {words(selectedMemory.sourceUpdates.state)} · {selectedMemory.sourceUpdates.comparedSources} local source revisions compared{selectedMemory.sourceUpdates.unknownSources ? ` · ${selectedMemory.sourceUpdates.unknownSources} unconfirmed components` : ""}. Live source content was not checked.{selectedMemory.sourceUpdates.truncated ? " This comparison is bounded; omitted components remain unknown." : ""}</p>}
        {selectedMemory.boundary?.truncated && <p>This snapshot is bounded; additional source content was not captured.</p>}{!!selectedMemory.boundary?.missingSources?.length && <p>{selectedMemory.boundary.missingSources.length} source components were unavailable.</p>}
        {(selectedMemory.members ?? []).map((member, index) => <div key={index} className="knowledge-evidence"><strong>{member.kind ?? member.member_kind}</strong><span>{member.ref ?? member.source_ref}</span><span>{words(member.availability)}</span><small>{member.revision ?? member.source_revision}</small></div>)}
        {!!Object.keys(selectedMemory.provenance ?? {}).length && <pre className="knowledge-retained-text">{JSON.stringify(selectedMemory.provenance, null, 2)}</pre>}
        <ul className="memory-revision-history">{(selectedMemory.revisions ?? []).map(row => <li key={row.revision}><Button disabled={!!opening || !!memoryWorking} onClick={() => void readMemory(selectedMemory, row.revision)}>Revision {row.revision}</Button><span>{when(row.createdAt)}{row.reason ? ` · ${row.reason}` : ""}</span></li>)}</ul>
      </details>
    </Dialog>}
    {retainedFile && <Dialog title="Retained file evidence" description={`${retainedFile.path ?? "Indexed source"} · ${words(retainedFile.availability)}`} size="wide" onClose={closeFileReader} footer={retainedFile.project && retainedFile.path && <Button onClick={() => { const item = retainedFile; closeFileReader(); void open("live-file-source", () => onOpenFile(item.project!, item.path!)); }}>Open live file</Button>}>
      {retainedFile.text !== undefined ? <pre className="knowledge-retained-text">{retainedFile.text}</pre> : <p>This retained evidence is unavailable. Its source revision was not replaced with live text.</p>}<details><summary>Evidence identity</summary><p className="knowledge-identity">{retainedFile.revisionIdentity}</p><p className="knowledge-identity">{retainedFile.hash}</p></details>
    </Dialog>}
    {retainedConversation && <Dialog title="Retained conversation evidence" description={`${retainedConversation.session?.title ?? "Indexed conversation"} · ${words(retainedConversation.coverage ?? retainedConversation.status)}`} size="wide" onClose={closeConversationReader}
      footer={<Button onClick={() => { const item = retainedConversation; closeConversationReader(); void open("live-conversation-source", () => onOpenConversation(item.navigationProject, item.navigationSession)); }}>Open live conversation</Button>}>
      {retainedConversation.status !== "ok" && <p>This retained source window is unavailable. It was not replaced with live conversation text.</p>}
      {retainedConversation.truncated && <p className="notice">This reader shows the first 500 retained messages. The source window contains additional messages.</p>}
      <div className="memory-reader-messages">{(retainedConversation.messages ?? []).map(message => <article key={message.messageID} className={`memory-reader-message ${message.role}`}><strong>{words(message.role)}</strong><p>{message.parts.filter(part => part.type === "text").map(part => part.text).join("\n")}</p></article>)}</div>
      <details><summary>Source identity and capture</summary><dl className="knowledge-metadata"><dt>Source captured</dt><dd>{when(retainedConversation.capturedAt)}</dd><dt>Session</dt><dd>{retainedConversation.session?.sessionID ?? "Unavailable"}</dd><dt>Snapshot hash</dt><dd className="knowledge-identity">{retainedConversation.snapshotRevisionSha256}</dd></dl></details>
    </Dialog>}
    {editor && <Dialog title={editor.id ? "Edit memory" : "New memory"} size="wide" onClose={() => setEditor(null)} busy={!!memoryWorking} onSubmit={event => { event.preventDefault(); void saveMemory(); }} footer={<><HelpHint topic="file-search" label="Memory details" details={<><p>A memory has a title and can optionally hold text, structured data, retained evidence and relationships. Editing creates a new retained revision.</p><p>Structured data accepts a JSON object with any fields, including origin, status, scope, dates and relationships. Existing fields are preserved until you edit them. Evidence links refer to exact retained sources and do not verify an assertion by themselves.</p><p>For conversation memories, captured messages and source boundaries remain attached. Edited memory text is separate from the captured transcript.</p></>} /><Button type="button" disabled={!!memoryWorking} onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={!!memoryWorking}>{memoryWorking === "save" ? "Saving…" : "Save memory"}</Button></>}>
      <Field label="Memory title"><input required maxLength={1000} value={editor.title} onChange={event => setEditor(current => current ? { ...current, title: event.target.value } : current)} /></Field>
      <Field label="Memory text"><textarea maxLength={1000000} rows={7} value={editor.body} onChange={event => setEditor(current => current ? { ...current, body: event.target.value } : current)} /></Field>
      {!editor.id && !scoped && <Field label="Memory scope"><select value={editor.projectID} onChange={event => setEditor(current => current ? { ...current, projectID: event.target.value } : current)}><option value="">Global memory</option>{projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
      <details className="memory-editor-details"><summary>Structured data and evidence</summary>
        <Field label="Structured data (JSON object)"><textarea className="memory-json-input" maxLength={1000000} rows={7} spellCheck={false} value={editor.data} onChange={event => setEditor(current => current ? { ...current, data: event.target.value } : current)} /></Field>
        <section className="knowledge-editor-evidence" aria-label="Retained memory evidence"><h3>Retained evidence</h3><Field label="Find retained evidence"><input type="search" maxLength={200} value={evidenceQuery} onChange={event => setEvidenceQuery(event.target.value)} /></Field><div className="knowledge-evidence-picker"><Field label="Retained source revision"><select value={evidenceChoice} disabled={evidenceLoading} onChange={event => setEvidenceChoice(event.target.value)}><option value="">{evidenceLoading ? "Finding retained evidence…" : "Select retained evidence"}</option>{evidenceOptions.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></Field><Button type="button" disabled={!evidenceChoice || !!memoryWorking} onClick={() => { const choice = evidenceOptions.find(row => row.id === evidenceChoice); if (choice) setEditor(current => current && !current.evidence.some(row => row.id === choice.id) ? { ...current, evidence: [...current.evidence, choice.evidence] } : current); setEvidenceChoice(""); }}>Add evidence</Button></div>
          {evidenceError && <p className="notice error" role="alert">{evidenceError}</p>}{editor.evidence.map((evidence, index) => <div className="knowledge-selected-evidence" key={evidence.id + ":" + index}><span>{evidence.label || evidence.id}</span><Field label={"Evidence relation for " + (evidence.label || evidence.id)}><select value={evidence.relation ?? ""} onChange={event => setEditor(current => current ? { ...current, evidence: current.evidence.map((row, rowIndex) => rowIndex === index ? { ...row, relation: event.target.value || undefined } : row) } : current)}><option value="">Source</option>{evidence.relation && !evidenceRelations.includes(evidence.relation) && <option value={evidence.relation}>{words(evidence.relation)}</option>}{evidenceRelations.map(value => <option key={value} value={value}>{words(value)}</option>)}</select></Field><Button type="button" aria-label={"Remove evidence " + (evidence.label || evidence.id)} onClick={() => setEditor(current => current ? { ...current, evidence: current.evidence.filter((_, rowIndex) => rowIndex !== index) } : current)}>Remove</Button></div>)}
        </section>
      </details>
      {editor.id && <Field label="Reason for revision"><input maxLength={2000} value={editor.reason} onChange={event => setEditor(current => current ? { ...current, reason: event.target.value } : current)} /></Field>}
      {editorError && <p className="notice error" role="alert">{editorError}</p>}
    </Dialog>}
    {forgetting && <ConfirmDialog title="Forget retained memory?" onCancel={() => setForgetting(null)} onConfirm={() => void forgetMemory()} confirmLabel="Forget memory" busy={memoryWorking === "forget"} danger error={readerError}><p>Remove “{forgetting.title}” and its retained revisions from memory search. {forgetting.kind === "conversation_snapshot" ? "The original conversation stays in OpenCode. " : ""}Existing backups can contain copies.</p></ConfirmDialog>}
  </div>;
}
