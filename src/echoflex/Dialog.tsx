import { useEffect, useId, useRef, useState, type FormEventHandler, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Controls';
import { containDialogFocus, registerDialog } from './dialog-stack.mjs';
import './dialog.css';

export type DialogPriority = 'normal' | 'confirmation' | 'decision' | 'worker';
const priorities = { normal: 0, confirmation: 10, decision: 100, worker: 200 };
type DialogProps = {
  open?: boolean; title: ReactNode; description?: ReactNode; icon?: ReactNode;
  children?: ReactNode; footer?: ReactNode; onClose?: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>; busy?: boolean;
  size?: 'compact' | 'standard' | 'wide'; layout?: 'stack' | 'split';
  priority?: DialogPriority; initialFocus?: 'heading' | 'first';
  className?: string; bodyClassName?: string; ariaLabel?: string; closeLabel?: string;
};

export function Dialog({ open = true, title, description, icon, children, footer, onClose, onSubmit,
  busy = false, size = 'standard', layout = 'stack', priority = 'normal', initialFocus = 'heading',
  className = '', bodyClassName = '', ariaLabel, closeLabel = 'Close dialog' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null), titleID = useId(), descriptionID = useId();
  useEffect(() => {
    if (open && ref.current) return registerDialog(ref.current, { priority: priorities[priority], initialFocus });
  }, [open, priority, initialFocus]);
  const content = <>
    <header className="ef-dialog-header">
      {icon && <span className="ef-dialog-icon" aria-hidden="true">{icon}</span>}
      <div><h2 id={titleID} tabIndex={-1} data-dialog-heading>{title}</h2>
        {description && <div id={descriptionID} className="ef-dialog-description">{description}</div>}</div>
      {onClose && <button type="button" className="icon-button ef-dialog-close" aria-label={closeLabel}
        title={closeLabel} disabled={busy} onClick={onClose}><X size={16} /></button>}
    </header>
    <div className={`ef-dialog-body ${bodyClassName}`} data-layout={layout} aria-busy={busy}>{children}</div>
    {footer && <footer className="ef-dialog-footer">{footer}</footer>}
  </>;
  const dialog = <dialog ref={ref} className={`ef-dialog ${className}`} data-size={size} data-priority={priority}
    aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : titleID} aria-describedby={description ? descriptionID : undefined}
    onKeyDown={containDialogFocus} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose?.(); }}>
    {onSubmit ? <form className="ef-dialog-frame" onSubmit={onSubmit}>{content}</form> : <div className="ef-dialog-frame">{content}</div>}
  </dialog>;
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

export function ConfirmDialog({ title, children, onCancel, onConfirm, confirmLabel = 'Confirm', busy = false,
  danger = false, error, ariaLabel }: { title: ReactNode; children?: ReactNode; onCancel: () => void;
  onConfirm: () => void; confirmLabel?: string; busy?: boolean; danger?: boolean; error?: string; ariaLabel?: string }) {
  return <Dialog title={title} ariaLabel={ariaLabel} size="compact" priority="confirmation" onClose={onCancel} busy={busy}
    footer={<><Button type="button" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button type="button" variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
    {children}{error && <p className="notice error" role="alert">{error}</p>}
  </Dialog>;
}

type Confirmation = { title: string; description: string; confirmLabel?: string; danger?: boolean };
// Promise-based replacement for browser confirm(), without creating another UI shell.
export function useConfirmation() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const resolve = useRef<(confirmed: boolean) => void>();
  useEffect(() => () => resolve.current?.(false), []);
  const finish = (value: boolean) => { resolve.current?.(value); resolve.current = undefined; setRequest(null); };
  return { ask: (next: Confirmation) => new Promise<boolean>(done => {
    resolve.current?.(false); resolve.current = done; setRequest(next);
  }), ui: request && <ConfirmDialog {...request} onCancel={() => finish(false)} onConfirm={() => finish(true)}>
    <p>{request.description}</p></ConfirmDialog> };
}
