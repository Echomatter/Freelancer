import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Capture before main.mjs applies OpenCode-only XDG isolation. GitHub CLI must
// reuse the user's actual native configuration, not a second app-local login.
const nativeEnvironment = { ...process.env };
export function cleanGitEnv(env = nativeEnvironment) {
  const result = { ...env };
  // Do not inherit repository overrides, tokens, debug traces or alternate hosts.
  for (const key of Object.keys(result))
    if (/^(GIT_|GCM_|GH_|GITHUB_TOKEN|FREELANCER_GIT_BRIDGE)/i.test(key))
      delete result[key];
  return {
    ...result,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_OPTIONAL_LOCKS: "0",
    ...(env.GH_CONFIG_DIR ? { GH_CONFIG_DIR: env.GH_CONFIG_DIR } : {}),
    GH_PROMPT_DISABLED: "1",
    GH_HOST: "github.com",
    GH_PAGER: "cat",
    NO_COLOR: "1",
    LC_ALL: "C",
  };
}
export async function executable(
  name,
  platform = process.platform,
  env = process.env,
) {
  const base = platform === "win32" ? `${name}.exe` : name;
  const candidates = (env.PATH || env.Path || "")
    .split(platform === "win32" ? ";" : ":")
    .filter((p) => path.isAbsolute(p))
    .map((p) => path.join(p.replace(/^"|"$/g, ""), base));
  if (platform === "win32") {
    if (name === "git")
      for (const root of [
        env.ProgramFiles,
        env["ProgramFiles(x86)"],
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs"),
      ].filter(Boolean))
        candidates.push(path.join(root, "Git", "cmd", base));
    if (name === "gh")
      candidates.push(
        path.join(env.ProgramFiles || "C:\\Program Files", "GitHub CLI", base),
      );
    if (name === "winget" && env.LOCALAPPDATA)
      candidates.push(
        path.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", base),
      );
  }
  for (const candidate of candidates)
    try {
      await access(candidate);
      return candidate;
    } catch {}
  throw Error(
    `${name === "git" ? "Git" : name === "gh" ? "GitHub CLI" : "Windows Package Manager"} is not installed. Use the setup panel.`,
  );
}
export function command(
  file,
  args,
  {
    cwd = os.homedir(),
    env,
    input,
    timeout = 30000,
    maxBytes = 8 * 1024 * 1024,
    onOutput,
    signal,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: { ...cleanGitEnv(), ...env },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = [],
      stderr = [],
      size = 0,
      settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          Error(
            "The command took too long. Check the project before trying again.",
          ),
        ),
      timeout,
    );
    signal?.addEventListener(
      "abort",
      () => fail(Error("Action cancelled. Check the project state.")),
      { once: true },
    );
    if (signal?.aborted) return fail(Error("Action cancelled."));
    const collect = (target, buffer) => {
      size += buffer.length;
      if (size > maxBytes)
        return fail(
          Error(
            "This result is too large to inspect safely. Use a smaller selection.",
          ),
        );
      target.push(buffer);
      onOutput?.(buffer.toString("utf8"));
    };
    child.stdout.on("data", (b) => collect(stdout, b));
    child.stderr.on("data", (b) => collect(stderr, b));
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export const installation = (name) => {
  if (!["git", "gh"].includes(name)) throw Error("Choose Git or GitHub CLI.");
  return {
    package: name === "git" ? "Git.Git" : "GitHub.cli",
    url:
      name === "git"
        ? "https://git-scm.com/install/windows"
        : "https://cli.github.com/",
  };
};
