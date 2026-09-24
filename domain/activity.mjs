// A completed model lookup is part of the matching handoff, not a second
// helper stuck forever waiting for a selection. Keep unmatched lookups visible.
export function visibleActivity(rows) {
  return rows.filter(
    (row) =>
      row.phase !== "selection_required" ||
      !row.raw?.task_hash ||
      !rows.some(
        (other) =>
          other.child &&
          (other.agentID ?? other.role) === (row.agentID ?? row.role) &&
          (other.workflowID ?? "") === (row.workflowID ?? "") &&
          other.raw?.task_hash === row.raw.task_hash &&
          (other.raw?.user_task_id === row.raw.user_task_id ||
            (row.requestID && other.requestID === row.requestID)) &&
          Date.parse(other.raw.created_at) >= Date.parse(row.raw.created_at),
      ),
  );
}
export function activityLabel(phase) {
  return (
    {
      completed: "Finished",
      no_qualified_route: "Route unavailable",
      delegation_unavailable: "Route unavailable",
      selection_required: "Choosing a model",
      running: "Working",
      working: "Working",
      tool: "Working",
      waiting: "Waiting",
      waiting_input: "Needs input",
      awaiting_paid_permission: "Needs your approval",
      failed: "Stopped",
      cancelled: "Cancelled",
    }[phase] ?? String(phase ?? "Waiting").replaceAll("_", " ")
  );
}
