import { Target, ChevronDown } from "lucide-react";

export function GoalHandoffs({ events = [] }: { events?: any[] }) {
  return (
    <>
      {events.map((event, index) => (
        <details
          className="handoff-card goal-handoff"
          key={`${event.at}:${index}`}
        >
          <summary>
            <Target size={15} />
            <span>
              {event.kind === "model" ? "Model handoff" : `Goal ${event.kind}`}
            </span>
            <small>
              {new Date(event.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
            <ChevronDown size={14} />
          </summary>
          <p>{event.detail}</p>
        </details>
      ))}
    </>
  );
}
