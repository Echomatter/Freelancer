import { ArrowUpRight, Bot, Cpu, Target, Terminal } from "lucide-react";
import { turnTools } from "../domain/chat-tools.mjs";

export function ChatActivityMarks({
  request,
  index,
  summary,
  busy,
  events,
  hasGoal,
  selectWork,
}: any) {
  const details = turnTools(request);
  const sections = [
    {
      id: "commands",
      label: "Commands",
      icon: Terminal,
      count: details.commands.length,
      show: details.commands.length > 0 || busy,
    },
    {
      id: "agents",
      label: "Agents",
      icon: Bot,
      count: details.agentTools.length + details.agentMessages.length,
    },
    {
      id: "models",
      label: "Models",
      icon: Cpu,
      count:
        details.models.length +
        events.filter((event) => event.kind === "model").length,
    },
    {
      id: "goals",
      label: "Goals",
      icon: Target,
      count: hasGoal ? details.goalMessages.length + events.length : 0,
    },
  ].filter((section) => section.show || section.count);
  if (!sections.length) return null;
  return (
    <div
      className="turn-activity-marks"
      aria-label={`Turn ${index + 1} activity`}
    >
      <small>Turn {index + 1}</small>
      {sections.map(({ id, label, icon: Icon, count }) => (
        <button
          key={id}
          type="button"
          className="request-marker activity-mark"
          data-request-work-key={id === "commands" ? request.key : undefined}
          aria-label={`Open ${id === "commands" ? "tools" : id} for turn ${index + 1}`}
          aria-controls="chat-tool-dock"
          onClick={() => selectWork(request.key, id)}
        >
          <Icon size={13} aria-hidden="true" />
          <span>{label}</span>
          <small>{count}</small>
          <ArrowUpRight size={11} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
