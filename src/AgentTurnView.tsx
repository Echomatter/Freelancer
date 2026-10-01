import { agentTurnEntries } from "../domain/chat-tools.mjs";
import { delegateChildSession } from "../domain/chat-view.mjs";
import { AgentStatusCard, agentActivityFromParts } from "./AgentStatusCard";

export function AgentTurnView({ details, onChild, current }: any) {
  const { entries } = agentTurnEntries(details);
  return (
    <div className="agent-status-grid" data-historical={!current}>
      {entries.map((entry: any) => (
        <section className="agent-turn-entry" key={entry.key} aria-label="Agent activity for this turn">
          <AgentStatusCard activity={entry.activity ?? agentActivityFromParts(entry.parts)} onChild={onChild} animate={current} />
          {entry.activity && entry.parts.filter((part: any) => part.state?.metadata?.freelancer_status === "conflict" || part.state?.error).map((part: any, index: number) => (
            <p className="notice" key={part.id ?? index}>{agentActivityFromParts([part]).label ?? "Handoff needs inspection"}</p>
          ))}
          {(entry.activity?.child || entry.parts.some(delegateChildSession)) && (
            <small className="agent-chat-hint">Open the agent chat for handoffs and reports.</small>
          )}
        </section>
      ))}
      {!entries.length && <p>No delegated agents for this turn.</p>}
    </div>
  );
}
