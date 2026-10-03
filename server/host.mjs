import { nativeDataTools } from "./native-data.mjs";
import { spawn, execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
const exec = promisify(execFile);

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

export function createHost({ url, password = "", fetchImpl = fetch }) {
  const origin = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
    throw Error("OpenCode must run locally");
  return {
    async request(route, { method = "GET", directory, body, signal } = {}) {
      if (!route.startsWith("/") || route.startsWith("//"))
        throw Error("Invalid host route");
      const target = new URL(route, origin);
      if (directory) target.searchParams.set("directory", directory);
      const response = await fetchImpl(target, {
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
      });
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
      if (response.status === 204) return null;
      return response.json();
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
export async function startHost({ backendRoot, config, executable, env = process.env }) {
  if (!executable) {
    // Prefer the native npm executable, avoiding cmd.exe interpolation entirely.
    const native = path.join(
      process.env.APPDATA || "",
      "npm/node_modules/opencode-ai/bin/opencode.exe",
    );
    try {
      await access(native);
      executable = native;
    } catch {
      const result = await exec(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          path.join(backendRoot, "scripts/resolve-opencode.ps1"),
        ],
        { windowsHide: true },
      );
      executable = result.stdout.trim();
      if (!/\.exe$/i.test(executable))
        throw Error("Install the native OpenCode executable to continue.");
    }
  }
  const password = randomBytes(32).toString("hex");

  // Keep OpenCode's native config and credentials, adding only Freelancer's
  // plugin and instruction layer.
  const childEnv = hostEnvironment(config, env);

  const child = spawn(
    executable,
    ["serve", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: backendRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...childEnv, OPENCODE_SERVER_PASSWORD: password },
    },
  );
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(Error("OpenCode took too long to start."));
    }, 30000);
    const fail = () => {
      clearTimeout(timeout);
      reject(Error("OpenCode could not start."));
    };
    child.once("error", fail);
    child.once("exit", fail);
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-8192);
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        child.off("exit", fail);
        resolve(match[0]);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
  });
  return {
    ...createHost({ url, password }),
    ...nativeDataTools({ executable, env: childEnv }),
    stop: () => child.kill(),
    process: child,
  };
}
