import { createHash } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const RECORDS = '.state/webpage/records.sqlite';
const RECORDS_APP_ID = 1179796804;
const RECORDS_SCHEMA = 1;
const MANIFEST = 'migration-sources-manifest.json';

const sha256 = async filename => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
};
function writeExclusive(filename, data) {
  let fd;
  try {
    fd = openSync(filename, 'wx', 0o600);
    writeFileSync(fd, data);
    if (process.platform !== 'win32') chmodSync(filename, 0o600);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    throw error;
  }
}
function safeRegularFile(filename, label) {
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`${label} must be a regular file.`);
  return stat;
}
function syncFile(filename) {
  const fd = openSync(filename, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function validRelativeKey(key) {
  return typeof key === 'string' && key.length > 0 && !key.includes('\\') &&
    !path.posix.isAbsolute(key) && key.split('/').every(part => part && part !== '.' && part !== '..');
}
function canonicalFuturePath(filename) {
  let current = path.resolve(filename), tail = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw Error('Backup path has no existing parent directory.');
    tail.unshift(path.basename(current)); current = parent;
  }
  return path.join(realpathSync(current), ...tail);
}
function isWithin(root, target) {
  const left = process.platform === 'win32' ? root.toLowerCase() : root;
  const right = process.platform === 'win32' ? target.toLowerCase() : target;
  return right === left || right.startsWith(`${left}${path.sep}`);
}
function excludedKey(key) {
  if (key === 'storage-runtime.json') return 'authority pointer stays on filesystem';
  if (key === 'webpage/launch.json') return 'live process rendezvous stays on filesystem';
  if (/^delegation\/dispatch-locks\/[^/]+\/owner\.json$/.test(key)) return 'OS lock owner record stays on filesystem';
  return null;
}
function legacyDatabaseInfo(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const applicationID = db.prepare('PRAGMA application_id').get().application_id;
    const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (applicationID !== RECORDS_APP_ID || schemaVersion !== RECORDS_SCHEMA || !tables.has('collections') || !tables.has('records'))
      throw Error('Legacy runtime records database identity or schema is unsupported.');
    const integrity = db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]);
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw Error('Legacy runtime records database integrity check failed.');
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeys.length) throw Error('Legacy runtime records database foreign-key check failed.');
    return {
      applicationID,
      schemaVersion,
      collections: db.prepare('SELECT count(*) AS n FROM collections').get().n,
      records: db.prepare('SELECT count(*) AS n FROM records').get().n,
    };
  } finally { db.close(); }
}

function scanRuntimeSources(runtimeRoot) {
  const stateRoot = path.join(runtimeRoot, '.state');
  const files = new Map(), directories = new Set(['.state']), skipped = [], excluded = [];
  const recordsPath = path.join(runtimeRoot, RECORDS);
  if (existsSync(recordsPath)) {
    for (const suffix of ['', '-wal', '-shm']) {
      const filename = `${recordsPath}${suffix}`;
      if (existsSync(filename)) {
        safeRegularFile(filename, 'Legacy runtime records database artifact');
        files.set(`${RECORDS}${suffix}`, { filename, kind: suffix ? 'sqlite-sidecar' : 'sqlite' });
      }
    }
    if (!files.has(RECORDS)) throw Error('Legacy runtime records database is not a regular file.');
  }
  const visit = (directory, relative = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      const filename = path.join(directory, entry.name);
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink()) throw Error(`Refusing symbolic link in runtime migration source: ${key}`);
      if (stat.isDirectory()) {
        directories.add(`.state/${key}`);
        visit(filename, key);
      } else if (!stat.isFile()) {
        skipped.push({ key: `.state/${key}`, reason: 'unsupported filesystem entry' });
      } else {
        const exclusion = excludedKey(key);
        if (exclusion) excluded.push({ key: `.state/${key}`, reason: exclusion });
        else if (key === 'webpage/records.sqlite' || key === 'webpage/records.sqlite-wal' || key === 'webpage/records.sqlite-shm') {
          // Added from the fixed runtime database path above.
        } else if (entry.name.endsWith('.json')) {
          const bytes = readFileSync(filename);
          try { JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
          catch (error) { throw Error(`Invalid migration-source JSON at .state/${key}.`, { cause: error }); }
          files.set(`.state/${key}`, { filename, kind: 'json' });
        } else skipped.push({ key: `.state/${key}`, reason: 'not a registered JSON migration input' });
      }
    }
  };
  if (existsSync(stateRoot)) {
    const stat = lstatSync(stateRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Runtime .state must be a regular directory.');
    visit(stateRoot);
  }
  return { files, directories: [...directories].sort(), skipped, excluded };
}

function cleanup(directory) {
  rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 20 });
}

export async function validateRuntimeMigrationSourceBackup(directory) {
  if (!path.isAbsolute(directory)) throw Error('Migration source bundle path must be absolute.');
  directory = path.resolve(directory);
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw Error('Migration source bundle must be a regular directory.');
  const manifestPath = path.join(directory, MANIFEST);
  safeRegularFile(manifestPath, 'Migration sources manifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.version !== 1 || !Array.isArray(manifest.directories) || !Array.isArray(manifest.files) ||
      !Array.isArray(manifest.skipped) || !Array.isArray(manifest.excluded))
    throw Error('Migration sources manifest is invalid or unsupported.');
  const listed = new Set(), listedDirectories = new Set();
  for (const directoryKey of manifest.directories) {
    if (!validRelativeKey(directoryKey) || !(directoryKey === '.state' || directoryKey.startsWith('.state/')) || listedDirectories.has(directoryKey))
      throw Error('Migration sources manifest has an invalid directory entry.');
    listedDirectories.add(directoryKey);
  }
  for (const item of manifest.files) {
    if (!validRelativeKey(item.key) || !item.key.startsWith('.state/') || listed.has(item.key) || !['json', 'sqlite', 'sqlite-sidecar'].includes(item.kind))
      throw Error('Migration sources manifest has an invalid file entry.');
    listed.add(item.key);
    const filename = path.join(directory, 'payload', ...item.key.split('/'));
    const stat = safeRegularFile(filename, `Migration source ${item.key}`);
    if (stat.size !== item.bytes || await sha256(filename) !== item.sha256)
      throw Error(`Migration source ${item.key} failed size or SHA-256 verification.`);
    if (item.kind === 'json') JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  }
  const actual = [], actualDirectories = [];
  const visit = (folder, prefix = '') => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      const filename = path.join(folder, entry.name);
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink()) throw Error(`Migration source bundle contains a symbolic link: ${key}`);
      if (stat.isDirectory()) { actualDirectories.push(key); visit(filename, key); }
      else if (stat.isFile()) actual.push(key);
      else throw Error(`Migration source bundle contains an unsupported entry: ${key}`);
    }
  };
  const payload = path.join(directory, 'payload');
  if (!existsSync(payload) || !lstatSync(payload).isDirectory() || lstatSync(payload).isSymbolicLink())
    throw Error('Migration source payload directory is missing or invalid.');
  const topLevel = readdirSync(directory).sort();
  if (JSON.stringify(topLevel) !== JSON.stringify([MANIFEST, 'payload'].sort()))
    throw Error('Migration source bundle contains unmanifested top-level entries.');
  visit(payload);
  const actualKeys = actual.map(key => key.startsWith('payload/') ? key.slice('payload/'.length) : key).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...listed].sort())) throw Error('Migration source bundle has missing or unmanifested payload files.');
  const actualDirectoryKeys = actualDirectories.map(key => key.startsWith('payload/') ? key.slice('payload/'.length) : key).sort();
  if (JSON.stringify(actualDirectoryKeys) !== JSON.stringify([...listedDirectories].sort()))
    throw Error('Migration source bundle directory set differs from its manifest.');
  if (listed.has(RECORDS)) {
    const database = legacyDatabaseInfo(path.join(payload, ...RECORDS.split('/')));
    if (JSON.stringify(database) !== JSON.stringify(manifest.legacyDatabase)) throw Error('Legacy runtime database metadata differs from its manifest.');
  } else if (manifest.legacyDatabase !== null) throw Error('Manifest claims a legacy runtime database that is absent.');
  return manifest;
}

export async function backupRuntimeMigrationSources(runtimeRoot, outputDirectory, { quiesced = false } = {}) {
  if (quiesced !== true) throw Error('Stop Freelancer, OpenCode plugins and runtime helpers before backing up runtime migration sources.');
  if (!path.isAbsolute(runtimeRoot) || !path.isAbsolute(outputDirectory)) throw Error('Runtime and backup paths must be absolute.');
  runtimeRoot = path.resolve(runtimeRoot); outputDirectory = path.resolve(outputDirectory);
  const canonicalRoot = realpathSync(runtimeRoot), canonicalOutput = canonicalFuturePath(outputDirectory);
  if (isWithin(canonicalRoot, canonicalOutput))
    throw Error('Migration source backup must be outside the runtime root.');
  const rootStat = lstatSync(runtimeRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Runtime root must be a regular directory.');
  const snapshot = scanRuntimeSources(runtimeRoot);
  let created = false;
  try {
    mkdirSync(outputDirectory, { recursive: false, mode: 0o700 }); created = true;
    if (process.platform !== 'win32') chmodSync(outputDirectory, 0o700);
    const payload = path.join(outputDirectory, 'payload');
    mkdirSync(payload, { mode: 0o700 });
    mkdirSync(path.join(payload, '.state'), { mode: 0o700 });
    for (const relativeDirectory of snapshot.directories) {
      const subpath = relativeDirectory === '.state' ? '' : relativeDirectory.slice('.state/'.length);
      if (subpath) mkdirSync(path.join(payload, '.state', ...subpath.split('/')), { recursive: true, mode: 0o700 });
    }
    for (const [key, source] of snapshot.files) {
      const destination = path.join(payload, ...key.split('/'));
      mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      copyFileSync(source.filename, destination, 1);
      syncFile(destination);
      if (process.platform !== 'win32') chmodSync(destination, 0o600);
    }
    const files = await Promise.all([...snapshot.files].map(async ([key, source]) => {
      const filename = path.join(payload, ...key.split('/'));
      return { key, kind: source.kind, bytes: lstatSync(filename).size, sha256: await sha256(filename) };
    }));
    const legacyDatabase = files.some(file => file.key === RECORDS)
      ? legacyDatabaseInfo(path.join(payload, ...RECORDS.split('/'))) : null;
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      directories: snapshot.directories,
      legacyDatabase,
      skipped: snapshot.skipped,
      excluded: snapshot.excluded,
      files: files.sort((a, b) => a.key.localeCompare(b.key)),
    };
    writeExclusive(path.join(outputDirectory, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    await validateRuntimeMigrationSourceBackup(outputDirectory);
    return { status: 'verified', directory: outputDirectory, manifest };
  } catch (error) {
    if (created) cleanup(outputDirectory);
    throw error;
  }
}

export async function restoreRuntimeMigrationSources(bundleDirectory, outputRuntimeRoot, { quiesced = false } = {}) {
  if (quiesced !== true) throw Error('Stop Freelancer, OpenCode plugins and runtime helpers before restoring migration sources.');
  if (!path.isAbsolute(bundleDirectory) || !path.isAbsolute(outputRuntimeRoot))
    throw Error('Migration source bundle and restore paths must be absolute.');
  bundleDirectory = path.resolve(bundleDirectory); outputRuntimeRoot = path.resolve(outputRuntimeRoot);
  const bundleRoot = realpathSync(bundleDirectory), outputResolved = canonicalFuturePath(outputRuntimeRoot);
  if (isWithin(bundleRoot, outputResolved)) throw Error('Migration-source restore destination must be outside its bundle.');
  const manifest = await validateRuntimeMigrationSourceBackup(bundleDirectory);
  if (existsSync(outputRuntimeRoot)) throw Error('Migration-source restore destination must be a new directory.');
  let created = false;
  try {
    mkdirSync(outputRuntimeRoot, { recursive: false, mode: 0o700 }); created = true;
    if (process.platform !== 'win32') chmodSync(outputRuntimeRoot, 0o700);
    for (const directoryKey of manifest.directories) {
      const destination = path.join(outputRuntimeRoot, ...directoryKey.split('/'));
      mkdirSync(destination, { recursive: true, mode: 0o700 });
    }
    for (const item of manifest.files) {
      const source = path.join(bundleDirectory, 'payload', ...item.key.split('/'));
      const destination = path.join(outputRuntimeRoot, ...item.key.split('/'));
      mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      copyFileSync(source, destination, 1);
      syncFile(destination);
      if (process.platform !== 'win32') chmodSync(destination, 0o600);
    }
    for (const item of manifest.files) {
      const filename = path.join(outputRuntimeRoot, ...item.key.split('/'));
      if (lstatSync(filename).size !== item.bytes || await sha256(filename) !== item.sha256)
        throw Error(`Restored migration source ${item.key} failed verification.`);
      if (item.kind === 'json') JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
    }
    if (manifest.legacyDatabase) {
      const actual = legacyDatabaseInfo(path.join(outputRuntimeRoot, ...RECORDS.split('/')));
      if (JSON.stringify(actual) !== JSON.stringify(manifest.legacyDatabase))
        throw Error('Restored legacy runtime database differs from the source manifest.');
    }
    return { status: 'verified', directory: outputRuntimeRoot, legacyDatabase: manifest.legacyDatabase,
      restoredFiles: manifest.files.length, restoredDirectories: manifest.directories.length };
  } catch (error) {
    if (created) cleanup(outputRuntimeRoot);
    throw error;
  }
}
