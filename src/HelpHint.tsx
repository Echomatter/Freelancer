import { CircleHelp } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { helpTopics, type HelpTopic } from "./documentation-help";
import "./help-hint.css";

type Topic = { topic: HelpTopic; label?: string };
const CardHelp = createContext<((id: string, topic: Topic) => () => void) | null>(null);

// Fields contribute to their containing card's single footer bubble. Nested
// cards own their help, so controls never collect beside headings or labels.
export function HelpScope({ children, topic }: { children: ReactNode; topic?: HelpTopic }) {
  const [entries, setEntries] = useState<Record<string, Topic>>({});
  const register = useCallback((id: string, item: Topic) => {
    setEntries(previous => ({ ...previous, [id]: item }));
    return () => setEntries(previous => { const next = { ...previous }; delete next[id]; return next; });
  }, []);
  const topics = [...new Map([...(topic ? [{ topic }] : []), ...Object.values(entries)].map(item => [item.topic, item])).values()];
  return <CardHelp.Provider value={register}>{children}
    {topics.length > 0 && <div className="card-help"><HelpPopover topics={topics} /></div>}
  </CardHelp.Provider>;
}

export function HelpHint({ topic, label }: Topic) {
  const register = useContext(CardHelp), id = useId();
  useEffect(() => register?.(id, { topic, label }), [register, id, topic, label]);
  return register ? null : <HelpPopover topics={[{ topic, label }]} />;
}

function HelpPopover({ topics }: { topics: Topic[] }) {
  const [selected, setSelected] = useState<HelpTopic | null>(null);
  const current = topics.find(item => item.topic === selected) ?? topics[0];
  const excerpt = helpTopics[current.topic];
  const label = topics[0].label;
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pinned = useRef(false);
  const focused = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const close = () => { clearTimeout(timer.current); pinned.current = false; setOpen(false); };
  const show = () => {
    clearTimeout(timer.current);
    window.dispatchEvent(new CustomEvent("freelancer:help", { detail: id }));
    setOpen(true);
  };
  const leave = () => {
    clearTimeout(timer.current);
    if (!pinned.current && !focused.current) timer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !tip.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const box = tip.current.getBoundingClientRect();
      const edge = 10;
      const left = Math.max(edge, Math.min(anchor.left, window.innerWidth - box.width - edge));
      const below = anchor.bottom + 7;
      const top = below + box.height < window.innerHeight - edge ? below : Math.max(edge, anchor.top - box.height - 7);
      setPosition({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, current.topic]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (!trigger.current?.getClientRects().length) { close(); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !tip.current?.contains(event.target as Node)) close();
    };
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) close(); };
    const dialog = trigger.current?.closest("dialog");
    dialog?.addEventListener("close", close);
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("freelancer:help", other);
    return () => { dialog?.removeEventListener("close", close); window.removeEventListener("keydown", key, true); window.removeEventListener("pointerdown", outside); window.removeEventListener("freelancer:help", other); };
  }, [open, id]);

  return <span className="help-hint">
    <button ref={trigger} type="button" className="help-hint-trigger" aria-label={`Help: ${label ? `${label} — ` : ""}${helpTopics[topics[0].topic].title}`}
      aria-expanded={open} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave}
      onFocus={() => { focused.current = true; show(); }} onBlur={event => { focused.current = false; if (!tip.current?.contains(event.relatedTarget as Node)) close(); }}
      onClick={event => { event.stopPropagation(); if (pinned.current) close(); else { pinned.current = true; show(); } }}>
      <CircleHelp size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={tip} id={id} className="help-hint-popover" role={topics.length > 1 ? 'dialog' : 'tooltip'} aria-label={topics.length > 1 ? 'Card help' : undefined} style={position}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) close(); }}
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={leave}>
      <strong>{excerpt.title}</strong>
      {topics.length > 1 && <select aria-label="Help topic" value={current.topic} onChange={event => setSelected(event.target.value as HelpTopic)}>
        {topics.map(item => <option key={item.topic} value={item.topic}>{helpTopics[item.topic].title}</option>)}
      </select>}
      {excerpt.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      <small>README · Interface help</small>
    </div>, trigger.current?.closest("dialog") ?? document.body)}
  </span>;
}
