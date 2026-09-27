import { useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronDown, X } from 'lucide-react';
import './work-card.css';

// Presentation only. Dismissing a card never cancels native work or edits todos.
export function WorkCard({ title, icon, children, onDismiss, dismissLabel = 'Dismiss card', action, defaultOpen = true, preview, attention = false }: {
  title: ReactNode; icon?: ReactNode; children: ReactNode; onDismiss?: () => void; dismissLabel?: string; action?: ReactNode; defaultOpen?: boolean; preview?: ReactNode; attention?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  useEffect(() => { if (attention) setOpen(true); }, [attention]);
  return <section className={`work-card${attention ? ' needs-attention' : ''}`}>
    <header className="work-card-heading">
      <button type="button" className="work-card-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {icon && <span className="work-icon">{icon}</span>}<span className="work-card-label"><strong>{title}</strong>{!open && preview && <small>{preview}</small>}</span><ChevronDown size={14} className={open ? '' : 'collapsed'} />
      </button>
      {action}
      {onDismiss && <button type="button" className="icon-button work-card-dismiss" aria-label={dismissLabel} title={dismissLabel} onClick={onDismiss}><X size={15} /></button>}
    </header>
    {open && <div id={id} className="work-card-body">{children}</div>}
  </section>;
}
