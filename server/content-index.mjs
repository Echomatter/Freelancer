import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import path from "node:path";

const execute = promisify(execFile);
const active = new Set();

export async function rebuildContentIndex({ project, backendRoot, dataRoot, run = execute, signal, onProgress = () => {} }) {
  const directory = path.resolve(project.directory);
  const key = process.platform === "win32" ? directory.toLowerCase() : directory;
  if (active.has(key)) throw Object.assign(Error("This project's index is already rebuilding."), { status: 409 });
  active.add(key);
  try {
    const script = path.join(backendRoot, "tools", "project-content-indexer.mjs");
    const database = path.join(dataRoot ?? path.join(backendRoot, '.state', 'local-data'), "freelancer.sqlite");
    await access(script);
    const args = [script, "--db", database, "--project-key", key, "rebuild", "--root", directory, "--facts", "none"];
    {
      let stdout;
      try {
        const execution = run(process.execPath, args, { cwd: directory, windowsHide: true, timeout: 600000, maxBuffer: 1024 * 1024, signal,
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
        throw Error(`Content index rebuild failed: ${error.stderr?.trim() || error.message}`);
      }
      let summary;
      try { summary = JSON.parse(stdout); }
      catch { throw Error("Content index rebuild returned an invalid summary. Check the index before retrying."); }
      signal?.throwIfAborted();
      return summary;
    }
  } finally {
    active.delete(key);
  }
}
