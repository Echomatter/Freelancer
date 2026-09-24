import { useEffect, useState } from "react";
import { CircleHelp, LoaderCircle, MessageSquare } from "lucide-react";
import { api, query } from "./api";
import { activityLabel, pollActivity } from "../domain/chat-activity.mjs";
import "./workspace-feedback.css";

type Activity = { active: boolean; retry: boolean; waiting: boolean; delegated: boolean };
type Snapshot = { project: string; sessions: Record<string, Activity> };

export function useProjectActivity(project: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    setSnapshot(null);
    if (!project || !enabled) return;
    return pollActivity(
      (signal: AbortSignal) => api("activity?" + query(project), undefined, "GET", signal),
      (next: Snapshot | null) => setSnapshot(next?.project === project ? next : null),
    );
  }, [project, enabled]);
  return enabled && snapshot?.project === project ? snapshot.sessions : undefined;
}

export function SessionActivity({ activity }: { activity?: Activity }) {
  const label = activityLabel(activity);
  const Icon = activity?.active ? LoaderCircle
    : !activity || activity.waiting ? CircleHelp : MessageSquare;
  return (
    <span className="session-activity" role="img" aria-label={label} title={label}>
      <Icon size={14} aria-hidden="true"
        className={activity?.active ? "session-progress spin" : ""} />
    </span>
  );
}
