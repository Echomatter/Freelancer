import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { palettes } from "../domain/theme.mjs";

// Each journey starts and closes its own loopback fixture. Keep them sequential
// to avoid port and browser-process contention on developer machines. A failed
// journey must not suppress evidence from the remaining independent journeys.
export const journeys = [
  "colors",
  "git-project",
  "local-data",
  "named-agents",
  "panels-theme",
  "usage",
  "usage-meter",
  "polish",
  "chat-tweaks",
  "chat-dock",
  "chat-loading-cache",
  "send-feedback",
  "unfinished-work",
  "history-search",
  "model-ratings",
  "progress-jobs",
  "dialogs",
  "chatgpt-import",
];

export function runJourneys({ names = journeys, run = spawnSync, log = console.log, record = () => {} } = {}) {
  const results = [];
  for (const name of names) {
    const file = `tests/${name}.browser.mjs`;
    log(`\nBrowser journey: ${name}`);
    const started = Date.now();
    let result;
    try {
      result = run(process.execPath, [file], { stdio: "inherit", timeout: ["colors", "usage"].includes(name) ? 180000 + palettes.length * 2000 : 180000 });
    } catch (error) {
      result = { status: null, error };
    }
    const passed = result.status === 0 && !result.error && !result.signal;
    results.push({ name, outcome: passed ? "success" : "failure", exitCode: result.status ?? null,
      signal: result.signal ?? null, errorCode: result.error?.code ?? null, durationMs: Date.now() - started });
    if (!passed) log(`FAIL ${name}: ${result.error?.message ?? result.signal ?? `exit ${result.status ?? "unknown"}`}`);
    // Persist after each journey so an interrupted suite does not lose the
    // completed results. Missing names remain explicitly not run.
    record({ expected: names, results: [...results], notRun: names.slice(results.length), liveProviderInference: "not-run" });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.resolve("artifacts", "verification");
  mkdirSync(directory, { recursive: true });
  const results = runJourneys({ record: report => writeFileSync(path.join(directory, "browser-journeys.json"), JSON.stringify(report, null, 2) + "\n") });
  const failed = results.filter(result => result.outcome !== "success");
  console.log(`\nBrowser journeys: ${results.length - failed.length} passed, ${failed.length} failed.`);
  if (failed.length) process.exitCode = 1;
}
