import { useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import './work-card.css';

// Presentation only. Dismissing a card never cancels native work or edits todos.
export function WorkCard({ title, icon, children, onDismiss, dismissLabel = 'Dismiss card', action, defaultOpen = true }: {
  title: ReactNode; icon?: ReactNode; children: ReactNode; onDismiss?: () => void; dismissLabel?: string; action?: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <section className="work-card">
    <header className="work-card-heading">
      <button type="button" className="work-card-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}<strong>{title}</strong><ChevronDown size={14} className={open ? '' : 'collapsed'} />
      </button>
      {action}
      {onDismiss && <button type="button" className="icon-button work-card-dismiss" aria-label={dismissLabel} title={dismissLabel} onClick={onDismiss}><X size={15} /></button>}
    </header>
    {open && <div className="work-card-body">{children}</div>}
  </section>;
}
