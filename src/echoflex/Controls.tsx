// Adapted from EM Preset Studio's Echoflex controls. Kept independent of its
// audio/module runtime; native HTML behavior and accessibility are preserved.
import { X } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cloneElement, isValidElement, useId, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { HelpHint } from "../HelpHint";
import type { HelpTopic } from "../documentation-help";
export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "quiet";
}) {
  return <button className={`button ${variant} ${className}`} {...props} />;
}
export function PageCloseButton({ onClick, label = "Close settings", disabled = false }: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return <Button type="button" className="page-close-button" variant="quiet" aria-label={label} title={label} disabled={disabled} onClick={onClick}><X size={18} /></Button>;
}

export function Panel({
  title,
  help,
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & { title?: string; help?: HelpTopic }) {
  return (
    <section className={`panel ${className}`} {...props}>
      {title && <h3 aria-label={help ? title : undefined}>{title}{help && <HelpHint topic={help} />}</h3>}
      {children}
    </section>
  );
}
export function PageHeading({ title, actions, icon: Icon, help }: {
  title: string;
  actions?: ReactNode;
  icon?: LucideIcon;
  help?: HelpTopic;
}) {
  return <header className="page-title">
    <div className="page-title-leading">
      {Icon && <span className="page-title-icon"><Icon size={21} strokeWidth={1.8} aria-hidden="true" /></span>}
      <div className="page-title-main"><div className="page-title-name"><h1>{title}</h1>{help && <HelpHint topic={help} />}</div></div>
    </div>
    {actions && <div className="page-title-actions">{actions}</div>}
  </header>;
}
export function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: HelpTopic;
  children: ReactNode;
}) {
  const labelID = useId();
  if (help) {
    const child = isValidElement(children) ? children as ReactElement<any> : null;
    const controlID = child?.props.id ?? `${labelID}-control`;
    return <div className="field">
      <span className="field-label"><label id={labelID} htmlFor={controlID}>{label}</label><HelpHint topic={help} /></span>
      {child ? cloneElement(child, { id: controlID, "aria-labelledby": labelID }) : children}
    </div>;
  }
  return (
    <label className="field">
      <span id={labelID}>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<any>, {
            "aria-labelledby": labelID,
          })
        : children}
    </label>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: any;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={28} />
      </span>
      <h2>{title}</h2>
      {children && <div className="empty-description">{children}</div>}
      {action}
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <Panel className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </Panel>
  );
}
