// Adapted from EM Preset Studio's Echoflex controls. Kept independent of its
// audio/module runtime; native HTML behavior and accessibility are preserved.
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cloneElement, isValidElement, useId, type ReactElement } from "react";
export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "quiet";
}) {
  return <button className={`button ${variant} ${className}`} {...props} />;
}
export function Panel({
  title,
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & { title?: string }) {
  return (
    <section className={`panel ${className}`} {...props}>
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}
export function PageHeading({ title, description, actions }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return <header className="page-title">
    <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions}
  </header>;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const labelID = useId();
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
