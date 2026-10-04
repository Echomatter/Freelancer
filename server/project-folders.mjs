import { realpath, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export async function listProjectFolders(directory = '') {
  const current = await realpath(directory || os.homedir());
  if (!(await stat(current)).isDirectory()) throw Error('Choose a folder.');
  const entries = (await readdir(current, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const roots = process.platform === 'win32'
    ? (await Promise.all('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async drive => { try { await stat(`${drive}:\\`); return `${drive}:\\`; } catch { return null; } }))).filter(Boolean)
    : ['/'];
  return { directory: current, parent: path.dirname(current), roots, home: os.homedir(),
    folders: entries.slice(0, 1000).map(entry => ({ name: entry.name, path: path.join(current, entry.name) })), truncated: entries.length > 1000 };
}
