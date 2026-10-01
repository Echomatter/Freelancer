import { HelpHint } from "./HelpHint";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import {
  AlertCircle,
  ArrowUpRight,
  ChevronUp,
  Clock3,
  Gauge,
  RefreshCw,
} from "lucide-react";
import { Button, Panel } from "./echoflex/Controls";
import {
  ProviderText,
  ProviderScope,
  providerAttributes,
  useColorAppearance,
} from "./ProviderColors";
import {
  availabilityView,
  observedLabel,
  resetLabel,
} from "../domain/availability.mjs";

import { compoundSegments } from "../domain/usage-meter.mjs";

type View = ReturnType<typeof availabilityView>;
type Provider = View["providers"][number];
type RefreshState = { pending: boolean; error: string };
type SummaryProps = {
  view: View;
  state: RefreshState;
  onRefresh: () => unknown;
  onManageProviders?: () => void;
};

function usageWarning(view: View, state: RefreshState) {
  if (state.error) return state.error;
  return view.providers.filter(p => p.kind === 'finite' && p.refreshFailed).map(p => `${p.name}: ${p.issue || 'Usage refresh failed'}`).join(' · ');
}

function absoluteTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function headline(view: View, state: RefreshState) {
  return state.pending && view.status === "unknown"
    ? "Checking…"
    : view.headline;
}

export function CompoundMeter({
  view,
  decorative = false,
}: {
  view: View;
  decorative?: boolean;
}) {
  const appearance = useColorAppearance();
  return (
    <span
      className="usage-compound"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={
        decorative ? undefined : `Estimated availability. ${view.description}`
      }
    >
      {view.plans.length ? (
        compoundSegments(view.plans).map((segment) => (
          <span
            key={`${segment.id}/${segment.portion}`}
            className={`usage-slice usage-slice-${segment.portion}${segment.portion === "unknown" ? " usage-unknown" : ""}`}
            data-portion={segment.portion}
            {...providerAttributes(segment.id, appearance)}
            style={{
              ...providerAttributes(segment.id, appearance).style,
              flexBasis: `${segment.width}%`,
            }}
          />
        ))
      ) : (
        <span
          className="usage-slice usage-no-quota"
          style={{ flexBasis: "100%" }}
        />
      )}
    </span>
  );
}

function NextReset({
  view,
  event = view.nextReset,
  provider = true,
}: {
  view: View;
  event?: View["nextReset"];
  provider?: boolean;
}) {
  if (!event) return <span className="usage-reset">Reset unknown</span>;
  return (
    <span className="usage-reset">
      <span>Next reset</span>
      <span className="usage-separator" aria-hidden="true">
        {" "}
        ·{" "}
      </span>
      {provider && (
        <>
          <ProviderText provider={event.provider}>{event.name}</ProviderText>
          <span aria-hidden="true"> · </span>
        </>
      )}
      <time dateTime={event.resetAt}>
        {resetLabel(event.resetAt, view.now)}
      </time>
    </span>
  );
}

export function UsageProviderRow({
  provider: p,
  view,
}: {
  provider: Provider;
  view: View;
}) {
  return (
    <ProviderScope provider={p.id} className="usage-provider-row">
      <div className="usage-provider-heading">
        <strong>
          <ProviderText provider={p.id} mark>
            {p.name}
          </ProviderText>
        </strong>
        <span className="usage-provider-value">{p.label}</span>
      </div>
      {p.kind === "finite" && (
        <span
          className={`usage-rail${p.remaining === null ? " usage-unknown" : ""}`}
          aria-hidden="true"
        >
          {p.remaining !== null && (
            <span className="usage-fill" style={{ width: `${p.remaining}%` }} />
          )}
        </span>
      )}
      <div className="usage-provider-meta">
        {p.kind === "free" ? (
          <small>Availability varies</small>
        ) : (
          <NextReset view={view} event={p.nextReset} provider={false} />
        )}
        {p.issue ? <small className="usage-warning">{p.issue}</small> : p.stale && <small>Not current</small>}
      </div>
    </ProviderScope>
  );
}

function RefreshButton({
  state,
  onRefresh,
}: Pick<SummaryProps, "state" | "onRefresh">) {
  return (
    <Button
      type="button"
      variant="quiet"
      className="usage-refresh"
      disabled={state.pending}
      onClick={() => onRefresh()}
      aria-label="Refresh usage"
    >
      <RefreshCw
        aria-hidden="true"
        size={16}
        className={state.pending ? "spin" : ""}
      />
      <span>
        {state.pending ? "Refreshing…" : state.error ? "Retry" : "Refresh"}
      </span>
    </Button>
  );
}

export function UsageSidebar({
  view,
  state,
  onRefresh,
  onOpen,
  onManageProviders,
}: SummaryProps & { onOpen: () => void }) {
  const [open, setOpen] = useState(false),
    id = useId(),
    button = useRef<HTMLButtonElement>(null),
    section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const compact = window.matchMedia("(max-width: 720px)").matches || section.current?.closest(".navigation-collapsed");
      if (compact && !section.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const value = headline(view, state);
  const refreshFailed = !!(state.error || view.refreshFailed);
  const warning = usageWarning(view, state);
  return (
    <section
      ref={section}
      className="usage usage-sidebar"
      aria-label="Available usage"
      data-expanded={open}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          !open ||
          event.defaultPrevented ||
          (event.target as HTMLElement).closest('[role="dialog"], dialog')
        )
          return;
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <div className="usage-breakout" id={id} hidden={!open}>
        <div className="usage-breakout-heading">
          <strong>Your providers</strong>
          <RefreshButton state={state} onRefresh={onRefresh} />
        </div>
        <div className="usage-breakout-rows">
          {view.providers.length ? (
            view.providers.map((p) => (
              <UsageProviderRow key={p.id} provider={p} view={view} />
            ))
          ) : (
            <small>
              {view.status === "loading"
                ? "Checking…"
                : "Connect a provider in Application settings"}
            </small>
          )}
        </div>
        {(state.error || view.refreshFailed) && (
          <small className="usage-warning">{warning}</small>
        )}
        {view.providers.some(p => p.needsReconnect) && onManageProviders && <Button variant="quiet" onClick={() => { setOpen(false); onManageProviders(); }}>Reconnect provider</Button>}
        <Button
          type="button"
          variant="quiet"
          className="usage-open"
          onClick={() => { setOpen(false); button.current?.focus(); onOpen(); }}
        >
          Open Available Usage
          <ArrowUpRight size={14} aria-hidden="true" />
        </Button>
      </div>
      <button
        ref={button}
        type="button"
        className="usage-disclosure"
        aria-controls={id}
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} provider availability. Estimated available: ${value}. ${view.nextReset ? `Next reset: ${view.nextReset.name}, ${resetLabel(view.nextReset.resetAt, view.now)}.` : "Reset unknown."}${warning ? ` ${warning}.` : ""}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="usage-summary-line">
          <span className="usage-label">Estimated available</span>
          <ChevronUp size={15} aria-hidden="true" className="usage-chevron" />
        </span>
        <span className="usage-compact-icon" aria-hidden="true">
          {refreshFailed ? <AlertCircle size={18} /> : <Gauge size={18} />}
        </span>
        <strong
          className={`usage-headline${view.remaining === null ? " usage-text-state" : ""}`}
        >
          {value}
        </strong>
        <CompoundMeter view={view} decorative />
        <span className="usage-sidebar-reset">
          <NextReset view={view} />
        </span>
        {(state.error || view.refreshFailed) && (
          <span className="usage-sidebar-warning">{state.error || 'Provider needs attention'}</span>
        )}
      </button>
    </section>
  );
}

export function UsageHero({ view, state, onRefresh, onManageProviders }: SummaryProps) {
  const value = headline(view, state);
  return (
    <Panel className="usage usage-hero" aria-label="Available Usage summary">
      <div className="usage-hero-top">
        <div className="usage-hero-value">
          <span className="usage-label">Estimated available</span>
          <strong
            className={`usage-headline${view.remaining === null ? " usage-text-state" : ""}`}
          >
            {value}
          </strong>
        </div>
        <div className="usage-hero-actions">
          <div>
            <Clock3 size={15} aria-hidden="true" />
            <NextReset view={view} />
          </div>
          <RefreshButton state={state} onRefresh={onRefresh} />
        </div>
      </div>
      <CompoundMeter view={view} />
      <div className="usage-legend">
        {view.providers.map((p) => (
          <span key={p.id}>
            <ProviderText provider={p.id} mark>
              {p.name}
            </ProviderText>
            <strong>{p.label}</strong>
          </span>
        ))}
      </div>
      <div className="usage-hero-footer">
        <small
          className={state.error || view.refreshFailed ? "usage-warning" : ""}
        >
          {state.pending
            ? "Refreshing…"
            : state.error || view.refreshFailed
              ? usageWarning(view, state)
              : view.status === "partial"
                ? "Partial data"
                : view.plans.some((p) => p.stale)
                  ? "Not current"
                  : observedLabel(view.asOf, view.now)}
        </small>
        {view.providers.some(p => p.needsReconnect) && onManageProviders && <Button variant="quiet" onClick={onManageProviders}>Reconnect provider</Button>}
        <HelpHint topic="usage-estimate" />
        <details className="usage-method">
          <summary>Observation details</summary>
          <div>
            {view.asOf && (
              <small>
                Oldest observation ·{" "}
                <time dateTime={view.asOf}>{absoluteTime(view.asOf)}</time>
              </small>
            )}
            {view.events.map((e) => (
              <div
                className="usage-event"
                key={`${e.provider}/${e.key}/${e.resetAt}`}
              >
                <ProviderText provider={e.provider}>{e.name}</ProviderText>
                <span>{e.window}</span>
                <time dateTime={e.resetAt}>{absoluteTime(e.resetAt)}</time>
              </div>
            ))}
          </div>
        </details>
      </div>
    </Panel>
  );
}

export function UsageProviders({ view }: { view: View }) {
  return (
    <div className="usage usage-providers">
      {view.providers.length ? (
        view.providers.map((p) => (
          <UsageProviderRow provider={p} key={p.id} view={view} />
        ))
      ) : (
        <small>Connect a provider in Application settings to check availability.</small>
      )}
    </div>
  );
}

export function UsagePreferences({ showDepletedModels = true, refresh }: {
  showDepletedModels?: boolean;
  refresh: () => Promise<unknown>;
}) {
  const [value, setValue] = useState(showDepletedModels),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const saving = useRef(false), description = useId();
  useEffect(() => { if (!saving.current) setValue(showDepletedModels); }, [showDepletedModels]);
  async function save(next: boolean) {
    if (saving.current) return;
    saving.current = true; setPending(true); setError(""); setSaved(false);
    try {
      // Keep the existing saved key: this preference controls model visibility,
      // while routing and native availability checks remain authoritative.
      const result = await api("appearance", { showDepletedModels: next }, "PUT");
      if (result?.saved !== true)
        throw Error("Model visibility was not confirmed. Please try again.");
      setValue(next); setSaved(true);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Model visibility could not be saved."); }
    finally { saving.current = false; setPending(false); }
  }
  return <Panel className="usage usage-preferences">
    <details>
      <summary>Model visibility</summary>
      <div className="usage-preferences-content">
        <label className="check">
          <input type="checkbox" checked={value} disabled={pending} aria-describedby={description}
            onChange={event => void save(event.target.checked)} />
          Show exhausted models in the workspace picker
        </label>
        <p id={description}>Keep models with exhausted usage visible in the workspace model picker. Availability checks still apply when choosing a model.</p>
        {(pending || saved) && <small role="status">{pending ? "Saving…" : "Model visibility saved."}</small>}
        {error && <p className="notice error" role="alert">{error}</p>}
      </div>
    </details>
  </Panel>;
}
