import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, Plus, X } from 'lucide-react';
import './composer.css';

// A single flat sheet: every existing choice is one level from the composer.
export function ComposerMenu({ children, disabled, onAttach, context }: {
  children: ReactNode; disabled: boolean; onAttach: () => void; context: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => setOpen(false), [context]);
  useEffect(() => {
    if (!open) return;
    (panel.current?.querySelector<HTMLButtonElement>('.composer-menu-attach:not(:disabled)')
      ?? panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = root.current?.closest('.composer')?.getBoundingClientRect();
      if (!anchor || !panel.current) return;
      const width = Math.min(440, anchor.width, window.innerWidth - 16);
      Object.assign(panel.current.style, {
        left: `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`,
        width: `${width}px`, bottom: `${Math.max(8, window.innerHeight - anchor.top + 6)}px`,
        maxHeight: `${Math.max(0, anchor.top - 14)}px`,
      });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open]);
  return <div className="composer-menu" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab' && open) {
      const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)') ?? [])];
      if (event.shiftKey && event.target === controls[0]) { event.preventDefault(); close(); }
      else if (!event.shiftKey && event.target === controls.at(-1)) {
        event.preventDefault(); setOpen(false); root.current?.closest('form')?.querySelector('textarea')?.focus();
      }
    }
  }}>
    <button ref={trigger} type="button" className="composer-menu-trigger" aria-label="Message options"
      title="Attachments and message settings" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}><Plus size={22} aria-hidden="true" /></button>
    {createPortal(<div ref={panel} id={id} hidden={!open} className="composer-menu-panel" role="region" aria-label="Message options">
      <header><strong>Message options</strong><button type="button" aria-label="Close message options" onClick={close}><X size={17} /></button></header>
      <button type="button" className="composer-menu-attach" disabled={disabled} onClick={() => { onAttach(); setOpen(false); }}>
        <span className="work-icon"><Paperclip size={18} /></span><span><strong>Attach files</strong><small>Choose files, or drop them into your message</small></span>
      </button>
      {children}
      <p>Changes apply to your next message.</p>
    </div>, document.body)}
  </div>;
}
