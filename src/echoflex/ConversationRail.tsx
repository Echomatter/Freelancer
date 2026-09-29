import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { railOffset, railPosition } from './rail-geometry.mjs';
import './conversation-rail.css';

export type RailTurn = { key: string; target: string; label: string; preview: string; status: string; stats: { label: string; value: string }[] };
type Metrics = { anchors: number[]; maximum: number; position: number; height: number };

/** Echoflex turn navigation + scroll position. */
export function ConversationRail({ scroll, content, turns, selected, onSelect, onScrollIntent, context, identity }: {
  scroll: RefObject<HTMLDivElement>; content: RefObject<HTMLDivElement>; turns: RailTurn[];
  selected?: string; onSelect: (key: string) => void; onScrollIntent: () => void;
  context: { ratio: number | null; label: string }; identity: string;
}) {
  const root = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null), buttons = useRef(new Map<string, HTMLButtonElement>());
  const cancelDrag = useRef<null | (() => void)>(null), jumpFrame = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const tooltipID = useId();
  const [metrics, setMetrics] = useState<Metrics>({ anchors: [], maximum: 0, position: 0, height: 0 });
  const latest = useRef(metrics);
  const [hovered, setHovered] = useState<string | null>(null), [focusKey, setFocusKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false), [tipPosition, setTipPosition] = useState({ left: 0, top: 0 });
  const active = turns.find(turn => turn.key === hovered);
  const tabKey = turns.some(turn => turn.key === focusKey) ? focusKey : selected ?? turns[0]?.key;
  const showTip = (key: string) => { clearTimeout(closeTimer.current); if (!dragging) setHovered(key); };
  const hideTip = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setHovered(null), 150); };

  // The scroll/content nodes are later siblings: wait until all their refs are
  // attached, including when a cached transcript is present on the first render.
  useEffect(() => {
    const area = scroll.current, body = content.current, line = track.current;
    if (!area || !body || !line) return;
    let frame = 0, layoutDirty = true;
    const measure = () => {
      frame = 0;
      let { anchors, maximum, height } = latest.current;
      const measuredMaximum = Math.max(0, area.scrollHeight - area.clientHeight);
      if (layoutDirty || maximum !== measuredMaximum) {
        maximum = measuredMaximum;
        const origin = area.getBoundingClientRect().top;
        anchors = turns.map(turn => {
          const node = document.getElementById(turn.target);
          return Math.min(maximum, Math.max(0, (node?.getBoundingClientRect().top ?? origin) - origin + area.scrollTop));
        });
        height = line.clientHeight;
        layoutDirty = false;
      }
      const next = { anchors, maximum, position: railPosition(area.scrollTop, anchors, maximum), height };
      // Measure transcript anchors only. Measuring floating UI here creates a
      // resize/render feedback loop, especially while streamed content grows.
      latest.current = next;
      setMetrics(previous => previous.position === next.position && previous.maximum === maximum && previous.height === height &&
        previous.anchors.length === anchors.length && previous.anchors.every((value, i) => value === anchors[i]) ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(() => { layoutDirty = true; schedule(); });
    observer.observe(area); observer.observe(body); observer.observe(line);
    area.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => { observer.disconnect(); area.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
  }, [scroll, content, turns]);

  useEffect(() => {
    setHovered(null); setFocusKey(null);
    return () => { cancelDrag.current?.(); cancelAnimationFrame(jumpFrame.current); clearTimeout(closeTimer.current); };
  }, [identity]);

  useLayoutEffect(() => {
    if (!active || !tip.current) return;
    const place = () => {
      const target = buttons.current.get(active.key)?.getBoundingClientRect(), box = tip.current?.getBoundingClientRect();
      if (!target || !box) return;
      setTipPosition({ left: Math.max(8, target.left - box.width - 12), top: Math.max(8, Math.min(window.innerHeight - box.height - 8, target.top - 26)) });
    };
    place();
    window.addEventListener('resize', place);
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setHovered(null); };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !tip.current?.contains(event.target as Node)) setHovered(null); };
    window.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('keydown', dismiss); document.removeEventListener('pointerdown', outside); };
  }, [active, metrics.height]);

  function jump(turn: RailTurn) {
    onScrollIntent(); onSelect(turn.key); setFocusKey(turn.key);
    cancelAnimationFrame(jumpFrame.current);
    // React commits the selected toolbar first; then measure the transcript
    // against its final viewport so the chosen turn is never under the dock.
    jumpFrame.current = requestAnimationFrame(() => {
      const area = scroll.current, target = document.getElementById(turn.target);
      if (area && target) area.scrollTop += target.getBoundingClientRect().top - area.getBoundingClientRect().top - 12;
    });
  }

  function startScroll(event: ReactPointerEvent<HTMLElement>, seek = false) {
    if (event.button !== 0 || !event.isPrimary || latest.current.maximum <= 0 || cancelDrag.current) return;
    event.preventDefault(); onScrollIntent(); setHovered(null); setDragging(true);
    const handle = event.currentTarget, id = event.pointerId, y = event.clientY;
    const area = scroll.current!, original = area.scrollTop, bounds = track.current!.getBoundingClientRect();
    const position = seek ? Math.max(0, Math.min(1, (y - bounds.top) / bounds.height)) : latest.current.position;
    handle.focus({ preventScroll: true }); handle.setPointerCapture(id);
    document.documentElement.classList.add('conversation-scrolling');
    const moveTo = (nextY: number) => {
      onScrollIntent();
      area.scrollTop = railOffset(position + (nextY - y) / Math.max(1, bounds.height), latest.current.anchors, latest.current.maximum);
    };
    if (seek) moveTo(y);
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', key);
      window.removeEventListener('blur', cancel); window.removeEventListener('resize', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      cancelDrag.current = null; setDragging(false);
      document.documentElement.classList.remove('conversation-scrolling');
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    };
    const cancel = () => { cleanup(); area.scrollTop = original; };
    const move = (e: PointerEvent) => { if (e.pointerId === id) moveTo(e.clientY); };
    const up = (e: PointerEvent) => { if (e.pointerId === id) { moveTo(e.clientY); cleanup(); } };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
    cancelDrag.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', key);
    window.addEventListener('blur', cancel); window.addEventListener('resize', cancel);
    handle.addEventListener('lostpointercapture', cancel);
  }

  const gap = metrics.height / Math.max(1, turns.length);
  const style = { '--rail-strength': `${Math.round(42 + (context.ratio ?? 0) * 58)}%`, '--turn-target': `${Math.min(26, Math.max(.1, gap))}px`, '--turn-size': `${Math.min(8, Math.max(2, gap - 3))}px` } as CSSProperties;
  return <div ref={root} className={`conversation-rail${dragging ? ' is-scrolling' : ''}`} style={style}
    data-context-level={context.ratio === null ? 'unknown' : Math.round(context.ratio * 100)}
    onWheel={event => { if (scroll.current && event.deltaY && !event.ctrlKey) { onScrollIntent(); scroll.current.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.current.clientHeight : 1); } }}>
    <div ref={track} className="conversation-rail-track" onPointerDown={event => { if (event.target === event.currentTarget) startScroll(event, true); }}>
      <div className="conversation-rail-line" aria-hidden="true" />
      <div className="conversation-rail-turns" role="group" aria-label="Conversation turns">
        {turns.map((turn, index) => <button key={turn.key} ref={node => { if (node) buttons.current.set(turn.key, node); else buttons.current.delete(turn.key); }} type="button"
          className="conversation-rail-turn" style={{ top: `${index / turns.length * 100}%` }}
          aria-label={`Jump to ${turn.label.toLowerCase()}`} aria-current={selected === turn.key ? 'step' : undefined}
          aria-controls={turn.target} aria-describedby={active?.key === turn.key ? tooltipID : undefined}
          tabIndex={tabKey === turn.key ? 0 : -1}
          onMouseEnter={() => showTip(turn.key)} onMouseLeave={hideTip}
          onFocus={() => { setFocusKey(turn.key); showTip(turn.key); }} onBlur={hideTip}
          onClick={() => jump(turn)} onKeyDown={event => {
            let next = index;
            if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next--;
            else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next++;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = turns.length - 1;
            else return;
            event.preventDefault(); buttons.current.get(turns[Math.max(0, Math.min(turns.length - 1, next))].key)?.focus({ preventScroll: true });
          }}><span aria-hidden="true" /></button>)}
      </div>
      <div className="conversation-rail-thumb" role="scrollbar" aria-label="Scroll conversation" aria-orientation="vertical"
        aria-controls={scroll.current?.id} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(metrics.position * 100)}
        aria-valuetext={`${Math.round(metrics.position * 100)}% through conversation`} aria-disabled={metrics.maximum <= 0}
        tabIndex={metrics.maximum > 0 ? 0 : -1} style={{ top: `${metrics.position * 100}%` }} onPointerDown={event => startScroll(event)}
        onKeyDown={event => {
          if (event.altKey || event.ctrlKey || event.metaKey || cancelDrag.current || !scroll.current) return;
          const area = scroll.current;
          const delta = event.key === 'ArrowDown' ? 48 : event.key === 'ArrowUp' ? -48 : event.key === 'PageDown' || event.key === ' ' && !event.shiftKey ? area.clientHeight * .85 : event.key === 'PageUp' || event.key === ' ' && event.shiftKey ? -area.clientHeight * .85 : null;
          if (delta === null && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault(); onScrollIntent(); area.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? area.scrollHeight : area.scrollTop + (delta ?? 0);
        }}><span aria-hidden="true" /></div>
    </div>
    <div className="conversation-rail-context" title={context.label} aria-label={context.label}>{context.ratio === null ? '—' : `${Math.round(context.ratio * 100)}%`}</div>
    {active && !dragging && createPortal(<div ref={tip} id={tooltipID} role="tooltip" className="conversation-rail-tooltip" style={tipPosition}
      onMouseEnter={() => clearTimeout(closeTimer.current)} onMouseLeave={hideTip}>
      <header><strong>{active.label}</strong><span>{active.status}</span></header>
      <p>{active.preview}</p>
      <dl>{active.stats.map(stat => <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl>
      <footer>Chat · {context.label}</footer>
    </div>, document.body)}
  </div>;
}
