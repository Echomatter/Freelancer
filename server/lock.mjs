import { open, mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function windowsProcess(pid) {
  try {
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object CommandLine,CreationDate | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true },
    );
    const value = JSON.parse(stdout || "null");
    if (!value?.CreationDate) return null;
    return { commandLine: value.CommandLine ?? "", startedAt: value.CreationDate };
  } catch {
    return null;
  }
}

async function processOwnsLock(old) {
  try {
    process.kill(old.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
  if (process.platform !== "win32") return true;
  const current = await windowsProcess(old.pid);
  // If Windows cannot inspect the process, keep the lock rather than risking
  // two writers. New locks carry a creation timestamp so reused PIDs are safe.
  if (!current) return true;
  if (old.startedAt) return old.startedAt === current.startedAt;
  // Old lock documents had only a PID. Treat them as live solely when that PID
  // is demonstrably a Freelancer server; a reused PID must not brick the launcher.
  return /\bserver[\\/]main\.mjs\b/i.test(current.commandLine);
}

export async function acquireLock(directory) {
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "application.lock"),
    nonce = randomUUID(),
    startedAt = process.platform === "win32" ? (await windowsProcess(process.pid))?.startedAt : undefined;
  let handle;
  try {
    handle = await open(file, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let old;
    try {
      old = JSON.parse(await readFile(file, "utf8"));
    } catch {
      throw Error(
        "Application lock is unreadable. Existing data was preserved.",
      );
    }
    if (!Number.isInteger(old.pid) || old.pid < 1)
      throw Error("Invalid application lock. Existing data was preserved.");
    try {
      if (await processOwnsLock(old))
      throw Error(
        "Freelancer is already running. Close its other window before starting another copy.",
      );
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
    // Only remove a stale lock if it is still the exact document we inspected.
    if (JSON.parse(await readFile(file, "utf8")).nonce !== old.nonce)
      throw Error("Freelancer is starting in another window.");
    await unlink(file);
    handle = await open(file, "wx");
  }
  await handle.writeFile(JSON.stringify({ pid: process.pid, nonce, ...(startedAt ? { startedAt } : {}) }));
  await handle.close();
  return async () => {
    try {
      if (JSON.parse(await readFile(file, "utf8")).nonce === nonce)
        await unlink(file);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  };
}
