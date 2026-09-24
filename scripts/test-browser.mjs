import { spawnSync } from "node:child_process";

// Each journey starts and closes its own loopback fixture. Keep them sequential
// to avoid port and browser-process contention on developer machines.
const journeys = [
  "colors",
  "git-project",
  "local-data",
  "named-agents",
  "panels-theme",
  "usage",
  "usage-meter",
  "polish",
  "chat-tweaks",
  "unfinished-work",
  "history-search",
  "model-ratings",
  "progress-jobs",
  "dialogs",
  "chatgpt-import",
];

for (const name of journeys) {
  const file = `tests/${name}.browser.mjs`;
  process.stdout.write(`\nBrowser journey: ${name}\n`);
  const result = spawnSync(process.execPath, [file], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
