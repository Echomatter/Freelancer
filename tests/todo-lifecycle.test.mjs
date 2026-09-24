import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { visibleTodosForRequest } from "../domain/todos.mjs";

const user = (id) => ({ info: { id, role: "user" }, parts: [] });
const write = (id) => ({
  info: { id, role: "assistant" },
  parts: [{ id: id + "-todo", type: "tool", tool: "todowrite" }],
});
const done = [
  { id: "a", content: "A", status: "completed" },
  { id: "b", content: "B", status: "completed" },
];

test("completed todo set remains visible until a later user request arrives", () => {
  assert.equal(visibleTodosForRequest(done, [user("u1"), write("a1")]), done);
  assert.deepEqual(
    visibleTodosForRequest(done, [user("u1"), write("a1"), user("u2")]),
    [],
  );
});

test("new native todo write makes the next request's list visible again", () => {
  const next = [{ id: "c", content: "C", status: "in_progress" }];
  assert.equal(
    visibleTodosForRequest(next, [
      user("u1"),
      write("a1"),
      user("u2"),
      write("a2"),
    ]),
    next,
  );
});

test("unfinished old work is never cleared by a new request", () => {
  const unfinished = [
    { id: "a", content: "A", status: "completed" },
    { id: "b", content: "B", status: "pending" },
  ];
  assert.equal(
    visibleTodosForRequest(unfinished, [user("u1"), write("a1"), user("u2")]),
    unfinished,
  );
});

test("cancelled items are terminal and missing history is not guessed", () => {
  const terminal = [
    { id: "a", content: "A", status: "completed" },
    { id: "b", content: "B", status: "cancelled" },
  ];
  assert.deepEqual(
    visibleTodosForRequest(terminal, [user("u1"), write("a1"), user("u2")]),
    [],
  );
  assert.equal(visibleTodosForRequest(terminal, [user("u2")]), terminal);
});

test("chat response applies todo rollover without a second todo store", async () => {
  const source = await readFile(new URL("../server/application.mjs", import.meta.url), "utf8");
  assert.match(source, /visibleTodosForRequest\(todos, rows\)/);
  assert.doesNotMatch(source, /todoSuppression|hiddenTodos|staleTodos/);
});
