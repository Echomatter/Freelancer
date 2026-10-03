import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, unlink, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { applyEdits, modify, parse, printParseErrorCode } from 'jsonc-parser';
import { replaceFile } from './replace-file.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const missing = error => error?.code === 'ENOENT';

async function regularFile(file) {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw Error('OpenCode config must be a regular file, not a link or directory.');
    return info;
  } catch (error) { if (missing(error)) return null; throw error; }
}

async function configTarget(directory) {
  const nativeDir = path.join(directory, '.opencode');
  let nativeInfo;
  try { nativeInfo = await lstat(nativeDir); }
  catch (error) { if (!missing(error)) throw error; }
  if (nativeInfo?.isSymbolicLink() || (nativeInfo && !nativeInfo.isDirectory()))
    throw Error('The project .opencode path must be a real directory before saving its model default.');

  for (const base of [nativeInfo ? nativeDir : null, directory].filter(Boolean)) {
    for (const name of ['opencode.jsonc', 'opencode.json']) {
      const file = path.join(base, name), info = await regularFile(file);
      if (info) return { file, info };
    }
  }
  return { file: path.join(directory, 'opencode.jsonc'), info: null };
}

async function replaceText(file, text, mode) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', mode: mode ?? 0o600, flag: 'wx' });
    await replaceFile(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/** Save user choices to native OpenCode project configuration while preserving JSONC. */
export async function updateOpenCodeProjectSettings(directory, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length)
    throw Error('Choose at least one OpenCode project setting.');
  if (Object.keys(patch).some(key => !['model', 'compaction'].includes(key)))
    throw Error('Choose a supported OpenCode project setting.');
  if (patch.model !== undefined && (typeof patch.model !== 'string' || !/^[\w.:-]+\/[\w./:-]+$/.test(patch.model)))
    throw Error('Choose a valid OpenCode model ID.');
  if (patch.compaction !== undefined && (!patch.compaction || typeof patch.compaction !== 'object' ||
      Object.keys(patch.compaction).some(key => key !== 'auto') || typeof patch.compaction.auto !== 'boolean'))
    throw Error('Choose a valid OpenCode compaction setting.');
  const root = await realpath(directory);
  let target = await configTarget(root);
  let previous = null, next;
  if (target.info) {
    previous = await readFile(target.file, 'utf8');
    const errors = [];
    const value = parse(previous, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length || !value || typeof value !== 'object' || Array.isArray(value))
      throw Error(`Cannot save the model default because ${path.basename(target.file)} is not valid OpenCode JSONC (${printParseErrorCode(errors[0]?.error)}).`);
    next = previous;
    for (const [key, value] of Object.entries(patch)) {
      const targetPath = key === 'compaction' ? ['compaction', 'auto'] : [key];
      next = applyEdits(next, modify(next, targetPath, key === 'compaction' ? value.auto : value,
        { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
    }
  } else {
    next = `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', ...patch }, null, 2)}\n`;
  }
  if (next === previous) return { changed: false, file: target.file, rollback: async () => {} };
  const latest = await regularFile(target.file);
  const bytes = latest ? await readFile(target.file, 'utf8') : null;
  if ((previous === null) !== (bytes === null) || (previous !== null && hash(previous) !== hash(bytes)))
    throw Object.assign(Error('The OpenCode project config changed in another process. Reload before saving.'), { status: 409 });
  await replaceText(target.file, next, target.info ? target.info.mode & 0o777 : undefined);
  let rolledBack = false;
  return {
    changed: true,
    file: target.file,
    rollback: async () => {
      if (rolledBack) return;
      const current = await readFile(target.file, 'utf8');
      if (hash(current) !== hash(next)) throw Object.assign(Error('OpenCode config changed after the save; automatic rollback was refused.'), { status: 409 });
      if (previous === null) {
        await unlink(target.file);
      } else await replaceText(target.file, previous, target.info.mode & 0o777);
      rolledBack = true;
    },
  };
}

export async function updateOpenCodeProjectModel(directory, model) {
  return updateOpenCodeProjectSettings(directory, { model });
}
