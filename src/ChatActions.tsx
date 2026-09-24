import { useState } from "react";
import { MoreHorizontal, Check, GitBranch, AlignLeft } from "lucide-react";
import { Button, Field } from "./echoflex/Controls";
import { api } from "./api";

export function ChatActions({
  project,
  session,
  model,
  run,
  refresh,
  onSession,
  onHistory,
}: {
  project: string;
  session: any;
  model: string;
  run: any;
  refresh: any;
  onSession: (id: string) => void;
  onHistory?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [title, setTitle] = useState("");
  async function action(name) {
    const slash = model.indexOf("/");
    const result = await api("chat/action", {
      project,
      session: session.id,
      action: name,
      providerID: model.slice(0, slash),
      modelID: model.slice(slash + 1),
    });
    if (name === "fork") onSession(result.id);
    await refresh();
    setOpen(false);
  }
  return (
    <div className="chat-menu">
      <button
        className="icon-button"
        aria-label="More actions"
        onClick={() => {
          setTitle(session?.title ?? "");
          setOpen(!open);
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <form
          className="chat-menu-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(
                "chat",
                { project, session: session.id, title },
                "PATCH",
              );
              await refresh();
              setOpen(false);
            });
          }}
        >
          {session && !session.imported && <>
            <Field label="Chat name"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Button type="submit" disabled={!title.trim()}><Check size={15} />Rename</Button>
            <Button type="button" onClick={() => run(() => action("fork"))}><GitBranch size={15} />Continue in a new chat</Button>
            <Button type="button" disabled={!model} onClick={() => run(() => action("summarize"))}><AlignLeft size={15} />Compact conversation</Button>
          </>}
          {onHistory && <Button type="button" onClick={() => { setOpen(false); onHistory(); }}>{session ? "Archive, pin or export…" : "Browse history / export…"}</Button>}
          <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
            Close
          </Button>
        </form>
      )}
    </div>
  );
}
