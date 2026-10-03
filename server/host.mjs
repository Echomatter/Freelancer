import { nativeDataTools } from "./native-data.mjs";
import { spawn, execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
const exec = promisify(execFile);

const readinessLimit = 75000;
const timedOut = message => new DOMException(message, 'TimeoutError');
const interrupted = message => new DOMException(message, 'AbortError');
function timeoutValue(value) {
  if (!Number.isInteger(value) || value < 1 || value > readinessLimit)
    throw Error(`OpenCode initialization timeout must be between 1 and ${readinessLimit} milliseconds.`);
  return value;
}
function waitForSignal(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? interrupted('OpenCode initialization was cancelled.'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}
function waitForReadiness(work, signal, timeoutMs) {
  const caller = new AbortController();
  const abort = () => caller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => caller.abort(timedOut('OpenCode initialization timed out. Retry initialization.')), timeoutMs);
  return waitForSignal(work, caller.signal).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  });
}
const directoryKey = directory => directory === undefined ? 'native-default'
  : process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory);

export function hostEnvironment(config, env = process.env) {
  const childEnv = { ...env };
  if (!config) return childEnv;
  childEnv.FREELANCER_RUNTIME_ROOT = config.backendRoot;
  childEnv.FREELANCER_DATA_HOME = config.dataRoot;
  childEnv.FREELANCER_RUNTIME_DATA_MODE = "unified";
  childEnv.FREELANCER_RUNTIME_ID = config.runtimeID ?? "freelancer-workspace-v2";
  let nativeContent = {};
  if (env.OPENCODE_CONFIG_CONTENT) {
    try { nativeContent = JSON.parse(env.OPENCODE_CONFIG_CONTENT); }
    catch (error) { throw Error('OpenCode OPENCODE_CONFIG_CONTENT must be valid JSON before Freelancer can add its plugin layer.', { cause:error }); }
    if (!nativeContent || typeof nativeContent !== 'object' || Array.isArray(nativeContent))
      throw Error('OpenCode OPENCODE_CONFIG_CONTENT must contain a JSON object.');
  }
  const pluginNames = config.opencodePlugins ?? ['delegation', 'git-project', 'goals', 'content-index', 'knowledge'];
  const plugins = pluginNames.map(name => pathToFileURL(path.join(config.backendRoot, 'opencode', 'plugins', `${name}.ts`)).href);
  const instructions = config.instructions ?? [
    path.join(config.backendRoot, 'global', 'WORKSTYLE.md'),
    path.join(config.backendRoot, 'opencode', 'global-instructions.md'),
  ];
  const append = (current, additions) => {
    const rows = current === undefined ? [] : Array.isArray(current) ? current : [current];
    const seen = new Set(rows.map(value => JSON.stringify(value)));
    return [...rows, ...additions.filter(value => {
      const key = JSON.stringify(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })];
  };
  childEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    ...nativeContent,
    plugin: append(nativeContent.plugin, plugins),
    instructions: append(nativeContent.instructions, instructions),
  });
  return childEnv;
}

export function createHost({ url, password = "", fetchImpl = fetch, diagnostics, defaultDirectory }) {
  const origin = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
    throw Error("OpenCode must run locally");
  const pending = new Map(), disposals = new Map();
  let closed = false;
  const report = event => { try { diagnostics?.(event); } catch {} };
  const invalidate = key => {
    for (const [scope, observation] of pending) if (key === null || scope === key) {
      pending.delete(scope);
      observation.controller.abort(interrupted('OpenCode initialization was interrupted by shutdown or configuration refresh.'));
    }
  };
  const client = {
    async ensureReady({ directory = defaultDirectory, signal, timeoutMs = 60000 } = {}) {
      timeoutValue(timeoutMs);
      signal?.throwIfAborted();
      if (closed) throw interrupted('OpenCode is closing. Restart before initializing a workspace.');
      if (directory !== undefined && (typeof directory !== 'string' || !path.isAbsolute(directory)))
        throw Error('OpenCode initialization requires an absolute project directory.');
      const key = directoryKey(directory);
      if (disposals.has(null) || disposals.has(key))
        throw interrupted('OpenCode configuration is refreshing. Retry initialization when it finishes.');
      let observation = pending.get(key);
      if (!observation || observation.controller.signal.aborted) {
        const controller = new AbortController(), startedAt = Date.now();
        observation = { controller, startedAt, deadline: 0, timer: undefined, work: undefined };
        pending.set(key, observation);
        const current = observation;
        report({ stage: 'readiness-started', directory, timeoutMs });
        current.work = (async () => {
          const ids = await waitForSignal(client.request('/experimental/tool/ids', { directory, signal: controller.signal }), controller.signal);
          controller.signal.throwIfAborted();
          if (pending.get(key) !== current) throw interrupted('OpenCode initialization was superseded. Retry initialization.');
          if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))
            throw Error('OpenCode tool inventory returned an unsupported response shape. Retry initialization.');
          report({ stage: 'readiness-observed', directory, toolCount: ids.length });
          return ids;
        })().finally(() => {
          clearTimeout(current.timer);
          if (pending.get(key) === current) pending.delete(key);
        });
        // Caller cancellation detaches only that waiter. Shutdown/configuration
        // refresh abort the shared observation, including uncooperative adapters.
        current.work.catch(error => report({ stage: 'readiness-failed', directory, error: error.name }));
      }
      // A longer joined waiter may extend the shared read, but no observation
      // outlives its original bounded window. Each caller retains its own limit.
      const deadline = Math.min(observation.startedAt + readinessLimit, Date.now() + timeoutMs);
      if (deadline > observation.deadline) {
        observation.deadline = deadline;
        clearTimeout(observation.timer);
        observation.timer = setTimeout(() => observation.controller.abort(timedOut('OpenCode initialization timed out. Retry initialization.')),
          Math.max(1, deadline - Date.now()));
      }
      return waitForReadiness(observation.work, signal, timeoutMs).then(ids => [...ids]);
    },
    async closePending() {
      closed = true;
      const work = [...pending.values()].map(observation => observation.work);
      invalidate(null);
      await Promise.allSettled(work);
    },
    async request(route, { method = "GET", directory, body, signal, responseMetadata = false } = {}) {
      if (!route.startsWith("/") || route.startsWith("//"))
        throw Error("Invalid host route");
      const target = new URL(route, origin);
      if (directory) target.searchParams.set("directory", directory);
      const disposal = method.toUpperCase() === 'POST' && ['/global/dispose', '/instance/dispose'].includes(target.pathname);
      const scope = target.pathname === '/global/dispose' ? null : directoryKey(target.searchParams.get('directory') ?? defaultDirectory);
      if (disposal) { disposals.set(scope, (disposals.get(scope) ?? 0) + 1); invalidate(scope); }
      try {
      const requestedAt = Date.now();
      report({ stage: 'request-started', route, method });
      let response;
      try { response = await fetchImpl(target, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(password
            ? {
                Authorization:
                  "Basic " +
                  Buffer.from("opencode:" + password).toString("base64"),
              }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(90000),
      }); } catch (error) {
        report({ stage: 'request-failed', route, method, durationMs: Date.now() - requestedAt, error: error.name });
        throw error;
      }
      report({ stage: 'request-responded', route, method, durationMs: Date.now() - requestedAt, status: response.status });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const detail =
          (typeof payload?.error === "string" && payload.error) ||
          (typeof payload?.error?.message === "string" &&
            payload.error.message) ||
          (typeof payload?.errors?.[0]?.message === "string" &&
            payload.errors[0].message) ||
          (typeof payload?.message === "string" && payload.message);
        const message =
          typeof detail === "string" && detail.trim()
            ? detail.trim().slice(0, 500)
            : `OpenCode request failed (${response.status})`;
        const error = new Error(message);
        error.status = response.status;
        error.code = `OPENCODE_HTTP_${response.status}`;
        throw error;
      }
      const payload = response.status === 204 ? null : await response.json();
      return responseMetadata ? { body: payload, metadata: { 'x-next-cursor': response.headers.get('x-next-cursor') } } : payload;
      } finally {
        if (disposal) {
          invalidate(scope);
          const remaining = disposals.get(scope) - 1;
          if (remaining) disposals.set(scope, remaining); else disposals.delete(scope);
        }
      }
    },
    async events(directory, signal) {
      const target = new URL("/event", origin);
      target.searchParams.set("directory", directory);
      const response = await fetchImpl(target, {
        headers: password
          ? {
              Authorization:
                "Basic " +
                Buffer.from("opencode:" + password).toString("base64"),
            }
          : {},
        signal,
      });
      if (!response.ok || !response.body)
        throw Error("Cannot connect to live updates");
      return response.body;
    },
  };
  return client;
}

/**
 * Start the local OpenCode server.
 *
 * @param {object} opts
 * @param {string} opts.backendRoot  - Resolved backend directory (FREELANCER_RUNTIME_ROOT).
 * @param {object} [opts.config]     - Runtime config from runtime-config.mjs. When
 *                                     supplied, Freelancer plugin and instruction
 *                                     paths are layered over the user's native config.
 * @param {string} [opts.executable] - Explicit OpenCode binary path. When omitted
 *                                     the system-installed native OpenCode is located.
 */
export async function startHost({ backendRoot, config, executable, env = process.env, diagnostics,
  startupTimeoutMs = readinessLimit, waitForReady = true,
  spawnImpl = spawn, execImpl = exec, accessImpl = access, fetchImpl = fetch }) {
  timeoutValue(startupTimeoutMs);
  const started = Date.now();
  const startupDeadline = started + startupTimeoutMs;
  const startup = new AbortController();
  const startupTimer = setTimeout(() => startup.abort(timedOut('OpenCode initialization timed out. Retry initialization.')), startupTimeoutMs);
  const remainingStartupMs = () => {
    startup.signal.throwIfAborted();
    const remaining = startupDeadline - Date.now();
    if (remaining < 1) throw timedOut('OpenCode initialization timed out. Retry initialization.');
    return remaining;
  };
  const report = event => {
    if (typeof diagnostics !== 'function') return;
    try { diagnostics({ ...event, elapsedMs: Date.now() - started }); } catch {}
  };
  let child, client, closed = false, closing, childClosed;
  const close = () => closing ??= (async () => {
    await client?.closePending();
    if (!child || closed) return;
    const cleanup = new AbortController();
    const timeout = setTimeout(() => cleanup.abort(timedOut('OpenCode shutdown was not confirmed.')), 5000);
    const kill = signal => {
      if (closed || child.exitCode !== null || child.signalCode !== null) return;
      try { child.kill(signal); } catch (error) { report({ stage: 'stop-failed', error: error.name }); }
    };
    kill('SIGTERM');
    const force = setTimeout(() => kill('SIGKILL'), 2500);
    try {
      await waitForSignal(childClosed, cleanup.signal);
    } catch (cause) {
      const error = Error('OpenCode shutdown was not confirmed. Check the local server before retrying.', { cause });
      error.code = 'OPENCODE_SHUTDOWN_UNCONFIRMED';
      error.pid = child.pid;
      Object.defineProperty(error, 'whenClosed', { value: childClosed });
      throw error;
    } finally {
      clearTimeout(timeout);
      clearTimeout(force);
    }
  })();
  try {
  if (!path.isAbsolute(backendRoot)) throw Error('OpenCode requires an absolute backend directory.');
  if (!executable) {
    // Prefer the native npm executable, avoiding cmd.exe interpolation entirely.
    const native = path.join(
      process.env.APPDATA || "",
      "npm/node_modules/opencode-ai/bin/opencode.exe",
    );
    try {
      await waitForSignal(accessImpl(native), startup.signal);
      executable = native;
    } catch {
      startup.signal.throwIfAborted();
      const result = await waitForSignal(execImpl(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          path.join(backendRoot, "scripts/resolve-opencode.ps1"),
        ],
        { windowsHide: true, signal: startup.signal, timeout: remainingStartupMs() },
      ), startup.signal);
      executable = result.stdout.trim();
      if (!/\.exe$/i.test(executable))
        throw Error("Install the native OpenCode executable to continue.");
    }
  }
  const password = randomBytes(32).toString("hex");

  // Keep OpenCode's native config and credentials, adding only Freelancer's
  // plugin and instruction layer.
  const childEnv = hostEnvironment(config, env);

  remainingStartupMs();
  child = spawnImpl(
    executable,
    [...(diagnostics ? ['--print-logs', '--log-level', 'DEBUG'] : []), "serve", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: backendRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...childEnv, OPENCODE_SERVER_PASSWORD: password },
    },
  );
  // Observe actual close immediately: exit alone does not prove that pipes and
  // owned process resources have been released, particularly on Windows.
  childClosed = new Promise(resolve => child.once('close', (code, signal) => {
    closed = true;
    report({ stage: 'closed', code, signal });
    resolve();
  }));
  report({ stage: 'spawned', pid: child.pid });
  child.once('exit', (code, signal) => {
    report({ stage: 'exited', code, signal });
    startup.abort(Error('OpenCode exited before initialization finished.'));
    void client?.closePending();
  });
  child.once('error', error => {
    report({ stage: 'process-error', error: error.name, code: error.code });
    startup.abort(Error('OpenCode could not start.', { cause: error }));
    void client?.closePending();
  });
  if (typeof diagnostics === 'function') for (const [stream, pipe] of [['stdout', child.stdout], ['stderr', child.stderr]])
    pipe.on('data', chunk => report({ stage: 'output', stream, text: chunk.toString().slice(-8192)
      .replace(/(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
      .replace(/(["']?(?:api[ _-]?key|token|secret|password)["']?\s*[=:]\s*["']?)[^"'\s,;}]+/gi, '$1[redacted]') }));
  const url = await waitForSignal(new Promise((resolve, reject) => {
    let output = "";
    const detach = () => {
      child.off('error', fail);
      child.off('exit', fail);
      child.stdout.off('data', collect);
      child.stderr.off('data', collect);
      startup.signal.removeEventListener('abort', abort);
      child.stdout.resume();
      child.stderr.resume();
    };
    const fail = () => {
      detach();
      reject(Error("OpenCode could not start."));
    };
    const abort = () => { detach(); reject(startup.signal.reason); };
    child.once("error", fail);
    child.once("exit", fail);
    startup.signal.addEventListener('abort', abort, { once: true });
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-8192);
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        detach();
        report({ stage: 'listening' });
        resolve(match[0]);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    if (startup.signal.aborted) abort();
  }), startup.signal);
  client = createHost({ url, password, diagnostics: report, defaultDirectory: backendRoot, fetchImpl });
  let nativeVersion = null;
  try {
    const signal = AbortSignal.any([startup.signal, AbortSignal.timeout(Math.min(3000, remainingStartupMs()))]);
    const health = await waitForSignal(client.request('/global/health', { signal }), signal);
    if (typeof health?.version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[.+-][A-Za-z0-9.-]+)?$/.test(health.version))
      nativeVersion = health.version;
  } catch { /* Version remains unknown; listening does not prove plugin readiness. */ }
  remainingStartupMs();
  if (waitForReady) await client.ensureReady({ directory: backendRoot, signal: startup.signal, timeoutMs: remainingStartupMs() });
  remainingStartupMs();
  report({ stage: waitForReady ? 'ready' : 'transport-ready' });
  return {
    ...client,
    nativeVersion,
    ...nativeDataTools({ executable, env: childEnv }),
    startupDeadline,
    remainingStartupMs,
    whenClosed: childClosed,
    close,
    stop: () => { void client.closePending(); return child.kill(); },
    process: child,
  };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { cleanupError.cause = error; throw cleanupError; }
    throw error;
  } finally {
    clearTimeout(startupTimer);
  }
}
