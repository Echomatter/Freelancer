const terminal = new Set(["completed", "cancelled"]);

export function hasUnfinishedTodos(todos = []) {
  return todos.some((todo) => !terminal.has(todo?.status));
}

// Native task state is retained; an idle session is not still executing it.
export function todoStatusLabel(todo, active = false) {
  if (todo?.status === "in_progress" && !active) return "unfinished";
  return String(todo?.status ?? "pending").replaceAll("_", " ");
}

function hasTodoWrite(message) {
  return (message?.parts ?? []).some(
    (part) => part?.type === "tool" && part.tool === "todowrite",
  );
}

export function visibleTodosForRequest(todos = [], messages = []) {
  if (!Array.isArray(todos) || !todos.length) return [];
  if (!todos.every((todo) => terminal.has(todo?.status))) return todos;

  let lastUser = -1;
  let lastTodoWrite = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.info?.role === "user") lastUser = i;
    if (hasTodoWrite(messages[i])) lastTodoWrite = i;
  }

  // A completed set belongs to the request whose latest todowrite created it.
  // Once another user request starts, hide that finished set until the native
  // agent writes a new todo list. We do not create a second todo store.
  return lastTodoWrite >= 0 && lastUser > lastTodoWrite ? [] : todos;
}
