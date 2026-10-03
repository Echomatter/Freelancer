import path from 'node:path';
import { lstatSync } from 'node:fs';
import { acquireLock } from './lock.mjs';

export async function withRuntimeMaintenanceLock(runtimeRoot, action) {
  if (!path.isAbsolute(runtimeRoot) || typeof action !== 'function')
    throw Error('Runtime maintenance requires an absolute runtime root and an action.');
  runtimeRoot=path.resolve(runtimeRoot);
  for (const [directory,required] of [[runtimeRoot,true],[path.join(runtimeRoot,'.state'),false],[path.join(runtimeRoot,'.state','webpage'),false]]) {
    let stat;
    try { stat=lstatSync(directory); }
    catch (error) { if (!required&&error.code==='ENOENT') continue; throw error; }
    if (!stat.isDirectory()||stat.isSymbolicLink()) throw Error('Runtime maintenance paths must be regular directories, not symbolic links.');
  }
  const release = await acquireLock(path.join(runtimeRoot, '.state', 'webpage'));
  try { return await action(); }
  finally { await release(); }
}
