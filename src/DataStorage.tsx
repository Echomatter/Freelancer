import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, ArrowRight, Database, FolderOpen, MessagesSquare, Search } from "lucide-react";
import { Button, PageCloseButton, PageHeading, Panel } from "./echoflex/Controls";
import { ConfirmDialog } from './echoflex/Dialog';
import { api } from "./api";
import "./history.css";
import type { HelpTopic } from "./documentation-help";

const locationHelp: Record<string, HelpTopic> = { local: "storage-freelancer", legacy: "storage-runtime", native: "storage-opencode" };

export function DataStorage({
  onHistory,
  onSearch,
  onIndex,
  onClose,
  onChange,
}: {
  onHistory: () => void;
  onSearch: () => void;
  onIndex: () => void;
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [confirm, setConfirm] = useState<any>(null);
  const refresh = async () => setData(await api("storage"));
  useEffect(() => {
    let active = true;
    api("storage")
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (action: () => Promise<any>) => {
    setPending(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const archive = () =>
    run(async () => {
      await api(
        "history/project",
        {
          project: confirm.id,
          archived: !confirm.organization?.archivedAt,
          revision: confirm.organization?.revision ?? 0,
        },
        "PUT",
      );
      setConfirm(null);
      await refresh();
      await onChange();
    });
  return (
    <div className="data-storage">
      <PageHeading title="Data & Storage" actions={<PageCloseButton onClick={onClose} />} />
      <Panel title="Local data" help="local-data" className="storage-story">
        <div className="storage-flow" aria-label="Project and application data ownership">
          <div className="storage-flow-step"><FolderOpen size={19} /><strong>Project folders</strong></div>
          <ArrowRight className="storage-flow-arrow" size={17} aria-hidden="true" />
          <div className="storage-flow-step"><Database size={19} /><strong>Freelancer data</strong></div>
          <ArrowRight className="storage-flow-arrow" size={17} aria-hidden="true" />
          <div className="storage-flow-step"><MessagesSquare size={19} /><strong>OpenCode</strong></div>
        </div>
        <div className="storage-story-actions">
          <Button type="button" onClick={onSearch}><Search size={16} />Search project files</Button>
          <Button type="button" onClick={onIndex}><Database size={16} />Manage content index</Button>
        </div>
      </Panel>
      <Panel title="Local backup" help="local-backup">
        <Button onClick={onHistory}>Export conversations</Button>
      </Panel>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!data &&
        (error ? (
          <Button disabled={pending} onClick={() => void run(refresh)}>
            Retry loading data
          </Button>
        ) : (
          <p role="status">Loading local data locations…</p>
        ))}
      {data?.locations.map((location) => (
        <Panel key={location.id} title={location.name} help={locationHelp[location.id]}>
          <strong>{location.owner}</strong>
          <p className="data-location">
            {location.path ?? "Location unavailable"}
          </p>
          {location.bytes != null && (
            <p>
              {(location.bytes / 1024 / 1024).toFixed(2)} MB · main file only
            </p>
          )}
          <div className="action-row">
            <Button
              disabled={pending || !location.path}
              onClick={() =>
                void run(() => api("storage/open", { location: location.id }))
              }
            >
              <FolderOpen size={16} />
              Open folder
            </Button>
          </div>
        </Panel>
      ))}
      {data?.nativeWarning && <p role="status">{data.nativeWarning}</p>}
      {data && (
        <Panel title="Projects" help="project-archive">
          {data.projects.map((project) => (
            <div className="history-row" key={project.id}>
              <div className="history-open">
                <strong>{project.name}</strong>
                <small>
                  {project.organization?.archivedAt
                    ? "Archived project"
                    : "Active project"}{" "}
                  · {project.directory}
                </small>
              </div>
              <Button disabled={pending} onClick={() => setConfirm(project)}>
                {project.organization?.archivedAt ? (
                  <ArchiveRestore size={16} />
                ) : (
                  <Archive size={16} />
                )}
                {project.organization?.archivedAt
                  ? "Restore project"
                  : "Put project away"}
              </Button>
            </div>
          ))}
          {confirm && (
            <ConfirmDialog ariaLabel="Confirm project archive"
              title={`${confirm.organization?.archivedAt ? 'Restore' : 'Put away'} ${confirm.name}?`}
              onCancel={() => setConfirm(null)} onConfirm={() => void archive()} busy={pending}
              confirmLabel="Confirm project change" error={error}>
              <p>
                This does not delete or move files, change GitHub, stop work, or
                change individual chat archives.
              </p>
            </ConfirmDialog>
          )}
        </Panel>
      )}
    </div>
  );
}
