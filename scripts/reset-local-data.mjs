// Reset only Freelancer's local SQLite data. Native OpenCode conversations and
// the application settings JSON live elsewhere and are never opened here.
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, lstat, readFile, readdir, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { resolveRuntimeConfig } from "../server/runtime-config.mjs";
import { acquireLock } from "../server/lock.mjs";
import { createLocalDataStore } from "../server/data/store.mjs";

if (process.argv.slice(2).join(" ") !== "--confirm")
  throw Error("Pass --confirm to reset Freelancer's local database.");

const config = resolveRuntimeConfig();
const dataRoot = path.resolve(config.dataRoot);
const stateRoot = path.join(config.backendRoot, ".state", "webpage");
const settingsFile = path.join(stateRoot, "settings.json");
const fileName = "freelancer.sqlite";
const digest = (value) => createHash("sha256").update(value).digest("hex");

await mkdir(dataRoot, { recursive: true });
if (!(await lstat(dataRoot)).isDirectory() || (await lstat(dataRoot)).isSymbolicLink())
  throw Error("The local data root must be a real directory.");

const originalSettings = await readFile(settingsFile);
const settings = JSON.parse(originalSettings.toString("utf8"));
if (!Array.isArray(settings.projects)) throw Error("Application settings are unreadable; local data was not changed.");

const releaseLock = await acquireLock(stateRoot);
const working = path.join(dataRoot, `.freelancer-reset-${randomUUID()}`);
const old = path.join(working, "old");
const clean = path.join(working, "clean");
const moved = [];
let installed = false;
let validated = false;
try {
  if (existsSync(path.join(stateRoot, "launch.json")))
    throw Error("Freelancer still has a launch record. Stop its server cleanly before resetting local data.");
  await mkdir(working);
  await mkdir(old);
  await mkdir(clean);

  const fresh = createLocalDataStore(clean);
  try {
    const check = fresh.maintainIndex("check");
    if (!check.healthy) throw Error(`Fresh local database failed integrity check: ${check.findings.join("; ")}`);
  } finally {
    fresh.close();
  }
  const cleanEntries = await readdir(clean);
  if (cleanEntries.length !== 1 || cleanEntries[0] !== fileName)
    throw Error("The fresh database has unexpected sidecar files. Existing local data was not changed.");

  // Index workers can leave staging SQLite files after an interrupted run.
  // They are derived copies of this same database and safe to discard while
  // the application lock is ours.
  const names = (await readdir(dataRoot)).filter((name) =>
    name === fileName || name.startsWith(`${fileName}.`) || name.startsWith(`${fileName}-`) ||
    /^\.content-stage-\d+-\d+\.sqlite(?:-wal|-shm|-journal)?$/.test(name));
  let removedBytes = 0;
  for (const name of names) {
    const source = path.join(dataRoot, name);
    const item = await lstat(source);
    if (!item.isFile() || item.isSymbolicLink())
      throw Error(`Unexpected local database artifact: ${name}. Existing local data was not changed.`);
    removedBytes += item.size;
  }
  for (const name of names) {
    await rename(path.join(dataRoot, name), path.join(old, name));
    moved.push(name);
  }

  await rename(path.join(clean, fileName), path.join(dataRoot, fileName));
  installed = true;
  const replacement = createLocalDataStore(dataRoot);
  try {
    const check = replacement.maintainIndex("check");
    if (!check.healthy) throw Error(`Replacement database failed integrity check: ${check.findings.join("; ")}`);
  } finally {
    replacement.close();
  }
  if (digest(await readFile(settingsFile)) !== digest(originalSettings))
    throw Error("Application settings changed during the reset. Old local data remains available for recovery.");
  validated = true;

  const cleanupErrors = [];
  for (const name of moved) {
    try { await unlink(path.join(old, name)); }
    catch (error) { cleanupErrors.push(`${name}: ${error.message}`); }
  }
  if (!cleanupErrors.length) {
    await rmdir(old);
    await rmdir(clean);
    await rmdir(working);
  }
  console.log(JSON.stringify({ reset: true, dataRoot, removedArtifacts: names.length,
    removedBytes, settingsSHA256: digest(originalSettings), projects: settings.projects.length,
    databaseBytes: (await lstat(path.join(dataRoot, fileName))).size,
    ...(cleanupErrors.length ? { cleanupErrors, oldArtifacts: old } : {}) }));
} catch (error) {
  // Before validation finishes, restore the complete old SQLite file family.
  // Never pair an old WAL with the replacement main database.
  if (installed && !validated && moved.length) {
    try { await rename(path.join(dataRoot, fileName), path.join(clean, fileName)); }
    catch { /* keep the replacement visible if rollback cannot move it */ }
  }
  if (!validated) {
    for (const name of [...moved].reverse()) {
      try { await rename(path.join(old, name), path.join(dataRoot, name)); }
      catch { /* report the original error; retain unmoved files in the reset folder */ }
    }
  }
  throw error;
} finally {
  await releaseLock();
}
