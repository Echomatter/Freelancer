import { useEffect, useRef, useState } from "react";
import { Archive, Database, FileSearch, FolderOpen, MessageSquare, Pin, BookOpen, Plus, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { api } from "./api";
import { settingsPage } from "./settings-catalog.mjs";
import { Badge, Button, Field, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";
import { ConfirmDialog, Dialog } from "./echoflex/Dialog";
import { HelpHint } from "./HelpHint";
import { ConversationResults } from "./ChatManagement";
import "./indexed-search.css";

type FileHit = {
  project: string; projectName: string; projectArchived: boolean; path: string; role: string;
  unit: number; locator: string; heading: string; excerpt: string;
  sourceIdentity?: string; revisionIdentity?: string; unitSha256?: string;
};
type ConversationHit = {
  project: string; projectName: string; session: string; title: string; excerpt: string; imported?: boolean;
  navigationSession?: string; navigationTitle?: string; evidence?: EvidenceRef | null; capturedAt?: number; indexedAt?: number;
  goal?: any; organization?: { pinnedAt?: number | null; revision?: number; archiveScope?: string; nativeArchived?: boolean; projectArchived?: boolean };
};
type CaptureJob = { id?: string; status: string; error?: string; attempts?: number };
type MemoryHit = {
  id: string; kind: string; project: string; projectName: string; session?: string; title: string;
  coverage: string; revision: number; pinnedAt: number | null; pinRevision?: number;
  messageCount: number; excerpt: string; job?: CaptureJob | null; status?: string; archiveRevision?: number;
};
type MemoryMember = { kind?: string; member_kind?: string; ref?: string; source_ref?: string; revision?: string; source_revision?: string; availability: string; hash?: string; content_hash?: string };
type MemoryItem = MemoryHit & {
  body?: string; status?: string; snapshotHash?: string; capturedAt?: number | null;
  sourceUpdates?: { state: "newer-retained" | "unchanged-retained" | "unknown" | "not-applicable"; basis: "retained-local-data"; liveSource: "not-checked"; checkedAt: number; comparedSources: number; changedSources: number; unknownSources: number; truncated: boolean };
  boundary?: { status?: string; capturedAt?: number | null; attemptedAt?: number; snapshotCreatedAt?: number; messageCount?: number; missingSources?: unknown[]; truncated?: boolean; [key: string]: unknown };
  members?: MemoryMember[]; revisions?: { revision: number; createdAt: number }[];
  messages: { ordinal: number; role: string; createdAt: number | null; text: string; providerID?: string | null; modelID?: string | null }[];
};
type EvidenceRef = { kind?: string; sourceIdentity?: string; revisionIdentity?: string; locator?: string; unitSha256?: string; revisionSha256?: string; projectID?: string; sessionID?: string; sourceSystemID?: string; snapshotRevisionSha256?: string; memoryID?: string; memoryRevision?: number; revision?: number };
type RetainedConversation = { status: string; snapshotRevisionSha256: string; capturedAt?: number; truncated?: boolean; coverage?: string;
  session?: { title: string; sourceSystemID: string; projectID: string; sessionID: string; sourceRef?: string };
  messages?: { messageID: string; role: string; revisionSha256: string; parts: { type: string; text?: string }[] }[];
  navigationProject: string; navigationSession: string };
type SelectedEvidence = EvidenceRef & { id: string; relation: string; label?: string };
type ClaimEditor = { id: string; expectedEpistemicState?: string; predicate: string; value: string; originalValue?: unknown; originalScope?: Record<string, unknown>; originalProjectID?: string; origin: string; epistemicState: string; method: string; reason: string; projectID: string; evidence: SelectedEvidence[] };
type EvidenceChoice = { id: string; label: string; evidence: SelectedEvidence };
type ClaimHit = {
  id: string; predicate: string; value?: unknown; subjectName?: string; objectName?: string;
  origin: string; method: string; epistemicState: string; scope?: unknown;
  validFrom?: number | null; validTo?: number | null; observedAt?: number | null; recordedAt?: number;
  evidence?: (EvidenceRef & { id: string; relation: string; ref?: EvidenceRef })[];
  sourceRefCount?: number; sourceRefsTruncated?: boolean; valueTruncated?: boolean; scopeTruncated?: boolean;
};
type RetainedFile = { text?: string; availability: string; path?: string; project?: string; hash?: string; revisionIdentity?: string };
type SearchDomain = "files" | "conversations" | "memories" | "facts";
type SearchPage = { limit: number; offset: number; returned: number; hasMore: boolean; continuation: string; consistency: "moving-index" };
type PageTarget = { cursor?: string; previousCursors: (string | undefined)[] };
type SearchState<T> = PageTarget & { results: T[]; error: string; loading: boolean; complete: boolean; coverage: string; truncated: boolean;
  nextCursor: string | null; page: SearchPage | null; retryPage?: PageTarget };
type ResultType = "all" | "files" | "conversations" | "memories" | "facts" | "pinned";
const resultTypes: [ResultType, string][] = [["all", "All content"], ["files", "Files"], ["conversations", "Conversations"], ["memories", "Memories"], ["facts", "Facts"], ["pinned", "Pinned"]];
const empty = <T,>(): SearchState<T> => ({ results: [], error: "", loading: false, complete: false, coverage: "", truncated: false, nextCursor: null, page: null, previousCursors: [] });
const pending = <T,>(): SearchState<T> => ({ ...empty<T>(), loading: true });
const readResult = <T,>(value: any): SearchState<T> => {
  if (!Array.isArray(value?.results) || value.results.length > 100) throw Error("The knowledge result could not be read. Retry the query.");
  const page = value.page && Number.isSafeInteger(value.page.offset) && value.page.offset >= 0 && value.page.consistency === "moving-index" ? value.page : null;
  return { ...empty<T>(), results: value.results, error: "", loading: false, complete: true, page,
    nextCursor: typeof value.nextCursor === "string" && value.nextCursor.length > 0 && value.nextCursor.length <= 1024 ? value.nextCursor : null,
    coverage: typeof value.coverage === "string" ? value.coverage : value.coverage?.summary ?? "", truncated: value.truncated === true || page?.hasMore === true };
};
const words = (value?: string) => (value ?? "Unknown").replaceAll("_", " ");
const when = (value?: number | null) => value == null ? "Not recorded" : new Date(value).toLocaleString();
const shownValue = (value: unknown) => typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
const captureLabel = (item: MemoryHit) => item.job && ["queued", "running"].includes(item.job.status)
  ? `Capture ${item.job.status}` : words(item.coverage);
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
  const [model, setModel] = useState(""), [phrase, setPhrase] = useState(false), [historical, setHistorical] = useState(false);
  const [claimState, setClaimState] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [files, setFiles] = useState<SearchState<FileHit>>(empty), [conversations, setConversations] = useState<SearchState<ConversationHit>>(empty);
  const [memories, setMemories] = useState<SearchState<MemoryHit>>(empty), [facts, setFacts] = useState<SearchState<ClaimHit>>(empty);
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null), [retainedFile, setRetainedFile] = useState<RetainedFile | null>(null);
  const [retainedConversation, setRetainedConversation] = useState<RetainedConversation | null>(null);
  const [opening, setOpening] = useState(""), [openError, setOpenError] = useState("");
  const [revision, setRevision] = useState(0), [limit, setLimit] = useState(25);
  const [readerError, setReaderError] = useState(""), [memoryWorking, setMemoryWorking] = useState("");
  const [captureUncertain, setCaptureUncertain] = useState(false), [capturePollEpoch, setCapturePollEpoch] = useState(0);
  const [editor, setEditor] = useState<{ id?: string; revision?: number; title: string; body: string; projectID: string } | null>(null);
  const [editorError, setEditorError] = useState(""), [forgetting, setForgetting] = useState<MemoryItem | null>(null);
  const [claimEditor, setClaimEditor] = useState<ClaimEditor | null>(null), [claimError, setClaimError] = useState(""), [claimWorking, setClaimWorking] = useState(false);
  const [evidenceQuery, setEvidenceQuery] = useState(""), [evidenceOptions, setEvidenceOptions] = useState<EvidenceChoice[]>([]);
  const [evidenceChoice, setEvidenceChoice] = useState(""), [evidenceError, setEvidenceError] = useState(""), [evidenceLoading, setEvidenceLoading] = useState(false);
  const evidenceRead = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const searchRead = useRef({ generation: 0, controllers: new Map<SearchDomain, AbortController>() });
  const trimmed = query.trim(), scoped = !!project?.id;
  const searchProject = project?.id || filterProject;
  const wantFiles = !!trimmed && (resultType === "all" || resultType === "files");
  const showConversations = resultType === "conversations" || resultType === "pinned" || resultType === "all";
  const wantConversations = !!trimmed && showConversations;
  const browseConversations = !trimmed && showConversations;
  const wantMemories = ["all", "memories", "pinned"].includes(resultType);
  const wantFacts = resultType === "facts" || resultType === "all" && !!trimmed;
  const pinnedOnly = resultType === "pinned" || resultType === "all" && !trimmed;
  const searchLabel = scoped ? "Search project content" : "Search all content";
  const activeStates = [wantFiles ? files : null, wantConversations ? conversations : null, wantMemories ? memories : null, wantFacts ? facts : null].filter(Boolean) as SearchState<unknown>[];
  const loading = activeStates.some(value => value.loading), complete = !!activeStates.length && activeStates.every(value => value.complete);
  const total = activeStates.reduce((count, value) => count + value.results.length, 0);
  const needsMore = activeStates.some(value => value.truncated);
  const firstPages = activeStates.every(value => !value.cursor);
  const domainStates = { files, conversations, memories, facts };
  const domainSetters = { files: setFiles, conversations: setConversations, memories: setMemories, facts: setFacts };

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
        params.set("pinnedOnly", String(pinnedOnly)); params.set("includeArchived", String(includeArchived));
        if (model) params.set("model", model);
        value = await api(`memory/search?${params}`, undefined, undefined, controller.signal);
      } else value = await api("knowledge", { operation: "query", domain: "facts", query: trimmed, projectID: searchProject || undefined,
        model: model || undefined, epistemicState: claimState || undefined, includeHistorical: historical, phrase, limit, cursor: target.cursor }, "POST", controller.signal);
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
    setFacts(wantFacts ? pending() : empty());
    const timer = setTimeout(() => {
      if (wantFiles) void requestPage("files", { previousCursors: [] }, generation);
      if (wantConversations) void requestPage("conversations", { previousCursors: [] }, generation);
      if (wantMemories) void requestPage("memories", { previousCursors: [] }, generation);
      if (wantFacts) void requestPage("facts", { previousCursors: [] }, generation);
    }, 180);
    return () => {
      clearTimeout(timer); searchRead.current.generation++;
      for (const controller of searchRead.current.controllers.values()) controller.abort();
      searchRead.current.controllers.clear();
    };
  }, [trimmed, searchProject, source, role, status, model, phrase, historical, claimState, includeArchived, resultType, limit, revision]);

  useEffect(() => () => invalidateEvidenceRead(), []);

  useEffect(() => {
    if (!claimEditor) return;
    const controller = new AbortController();
    setEvidenceLoading(true); setEvidenceError(""); setEvidenceChoice("");
    const params = new URLSearchParams({ q: evidenceQuery.trim(), limit: "25", ...(claimEditor.projectID ? { project: claimEditor.projectID } : {}) });
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
  }, [!!claimEditor, claimEditor?.projectID, evidenceQuery]);

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
      const result = await api("knowledge", { operation: "opencode-read", projectID: ref.projectID, sessionID: ref.sessionID,
        sourceSystemID: ref.sourceSystemID, snapshotRevisionSha256: ref.snapshotRevisionSha256, limit: 500 }, "POST", controller.signal);
      if (!currentRequest()) return;
      setSelectedMemory(null); setRetainedFile(null);
      setRetainedConversation({ ...result, navigationProject: hit.project, navigationSession: hit.navigationSession ?? hit.session });
    } catch (error) { if (currentRequest()) setOpenError((error as Error).message); }
    finally { if (currentRequest()) { evidenceRead.current.controller = null; setOpening(""); } }
  }
  async function readMemory(hit: Pick<MemoryHit, "id">, requestedRevision?: number) {
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
    } catch (error) { if (currentRequest()) selectedMemory ? setReaderError((error as Error).message) : setOpenError((error as Error).message); }
    finally { if (currentRequest()) { evidenceRead.current.controller = null; setOpening(""); } }
  }
  async function refreshMemory() {
    if (!selectedMemory || memoryWorking || opening) return;
    setMemoryWorking("capture"); setReaderError("");
    try {
      const result = await api("memory/refresh", { id: selectedMemory.id });
      setSelectedMemory(current => current ? { ...current, job: result.job ?? result } : current);
      setCapturePollEpoch(value => value + 1);
      setRevision(value => value + 1);
    } catch (error) { setCaptureUncertain(true); setReaderError(`Capture was not confirmed. Check the latest revision before retrying. ${(error as Error).message}`); }
    finally { setMemoryWorking(""); }
  }
  async function pinMemory() {
    if (!selectedMemory || memoryWorking || opening) return;
    setMemoryWorking("pin"); setReaderError("");
    try {
      await api("knowledge", { operation: "pin", id: selectedMemory.id, pinned: !selectedMemory.pinnedAt, expectedRevision: selectedMemory.pinRevision ?? 0 });
      await readMemory(selectedMemory, selectedMemory.revision); setRevision(value => value + 1); await onChange();
    } catch (error) { setReaderError((error as Error).message); }
    finally { setMemoryWorking(""); }
  }
  async function archiveMemory() {
    if (!selectedMemory || memoryWorking || opening) return;
    setMemoryWorking("archive"); setReaderError("");
    try {
      await api("knowledge", { operation: "archive", id: selectedMemory.id, archived: selectedMemory.status !== "archived", expectedRevision: selectedMemory.archiveRevision ?? 0 });
      await readMemory(selectedMemory, selectedMemory.revision); setRevision(value => value + 1); await onChange();
    } catch (error) { setReaderError((error as Error).message); }
    finally { setMemoryWorking(""); }
  }
  function openClaimEditor(fact: ClaimHit) {
    const scope = fact.scope && typeof fact.scope === "object" && !Array.isArray(fact.scope) ? fact.scope as Record<string, unknown> : {};
    const factProjectID = typeof scope.projectID === "string" ? scope.projectID : typeof scope.project === "string" ? scope.project : "";
    const projectID = factProjectID;
    setClaimError(""); setEvidenceQuery(""); setEvidenceOptions([]); setEvidenceChoice("");
    setClaimEditor({ id: fact.id, expectedEpistemicState: fact.epistemicState, predicate: fact.predicate, value: shownValue(fact.value), originalValue: fact.value,
      originalScope: scope, originalProjectID: projectID, origin: "user-stated", epistemicState: "unverified", method: "", reason: "", projectID, evidence: [] });
  }
  async function editClaim(fact: ClaimHit) {
    if (!fact.valueTruncated && !fact.scopeTruncated) { openClaimEditor(fact); return; }
    invalidateEvidenceRead();
    const generation = evidenceRead.current.generation, controller = new AbortController();
    evidenceRead.current.controller = controller;
    const currentRequest = () => !controller.signal.aborted && evidenceRead.current.generation === generation;
    setOpening("claim"); setOpenError("");
    try {
      const retained = await api("knowledge", { operation: "read-claim", id: fact.id }, undefined, controller.signal);
      if (!currentRequest()) return;
      if (retained?.id !== fact.id || retained.status === "missing" || retained.valueTruncated || retained.scopeTruncated) throw Error("The retained fact could not be read. Retry before correcting it.");
      openClaimEditor(retained);
    } catch (error) { if (currentRequest()) setOpenError((error as Error).message); }
    finally { if (currentRequest()) { evidenceRead.current.controller = null; setOpening(""); } }
  }
  async function saveClaim() {
    if (!claimEditor?.id || claimWorking) return;
    if (!claimEditor.evidence.length) { setClaimError("Select at least one retained source revision for this fact."); return; }
    setClaimWorking(true); setClaimError("");
    try {
      const value = claimEditor.value === shownValue(claimEditor.originalValue) ? claimEditor.originalValue : claimEditor.value;
      // An unchanged scope is preserved by the transactional correction API.
      // Changing its project keeps the other recorded applicability fields.
      let scopeJson: string | undefined;
      if (claimEditor.projectID !== claimEditor.originalProjectID) {
        const scope = { ...claimEditor.originalScope };
        delete scope.projectID; delete scope.project;
        if (claimEditor.projectID) scope.projectID = claimEditor.projectID;
        scopeJson = JSON.stringify(scope);
      }
      await api("knowledge", { operation: "correct-claim", id: claimEditor.id, expectedEpistemicState: claimEditor.expectedEpistemicState,
        predicate: claimEditor.predicate, valueJson: JSON.stringify(value), origin: claimEditor.origin, epistemicState: claimEditor.epistemicState,
        method: claimEditor.method, reason: claimEditor.reason, sessionID: "user", scopeJson,
        evidenceJson: JSON.stringify({ items: claimEditor.evidence.map(({ label: _label, ...item }) => item) }) });
      setClaimEditor(null); setResultType("facts"); setQuery(""); setClaimState(""); setRevision(current => current + 1);
    } catch (error) { setClaimError((error as Error).message); }
    finally { setClaimWorking(false); }
  }
  async function saveNote() {
    if (!editor || memoryWorking) return;
    setMemoryWorking("save"); setEditorError("");
    try {
      const result = await api("knowledge", editor.id
        ? { operation: "revise", id: editor.id, expectedRevision: editor.revision, body: editor.body }
        : { operation: "remember", type: "note", title: editor.title, body: editor.body, projectID: editor.projectID || undefined });
      setEditor(null); setResultType("memories"); setQuery(""); setRevision(value => value + 1);
      await readMemory({ id: result.id });
    } catch (error) { setEditorError((error as Error).message); }
    finally { setMemoryWorking(""); }
  }
  async function forgetMemory() {
    if (!forgetting || memoryWorking || opening) return;
    setMemoryWorking("forget"); setReaderError("");
    try {
      await api("knowledge", { operation: "forget", id: forgetting.id, reason: "Forgotten from the knowledge view" });
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
      const result = await api(`knowledge/evidence?${params}`, undefined, undefined, controller.signal);
      if (!currentRequest()) return;
      setSelectedMemory(null); setRetainedConversation(null); setReaderError("");
      setRetainedFile({ ...result, path: result.path ?? fallback?.path, project: result.project ?? fallback?.project });
    } catch (error) { if (currentRequest()) setOpenError((error as Error).message); }
    finally { if (currentRequest()) { evidenceRead.current.controller = null; setOpening(""); } }
  }
  const canReadFileEvidence = (ref?: { sourceIdentity?: string; revisionIdentity?: string; locator?: string; unitSha256?: string }) => !!(ref?.sourceIdentity && ref.revisionIdentity && ref.locator && ref.unitSha256);
  const memoryTitle = pinnedOnly ? "Pinned memories" : "Memories";
  const memoryRevisions = selectedMemory ? [...new Set([selectedMemory.revision, ...(selectedMemory.revisions ?? []).map(row => row.revision)])].sort((a, b) => b - a) : [];
  const captureBusy = memoryWorking === "capture" || !!selectedMemory?.job && ["queued", "running"].includes(selectedMemory.job.status);

  return <div className="page indexed-search-page">
    <PageHeading title={searchLabel} icon={FileSearch} help="file-search" description={settingsPage(scoped ? "project" : "application", "search")?.description}
      helpDetails={<>{activeStates.filter(value => value.coverage).map((value, index) => <p key={index}>{value.coverage}</p>)}</>}
      actions={<PageCloseButton onClick={onClose} />} />
    <div className="knowledge-type-filters" role="tablist" aria-label="Knowledge result types">{resultTypes.map(([id, name]) => <Button key={id} type="button" role="tab" aria-selected={resultType === id}
      variant={resultType === id ? "primary" : "secondary"} onClick={() => { setResultType(id); setLimit(25); }}>{name}</Button>)}</div>
    <section className="indexed-search-controls" aria-label={searchLabel}>
      <div className="indexed-search-query"><Field label={searchLabel}><input autoFocus type="search" maxLength={200} value={query}
        placeholder={scoped ? `Search knowledge in ${project.name}…` : "Search knowledge across every project…"} onChange={event => { setQuery(event.target.value); setLimit(25); }} /></Field></div>
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
    {(resultType === "memories" || resultType === "pinned") && <div className="knowledge-actions"><Button variant="primary" onClick={() => { setEditorError(""); setEditor({ title: "", body: "", projectID: searchProject }); }}><Plus size={16} />New memory</Button><label className="content-search-phrase"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />Include archived memories</label></div>}
    {resultType === "facts" && <div className="knowledge-fact-filters"><Field label="Claim status"><select value={claimState} onChange={event => setClaimState(event.target.value)}><option value="">All statuses</option><option value="supported">Supported</option><option value="unverified">Unverified</option><option value="disputed">Disputed</option><option value="superseded">Superseded</option></select></Field><label className="content-search-phrase"><input type="checkbox" checked={historical} onChange={event => setHistorical(event.target.checked)} />Include historical claims</label></div>}
    {openError && <p className="notice error" role="alert">{openError}</p>}
    {([["files", "Files", files], ["conversations", "Conversations", conversations], ["memories", memoryTitle, memories], ["facts", "Facts", facts]] as const).map(([domain, label, value]) => value.error && <div key={label} className="notice error content-search-error" role="alert"><span>{label}: {value.error}</span><Button onClick={() => retrySearch(domain)}>Retry search</Button></div>)}
    <div className="indexed-search-status" aria-live="polite">{loading ? <span role="status">Searching indexed content…</span> : complete && !browseConversations ? <span>{total ? `${total} matching ${total === 1 ? "result" : "results"}` : "No indexed content matched."}</span> : !browseConversations ? <span>Enter search words to find {resultType}.</span> : null}</div>

    {showConversations && <ConversationResults
      projects={projects} project={searchProject || undefined} results={conversations.results}
      searching={!!trimmed} loading={conversations.loading} pinnedOnly={pinnedOnly}
      currentProject={currentProject} activity={activity} initialConversation={initialConversation}
      selectionScope={JSON.stringify([searchProject, trimmed, model, phrase, resultType, source, role, status,
        limit, conversations.cursor ?? null])}
      revision={revision} pages={pageNavigation("conversations", "Conversations", conversations)}
      onOpen={onOpenConversation} onReadEvidence={readConversationEvidence}
      onChange={async () => { setRevision(value => value + 1); await onChange(); }} />}
    {wantMemories && (!!memories.results.length || !!memories.previousCursors.length || !!memories.cursor || !!memories.error) && <section className="content-search-group" aria-label={pinnedOnly ? "Pinned memory results" : "Memory results"}><h2><BookOpen size={17} />{memoryTitle} <span>{memories.results.length}</span></h2>
      <div className="indexed-search-results">{memories.results.map(hit => <button type="button" className="indexed-search-result" key={hit.id} aria-label={`Read ${hit.pinnedAt ? "pinned " : ""}memory ${hit.title}`} disabled={!!opening} onClick={() => void readMemory(hit, hit.revision)}>
        <span className="indexed-result-heading"><strong>{hit.title}</strong><small>Revision {hit.revision}{hit.pinnedAt ? " · pinned" : ""}{hit.status === "archived" ? " · archived" : ""}</small></span><span className="indexed-result-path"><span>{hit.projectName || "Global memory"}</span><span>{words(hit.kind)} · {captureLabel(hit)}</span></span>
        <span className="indexed-result-excerpt">{hit.excerpt || (hit.kind === "conversation_snapshot" ? `${hit.messageCount} captured messages` : "Retained note")}</span><span className="indexed-result-open"><BookOpen size={15} />Read retained {hit.kind === "conversation_snapshot" ? "snapshot" : "memory"}</span>
      </button>)}</div>{pageNavigation("memories", "Memories", memories)}</section>}
    {wantFiles && (!!files.results.length || !!files.previousCursors.length || !!files.cursor || !!files.error) && <section className="content-search-group" aria-label="File results"><h2><FolderOpen size={17} />Files <span>{files.results.length}</span></h2>
      <div className="indexed-search-results">{files.results.map(hit => {
        const key = `file:${hit.project}:${hit.path}`;
        return <div className="knowledge-file-result" key={`${key}:${hit.unit}:${hit.locator}`}><button type="button" className="indexed-search-result" aria-label={`Open file ${hit.projectName}/${hit.path}`} disabled={!!opening} onClick={() => void open(key, () => onOpenFile(hit.project, hit.path))}>
          <span className="indexed-result-heading"><strong>{hit.heading || hit.path.split(/[\\/]/).at(-1)}</strong><small>{opening === key ? "Opening project file…" : hit.role}</small></span><span className="indexed-result-path"><span>{hit.projectName}{hit.projectArchived ? " · archived" : ""}</span><span>{hit.path}</span></span>
          <span className="indexed-result-excerpt">{hit.excerpt}</span><span className="indexed-result-open"><FolderOpen size={15} />Open in project Files</span>
        </button>{canReadFileEvidence(hit) && <Button disabled={!!opening} aria-label={`Read retained file evidence ${hit.projectName}/${hit.path}`} onClick={() => void readFileEvidence(hit, hit)}><BookOpen size={15} />Read retained evidence</Button>}</div>;
      })}</div>{pageNavigation("files", "Files", files)}</section>}
    {wantFacts && (!!facts.results.length || !!facts.previousCursors.length || !!facts.cursor || !!facts.error) && <section className="content-search-group" aria-label="Fact results"><h2><Database size={17} />Facts <span>{facts.results.length}</span></h2><div className="indexed-search-results">{facts.results.map(fact => <Panel key={fact.id} className="knowledge-claim">
      <div className="indexed-result-heading"><strong>{[fact.subjectName, fact.predicate, fact.objectName, fact.value == null ? "" : shownValue(fact.value)].filter(Boolean).join(" · ")}</strong><Badge tone={fact.epistemicState === "supported" ? "success" : "neutral"}>{words(fact.epistemicState)}</Badge></div>
      <p>{fact.origin} · {fact.method}</p>{fact.valueTruncated && <p>The value exceeds the search summary limit. Correct fact loads its retained value.</p>}<details><summary>Evidence and validity</summary><dl className="knowledge-metadata"><dt>Claim ID</dt><dd>{fact.id}</dd><dt>Scope</dt><dd>{fact.scopeTruncated ? "Omitted from the bounded search summary; correction loads the retained scope." : shownValue(fact.scope) || "Not specified"}</dd><dt>Valid from</dt><dd>{when(fact.validFrom)}</dd><dt>Valid to</dt><dd>{when(fact.validTo)}</dd><dt>Observed</dt><dd>{when(fact.observedAt)}</dd></dl>
        {fact.sourceRefsTruncated && <p>Showing {fact.evidence?.length ?? 0} of {fact.sourceRefCount} retained evidence references.</p>}
        {(fact.evidence ?? []).map(evidence => {
          const ref = evidence.ref ?? evidence, memoryRef = memoryEvidenceReference(ref);
          return <div className="knowledge-evidence" key={`${evidence.id}:${evidence.relation}`}><strong>{evidence.relation}</strong><span>{evidence.id}</span>{canReadFileEvidence(ref) && <Button onClick={() => void readFileEvidence(ref)}>Read retained evidence</Button>}{ref.memoryID && <><Button disabled={!memoryRef} onClick={() => { if (memoryRef) void readMemory(memoryRef, memoryRef.revision); }}>Read retained memory evidence</Button>{!memoryRef && <span>Retained memory evidence is unavailable: its exact retained revision was not recorded.</span>}</>}</div>;
        })}
      </details>{fact.epistemicState !== "superseded" && <Button disabled={!!opening} aria-label={`Correct fact ${fact.predicate}`} onClick={() => void editClaim(fact)}><Pencil size={15} />Correct fact</Button>}</Panel>)}</div>{pageNavigation("facts", "Facts", facts)}</section>}
    {needsMore && firstPages && limit < 100 && <div className="knowledge-actions"><Button onClick={() => setLimit(current => Math.min(100, current + 25))}>Show more results</Button></div>}
    {complete && !total && activeStates.every(value => !value.error) && <Panel className="indexed-search-empty" help="file-search"><FileSearch size={22} aria-hidden="true" /><strong>{pinnedOnly ? "No pinned memories" : "No indexed content found"}</strong></Panel>}

    {selectedMemory && <Dialog title={selectedMemory.title} description={`${selectedMemory.projectName || "Global memory"} · retained revision ${selectedMemory.revision} · ${words(selectedMemory.coverage)}`} size="wide" className="memory-reader" bodyClassName="memory-reader-body" busy={!!memoryWorking} onClose={closeMemoryReader}
      footer={<><Button disabled={!!memoryWorking || !!opening} onClick={() => void pinMemory()}><Pin size={15} />{selectedMemory.pinnedAt ? "Unpin memory" : "Pin memory"}</Button><Button disabled={!!memoryWorking || !!opening} onClick={() => void archiveMemory()}><Archive size={15} />{selectedMemory.status === "archived" ? "Restore memory" : "Archive memory"}</Button>{selectedMemory.kind !== "conversation_snapshot" && <Button disabled={!!memoryWorking || !!opening} onClick={() => { setEditorError(""); setEditor({ id: selectedMemory.id, revision: selectedMemory.revision, title: selectedMemory.title, body: selectedMemory.body ?? "", projectID: selectedMemory.project }); }}><Pencil size={15} />Edit memory</Button>}<Button variant="danger" disabled={!!memoryWorking || !!opening} onClick={() => setForgetting(selectedMemory)}><Trash2 size={15} />Forget memory</Button></>}>
      {readerError && <p className="notice error" role="alert">{readerError}</p>}
      {selectedMemory.status === "archived" && <p className="notice">This memory is archived. Its retained revisions and pin are preserved.</p>}
      <div className="knowledge-reader-actions"><Field label="Retained revision"><select value={selectedMemory.revision} disabled={!!opening || !!memoryWorking} onChange={event => void readMemory(selectedMemory, Number(event.target.value))}>{memoryRevisions.map(value => <option key={value} value={value}>Revision {value}</option>)}</select></Field>
        <Button disabled={!!opening || !!memoryWorking} onClick={() => void readMemory(selectedMemory)}>Check latest revision</Button>
        {selectedMemory.kind === "conversation_snapshot" && <><Button disabled={captureBusy || captureUncertain || !!opening || !!memoryWorking} onClick={() => void refreshMemory()}><RefreshCw size={15} />{captureBusy ? `Capture ${selectedMemory.job?.status ?? "starting"}…` : "Refresh snapshot"}</Button>{selectedMemory.project && selectedMemory.session && <Button disabled={!!opening || !!memoryWorking} onClick={() => { const item = selectedMemory; closeMemoryReader(); void open("live-memory-source", () => onOpenConversation(item.project, item.session!)); }}><MessageSquare size={15} />Open live conversation</Button>}</>}
      </div>
      {memoryRevisions[0] > selectedMemory.revision && <p role="status">A newer retained revision is available. Select it above to read its evidence.</p>}
      {selectedMemory.sourceUpdates?.state === "newer-retained" && <p className="notice" role="status">A newer retained source revision is available. This memory still shows its captured revision.{selectedMemory.kind === "conversation_snapshot" ? " Refresh snapshot creates another memory revision." : " Its retained evidence has not been replaced."}</p>}
      {selectedMemory.sourceUpdates?.state === "unknown" && <p className="notice">Current source content is unknown. A comparable retained source revision could not be confirmed.</p>}
      {selectedMemory.job && <p role="status">Capture {words(selectedMemory.job.status)}{selectedMemory.job.error ? `: ${selectedMemory.job.error}` : ""}.</p>}
      {selectedMemory.kind === "conversation_snapshot" && selectedMemory.coverage === "unknown_source" && <p className="notice">The source could not be checked. Its availability is unknown. Any transcript below is from the last retained capture.</p>}
      {selectedMemory.kind === "conversation_snapshot" && selectedMemory.coverage === "missing_source" && <p className="notice">OpenCode reported this conversation missing. Any transcript below is retained from an earlier capture.</p>}
      {selectedMemory.kind === "conversation_snapshot" && !selectedMemory.messages.length && <p className="notice">This revision has no captured transcript. Its coverage is shown above.</p>}
      {!!selectedMemory.body && selectedMemory.kind !== "conversation_snapshot" && <p className="knowledge-memory-body">{selectedMemory.body}</p>}
      <div className="memory-reader-messages">{selectedMemory.messages.map(message => <article key={`${message.ordinal}:${message.role}`} className={`memory-reader-message ${message.role}`}><strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : words(message.role)}</strong><p>{message.text}</p></article>)}</div>
      <details className="knowledge-provenance"><summary>Capture boundary and evidence</summary><dl className="knowledge-metadata"><dt>Memory ID</dt><dd>{selectedMemory.id}</dd><dt>Source captured</dt><dd>{when(selectedMemory.capturedAt ?? selectedMemory.boundary?.capturedAt)}</dd>{selectedMemory.boundary?.attemptedAt != null && <><dt>Last source check</dt><dd>{when(selectedMemory.boundary.attemptedAt)}</dd></>}{selectedMemory.boundary?.snapshotCreatedAt != null && <><dt>Retained revision recorded</dt><dd>{when(selectedMemory.boundary.snapshotCreatedAt)}</dd></>}<dt>Coverage</dt><dd>{words(selectedMemory.coverage)}</dd><dt>Captured messages</dt><dd>{selectedMemory.messageCount}</dd>{selectedMemory.snapshotHash && <><dt>Snapshot hash</dt><dd>{selectedMemory.snapshotHash}</dd></>}</dl>
        {selectedMemory.sourceUpdates && selectedMemory.sourceUpdates.state !== "not-applicable" && <p>Source comparison: {words(selectedMemory.sourceUpdates.state)} · {selectedMemory.sourceUpdates.comparedSources} local source revisions compared{selectedMemory.sourceUpdates.unknownSources ? ` · ${selectedMemory.sourceUpdates.unknownSources} unconfirmed components` : ""}. Live source content was not checked.{selectedMemory.sourceUpdates.truncated ? " This comparison is bounded; omitted components remain unknown." : ""}</p>}
        {selectedMemory.boundary?.truncated && <p>This snapshot is bounded; additional source content was not captured.</p>}{!!selectedMemory.boundary?.missingSources?.length && <p>{selectedMemory.boundary.missingSources.length} source components were unavailable.</p>}
        {(selectedMemory.members ?? []).map((member, index) => <div key={index} className="knowledge-evidence"><strong>{member.kind ?? member.member_kind}</strong><span>{member.ref ?? member.source_ref}</span><span>{words(member.availability)}</span><small>{member.revision ?? member.source_revision}</small></div>)}
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
    {editor && <Dialog title={editor.id ? "Edit memory" : "New memory"} size="wide" onClose={() => setEditor(null)} busy={!!memoryWorking} onSubmit={event => { event.preventDefault(); void saveNote(); }} footer={<><Button disabled={!!memoryWorking} onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={!!memoryWorking}>{memoryWorking === "save" ? "Saving…" : "Save memory"}</Button></>}>
      <Field label="Memory title"><input required maxLength={1000} value={editor.title} disabled={!!editor.id} onChange={event => setEditor(current => current ? { ...current, title: event.target.value } : current)} /></Field>
      <Field label="Memory text"><textarea required maxLength={1000000} rows={9} value={editor.body} onChange={event => setEditor(current => current ? { ...current, body: event.target.value } : current)} /></Field>
      {!editor.id && !scoped && <Field label="Memory scope"><select value={editor.projectID} onChange={event => setEditor(current => current ? { ...current, projectID: event.target.value } : current)}><option value="">Global memory</option>{projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
      {editorError && <p className="notice error" role="alert">{editorError}</p>}
    </Dialog>}
    {claimEditor && <Dialog title="Correct fact" size="wide" busy={claimWorking} onClose={() => setClaimEditor(null)} onSubmit={event => { event.preventDefault(); void saveClaim(); }} footer={<><HelpHint topic="file-search" label="Fact corrections" details={<p>Facts are recorded claims with origin, status and retained evidence. A correction records a replacement and preserves the previous claim and evidence. Select at least one exact retained memory revision or indexed file unit.</p>} /><Button disabled={claimWorking} onClick={() => setClaimEditor(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={claimWorking || evidenceLoading}>{claimWorking ? "Saving…" : "Save correction"}</Button></>}>
      <Field label="Fact statement"><input required maxLength={1000} value={claimEditor.predicate} onChange={event => setClaimEditor(current => current ? { ...current, predicate: event.target.value } : current)} /></Field>
      <Field label="Fact value"><textarea required maxLength={100000} rows={3} value={claimEditor.value} onChange={event => setClaimEditor(current => current ? { ...current, value: event.target.value } : current)} /></Field>
      <div className="knowledge-editor-grid"><Field label="Claim origin"><select value={claimEditor.origin} onChange={event => setClaimEditor(current => current ? { ...current, origin: event.target.value } : current)}>{["user-stated", "human-authored", "source-reported", "directly-observed", "deterministically-extracted", "model-inferred"].map(value => <option key={value} value={value}>{words(value.replaceAll("-", " "))}</option>)}</select></Field><Field label="Epistemic status"><select value={claimEditor.epistemicState} onChange={event => setClaimEditor(current => current ? { ...current, epistemicState: event.target.value } : current)}><option value="unverified">Unverified</option><option value="supported">Supported by evidence</option><option value="disputed">Disputed</option></select></Field>
        {!scoped && <Field label="Fact scope"><select value={claimEditor.projectID} onChange={event => setClaimEditor(current => current ? { ...current, projectID: event.target.value, evidence: [] } : current)}><option value="">All projects</option>{projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}</div>
      <Field label="How this claim was established"><textarea required maxLength={2000} rows={2} placeholder="Describe the observation, source, or user statement." value={claimEditor.method} onChange={event => setClaimEditor(current => current ? { ...current, method: event.target.value } : current)} /></Field>
      <Field label="Reason for correction"><input required maxLength={2000} value={claimEditor.reason} onChange={event => setClaimEditor(current => current ? { ...current, reason: event.target.value } : current)} /></Field>
      <section className="knowledge-editor-evidence" aria-label="Retained fact evidence"><h3>Retained evidence</h3><Field label="Find retained evidence"><input type="search" maxLength={200} value={evidenceQuery} onChange={event => setEvidenceQuery(event.target.value)} /></Field><div className="knowledge-evidence-picker"><Field label="Retained source revision"><select value={evidenceChoice} disabled={evidenceLoading} onChange={event => setEvidenceChoice(event.target.value)}><option value="">{evidenceLoading ? "Finding retained evidence…" : "Select retained evidence"}</option>{evidenceOptions.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></Field><Button disabled={!evidenceChoice || claimWorking} onClick={() => { const choice = evidenceOptions.find(row => row.id === evidenceChoice); if (choice) { setClaimError(""); setClaimEditor(current => current && !current.evidence.some(row => row.id === choice.id) ? { ...current, evidence: [...current.evidence, choice.evidence] } : current); } setEvidenceChoice(""); }}>Add evidence</Button></div>
        {evidenceError && <p className="notice error" role="alert">{evidenceError}</p>}{claimEditor.evidence.map(evidence => <div className="knowledge-selected-evidence" key={evidence.id}><span>{evidence.label}</span><Field label={`Evidence relation for ${evidence.label}`}><select value={evidence.relation} onChange={event => setClaimEditor(current => current ? { ...current, evidence: current.evidence.map(row => row.id === evidence.id ? { ...row, relation: event.target.value } : row) } : current)}>{["supports", "contradicts", "qualifies", "supersedes"].map(value => <option key={value} value={value}>{words(value)}</option>)}</select></Field><Button aria-label={`Remove evidence ${evidence.label}`} onClick={() => setClaimEditor(current => current ? { ...current, evidence: current.evidence.filter(row => row.id !== evidence.id) } : current)}>Remove</Button></div>)}
      </section>{claimError && <p className="notice error" role="alert">{claimError}</p>}
    </Dialog>}
    {forgetting && <ConfirmDialog title="Forget retained memory?" onCancel={() => setForgetting(null)} onConfirm={() => void forgetMemory()} confirmLabel="Forget memory" busy={memoryWorking === "forget"} danger error={readerError}><p>Remove “{forgetting.title}” from knowledge search and pins. {forgetting.kind === "conversation_snapshot" ? "The original conversation stays in OpenCode. " : ""}Existing backups can contain copies.</p></ConfirmDialog>}
  </div>;
}
