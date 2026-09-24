import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, FolderOpen } from "lucide-react";
import { Button, PageHeading, Panel } from "./echoflex/Controls";
import { ConfirmDialog } from './echoflex/Dialog';
import { api } from "./api";
import "./history.css";

export function DataStorage({
  onHistory,
  onChange,
}: {
  onHistory: () => void;
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
      <PageHeading title="Data & Storage" description="Find the data needed for recovery, export conversations, and organize projects." />
      <Panel title="Make a local backup">
        <ol className="backup-steps">
          <li><strong>Stop active writers.</strong><span>Close Freelancer's server and OpenCode before copying live databases.</span></li>
          <li><strong>Copy your projects and data.</strong><span>Include each project folder and the available locations below. Keep SQLite sidecar files with their databases.</span></li>
          <li><strong>Export chats for reading.</strong><span>JSON or Markdown exports cover selected conversations, and Freelancer does not currently import them.</span></li>
        </ol>
        <p className="backup-note">These locations are not a complete system backup. Credentials and attachments stored outside conversations need separate care.</p>
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
        <Panel key={location.id} title={location.name}>
          <strong>{location.owner}</strong>
          <p className="data-location">
            {location.path ?? "Location unavailable"}
          </p>
          <small>{location.note}</small>
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
        <Panel title="Projects">
          <p>
            Archiving a project hides it from active navigation. Its folder, Git
            agreement and conversations stay in place.
          </p>
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
      <Panel title="What belongs where?">
        <dl className="data-map">
          <dt>Project</dt>
          <dd>Your chosen folder and its application setup.</dd>
          <dt>Conversation and workers</dt>
          <dd>
            Native OpenCode sessions, messages, tools and todos. Workers remain
            linked to their parent.
          </dd>
          <dt>Agent and workflow</dt>
          <dd>
            Reusable definitions. Request receipts preserve the configuration
            used for a particular submission.
          </dd>
          <dt>Draft and queue</dt>
          <dd>
            A draft is editable unsent text. A queued message is an explicit
            delivery commitment; archiving cannot cancel it silently.
          </dd>
          <dt>Archive and export</dt>
          <dd>
            Archive organizes history. Export writes a chosen conversation to a
            file. Neither is a full system backup or a way to reclaim disk
            space.
          </dd>
        </dl>
      </Panel>
      {data && <p>{data.notice}</p>}
    </div>
  );
}
