import { readFile, writeFile } from 'node:fs/promises';
import { paletteCSS } from '../domain/theme.mjs';
const file = new URL('../src/echoflex/tokens.css', import.meta.url);
if (process.argv.includes('--check')) {
  // Git may check out text as CRLF on Windows; token content must still match exactly.
  if ((await readFile(file, 'utf8')).replaceAll('\r\n', '\n') !== paletteCSS()) throw Error('Palette CSS is stale. Run node scripts/palette-css.mjs.');
} else await writeFile(file, paletteCSS());
