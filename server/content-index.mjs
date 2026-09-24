import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execute = promisify(execFile);
const active = new Set();

export async function rebuildContentIndex({ project, backendRoot, dataRoot, run = execute, signal, onProgress = () => {} }) {
  const directory = path.resolve(project.directory);
  const key = process.platform === "win32" ? directory.toLowerCase() : directory;
  if (active.has(key)) throw Object.assign(Error("This project's index is already rebuilding."), { status: 409 });
  active.add(key);
  let staging;
  try {
    const script = path.join(backendRoot, "tools", "Project_Content_Indexer.py");
    const database = path.join(dataRoot ?? path.join(backendRoot, '.state', 'local-data'), "freelancer.sqlite");
    await access(script);
    staging = await mkdtemp(path.join(os.tmpdir(), 'freelancer-content-stage-'));
    const args = [script, "--db", database, "--project-key", key, "rebuild", "--root", directory, "--facts", "none", "--staging-dir", staging];
    const candidates = process.platform === "win32" ? [["python", args], ["py", ["-3", ...args]]] : [["python3", args], ["python", args]];
    let missing;
    for (const [command, commandArgs] of candidates) {
      let stdout;
      try {
        const execution = run(command, commandArgs, { cwd: directory, windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024, signal,
          env: { ...process.env, FREELANCER_NODE: process.execPath } });
        let buffer = '';
        execution.child?.stderr?.on('data', chunk => {
          buffer = (buffer + chunk.toString()).slice(-8192);
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop();
          for (const line of lines) {
            const match = line.match(/^\[(\d+)\/(\d+)\]/);
            if (match) onProgress(`Indexing files · ${project.name} · ${Number(match[1])}/${Number(match[2])} files`);
            if (line === 'Publishing project index…') onProgress(`Saving file index · ${project.name}`);
          }
        });
        ({ stdout } = await execution);
      } catch (error) {
        if (error.code === "ENOENT" || error.code === 9009 || /Python was not found/i.test(error.stderr ?? "")) {
          missing = error;
          continue;
        }
        throw Error(`Content index rebuild failed: ${error.stderr?.trim() || error.message}`);
      }
      let summary;
      try { summary = JSON.parse(stdout); }
      catch { throw Error("Content index rebuild returned an invalid summary. Check the index before retrying."); }
      signal?.throwIfAborted();
      onProgress(`Saving file index · ${project.name}`);
      // Own both child lifetimes so Stop cannot leave an untracked writer behind.
      await run(process.execPath, [path.join(backendRoot, 'tools', 'runtime', 'publish-index.mjs'),
        database, path.join(staging, 'staged-freelancer.sqlite'), key],
      { cwd: directory, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024, signal });
      return summary;
    }
    throw Error(`Content index rebuild failed: ${missing?.stderr?.trim() || "Python is unavailable."}`);
  } finally {
    active.delete(key);
    if (staging && path.dirname(path.resolve(staging)) === path.resolve(os.tmpdir())
      && path.basename(staging).startsWith('freelancer-content-stage-'))
      await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
