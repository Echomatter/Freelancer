import { useEffect, useState } from "react";
import { CircleHelp, LoaderCircle, MessageSquare } from "lucide-react";
import { api, query } from "./api";
import { activityLabel, pollActivity } from "../domain/chat-activity.mjs";
import "./workspace-feedback.css";
import { shareSnapshot } from './snapshot-sharing.mjs';

type Activity = { active: boolean; retry: boolean; waiting: boolean; delegated: boolean };
type Snapshot = { project: string; sessions: Record<string, Activity> };

export function useProjectActivity(project: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useEffect(() => {
    setSnapshot(null);
    if (!project || !enabled) return;
    let stop: (() => void) | undefined;
    const start = () => { stop?.(); stop = undefined; if (!document.hidden) stop = pollActivity(
      (signal: AbortSignal) => api("activity?" + query(project), undefined, "GET", signal),
      (next: Snapshot | null) => setSnapshot(previous => shareSnapshot(previous, next?.project === project ? next : null)),
    ); };
    start();
    document.addEventListener('visibilitychange', start);
    return () => { stop?.(); document.removeEventListener('visibilitychange', start); };
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
