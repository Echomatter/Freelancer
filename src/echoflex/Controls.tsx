// Adapted from EM Preset Studio's Echoflex controls. Kept independent of its
// audio/module runtime; native HTML behavior and accessibility are preserved.
import { X } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cloneElement, createContext, isValidElement, useContext, useId, useState, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { HelpHint, HelpScope } from "../HelpHint";
import type { HelpTopic } from "../documentation-help";
import { settingsPageForTitle } from "../settings-catalog.mjs";
import "../settings-ux.css";

export function Button({ variant = "secondary", className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "quiet" }) {
  return <button className={`button ${variant} ${className}`} {...props} />;
}
export function PageCloseButton({ onClick, label = "Close settings", disabled = false }: {
  onClick: () => void; label?: string; disabled?: boolean;
}) {
  return <Button type="button" className="page-close-button" variant="quiet" aria-label={label} title={label} disabled={disabled} onClick={onClick}><X size={18} aria-hidden="true" /></Button>;
}

const PanelLevel = createContext(1);
export function Panel({ title, help, helpDetails, children, className = "", collapsible = false, summaryText, storageKey, ...props }:
  HTMLAttributes<HTMLElement> & { title?: string; help?: HelpTopic; helpDetails?: ReactNode; collapsible?: boolean; summaryText?: string; storageKey?: string }) {
  const parentLevel = useContext(PanelLevel);
  const level = title ? Math.min(6, parentLevel + 1) : parentLevel;
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  const headingID = useId();
  const [open, setOpen] = useState(() => {
    if (!collapsible || !storageKey) return true;
    try { return window.localStorage.getItem(`capability-panel:${storageKey}`) === 'open'; } catch { return false; }
  });
  const labelledBy = props['aria-labelledby'] ?? (title && !props['aria-label'] ? headingID : undefined);
  const contents = <section className={`panel ${className}`} {...props} aria-labelledby={labelledBy}>
    <PanelLevel.Provider value={level}><HelpScope topic={help} details={helpDetails}>
      {title && !collapsible && <Heading id={headingID} className="panel-heading">{title}</Heading>}
      {children}
    </HelpScope></PanelLevel.Provider>
  </section>;
  if (!collapsible) return contents;
  return <details className="panel-disclosure" open={open} onToggle={event => {
    const value = event.currentTarget.open; setOpen(value);
    if (storageKey) try { window.localStorage.setItem(`capability-panel:${storageKey}`, value ? 'open' : 'collapsed'); } catch { /* local preference is optional */ }
  }}>
    <summary>{title && <Heading id={headingID} className="panel-heading">{title}</Heading>}{summaryText && <small>{summaryText}</small>}</summary>{contents}
  </details>;
}
export function PageHeading({ title, actions, icon: Icon, help, description, compact }: {
  title: string; actions?: ReactNode; icon?: LucideIcon; help?: HelpTopic; description?: string; compact?: boolean;
}) {
  const page = settingsPageForTitle(title);
  const detail = description ?? page?.description;
  return <><header className="page-title" data-settings-page={page ? `${page.scope}/${page.id}` : undefined} data-settings-layout={page?.layout}>
    <div className="page-title-leading">
      {Icon && <span className="page-title-icon"><Icon size={21} strokeWidth={1.8} aria-hidden="true" /></span>}
      <div className="page-title-main">
        {page && !compact && <span className="settings-page-kind">{page.kind}</span>}
        <div className="page-title-name"><h1>{title}</h1></div>
        {detail && !compact && <p className="settings-page-description">{detail}</p>}
      </div>
    </div>
    {actions && <div className="page-title-actions">{actions}</div>}
  </header>{help && <div className="page-help"><HelpHint topic={help} /></div>}</>;
}
export function Field({ label, help, children }: { label: string; help?: HelpTopic; children: ReactNode }) {
  const labelID = useId();
  if (help) {
    const child = isValidElement(children) ? children as ReactElement<any> : null;
    const controlID = child?.props.id ?? `${labelID}-control`;
    return <div className="field">
      <span className="field-label"><label id={labelID} htmlFor={controlID}>{label}</label></span>
      {child ? cloneElement(child, { id: controlID, "aria-labelledby": labelID }) : children}
      <div className="field-help"><HelpHint topic={help} /></div>
    </div>;
  }
  return <label className="field"><span id={labelID}>{label}</span>
    {isValidElement(children) ? cloneElement(children as ReactElement<any>, { "aria-labelledby": labelID }) : children}
  </label>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({ icon: Icon, title, children, action }: { icon: any; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon size={28} aria-hidden="true" /></span>
    <h2>{title}</h2>{children && <div className="empty-description">{children}</div>}{action}</div>;
}
export function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <Panel className="stat"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</Panel>;
}
