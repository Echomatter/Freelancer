import { agentTurnEntries } from "../domain/chat-tools.mjs";
import { AgentStatusCard, agentActivityFromParts } from "./AgentStatusCard";

export function AgentTurnView({ details, onChild, current, scope = "turn" }: any) {
  const { entries } = agentTurnEntries(details);
  return (
    <div className="agent-status-grid" data-historical={!current}>
      {entries.map((entry: any) => {
        const fromParts = agentActivityFromParts(entry.parts);
        const live = entry.activity;
        // Native session activity may be present before its corresponding
        // tool transcript has been reconciled. Keep live status/recency while
        // filling missing identity, route and child navigation from that
        // same turn's native delegate tool part.
        const activity = live ? {
          ...fromParts, ...live,
          agentID: live.agentID ?? fromParts.agentID,
          agentName: live.agentName && live.agentName !== 'Agent activity' && live.agentName !== 'unknown' ? live.agentName : fromParts.agentName,
          selected: live.selected ?? fromParts.selected,
          observed: live.observed ?? fromParts.observed,
          child: live.child ?? fromParts.child,
          label: live.label ?? fromParts.label,
          completedTools: live.completedTools ?? fromParts.completedTools,
          elapsedMs: live.elapsedMs ?? fromParts.elapsedMs,
          tool: live.tool ?? fromParts.tool,
          subject: live.subject ?? fromParts.subject,
          phase: !live.phase || live.phase === 'unknown' ? fromParts.phase : live.phase,
        } : fromParts;
        return <section className="agent-turn-entry" key={entry.key} aria-label={`Agent activity for this ${scope}`}>
          <AgentStatusCard activity={activity} onChild={onChild} animate={current} />
          {live && entry.parts.filter((part: any) => part.state?.metadata?.freelancer_status === "conflict" || part.state?.error).map((part: any, index: number) => (
            <p className="notice" key={part.id ?? index}>{agentActivityFromParts([part]).label ?? "Handoff needs inspection"}</p>
          ))}
        </section>;
      })}
      {!entries.length && <p>No delegated agents for this {scope}.</p>}
    </div>
  );
}
