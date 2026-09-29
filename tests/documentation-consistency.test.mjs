import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { palettes, lightPalettes, darkPalettes } from '../domain/theme.mjs';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

test('README palette overview agrees with the shipped registry and mode totals', () => {
  const matches = [...readme.matchAll(/\*\*(\d+) named palettes: (\d+) light and (\d+) dark\*\*/g)];
  assert.equal(matches.length, 1, 'keep one unambiguous palette inventory in the overview');
  assert.deepEqual(matches[0].slice(1).map(Number), [palettes.length, lightPalettes.length, darkPalettes.length]);
});

test('README settings map uses the same built-in palette count and distinguishes custom themes', () => {
  const row = readme.split('\n').find(line => /^\|\s*\|\s*\*\*Appearance\*\*\s*\|/.test(line));
  assert.ok(row, 'Appearance must remain in the settings map');
  const count = row.match(/\b(\d+) built-in palettes\b/);
  assert.ok(count, 'identify the built-in inventory separately from custom themes');
  assert.equal(Number(count[1]), palettes.length);
  assert.match(row, /custom themes/);
});
