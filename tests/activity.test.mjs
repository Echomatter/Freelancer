import test from "node:test";
import assert from "node:assert/strict";
import { visibleActivity, activityLabel } from "../domain/activity.mjs";

test("routing failures have a clear activity label", () => {
  assert.equal(activityLabel("no_qualified_route"), "Route unavailable");
  assert.equal(activityLabel("delegation_unavailable"), "Route unavailable");
});
test("only a matching executed handoff resolves an earlier model lookup", () => {
  const base = {
    role: "researcher",
    raw: {
      task_hash: "one",
      user_task_id: "work",
      created_at: "2026-09-20T00:00:00Z",
    },
  };
  const lookup = { ...base, id: "lookup", phase: "selection_required" },
    unrelated = {
      ...lookup,
      id: "other",
      raw: { ...base.raw, task_hash: "two" },
    };
  const executed = {
    ...base,
    id: "child",
    phase: "completed",
    child: "ses_child",
  };
  assert.deepEqual(
    visibleActivity([lookup, unrelated, executed]).map((a) => a.id),
    ["other", "child"],
  );
  assert.deepEqual(
    visibleActivity([lookup]).map((a) => a.id),
    ["lookup"],
  );
});

test("selection and execution in different assistant messages reconcile only within the same user request", () => {
  const lookup = {
    id: "lookup",
    role: "researcher",
    phase: "selection_required",
    requestID: "msg_request",
    raw: {
      task_hash: "same",
      user_task_id: "session/msg_select",
      created_at: "2026-09-20T00:00:00Z",
    },
  };
  const child = {
    ...lookup,
    id: "executed",
    phase: "completed",
    child: "ses_child",
    raw: {
      ...lookup.raw,
      user_task_id: "session/msg_execute",
      created_at: "2026-09-20T00:00:10Z",
    },
  };
  assert.deepEqual(
    visibleActivity([lookup, child]).map((r) => r.id),
    ["executed"],
  );
  assert.deepEqual(
    visibleActivity([lookup, { ...child, requestID: "msg_other" }]).map(
      (r) => r.id,
    ),
    ["lookup", "executed"],
  );
});
