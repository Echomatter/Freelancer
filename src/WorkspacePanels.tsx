import { ArrowLeft, ArrowUpRight, File, Folder, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api, query } from "./api";
import { FileChanges } from "./FileChanges";
import { Diff } from "./FilePreview";
import {
  Button,
  PageCloseButton,
  PageHeading,
  Panel,
} from "./echoflex/Controls";

export function Files({
  project,
  run,
  onClose,
  onSearch,
  initialPath,
  initialFolder = "",
  onLocationChange,
  changes,
  chatTitle,
  changesUnavailable,
  messages,
  directory,
}: {
  project: string;
  run: any;
  onClose: () => void;
  onSearch?: () => void;
  initialPath?: string;
  initialFolder?: string;
  onLocationChange?: (path: string, file?: string) => void;
  changes?: any[];
  chatTitle?: string;
  changesUnavailable?: boolean;
  messages?: any[];
  directory?: string;
}) {
  const folder = initialFolder;
  const [loading, setLoading] = useState(true),
    [selectedPath, setSelectedPath] = useState(initialPath ?? ""),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [nodes, setNodes] = useState<any[]>([]),
    [file, setFile] = useState<any>(null);
  const parentDirectory = (value: string) => {
    const normalized = value.replaceAll("\\", "/");
    const index = normalized.lastIndexOf("/");
    return index < 0 ? "" : normalized.slice(0, index);
  };
  useEffect(() => {
    const controller = new AbortController();
    setFile(null);
    setNodes([]);
    setError("");
    setLoading(true);
    void (async () => {
      try {
        const value = await api(
          "files?" +
            query(project) +
            (selectedPath ? "&content=true" : "") +
            "&path=" +
            encodeURIComponent(selectedPath || folder),
          undefined,
          "GET",
          controller.signal,
        );
        if (!controller.signal.aborted) {
          if (selectedPath) setFile({ ...value, path: selectedPath });
          else setNodes(value);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError((failure as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [project, folder, selectedPath, revision]);
  function open(node) {
    if (node.type === "directory") {
      setSelectedPath("");
      onLocationChange?.(node.path);
      return;
    }
    setSelectedPath(node.path);
    onLocationChange?.(parentDirectory(node.path), node.path);
  }
  return (
    <div className="page files-page">
      <PageHeading
        title="Files"
        icon={Folder}
        help="project-files"
        actions={
          <>
            {(folder || selectedPath) && (
              <Button
                onClick={() =>
                  selectedPath
                    ? (setSelectedPath(""), onLocationChange?.(folder))
                    : onLocationChange?.(parentDirectory(folder))
                }
              >
                <ArrowLeft size={15} />
                Back
              </Button>
            )}
            {onSearch && (
              <Button variant="quiet" onClick={onSearch}>
                <Search size={15} />
                Search project content
              </Button>
            )}
            <PageCloseButton onClick={onClose} />
          </>
        }
      />
      {!selectedPath && !folder && <FileChanges project={project} changes={changes} messages={messages} directory={directory} chatTitle={chatTitle} unavailable={changesUnavailable} />}
      <p className="files-location" aria-label="Current location">
        {selectedPath || folder || "Your project"}
      </p>
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          <Button onClick={() => setRevision((value) => value + 1)}>
            Retry files
          </Button>
        </div>
      )}
      {file ? (
        <Panel>
          {file.type === "binary" || file.encoding === "base64" ? (
            <p>This file does not have a text preview.</p>
          ) : (
            <pre className="file-preview">{file.content}</pre>
          )}
          {file.diff && <Diff text={file.diff} />}
        </Panel>
      ) : (
        <Panel>
          {loading && selectedPath ? (
            <p role="status">Opening selected file…</p>
          ) : loading ? (
            <p>Loading files…</p>
          ) : (
            nodes.map((node) => (
              <button
                className="file-row"
                key={node.path}
                onClick={() => open(node)}
              >
                {node.type === "directory" ? (
                  <Folder size={17} />
                ) : (
                  <File size={17} />
                )}
                <span>{node.name}</span>
                <ArrowUpRight size={14} />
              </button>
            ))
          )}
          {!loading && !error && !selectedPath && !nodes.length && (
            <p>This folder is empty.</p>
          )}
        </Panel>
      )}
    </div>
  );
}
