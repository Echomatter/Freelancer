// Missing legacy settings get the new default; explicit inline choices survive.
export const defaultTodoLayout = "docked";
export function resolveTodoLayout(appearance) {
  return appearance?.todoLayout === "inline" ? "inline" : defaultTodoLayout;
}

// A successful save is applied immediately to the live workspace. The caller
// invalidates older bootstrap requests before applying this update.
export function applyTodoLayout(data, todoLayout) {
  if (!["docked", "inline"].includes(todoLayout)) throw Error("Choose todo placement");
  if (!data) return data;
  return { ...data, settings: {
    ...data.settings,
    appearance: { ...data.settings?.appearance, todoLayout },
  } };
}

export async function persistTodoLayout(todoLayout, write, apply) {
  if (!["docked", "inline"].includes(todoLayout)) throw Error("Choose todo placement");
  const result = await write({ todoLayout });
  if (result?.saved !== true)
    throw Error("Todo placement was not saved. Restart Freelancer and try again.");
  await apply(todoLayout);
}
