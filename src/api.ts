export async function api(
  route: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  signal?: AbortSignal,
) {
  const response = await fetch("/api/" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Freelancer-Client": "webpage",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(Error(value.error || "Could not complete that action"), {
      status: response.status,
      code: typeof value.code === "string" ? value.code : "REQUEST_FAILED",
    });
  return value;
}
export const query = (project?: string, session?: string) =>
  new URLSearchParams({
    ...(project ? { project } : {}),
    ...(session ? { session } : {}),
  }).toString();
export async function subscribe(
  project: string,
  onChange: () => void,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    try {
      const response = await fetch("/api/events?" + query(project), {
        headers: { "X-Freelancer-Client": "webpage" },
        signal,
      });
      if (!response.ok || !response.body) throw Error("Connection interrupted");
      const reader = response.body.getReader();
      while (!signal.aborted) {
        const { done } = await reader.read();
        if (done) break;
        onChange();
      }
    } catch {
      if (signal.aborted) return;
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timeout = setTimeout(done, 2000);
      signal.addEventListener("abort", done, { once: true });
    });
  }
}
