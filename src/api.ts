import { createEventInvalidator } from "./live-events.mjs";

export async function api(
  route: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  signal?: AbortSignal,
) {
  // A stalled read must release its caller's loading/single-flight guard.
  // Mutations retain their existing uncertain-delivery semantics.
  const readTimeout = method === 'GET' ? AbortSignal.timeout(30_000) : undefined;
  const requestSignal = readTimeout ? signal ? AbortSignal.any([signal, readTimeout]) : readTimeout : signal;
  try {
    const response = await fetch("/api/" + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Freelancer-Client": "webpage",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestSignal,
    });
    const value = await response.json();
    if (!response.ok)
      throw Object.assign(Error(value.error || "Could not complete that action"), {
        status: response.status,
        code: typeof value.code === "string" ? value.code : "REQUEST_FAILED",
      });
    return value;
  } catch (error) {
    if (readTimeout?.aborted && !signal?.aborted)
      throw Error('Loading took too long. Try Refresh; running work has not been stopped.');
    throw error;
  }
}
export const query = (project?: string, session?: string) =>
  new URLSearchParams({
    ...(project ? { project } : {}),
    ...(session ? { session } : {}),
  }).toString();
export async function subscribe(
  project: string,
  onChange: (events: any[]) => void,
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
      const decoder = new TextDecoder();
      const invalidate = createEventInvalidator(onChange);
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          invalidate(decoder.decode(value, { stream: true }));
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch {
      if (signal.aborted) return;
    }
    if (signal.aborted) return;
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
