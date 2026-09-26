import path from 'node:path';
import { realpathSync } from 'node:fs';

// Keep lexical comparison separate from filesystem identity. A location that
// was already resolved at preview time must not follow a newly retargeted link.
export function cleanWindowsPath(value) {
  const text = String(value);
  if (/^\\\\\?\\UNC\\/i.test(text)) return `\\\\${text.slice(8)}`;
  return text.replace(/^\\\\\?\\/, '');
}

export function createPathIdentity({ platform = process.platform, resolveRealpath = realpathSync.native } = {}) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const clean = value => windows ? cleanWindowsPath(value) : String(value);
  const lexicalKey = value => {
    const resolved = paths.resolve(clean(value));
    return windows ? resolved.toLowerCase() : resolved;
  };
  function key(value) {
    const resolved = paths.resolve(clean(value));
    if (!windows) return resolved; // POSIX project keys remain case-sensitive.
    let ancestor = resolved;
    const suffix = [];
    while (true) {
      try {
        return lexicalKey(paths.join(clean(resolveRealpath(ancestor)), ...suffix));
      } catch (error) {
        // Historical workspaces may have moved. Resolve the surviving ancestor
        // (including its 8.3 alias), never guess identity from a folder basename.
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        const parent = paths.dirname(ancestor);
        if (parent === ancestor) return lexicalKey(resolved);
        suffix.unshift(paths.basename(ancestor));
        ancestor = parent;
      }
    }
  }
  return { key, lexicalKey, same: (left, right) => key(left) === key(right) };
}

export const pathIdentity = createPathIdentity();
