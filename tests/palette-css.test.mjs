import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { paletteCSS } from '../domain/theme.mjs';
const run = promisify(execFile);

test('palette CLI accepts LF and Windows CRLF but rejects changed or missing tokens', async t => {
  // Execute the real checker in an isolated checkout; never mutate the live source under parallel tests.
  const root = await mkdtemp(path.join(os.tmpdir(), 'palette-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['scripts', 'domain', 'src/echoflex']) await mkdir(path.join(root, folder), { recursive: true });
  for (const file of ['scripts/palette-css.mjs', 'domain/theme.mjs', 'domain/color.mjs'])
    await copyFile(new URL('../' + file, import.meta.url), path.join(root, file));
  const file = path.join(root, 'src/echoflex/tokens.css');
  const check = () => run(process.execPath, [path.join(root, 'scripts/palette-css.mjs'), '--check']);
  const css = paletteCSS();
  for (const newline of ['\n', '\r\n']) {
    await writeFile(file, css.replaceAll('\n', newline));
    await check();
    await writeFile(file, css.replace('--bg: #f8f9f6;', '--bg: #ffffff;').replaceAll('\n', newline));
    await assert.rejects(check(), /Palette CSS is stale/);
    await writeFile(file, css.replace('  --focus:', '  --wrong-focus:').replaceAll('\n', newline));
    await assert.rejects(check(), /Palette CSS is stale/);
  }
});
