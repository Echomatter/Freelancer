import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizePlans } from '../domain/costs.mjs';
import { replaceFile } from './replace-file.mjs';
import { migrateSettings } from './settings-migration.mjs';

// Small configuration documents keep atomic replacement and stat validation.
export function createJsonStore(root, { replace = replaceFile } = {}) {
  const directory = path.join(root, '.state', 'webpage');
  const cache = new Map();
  const files = {
    settings: "settings.json",
    gitOperations: "git-operations.json",
    goals: "goals.json",
  };
  const defaults = {
    settings: () => ({
      version: 1,
      revision: 0,
      projects: [],
      plans: normalizePlans(),
      monthlyPlans: {},
    }),
    gitOperations: () => ({ version: 1, records: {} }),
    goals: () => ({ version: 1, records: {} }),
  };
  const filePath = (name) => path.join(directory, files[name]);
  const signature = (stats) =>
    stats ? `${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}` : null;
  async function currentSignature(name) {
    try {
      return signature(await stat(filePath(name), { bigint: true }));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  function validate(name, value) {
    if (value.version !== 1) throw Error("Unsupported document");
    if (
      name === "settings" &&
      (!Array.isArray(value.projects) || !Number.isInteger(value.revision))
    )
      throw Error("Invalid settings");
    if (
      ["gitOperations", "goals"].includes(name) &&
      (!value.records ||
        typeof value.records !== "object" ||
        Array.isArray(value.records))
    )
      throw Error("Invalid usage");
  }
  async function load(name) {
    if (!files[name]) throw Error("Unknown document");
    try {
      const seen = await currentSignature(name),
        cached = cache.get(name);
      if (cached && cached.signature === seen) return cached.data;
      if (seen === null) {
        const value = defaults[name]();
        cache.set(name, { signature: null, data: value });
        return value;
      }
      const parsed = JSON.parse(await readFile(filePath(name), "utf8"));
      validate(name, parsed);
      const value = name === "settings" ? migrateSettings(parsed) : parsed;
      if (value !== parsed) {
        await writeDocument(name, value);
        return value;
      }
      cache.set(name, { signature: seen, data: value });
      return value;
    } catch (e) {
      if (e.code === "ENOENT") {
        const value = defaults[name]();
        cache.set(name, { signature: null, data: value });
        return value;
      }
      throw Error(`Cannot read ${name}; your existing data was preserved.`);
    }
  }
  async function read(name) {
    return structuredClone(await load(name));
  }
  async function writeDocument(name, next) {
    if (name === "settings") next = migrateSettings(next);
    validate(name, next);
    await mkdir(directory, { recursive: true });
    const target = filePath(name),
      temp = target + "." + randomUUID() + ".tmp";
    try {
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await replace(temp, target);
      cache.set(name, {
        signature: await currentSignature(name),
        data: next,
      });
    } finally {
      await unlink(temp).catch(() => {});
    }
  }

  return { directory, read, write: writeDocument };
}
