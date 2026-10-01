import { Target } from "lucide-react";
import { GoalHeader } from "./Goals";
import { ProviderText } from "./ProviderColors";

export function GoalOverview({ goal, onManage, onChange }: any) {
  return <div className="goal-overview" data-status={goal.status}>
    <GoalHeader goal={goal} onManage={onManage} onChange={onChange} />
    {goal.reason && <p className="goal-state-note" role="status"><Target size={16} aria-hidden="true" /><span>{goal.reason}</span></p>}
    <div className="goal-overview-meta"><span>Revision {goal.revision}</span><span>{goal.agentID}</span>{goal.model && <ProviderText provider={goal.model} mark>{goal.model}</ProviderText>}</div>
    <details className="goal-overview-detail"><summary>Objective</summary><div className="goal-long-text" tabIndex={0} role="region" aria-label="Goal objective">{goal.objective}</div></details>
    {goal.checkpoint && <details className="goal-overview-detail"><summary>Latest checkpoint and evidence</summary><div className="goal-long-text" tabIndex={0} role="region" aria-label="Goal checkpoint"><p>{goal.checkpoint.interpretation}</p><p>{goal.checkpoint.checkpoint}</p><pre>{goal.checkpoint.evidence}</pre></div></details>}
  </div>;
}
