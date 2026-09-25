// A completed model lookup is part of the matching handoff, not a second
// helper stuck forever waiting for a selection. Keep unmatched lookups visible.
export function visibleActivity(rows) {
  const filtered = rows.filter(
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
  const byChild = new Map();
  const visible = [];
  for (const row of filtered) {
    if (!row.child) { visible.push(row); continue; }
    const previous = byChild.get(row.child);
    if (!previous) { byChild.set(row.child, row); continue; }
    const time = (value) => Date.parse(value.updatedAt ?? value.raw?.updated_at ?? value.raw?.created_at) || 0;
    const newer = time(row) >= time(previous) ? row : previous;
    const older = newer === row ? previous : row;
    byChild.set(row.child, {
      ...newer,
      selected: newer.selected ?? older.selected,
      observed: newer.observed ?? older.observed,
      dispatched: newer.dispatched ?? older.dispatched,
    });
  }
  return [...visible, ...byChild.values()];
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
