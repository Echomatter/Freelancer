import { useState } from "react";
import { api, query } from "./api";

export function Diff({ text }: { text: string }) {
  return (
    <pre className="diff">
      {text.split("\n").map((line, i) => (
        <span
          key={i}
          className={
            line.startsWith("+")
              ? "added"
              : line.startsWith("-")
                ? "removed"
                : line.startsWith("@@")
                  ? "hunk"
                  : ""
          }
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
export function CurrentFile({
  project,
  file,
}: {
  project?: string;
  file: any;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    if (!project || loading) return;
    setLoading(true);
    setError("");
    try {
      setPreview(
        await api(
          "files?" +
            query(project) +
            "&content=true&path=" +
            encodeURIComponent(file.file ?? file.path),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  if (file.status === "Deleted")
    return <p className="changes-scope">Deleted from the working tree.</p>;
  return (
    <div>
      <button
        className="work-changes-link"
        type="button"
        disabled={!project || loading}
        onClick={load}
      >
        {loading
          ? "Loading…"
          : preview
            ? "Refresh preview"
            : "Preview current file"}
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {preview &&
        (preview.type === "binary" || preview.encoding === "base64" ? (
          <p className="changes-scope">
            This file does not have a text preview.
          </p>
        ) : typeof preview.diff === "string" && preview.diff ? (
          <Diff text={preview.diff} />
        ) : (
          <>
            <p className="changes-scope">Current file contents</p>
            <pre className="file-preview">{preview.content}</pre>
          </>
        ))}
    </div>
  );
}
