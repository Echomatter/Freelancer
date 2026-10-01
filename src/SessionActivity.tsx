import { useEffect, useState } from "react";
import { Target, CircleHelp, LoaderCircle, MessageSquare } from "lucide-react";
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

export function SessionActivity({ activity, goal }: { activity?: Activity; goal?: any }) {
  const label = activityLabel(activity);
  const Icon = activity?.active ? LoaderCircle
    : !activity || activity.waiting ? CircleHelp : MessageSquare;
  return (
    goal ? <span className="session-activity" role="img" aria-label={`Goal · ${goal.status} · ${label}`} title={`Goal · ${goal.status} · ${label}`}><Target size={14} />{(activity?.active || activity?.waiting) && <span aria-hidden="true">{activity.waiting ? '!' : '·'}</span>}</span> :
    <span className="session-activity" role="img" aria-label={label} title={label}>
      <Icon size={14} aria-hidden="true"
        className={activity?.active ? "session-progress spin" : ""} />
    </span>
  );
}
