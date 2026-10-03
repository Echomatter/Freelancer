import path from 'node:path';
import { realpathSync, statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const networkFilesystems = new Set([0x6969, 0x517b, 0xff534d42, 0x5346414f, 0x73757245, 0xc36400, 0x1021997]);
const pathsFor = platform => platform === 'win32' ? path.win32 : path.posix;
// Cache native observations for this process so hot reads never launch a
// synchronous subprocess. Drive remapping requires a restart. Canonical link
// and UNC validation still runs on every call; errors remain fail closed.
const windowsVolumes = new Map();
const volumeProbeScript = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FreelancerStorageVolume { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] public static extern uint GetDriveTypeW(string root); }' -ErrorAction Stop; [Console]::Out.Write([FreelancerStorageVolume]::GetDriveTypeW([Environment]::GetEnvironmentVariable('FREELANCER_STORAGE_VOLUME_ROOT')))`;

/** Native Windows observation; its root is computed by the caller, never a locality assertion from env. */
export function windowsStorageVolumeType(root) {
  const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    const output=execFileSync(executable,['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',volumeProbeScript],{
      env:{...process.env,FREELANCER_STORAGE_VOLUME_ROOT:root},windowsHide:true,timeout:5000,maxBuffer:16*1024,encoding:'utf8',
      stdio:['ignore','pipe','pipe'],
    });
    const text=output.trim();
    if (!/^[0-6]$/.test(text)) throw Error('Invalid volume observation.');
    return Number(text);
  } catch {
    throw Error('Windows storage volume could not be verified within its time limit. Freelancer SQLite was not opened.');
  }
}

function assertWindowsVolume(location, {readWindowsVolume,volumeCache}) {
  const root=path.win32.parse(normalizeWindowsLocation(location)).root;
  const key=root.toLowerCase();
  let observation=volumeCache.get(key);
  if (!observation) {
    try { observation={type:readWindowsVolume(root)}; }
    catch (error) { observation={error}; }
    volumeCache.set(key,observation);
  }
  if (observation.error) throw observation.error;
  // DRIVE_REMOVABLE/FIXED/CDROM/RAMDISK are local. UNKNOWN/NO_ROOT fail closed.
  if (![2,3,5,6].includes(observation.type))
    throw Error(observation.type===4 ? 'Freelancer SQLite storage must use a local filesystem, not a mapped network volume.' :
      'Windows storage volume is unavailable or unknown. Freelancer SQLite was not opened.');
}

function normalizeWindowsLocation(value) {
  const text = String(value).replaceAll('/', '\\');
  const device = text.match(/^(?:\\\\[?.]\\|\\\?\?\\)(.*)$/);
  if (device && /^UNC\\/i.test(device[1])) return `\\\\${device[1].slice(4)}`;
  if (device && /^[a-z]:\\/i.test(device[1])) return device[1];
  return text;
}

function windowsLocation(value) {
  const text = String(value).replaceAll('/', '\\');
  const device = text.match(/^(?:\\\\[?.]\\|\\\?\?\\)(.*)$/);
  if (device) {
    // Drive and volume namespaces identify local volumes. UNC, redirector and
    // arbitrary device namespaces must not become SQLite storage locations.
    if (/^[a-z]:\\/i.test(device[1])) return normalizeWindowsLocation(text);
    if (/^Volume\{[a-f0-9-]+\}\\/i.test(device[1])) return text;
    throw Error('Freelancer SQLite storage must use a local filesystem, not a network or unsupported device path.');
  }
  if (text.startsWith('\\\\'))
    throw Error('Freelancer SQLite storage must use a local filesystem, not a network path.');
  return text;
}

/** Resolve links and aliases through the nearest existing parent of a future path. */
export function canonicalStoragePath(value, { platform = process.platform, resolveRealpath = realpathSync.native } = {}) {
  const paths = pathsFor(platform);
  let current = paths.resolve(value), suffix = [];
  while (true) {
    try { return paths.join(resolveRealpath(current), ...suffix); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      const parent = paths.dirname(current);
      if (parent === current) throw Error('Storage path has no existing parent directory.', { cause:error });
      suffix.unshift(paths.basename(current)); current = parent;
    }
  }
}

/** Validate before creating a directory or opening either a writable or read-only SQLite connection. */
export function assertLocalStoragePath(value, { platform = process.platform, inspectFilesystem = true,
  inspectVolume = true, resolveRealpath = realpathSync.native, readFilesystem = statfsSync,
  readWindowsVolume = windowsStorageVolumeType, volumeCache = windowsVolumes } = {}) {
  const paths = pathsFor(platform);
  const location = platform === 'win32' ? windowsLocation(value) : value;
  if (typeof location !== 'string' || !paths.isAbsolute(location))
    throw Error('The local data folder must be an absolute path.');
  if (!inspectFilesystem) return paths.resolve(location);
  const canonical = canonicalStoragePath(location, { platform, resolveRealpath });
  if (platform === 'win32') {
    const local=windowsLocation(canonical);
    if (inspectVolume) assertWindowsVolume(local,{readWindowsVolume,volumeCache});
  }
  else {
    // statfs uses the existing ancestor; future suffixes have not been created.
    let ancestor = canonical;
    while (true) {
      try {
        const type = Number(readFilesystem(ancestor).type) >>> 0;
        if (networkFilesystems.has(type)) throw Error('Freelancer SQLite storage must use a local filesystem, not a network mount.');
        break;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        const parent = paths.dirname(ancestor);
        if (parent === ancestor) throw error;
        ancestor = parent;
      }
    }
  }
  return paths.resolve(location);
}

/** Case-aware physical containment, including junctions and not-yet-created suffixes. */
export function storagePathContains(root, target, { platform = process.platform, resolveRealpath = realpathSync.native } = {}) {
  const paths = pathsFor(platform);
  const canonical = value => {
    const resolved = canonicalStoragePath(value, { platform, resolveRealpath });
    const normalized = platform === 'win32' ? normalizeWindowsLocation(resolved) : resolved;
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  const relative = paths.relative(canonical(root), canonical(target));
  return relative === '' || (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`));
}
