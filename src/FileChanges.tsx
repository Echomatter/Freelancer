import { CurrentFile, Diff } from "./FilePreview";
import { chatChanges } from "../domain/chat-changes.mjs";

export function FileChanges({ project, changes = [], messages = [], directory, chatTitle, unavailable }: any) {
  // Native command metadata may contain a patch before the session snapshot.
  const recorded = chatChanges([], messages, [], directory).filter(file => !changes.some((row: any) => row.scope === "session" && (row.file ?? row.path) === file.file));
  const rows = [...changes, ...recorded];
  return (
    <section className="file-changes" aria-label="File changes">
      <h3>Changes</h3>
      <p className="changes-scope">{chatTitle ? `Recorded in “${chatTitle}” and the current project working tree.` : "Open a chat to inspect its recorded changes."} Working tree changes may include work from other chats.</p>
      {unavailable && <p className="notice">Some changes are unavailable. Refresh to try again.</p>}
      {chatTitle && !unavailable && !rows.length && <p>No file changes recorded.</p>}
      {rows.map((file: any, index: number) => (
        <details className="file-diff" key={`${file.scope}:${file.file ?? file.path}:${index}`}>
          <summary><span>{file.file ?? file.path}</span><small>{file.scope === "workspace" ? "Working tree" : "Chat record"}{file.status ? ` · ${file.status}` : ""}</small></summary>
          {!file.patch && file.before == null && file.after == null ? (
            <CurrentFile project={project} file={file} />
          ) : (
            <Diff text={file.patch ?? `--- Before\n${file.before ?? ""}\n+++ After\n${file.after ?? ""}`} />
          )}
        </details>
      ))}
    </section>
  );
}
