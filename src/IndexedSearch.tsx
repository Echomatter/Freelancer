import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Database, FileSearch, FolderOpen, MessageSquare, Pin, BookOpen, Plus, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { api } from "./api";
import { settingsPage } from "./settings-catalog.mjs";
import { Badge, Button, Field, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";
import { ConfirmDialog, Dialog } from "./echoflex/Dialog";
import "./indexed-search.css";

type FileHit = {
  project: string; projectName: string; projectArchived: boolean; path: string; role: string;
  unit: number; locator: string; heading: string; excerpt: string;
  sourceIdentity?: string; revisionIdentity?: string; unitSha256?: string;
};
type ConversationHit = {
  project: string; projectName: string; session: string; title: string; excerpt: string; imported?: boolean;
  organization?: { pinnedAt?: number | null; revision?: number; archiveScope?: string; nativeArchived?: boolean; projectArchived?: boolean };
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
  boundary?: { status?: string; capturedAt?: number | null; attemptedAt?: number; snapshotCreatedAt?: number; messageCount?: number; missingSources?: unknown[]; truncated?: boolean; [key: string]: unknown };
  members?: MemoryMember[]; revisions?: { revision: number; createdAt: number }[];
  messages: { ordinal: number; role: string; createdAt: number | null; text: string; providerID?: string | null; modelID?: string | null }[];
};
type EvidenceRef = { kind?: string; sourceIdentity?: string; revisionIdentity?: string; locator?: string; unitSha256?: string; revisionSha256?: string; projectID?: string; sessionID?: string; memoryID?: string; memoryRevision?: number; revision?: number };
type SelectedEvidence = EvidenceRef & { id: string; relation: string; label?: string };
type ClaimEditor = { id?: string; expectedEpistemicState?: string; predicate: string; value: string; origin: string; epistemicState: string; method: string; reason: string; projectID: string; evidence: SelectedEvidence[] };
type EvidenceChoice = { id: string; label: string; evidence: SelectedEvidence };
type ClaimHit = {
  id: string; predicate: string; value?: unknown; subjectName?: string; objectName?: string;
  origin: string; method: string; epistemicState: string; scope?: unknown;
  validFrom?: number | null; validTo?: number | null; observedAt?: number | null; recordedAt?: number;
  evidence?: (EvidenceRef & { id: string; relation: string; ref?: EvidenceRef })[];
};
type RetainedFile = { text?: string; availability: string; path?: string; project?: string; hash?: string; revisionIdentity?: string };
type SearchState<T> = { results: T[]; error: string; loading: boolean; complete: boolean; coverage: string; truncated: boolean };
type ResultType = "all" | "files" | "conversations" | "memories" | "facts" | "pinned";
const resultTypes: [ResultType, string][] = [["all", "All content"], ["files", "Files"], ["conversations", "Conversations"], ["memories", "Memories"], ["facts", "Facts"], ["pinned", "Pinned Memory"]];
const empty = <T,>(): SearchState<T> => ({ results: [], error: "", loading: false, complete: false, coverage: "", truncated: false });
const pending = <T,>(): SearchState<T> => ({ ...empty<T>(), loading: true });
const readResult = <T,>(value: any): SearchState<T> => {
  if (!Array.isArray(value?.results)) throw Error("The knowledge result could not be read. Retry the query.");
  return { results: value.results, error: "", loading: false, complete: true,
    coverage: typeof value.coverage === "string" ? value.coverage : value.coverage?.summary ?? "", truncated: value.truncated === true };
};
const failureResult = <T,>(error: Error): SearchState<T> => ({ ...empty<T>(), error: error.message, complete: true });
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

export function ContentSearch({ project, projects = [], onOpenFile, onOpenConversation, onIndex, onClose, onChange, managing, onManage, management }: {
  project?: { id: string; name: string };
  projects?: { id: string; name: string }[];
  onOpenFile: (project: string, path: string) => Promise<void>;
  onOpenConversation: (project: string, session: string) => Promise<void>;
  onIndex: () => void; onClose: () => void; onChange: () => Promise<void>;
  managing: boolean; onManage: () => void; management: ReactNode;
}) {
  const [query, setQuery] = useState(""), [resultType, setResultType] = useState<ResultType>("all");
  const [source, setSource] = useState(""), [role, setRole] = useState(""), [status, setStatus] = useState("");
  const [model, setModel] = useState(""), [phrase, setPhrase] = useState(false), [historical, setHistorical] = useState(false);
  const [claimState, setClaimState] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [files, setFiles] = useState<SearchState<FileHit>>(empty), [conversations, setConversations] = useState<SearchState<ConversationHit>>(empty);
  const [memories, setMemories] = useState<SearchState<MemoryHit>>(empty), [facts, setFacts] = useState<SearchState<ClaimHit>>(empty);
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null), [retainedFile, setRetainedFile] = useState<RetainedFile | null>(null);
  const [opening, setOpening] = useState(""), [openError, setOpenError] = useState(""), [pinning, setPinning] = useState("");
  const [revision, setRevision] = useState(0), [limit, setLimit] = useState(25);
  const [readerError, setReaderError] = useState(""), [memoryWorking, setMemoryWorking] = useState("");
  const [captureUncertain, setCaptureUncertain] = useState(false), [capturePollEpoch, setCapturePollEpoch] = useState(0);
  const [editor, setEditor] = useState<{ id?: string; revision?: number; title: string; body: string; projectID: string } | null>(null);
  const [editorError, setEditorError] = useState(""), [forgetting, setForgetting] = useState<MemoryItem | null>(null);
  const [claimEditor, setClaimEditor] = useState<ClaimEditor | null>(null), [claimError, setClaimError] = useState(""), [claimWorking, setClaimWorking] = useState(false);
  const [evidenceQuery, setEvidenceQuery] = useState(""), [evidenceOptions, setEvidenceOptions] = useState<EvidenceChoice[]>([]);
  const [evidenceChoice, setEvidenceChoice] = useState(""), [evidenceError, setEvidenceError] = useState(""), [evidenceLoading, setEvidenceLoading] = useState(false);
  const evidenceRead = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const trimmed = query.trim(), scoped = !!project?.id;
  const wantFiles = !!trimmed && (resultType === "all" || resultType === "files");
  const wantConversations = !!trimmed && (resultType === "all" || resultType === "conversations");
  const wantMemories = ["all", "memories", "pinned"].includes(resultType);
  const wantFacts = resultType === "facts" || resultType === "all" && !!trimmed;
  const pinnedOnly = resultType === "pinned" || resultType === "all" && !trimmed;
  const searchLabel = scoped ? "Search project content" : "Search all content";
  const activeStates = [wantFiles ? files : null, wantConversations ? conversations : null, wantMemories ? memories : null, wantFacts ? facts : null].filter(Boolean) as SearchState<unknown>[];
  const loading = activeStates.some(value => value.loading), complete = !!activeStates.length && activeStates.every(value => value.complete);
  const total = activeStates.reduce((count, value) => count + value.results.length, 0);
  const needsMore = activeStates.some(value => value.truncated);

  useEffect(() => {
    setOpenError("");
    const controller = new AbortController();
    setFiles(wantFiles ? pending() : empty());
    setConversations(wantConversations ? pending() : empty());
    setMemories(wantMemories ? pending() : empty());
    setFacts(wantFacts ? pending() : empty());
    const params = new URLSearchParams({ q: trimmed, limit: String(limit), ...(project?.id ? { project: project.id } : {}), ...(phrase ? { phrase: "true" } : {}) });
    const timer = setTimeout(() => {
      if (wantFiles) {
        const fileParams = new URLSearchParams(params);
        for (const [key, value] of [["source", source], ["role", role], ["status", status]]) if (value) fileParams.set(key, value);
        void api(`index/search?${fileParams}`, undefined, undefined, controller.signal)
          .then(value => { if (!controller.signal.aborted) setFiles(readResult(value)); })
          .catch(error => { if (!controller.signal.aborted) setFiles(failureResult(error)); });
      }
      if (wantConversations) {
        const chatParams = new URLSearchParams(params);
        if (model) chatParams.set("model", model);
        void api(`history/search?${chatParams}`, undefined, undefined, controller.signal)
          .then(value => {
            if (controller.signal.aborted) return;
            const result = readResult<ConversationHit>(value), unique = new Map<string, ConversationHit>();
            for (const hit of result.results) if (!unique.has(`${hit.project}:${hit.session}`)) unique.set(`${hit.project}:${hit.session}`, hit);
            setConversations({ ...result, results: [...unique.values()] });
          }).catch(error => { if (!controller.signal.aborted) setConversations(failureResult(error)); });
      }
      if (wantMemories) {
        const memoryParams = new URLSearchParams(params);
        memoryParams.set("pinnedOnly", String(pinnedOnly));
        memoryParams.set("includeArchived", String(includeArchived));
        if (model) memoryParams.set("model", model);
        void api(`memory/search?${memoryParams}`, undefined, undefined, controller.signal)
          .then(value => { if (!controller.signal.aborted) setMemories(readResult(value)); })
          .catch(error => { if (!controller.signal.aborted) setMemories(failureResult(error)); });
      }
      if (wantFacts) void api("knowledge", { operation: "query", domain: "facts", query: trimmed, projectID: project?.id,
        model: model || undefined, epistemicState: claimState || undefined, includeHistorical: historical, phrase, limit }, "POST", controller.signal)
        .then(value => { if (!controller.signal.aborted) setFacts(readResult(value)); })
        .catch(error => { if (!controller.signal.aborted) setFacts(failureResult(error)); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [trimmed, project?.id, source, role, status, model, phrase, historical, claimState, includeArchived, resultType, limit, revision, managing]);

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
  async function pin(hit: ConversationHit) {
    setPinning(`${hit.project}:${hit.session}`); setOpenError("");
    let saved = false;
    try {
      await api("history/pin", { project: hit.project, session: hit.session, pinned: !hit.organization?.pinnedAt, revision: hit.organization?.revision ?? 0 }, "PUT");
      saved = true; setRevision(value => value + 1); await onChange();
    } catch (error) { setOpenError(saved ? "Pin saved, but the workspace could not refresh. Reopen Search content to refresh." : (error as Error).message); }
    finally { setPinning(""); }
  }
  function invalidateEvidenceRead() {
    evidenceRead.current.generation++;
    evidenceRead.current.controller?.abort();
    evidenceRead.current.controller = null;
  }
  function clearEvidenceOpening() {
    setOpening(current => current.startsWith("memory:") || current === "file-evidence" ? "" : current);
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
      setRetainedFile(null); setSelectedMemory(item); setCaptureUncertain(false); setCapturePollEpoch(value => value + 1);
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
  function editClaim(fact?: ClaimHit) {
    const scope = fact?.scope && typeof fact.scope === "object" ? fact.scope as { projectID?: string } : {};
    setClaimError(""); setEvidenceQuery(""); setEvidenceOptions([]); setEvidenceChoice("");
    setClaimEditor({ id: fact?.id, expectedEpistemicState: fact?.epistemicState, predicate: fact?.predicate ?? "", value: fact ? shownValue(fact.value) : "",
      origin: "user-stated", epistemicState: "unverified", method: "", reason: "", projectID: scope.projectID ?? project?.id ?? "", evidence: [] });
  }
  async function saveClaim() {
    if (!claimEditor || claimWorking) return;
    if (!claimEditor.evidence.length) { setClaimError("Select at least one retained source revision for this fact."); return; }
    setClaimWorking(true); setClaimError("");
    try {
      await api("knowledge", { operation: claimEditor.id ? "correct-claim" : "claim", id: claimEditor.id, expectedEpistemicState: claimEditor.expectedEpistemicState,
        predicate: claimEditor.predicate, valueJson: JSON.stringify(claimEditor.value), origin: claimEditor.origin, epistemicState: claimEditor.epistemicState,
        method: claimEditor.method, reason: claimEditor.reason, sessionID: "user", scopeJson: JSON.stringify(claimEditor.projectID ? { projectID: claimEditor.projectID } : {}),
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
      setSelectedMemory(null); setReaderError("");
      setRetainedFile({ ...result, path: result.path ?? fallback?.path, project: result.project ?? fallback?.project });
    } catch (error) { if (currentRequest()) setOpenError((error as Error).message); }
    finally { if (currentRequest()) { evidenceRead.current.controller = null; setOpening(""); } }
  }
  const canReadFileEvidence = (ref?: { sourceIdentity?: string; revisionIdentity?: string; locator?: string; unitSha256?: string }) => !!(ref?.sourceIdentity && ref.revisionIdentity && ref.locator && ref.unitSha256);
  const memoryTitle = pinnedOnly ? "Pinned Memory" : "Memories";
  const memoryRevisions = selectedMemory ? [...new Set([selectedMemory.revision, ...(selectedMemory.revisions ?? []).map(row => row.revision)])].sort((a, b) => b - a) : [];
  const captureBusy = memoryWorking === "capture" || !!selectedMemory?.job && ["queued", "running"].includes(selectedMemory.job.status);

  if (managing) return <>{management}</>;
  return <div className="page indexed-search-page">
    <PageHeading title={searchLabel} icon={FileSearch} help="file-search" description={settingsPage(scoped ? "project" : "application", "search")?.description}
      actions={<><Button type="button" onClick={onIndex}><Database size={16} />Content &amp; Storage</Button><Button onClick={() => { closeMemoryReader(); onManage(); }}>Manage chats</Button><PageCloseButton onClick={onClose} /></>} />
    <div className="knowledge-type-filters" role="tablist" aria-label="Knowledge result types">{resultTypes.map(([id, name]) => <Button key={id} type="button" role="tab" aria-selected={resultType === id}
      variant={resultType === id ? "primary" : "secondary"} onClick={() => { setResultType(id); setLimit(25); }}>{name}</Button>)}</div>
    <section className="indexed-search-controls" aria-label={searchLabel}>
      <div className="indexed-search-query"><Field label={searchLabel}><input autoFocus type="search" maxLength={200} value={query}
        placeholder={scoped ? `Search knowledge in ${project.name}…` : "Search knowledge across every project…"} onChange={event => { setQuery(event.target.value); setLimit(25); }} /></Field></div>
      {(resultType === "all" || resultType === "files") && <>
        <Field label="Source path"><input type="search" maxLength={500} value={source} placeholder="Any indexed path" onChange={event => setSource(event.target.value)} /></Field>
        <Field label="Source role"><select value={role} onChange={event => setRole(event.target.value)}><option value="">All roles</option><option value="current_project_source">Current project</option><option value="reference_source">Reference</option><option value="project_source">Project source</option><option value="project_archive">Archive</option></select></Field>
        <Field label="Source status"><select value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="current">Current</option><option value="reference">Reference</option><option value="source">Source</option><option value="archive">Archive</option></select></Field>
      </>}
      {resultType !== "files" && <Field label="Model ID"><input type="search" maxLength={200} value={model} placeholder="Any provider/model" onChange={event => setModel(event.target.value)} /></Field>}
      <label className="content-search-phrase"><input type="checkbox" checked={phrase} onChange={event => setPhrase(event.target.checked)} /> Exact phrase</label>
      <div className="content-search-scope"><span>Scope</span><strong>{scoped ? project.name : "All registered projects"}</strong></div>
    </section>
    {(resultType === "memories" || resultType === "pinned") && <div className="knowledge-actions"><Button onClick={() => { setEditorError(""); setEditor({ title: "", body: "", projectID: project?.id ?? "" }); }}><Plus size={16} />New memory</Button><label className="content-search-phrase"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />Include archived memories</label><span>Archive is reversible. Unpin keeps the retained memory.</span></div>}
    {resultType === "facts" && <div className="knowledge-fact-filters"><Button onClick={() => editClaim()}><Plus size={16} />New fact</Button><Field label="Claim status"><select value={claimState} onChange={event => setClaimState(event.target.value)}><option value="">All statuses</option><option value="supported">Supported</option><option value="unverified">Unverified</option><option value="disputed">Disputed</option><option value="superseded">Superseded</option></select></Field><label className="content-search-phrase"><input type="checkbox" checked={historical} onChange={event => setHistorical(event.target.checked)} />Include historical claims</label></div>}
    {openError && <p className="notice error" role="alert">{openError}</p>}
    {([["Files", files], ["Conversations", conversations], [memoryTitle, memories], ["Facts", facts]] as const).map(([label, value]) => value.error && <div key={label} className="notice error content-search-error" role="alert"><span>{label}: {value.error}</span><Button onClick={() => setRevision(current => current + 1)}>Retry search</Button></div>)}
    <div className="indexed-search-status" aria-live="polite">{loading ? <span role="status">Searching indexed content…</span> : complete ? <span>{total ? `${total} matching ${total === 1 ? "result" : "results"}` : "No indexed content matched."}</span> : <span>Enter search words to find {resultType}.</span>}</div>

    {wantConversations && !!conversations.results.length && <section className="content-search-group" aria-label="Conversation results"><h2><MessageSquare size={17} />Conversations <span>{conversations.results.length}</span></h2>
      <div className="indexed-search-results">{conversations.results.map(hit => {
        const key = `conversation:${hit.project}:${hit.session}`, archived = hit.organization?.archiveScope === "freelancer" || hit.organization?.nativeArchived || hit.organization?.projectArchived;
        return <div className="content-search-conversation" key={key}><button type="button" className="indexed-search-result" aria-label={`Open conversation ${hit.title} in ${hit.projectName}`} disabled={!!opening} onClick={() => void open(key, () => onOpenConversation(hit.project, hit.session))}>
          <span className="indexed-result-heading"><strong>{hit.title}</strong><small>{opening === key ? "Opening conversation…" : "Conversation"}</small></span><span className="indexed-result-path"><span>{hit.projectName}</span><span>{hit.imported ? "Imported snapshot" : archived ? "Archived" : "OpenCode conversation"}</span></span>
          <span className="indexed-result-excerpt">{hit.excerpt || "Title match"}</span><span className="indexed-result-open"><MessageSquare size={15} />Open conversation</span>
        </button><Button aria-label={`${hit.organization?.pinnedAt ? "Unpin" : "Pin"} ${hit.title}`} aria-pressed={!!hit.organization?.pinnedAt} disabled={!!pinning} onClick={() => void pin(hit)}><Pin size={16} />{hit.organization?.pinnedAt ? "Unpin" : "Pin"}</Button></div>;
      })}</div></section>}
    {wantMemories && !!memories.results.length && <section className="content-search-group" aria-label={pinnedOnly ? "Pinned memory results" : "Memory results"}><h2><BookOpen size={17} />{memoryTitle} <span>{memories.results.length}</span></h2>
      <div className="indexed-search-results">{memories.results.map(hit => <button type="button" className="indexed-search-result" key={hit.id} aria-label={`Read ${hit.pinnedAt ? "pinned " : ""}memory ${hit.title}`} disabled={!!opening} onClick={() => void readMemory(hit, hit.revision)}>
        <span className="indexed-result-heading"><strong>{hit.title}</strong><small>Revision {hit.revision}{hit.pinnedAt ? " · pinned" : ""}{hit.status === "archived" ? " · archived" : ""}</small></span><span className="indexed-result-path"><span>{hit.projectName || "Global memory"}</span><span>{words(hit.kind)} · {captureLabel(hit)}</span></span>
        <span className="indexed-result-excerpt">{hit.excerpt || (hit.kind === "conversation_snapshot" ? `${hit.messageCount} captured messages` : "Retained note")}</span><span className="indexed-result-open"><BookOpen size={15} />Read retained {hit.kind === "conversation_snapshot" ? "snapshot" : "memory"}</span>
      </button>)}</div></section>}
    {wantFiles && !!files.results.length && <section className="content-search-group" aria-label="File results"><h2><FolderOpen size={17} />Files <span>{files.results.length}</span></h2>
      <div className="indexed-search-results">{files.results.map(hit => {
        const key = `file:${hit.project}:${hit.path}`;
        return <div className="knowledge-file-result" key={`${key}:${hit.unit}:${hit.locator}`}><button type="button" className="indexed-search-result" aria-label={`Open file ${hit.projectName}/${hit.path}`} disabled={!!opening} onClick={() => void open(key, () => onOpenFile(hit.project, hit.path))}>
          <span className="indexed-result-heading"><strong>{hit.heading || hit.path.split(/[\\/]/).at(-1)}</strong><small>{opening === key ? "Opening project file…" : hit.role}</small></span><span className="indexed-result-path"><span>{hit.projectName}{hit.projectArchived ? " · archived" : ""}</span><span>{hit.path}</span></span>
          <span className="indexed-result-excerpt">{hit.excerpt}</span><span className="indexed-result-open"><FolderOpen size={15} />Open in project Files</span>
        </button>{canReadFileEvidence(hit) && <Button disabled={!!opening} aria-label={`Read retained file evidence ${hit.projectName}/${hit.path}`} onClick={() => void readFileEvidence(hit, hit)}><BookOpen size={15} />Read retained evidence</Button>}</div>;
      })}</div></section>}
    {wantFacts && !!facts.results.length && <section className="content-search-group" aria-label="Fact results"><h2><Database size={17} />Facts <span>{facts.results.length}</span></h2><div className="indexed-search-results">{facts.results.map(fact => <Panel key={fact.id} className="knowledge-claim">
      <div className="indexed-result-heading"><strong>{[fact.subjectName, fact.predicate, fact.objectName, fact.value == null ? "" : shownValue(fact.value)].filter(Boolean).join(" · ")}</strong><Badge tone={fact.epistemicState === "supported" ? "success" : "neutral"}>{words(fact.epistemicState)}</Badge></div>
      <p>{fact.origin} · {fact.method}</p><details><summary>Evidence and validity</summary><dl className="knowledge-metadata"><dt>Claim ID</dt><dd>{fact.id}</dd><dt>Scope</dt><dd>{shownValue(fact.scope) || "Not specified"}</dd><dt>Valid from</dt><dd>{when(fact.validFrom)}</dd><dt>Valid to</dt><dd>{when(fact.validTo)}</dd><dt>Observed</dt><dd>{when(fact.observedAt)}</dd></dl>
        {(fact.evidence ?? []).map(evidence => {
          const ref = evidence.ref ?? evidence, memoryRef = memoryEvidenceReference(ref);
          return <div className="knowledge-evidence" key={`${evidence.id}:${evidence.relation}`}><strong>{evidence.relation}</strong><span>{evidence.id}</span>{canReadFileEvidence(ref) && <Button onClick={() => void readFileEvidence(ref)}>Read retained evidence</Button>}{ref.memoryID && <><Button disabled={!memoryRef} onClick={() => { if (memoryRef) void readMemory(memoryRef, memoryRef.revision); }}>Read retained memory evidence</Button>{!memoryRef && <span>Retained memory evidence is unavailable: its exact retained revision was not recorded.</span>}</>}</div>;
        })}
      </details>{fact.epistemicState !== "superseded" && <Button aria-label={`Correct fact ${fact.predicate}`} onClick={() => editClaim(fact)}><Pencil size={15} />Correct fact</Button>}</Panel>)}</div></section>}
    {!!activeStates.some(value => value.coverage) && <details className="knowledge-coverage"><summary>Search coverage</summary>{activeStates.filter(value => value.coverage).map((value, index) => <p key={index}>{value.coverage}</p>)}</details>}
    {needsMore && <div className="knowledge-actions"><span>Results are limited. Narrow the query{limit < 100 ? " or show more matches." : "."}</span>{limit < 100 && <Button onClick={() => setLimit(current => Math.min(100, current + 25))}>Show more results</Button>}</div>}
    {complete && !total && activeStates.every(value => !value.error) && <Panel className="indexed-search-empty"><FileSearch size={22} aria-hidden="true" /><strong>{pinnedOnly ? "No pinned memories" : "No indexed content found"}</strong><p>{pinnedOnly ? "Pin a conversation or retained note to keep it here." : "Try different words, or refresh the file and conversation indexes."}</p><Button onClick={onIndex}><Database size={16} />Open Content &amp; Storage</Button></Panel>}

    {selectedMemory && <Dialog title={selectedMemory.title} description={`${selectedMemory.projectName || "Global memory"} · retained revision ${selectedMemory.revision} · ${words(selectedMemory.coverage)}`} size="wide" className="memory-reader" bodyClassName="memory-reader-body" busy={!!memoryWorking} onClose={closeMemoryReader}
      footer={<><Button disabled={!!memoryWorking || !!opening} onClick={() => void pinMemory()}><Pin size={15} />{selectedMemory.pinnedAt ? "Unpin memory" : "Pin memory"}</Button><Button disabled={!!memoryWorking || !!opening} onClick={() => void archiveMemory()}><Archive size={15} />{selectedMemory.status === "archived" ? "Restore memory" : "Archive memory"}</Button>{selectedMemory.kind !== "conversation_snapshot" && <Button disabled={!!memoryWorking || !!opening} onClick={() => { setEditorError(""); setEditor({ id: selectedMemory.id, revision: selectedMemory.revision, title: selectedMemory.title, body: selectedMemory.body ?? "", projectID: selectedMemory.project }); }}><Pencil size={15} />Edit memory</Button>}<Button variant="danger" disabled={!!memoryWorking || !!opening} onClick={() => setForgetting(selectedMemory)}><Trash2 size={15} />Forget memory</Button></>}>
      {readerError && <p className="notice error" role="alert">{readerError}</p>}
      {selectedMemory.status === "archived" && <p className="notice">This memory is archived. Its retained revisions and pin are preserved.</p>}
      <div className="knowledge-reader-actions"><Field label="Retained revision"><select value={selectedMemory.revision} disabled={!!opening || !!memoryWorking} onChange={event => void readMemory(selectedMemory, Number(event.target.value))}>{memoryRevisions.map(value => <option key={value} value={value}>Revision {value}</option>)}</select></Field>
        <Button disabled={!!opening || !!memoryWorking} onClick={() => void readMemory(selectedMemory)}>Check latest revision</Button>
        {selectedMemory.kind === "conversation_snapshot" && <><Button disabled={captureBusy || captureUncertain || !!opening || !!memoryWorking} onClick={() => void refreshMemory()}><RefreshCw size={15} />{captureBusy ? `Capture ${selectedMemory.job?.status ?? "starting"}…` : "Refresh snapshot"}</Button>{selectedMemory.project && selectedMemory.session && <Button disabled={!!opening || !!memoryWorking} onClick={() => { const item = selectedMemory; closeMemoryReader(); void open("live-memory-source", () => onOpenConversation(item.project, item.session!)); }}><MessageSquare size={15} />Open live conversation</Button>}</>}
      </div>
      {memoryRevisions[0] > selectedMemory.revision && <p role="status">A newer retained revision is available. Select it above to read its evidence.</p>}
      {selectedMemory.job && <p role="status">Capture {words(selectedMemory.job.status)}{selectedMemory.job.error ? `: ${selectedMemory.job.error}` : ""}.</p>}
      {selectedMemory.kind === "conversation_snapshot" && selectedMemory.coverage === "unknown_source" && <p className="notice">The source could not be checked. Its availability is unknown. Any transcript below is from the last retained capture.</p>}
      {selectedMemory.kind === "conversation_snapshot" && selectedMemory.coverage === "missing_source" && <p className="notice">OpenCode reported this conversation missing. Any transcript below is retained from an earlier capture.</p>}
      {selectedMemory.kind === "conversation_snapshot" && !selectedMemory.messages.length && <p className="notice">This revision has no captured transcript. Its coverage is shown above.</p>}
      {!!selectedMemory.body && selectedMemory.kind !== "conversation_snapshot" && <p className="knowledge-memory-body">{selectedMemory.body}</p>}
      <div className="memory-reader-messages">{selectedMemory.messages.map(message => <article key={`${message.ordinal}:${message.role}`} className={`memory-reader-message ${message.role}`}><strong>{message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : words(message.role)}</strong><p>{message.text}</p></article>)}</div>
      <details className="knowledge-provenance"><summary>Capture boundary and evidence</summary><dl className="knowledge-metadata"><dt>Memory ID</dt><dd>{selectedMemory.id}</dd><dt>Source captured</dt><dd>{when(selectedMemory.capturedAt ?? selectedMemory.boundary?.capturedAt)}</dd>{selectedMemory.boundary?.attemptedAt != null && <><dt>Last source check</dt><dd>{when(selectedMemory.boundary.attemptedAt)}</dd></>}{selectedMemory.boundary?.snapshotCreatedAt != null && <><dt>Retained revision recorded</dt><dd>{when(selectedMemory.boundary.snapshotCreatedAt)}</dd></>}<dt>Coverage</dt><dd>{words(selectedMemory.coverage)}</dd><dt>Captured messages</dt><dd>{selectedMemory.messageCount}</dd>{selectedMemory.snapshotHash && <><dt>Snapshot hash</dt><dd>{selectedMemory.snapshotHash}</dd></>}</dl>
        {selectedMemory.boundary?.truncated && <p>This snapshot is bounded; additional source content was not captured.</p>}{!!selectedMemory.boundary?.missingSources?.length && <p>{selectedMemory.boundary.missingSources.length} source components were unavailable.</p>}
        {(selectedMemory.members ?? []).map((member, index) => <div key={index} className="knowledge-evidence"><strong>{member.kind ?? member.member_kind}</strong><span>{member.ref ?? member.source_ref}</span><span>{words(member.availability)}</span><small>{member.revision ?? member.source_revision}</small></div>)}
      </details>
    </Dialog>}
    {retainedFile && <Dialog title="Retained file evidence" description={`${retainedFile.path ?? "Indexed source"} · ${words(retainedFile.availability)}`} size="wide" onClose={closeFileReader} footer={retainedFile.project && retainedFile.path && <Button onClick={() => { const item = retainedFile; closeFileReader(); void open("live-file-source", () => onOpenFile(item.project!, item.path!)); }}>Open live file</Button>}>
      {retainedFile.text !== undefined ? <pre className="knowledge-retained-text">{retainedFile.text}</pre> : <p>This retained evidence is unavailable. Its source revision was not replaced with live text.</p>}<details><summary>Evidence identity</summary><p className="knowledge-identity">{retainedFile.revisionIdentity}</p><p className="knowledge-identity">{retainedFile.hash}</p></details>
    </Dialog>}
    {editor && <Dialog title={editor.id ? "Edit memory" : "New memory"} size="wide" onClose={() => setEditor(null)} busy={!!memoryWorking} onSubmit={event => { event.preventDefault(); void saveNote(); }} footer={<><Button disabled={!!memoryWorking} onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={!!memoryWorking}>{memoryWorking === "save" ? "Saving…" : "Save memory"}</Button></>}>
      <Field label="Memory title"><input required maxLength={1000} value={editor.title} disabled={!!editor.id} onChange={event => setEditor(current => current ? { ...current, title: event.target.value } : current)} /></Field>
      <Field label="Memory text"><textarea required maxLength={1000000} rows={9} value={editor.body} onChange={event => setEditor(current => current ? { ...current, body: event.target.value } : current)} /></Field>
      {!editor.id && !scoped && <Field label="Memory scope"><select value={editor.projectID} onChange={event => setEditor(current => current ? { ...current, projectID: event.target.value } : current)}><option value="">Global memory</option>{projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
      {editorError && <p className="notice error" role="alert">{editorError}</p>}
    </Dialog>}
    {claimEditor && <Dialog title={claimEditor.id ? "Correct fact" : "New fact"} description="A fact is a recorded claim with its own origin, status, and retained evidence." size="wide" busy={claimWorking} onClose={() => setClaimEditor(null)} onSubmit={event => { event.preventDefault(); void saveClaim(); }} footer={<><Button disabled={claimWorking} onClick={() => setClaimEditor(null)}>Cancel</Button><Button type="submit" variant="primary" disabled={claimWorking || evidenceLoading}>{claimWorking ? "Saving…" : claimEditor.id ? "Save correction" : "Save fact"}</Button></>}>
      {claimEditor.id && <p className="notice">The previous claim and its evidence remain in history. This correction records a replacement.</p>}
      <Field label="Fact statement"><input required maxLength={1000} value={claimEditor.predicate} onChange={event => setClaimEditor(current => current ? { ...current, predicate: event.target.value } : current)} /></Field>
      <Field label="Fact value"><textarea required maxLength={100000} rows={3} value={claimEditor.value} onChange={event => setClaimEditor(current => current ? { ...current, value: event.target.value } : current)} /></Field>
      <div className="knowledge-editor-grid"><Field label="Claim origin"><select value={claimEditor.origin} onChange={event => setClaimEditor(current => current ? { ...current, origin: event.target.value } : current)}>{["user-stated", "human-authored", "source-reported", "directly-observed", "deterministically-extracted", "model-inferred"].map(value => <option key={value} value={value}>{words(value.replaceAll("-", " "))}</option>)}</select></Field><Field label="Epistemic status"><select value={claimEditor.epistemicState} onChange={event => setClaimEditor(current => current ? { ...current, epistemicState: event.target.value } : current)}><option value="unverified">Unverified</option><option value="supported">Supported by evidence</option><option value="disputed">Disputed</option></select></Field>
        {!scoped && <Field label="Fact scope"><select value={claimEditor.projectID} onChange={event => setClaimEditor(current => current ? { ...current, projectID: event.target.value, evidence: [] } : current)}><option value="">All projects</option>{projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}</div>
      <Field label="How this claim was established"><textarea required maxLength={2000} rows={2} placeholder="Describe the observation, source, or user statement." value={claimEditor.method} onChange={event => setClaimEditor(current => current ? { ...current, method: event.target.value } : current)} /></Field>
      {claimEditor.id && <Field label="Reason for correction"><input required maxLength={2000} value={claimEditor.reason} onChange={event => setClaimEditor(current => current ? { ...current, reason: event.target.value } : current)} /></Field>}
      <section className="knowledge-editor-evidence" aria-label="Retained fact evidence"><h3>Retained evidence</h3><p>Select at least one exact memory revision or indexed file unit. Search to find other retained sources.</p><Field label="Find retained evidence"><input type="search" maxLength={200} value={evidenceQuery} onChange={event => setEvidenceQuery(event.target.value)} /></Field><div className="knowledge-evidence-picker"><Field label="Retained source revision"><select value={evidenceChoice} disabled={evidenceLoading} onChange={event => setEvidenceChoice(event.target.value)}><option value="">{evidenceLoading ? "Finding retained evidence…" : "Select retained evidence"}</option>{evidenceOptions.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></Field><Button disabled={!evidenceChoice || claimWorking} onClick={() => { const choice = evidenceOptions.find(row => row.id === evidenceChoice); if (choice) { setClaimError(""); setClaimEditor(current => current && !current.evidence.some(row => row.id === choice.id) ? { ...current, evidence: [...current.evidence, choice.evidence] } : current); } setEvidenceChoice(""); }}>Add evidence</Button></div>
        {evidenceError && <p className="notice error" role="alert">{evidenceError}</p>}{claimEditor.evidence.map(evidence => <div className="knowledge-selected-evidence" key={evidence.id}><span>{evidence.label}</span><Field label={`Evidence relation for ${evidence.label}`}><select value={evidence.relation} onChange={event => setClaimEditor(current => current ? { ...current, evidence: current.evidence.map(row => row.id === evidence.id ? { ...row, relation: event.target.value } : row) } : current)}>{["supports", "contradicts", "qualifies", "supersedes"].map(value => <option key={value} value={value}>{words(value)}</option>)}</select></Field><Button aria-label={`Remove evidence ${evidence.label}`} onClick={() => setClaimEditor(current => current ? { ...current, evidence: current.evidence.filter(row => row.id !== evidence.id) } : current)}>Remove</Button></div>)}
      </section>{claimError && <p className="notice error" role="alert">{claimError}</p>}
    </Dialog>}
    {forgetting && <ConfirmDialog title="Forget retained memory?" onCancel={() => setForgetting(null)} onConfirm={() => void forgetMemory()} confirmLabel="Forget memory" busy={memoryWorking === "forget"} danger error={readerError}><p>Remove “{forgetting.title}” from knowledge search and pins. {forgetting.kind === "conversation_snapshot" ? "The original conversation stays in OpenCode. " : ""}Existing backups can contain copies.</p></ConfirmDialog>}
  </div>;
}
