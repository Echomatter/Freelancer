import { useEffect, useState } from "react";
import { Database, FileSearch, FolderOpen } from "lucide-react";
import { api } from "./api";
import { Button, Field, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";
import "./indexed-search.css";

type SearchHit = {
  project: string;
  projectName: string;
  projectArchived: boolean;
  path: string;
  role: string;
  unit: number;
  locator: string;
  heading: string;
  excerpt: string;
};

export function IndexedSearch({ projects, onOpen, onIndex, onClose }: {
  projects: any[];
  onOpen: (project: string, path: string) => Promise<void>;
  onIndex: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState("");
  const [error, setError] = useState("");
  const trimmed = query.trim();

  useEffect(() => {
    setError("");
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setResults([]);
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: trimmed, project });
      void api(`index/search?${params}`, undefined, undefined, controller.signal)
        .then((value) => {
          setResults(value.results);
          setSearched(true);
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError((failure as Error).message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, project]);

  async function open(hit: SearchHit) {
    const key = `${hit.project}/${hit.path}`;
    setOpening(key);
    setError("");
    try {
      await onOpen(hit.project, hit.path);
    } catch (failure) {
      setError((failure as Error).message);
      setOpening("");
    }
  }

  return <div className="page indexed-search-page">
    <PageHeading title="Search files" actions={<><Button type="button" onClick={onIndex}><Database size={16} />Index coverage</Button><PageCloseButton onClick={onClose} /></>} />
    <section className="indexed-search-controls" aria-label="Search indexed project files">
      <div className="indexed-search-query"><Field label="Search project files" help="file-search">
        <input autoFocus type="search" maxLength={200} value={query} placeholder="Search words in files, documents, and notes…" onChange={(event) => setQuery(event.target.value)} />
      </Field></div>
      <Field label="Project">
        <select value={project} onChange={(event) => setProject(event.target.value)}>
          <option value="">All registered projects</option>
          {projects.map((item) => <option key={item.id} value={item.id}>{item.name}{item.organization?.archivedAt ? " · archived" : ""}</option>)}
        </select>
      </Field>
    </section>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="indexed-search-status" aria-live="polite">
      {loading ? <span role="status">Searching the local index…</span>
        : searched ? <span>{results.length ? `${results.length} matching ${results.length === 1 ? "section" : "sections"}` : "No indexed files matched."}</span>
          : null}
    </div>
    {searched && !loading && results.length > 0 && <div className="indexed-search-results" aria-label="Indexed file results">
      {results.map((hit) => {
        const key = `${hit.project}/${hit.path}`;
        return <button type="button" className="indexed-search-result" key={`${key}/${hit.unit}/${hit.locator}`}
          aria-label={`Open ${hit.projectName}/${hit.path}`} disabled={!!opening} onClick={() => void open(hit)}>
          <span className="indexed-result-heading"><strong>{hit.heading || hit.path.split(/[\\/]/).at(-1)}</strong><small>{opening === key ? "Opening project file…" : hit.role}</small></span>
          <span className="indexed-result-path"><span>{hit.projectName}{hit.projectArchived ? " · archived" : ""}</span><span>{hit.path}</span></span>
          <span className="indexed-result-excerpt">{hit.excerpt}</span>
          <span className="indexed-result-open"><FolderOpen size={15} />Open in project Files</span>
        </button>;
      })}
    </div>}
    {searched && !loading && !results.length && <Panel className="indexed-search-empty">
      <FileSearch size={22} aria-hidden="true" />
      <strong>No indexed file sections found</strong>
      <Button type="button" onClick={onIndex}><Database size={16} />Open Content index</Button>
    </Panel>}
  </div>;
}
