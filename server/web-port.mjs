import { readStateText as readFile, writeState } from '../backend/tools/runtime/state-database.mjs';
import path from 'node:path';

export async function savedWebPort(file, override) {
  let port = 58633;
  try { port = JSON.parse(await readFile(file, 'utf8')).port; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (override !== undefined && override !== '') port = Number(override);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Freelancer web port must be from 1024 to 65535.');
  return port;
}

export async function rememberWebPort(file, port) {
  writeState(file, { port });
}
