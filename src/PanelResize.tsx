import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { api } from "./api";
import { clampWidth, fitPanelWidths, panelLimits, readPanelWidths, savePanelWidth } from "../domain/panel-widths.mjs";
import "./panel-resize.css";
type PanelName = "navigation" | "details";
type Widths = Record<PanelName, number>;
export function usePanelLayout(appearance: any, detailsOpen: boolean) {
  const [widths, setWidths] = useState<Widths>(() => readPanelWidths(undefined) as Widths);
  const [viewport, setViewport] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const initialized = useRef(false), writing = useRef(false), confirmed = useRef(widths);
  useEffect(() => {
    if (appearance === undefined || initialized.current) return;
    initialized.current = true;
    confirmed.current = readPanelWidths(appearance) as Widths;
    setWidths(confirmed.current);
    // Subsequent bootstrap polls must not undo locally confirmed widths.
  }, [appearance]);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const preview = (name: PanelName, value: number) => setWidths((old) => ({ ...old, [name]: value }));
  const commit = async (name: PanelName, value: number) => {
    if (writing.current || !initialized.current) return;
    if (confirmed.current[name] === value) { preview(name, value); return; }
    writing.current = true; setSaving(true); setError(""); preview(name, value);
    try {
      await savePanelWidth(name, value, (patch) => api("appearance", patch, "PUT"));
      confirmed.current = { ...confirmed.current, [name]: value };
    } catch (e) {
      preview(name, confirmed.current[name]);
      setError(e instanceof Error ? e.message : "Panel width could not be saved.");
    } finally { writing.current = false; setSaving(false); }
  };
  const fitted = fitPanelWidths(widths, viewport, detailsOpen);
  return { widths, fitted, preview, commit, saving, error,
    ready: appearance !== undefined && initialized.current, dismissError: () => setError(""),
    style: { "--navigation-width": `${fitted.navigation}px`, "--details-width": `${fitted.details}px` } as CSSProperties };
}
export function PanelResize({ panel, layout }: { panel: PanelName; layout: ReturnType<typeof usePanelLayout> }) {
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelDrag.current?.(), []);
  const limit = panelLimits[panel], value = layout.fitted[panel];
  const max = panel === "navigation" ? layout.fitted.navigationMax : layout.fitted.detailsMax;
  const enabled = layout.ready && !layout.saving, direction = panel === "navigation" ? 1 : -1;
  const bounded = (width: number) => clampWidth(width, limit.min, max);
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (!enabled || event.button !== 0 || !event.isPrimary || cancelDrag.current) return;
    event.preventDefault();
    const handle = event.currentTarget, id = event.pointerId, x = event.clientX;
    const original = layout.widths[panel];
    handle.focus(); handle.setPointerCapture(id);
    document.documentElement.classList.add("panel-resizing");
    const next = (e: PointerEvent) => bounded(value + direction * (e.clientX - x));
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      cancelDrag.current = null;
      document.documentElement.classList.remove("panel-resizing");
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
    };
    const cancel = () => { cleanup(); layout.preview(panel, original); };
    const move = (e: PointerEvent) => { if (e.pointerId === id) layout.preview(panel, next(e)); };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const width = next(e); cleanup();
      if (width === value) layout.preview(panel, original);
      else void layout.commit(panel, width);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); cancel(); } };
    cancelDrag.current = cancel;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
  }
  return <div className={`panel-resizer panel-resizer-${panel}`} role="separator"
    aria-orientation="vertical" aria-label={`${panel === "navigation" ? "Navigation" : "Details"} width`}
    aria-controls={`workspace-${panel}`} aria-valuemin={limit.min} aria-valuemax={max}
    aria-valuenow={value} aria-valuetext={`${value} pixels`} aria-disabled={!enabled} tabIndex={enabled ? 0 : -1}
    title="Drag to resize. Double-click to reset. Arrow keys adjust; Home/End set limits."
    onPointerDown={start}
    onDoubleClick={() => { if (enabled) void layout.commit(panel, bounded(limit.default)); }}
    onKeyDown={(e) => {
      if (!enabled || cancelDrag.current || e.altKey || e.ctrlKey || e.metaKey) return;
      let next: number;
      if (e.key === "Home") next = limit.min;
      else if (e.key === "End") next = max;
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight")
        next = bounded(value + direction * (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 30 : 10));
      else return;
      e.preventDefault(); void layout.commit(panel, next);
    }} />;
}
