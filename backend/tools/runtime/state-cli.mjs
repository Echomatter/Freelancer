import { readState, writeState, removeState, stateFiles } from './state-database.mjs';
import path from 'node:path';
const [operation, file] = process.argv.slice(2);
if (!file) throw Error('A state document key is required.');
const print = value => process.stdout.write(JSON.stringify(value).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
if (operation === 'read') print(readState(file, null));
else if (operation === 'list') print(stateFiles(file).map(name => path.join(file, name)));
else if (operation === 'remove') removeState(file);
else if (operation === 'write' || operation === 'write-base64') {
  const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
  let text = Buffer.concat(chunks).toString('utf8');
  if (operation === 'write-base64') text = Buffer.from(text.trim(), 'base64').toString('utf8');
  writeState(file, JSON.parse(text.replace(/^\uFEFF/, '')));
} else throw Error('Unsupported state operation.');
