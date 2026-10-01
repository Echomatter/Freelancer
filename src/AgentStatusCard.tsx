import { ArrowUpRight, Bot, Check, CircleAlert, LoaderCircle } from "lucide-react";
import { activityLabel } from "../domain/activity.mjs";
import { ProviderText } from "./ProviderColors";
import { delegateChildSession, delegateModel, toolOutcomeStatus } from "../domain/chat-view.mjs";

export function agentActivityFromParts(parts: any[]) {
  const part = parts.at(-1), state = part?.state ?? {}, meta = state.metadata ?? {};
  let result: any = {};
  try { result = typeof state.output === "string" ? JSON.parse(state.output) : state.output ?? {}; } catch { /* Native output can be truncated. */ }
  if (!result || typeof result !== "object") result = {};
  const identity = [...parts].reverse().find(p => p.state?.metadata?.agentName || p.state?.input?.agent || p.state?.input?.agentID);
  const saved = identity?.state?.metadata?.freelancer_delegate_display ?? identity?.state?.metadata?.ai_toolkit_delegate_display;
  const outcome = toolOutcomeStatus(part);
  const delivery = meta.freelancer_status === "worker_handoff";
  return {
    child: parts.map(delegateChildSession).find(Boolean),
    agentName: meta.agentName ?? identity?.state?.metadata?.agentName ?? result.agent?.name ?? saved?.agent?.name ?? identity?.state?.input?.agent ?? identity?.state?.input?.agentID ?? state.input?.role ?? "Agent activity",
    selected: [...parts].reverse().map(delegateModel).find(Boolean),
    phase: delivery ? (outcome === "error" ? "Handoff needs inspection" : meta.delivery_included ? "Input included" : "Handoff saved") : meta.freelancer_status === "conflict" ? "Needs inspection" : ["no_qualified_route", "delegation_unavailable"].includes(meta.freelancer_status ?? result.status) ? meta.freelancer_status ?? result.status : outcome === "error" ? "failed" : outcome,
    label: state.error ?? result.reason ?? (!delegateChildSession(part) ? meta.freelancer_status === "catalog" ? "Inspect agent catalog" : meta.freelancer_status === "workers" ? "Inspect workers" : state.title : undefined),
    raw: result,
  };
}

export function AgentStatusCard({ activity, onChild, animate = true }: any) {
  const completed = activity.phase === "completed";
  const unavailable = ["no_qualified_route", "delegation_unavailable"].includes(activity.phase);
  const failed = unavailable || ["failed", "aborted", "timeout", "stop_unverified"].includes(activity.phase);
  const running = animate && !activity.stale && ["working", "running", "starting", "tool"].includes(activity.phase);
  const model = activity.observed ?? activity.selected;
  const name = activity.agentName ?? activity.agentID ?? activity.role ?? "Agent";
  const status = activityLabel(activity.phase);
  const elapsed = activity.elapsedMs ?? activity.raw?.activity?.elapsed_ms;
  const detail = [activity.tool ?? activity.raw?.activity?.tool, activity.subject ?? activity.raw?.activity?.subject].filter(Boolean).join(" · ");
  return (
    <button type="button" className={`agent-activity agent-card agent-status-card ${running ? "running" : ""}`}
      aria-label={`${name} · ${status}${activity.child ? " · Open conversation" : ""}`}
      disabled={!activity.child} onClick={() => activity.child && onChild(activity.child)}>
      <span className="agent-card-icon">
        {running ? <LoaderCircle size={24} className="spin" /> : failed ? <CircleAlert size={24} /> : <Bot size={24} />}
        {completed && <Check size={10} className="agent-check" />}
      </span>
      <span className="agent-card-copy">
        <strong>{name}</strong>
        <span className={`agent-status-label ${failed ? "failed" : ""}`}>{status}</span>
        {model && <small><ProviderText provider={model} mark>{model}</ProviderText></small>}
        {activity.label && <small>{activity.label}</small>}
        {detail && <small>{detail}</small>}
        {(activity.completedTools != null || elapsed != null) && <small>{activity.completedTools != null ? `${activity.completedTools} actions` : ""}{elapsed != null ? ` · ${Math.round(elapsed / 1000)}s` : ""}</small>}
        {activity.stale && <small>Waiting for a fresh activity update</small>}
        {unavailable && <small>No worker started. {activity.raw?.routing_diagnostics?.reasons?.slice(0, 3).join(", ") || "No model qualified under the current delegation settings."}</small>}
      </span>
      {activity.child && <ArrowUpRight size={16} className="activity-open-indicator" />}
    </button>
  );
}
