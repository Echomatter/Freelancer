import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { idPattern } from "../domain/history.mjs";
const exec = promisify(execFile);

// Fixed read-only native commands; never receive a command or arbitrary flags
// from the browser. Use the same executable and environment as the running host.
export function nativeDataTools({ executable, env, execute = exec }) {
  return {
    async exportSession(id, directory) {
      if (!idPattern.test(id) || !path.isAbsolute(directory))
        throw Error("Choose a project conversation.");
      const { stdout } = await execute(executable, ["export", id], {
        cwd: directory,
        env,
        windowsHide: true,
        timeout: 45000,
        maxBuffer: 32 * 1024 * 1024,
      });
      const data = JSON.parse(stdout);
      if (data.info?.id !== id || !Array.isArray(data.messages))
        throw Error(
          "OpenCode returned an unsupported conversation export. Nothing was saved.",
        );
      return data;
    },
    async databasePath() {
      const { stdout } = await execute(executable, ["db", "path"], {
        env,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 8192,
      });
      const filename = stdout.trim();
      if (!path.isAbsolute(filename) || /[\r\n\0]/.test(filename))
        throw Error("OpenCode did not report an absolute database path.");
      return filename;
    },
  };
}
export async function openDataFolder(directory) {
  if (!path.isAbsolute(directory) || /[\r\n\0]/.test(directory))
    throw Error("Invalid local data folder.");
  const command =
    process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  await new Promise((resolve, reject) => {
    const child = spawn(command, [directory], {
      shell: false,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
