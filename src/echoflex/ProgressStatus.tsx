import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Controls';
import './progress-status.css';

export type ProgressState = 'running' | 'waiting' | 'success' | 'warning' | 'error' | 'stopped';
export type ProgressAction = { label: string; onClick: () => void; disabled?: boolean };

// Presentation only: callers own job identity, cancellation and persistence.
// Omit value when work cannot be measured; never animate a made-up percentage.
export function ProgressStatus({ label, state = 'running', value, detail, action, onDismiss,
  dismissLabel = 'Dismiss status', disabled = false, className = '' }: {
  label: string; state?: ProgressState; value?: number; detail?: ReactNode;
  action?: ProgressAction; onDismiss?: () => void; dismissLabel?: string;
  disabled?: boolean; className?: string;
}) {
  const percent = value === undefined || !Number.isFinite(value) ? undefined : Math.min(100, Math.max(0, value));
  return <section className={`ef-progress ${className}`} data-state={state} aria-label={label}>
    <div className="ef-progress-row">
      <span className="ef-progress-label" role="status" aria-live="polite">{label}</span>
      <div className="ef-progress-actions">
        {action && <Button type="button" variant="quiet" disabled={disabled || action.disabled} onClick={action.onClick}>{action.label}</Button>}
        {onDismiss && <button type="button" className="icon-button" aria-label={dismissLabel} title={dismissLabel}
          disabled={disabled} onClick={onDismiss}><X size={15} /></button>}
      </div>
    </div>
    <div className="ef-progress-track" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      aria-valuetext={label} data-indeterminate={percent === undefined && state === 'running'}>
      <span style={{ width: `${percent ?? (state === 'running' ? 34 : 100)}%` }} />
    </div>
    {detail && <div className="ef-progress-detail">{detail}</div>}
  </section>;
}
