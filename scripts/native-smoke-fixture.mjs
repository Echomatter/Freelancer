import path from 'node:path';
import os from 'node:os';
import { mkdir, readFile, writeFile, symlink, stat, lstat, realpath } from 'node:fs/promises';

const inside = (root, destination) => {
  const relative = path.relative(root, destination);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/** Use XDG's standard app directory as the one effective global config directory. */
export function nativeSmokeConfigPaths(fixtureRoot) {
  if (typeof fixtureRoot !== 'string' || !path.isAbsolute(fixtureRoot))
    throw Error('Native smoke config root must be an absolute path.');
  const xdgConfigHome = path.join(fixtureRoot, 'native-config');
  return { xdgConfigHome, nativeConfig: path.join(xdgConfigHome, 'opencode') };
}

/** Reuse installed source dependencies only inside an explicit disposable fixture. */
export async function seedNativeSmokeDependencies({ fixtureRoot, appRoot, nativeConfig, projectDirectories = [] }) {
  if (![fixtureRoot, appRoot, nativeConfig, ...projectDirectories].every(value => typeof value === 'string' && path.isAbsolute(value)))
    throw Error('Native smoke dependency paths must be absolute.');
  const root = await realpath(fixtureRoot);
  if (!inside(await realpath(os.tmpdir()), root) || !path.basename(root).startsWith('freelancer-'))
    throw Error('Native smoke dependencies require a disposable freelancer directory inside the system temporary folder.');
  const destinations = [...new Set([nativeConfig, ...projectDirectories.map(directory => path.join(directory, '.opencode'))].map(value => path.resolve(value)))];
  for (const destination of destinations) if (!inside(root, destination))
    throw Error('Native smoke dependencies must stay inside the disposable fixture root.');
  const dependencies = await realpath(path.join(appRoot, 'node_modules'));
  if (!(await stat(dependencies)).isDirectory()) throw Error('Run npm ci before native smoke checks.');
  const lock = await readFile(path.join(appRoot, 'package-lock.json'), 'utf8');
  const parsed = JSON.parse(lock), version = parsed.packages?.['node_modules/@opencode-ai/plugin']?.version;
  if (!version || !parsed.packages?.['']?.dependencies?.['@opencode-ai/plugin']) throw Error('The installed native plugin dependency must be locked.');
  // Preflight every destination before writing anything. A parent junction must
  // not redirect a disposable path into a native user's configuration folder.
  const existingLinks = new Set();
  for (const destination of destinations) {
    let ancestor = destination;
    while (true) {
      try {
        const resolved = await realpath(ancestor);
        if (resolved !== root && !inside(root, resolved)) throw Error('Native smoke dependency path escapes the disposable fixture through a link.');
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        ancestor = path.dirname(ancestor);
      }
    }
    const target = path.join(destination, 'node_modules');
    const info = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (info) {
      if (!info.isSymbolicLink() || await realpath(target) !== dependencies) throw Error('Native smoke dependency destination already contains unrelated dependencies.');
      existingLinks.add(destination);
    }
    for (const name of ['package.json', 'package-lock.json']) {
      const info = await lstat(path.join(destination, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (info && (!info.isFile() || info.isSymbolicLink())) throw Error('Native smoke package metadata must be ordinary fixture files.');
    }
  }
  for (const destination of destinations) {
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'package.json'), JSON.stringify({ private: true, dependencies: { '@opencode-ai/plugin': version } }));
    await writeFile(path.join(destination, 'package-lock.json'), lock);
    if (!existingLinks.has(destination)) await symlink(dependencies, path.join(destination, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  return { dependencies: 'installed-source', destinations };
}
