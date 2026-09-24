import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const directories = ["tests", path.join("backend", "tests")];
const slow = new Set(["git-project.test.mjs", "git-project-http.test.mjs"]);
const files = (await Promise.all(directories.map(async (directory) =>
  (await readdir(directory))
    .filter((name) => name.endsWith(".test.mjs") && !slow.has(name))
    .map((name) => path.join(directory, name))
))).flat();

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
