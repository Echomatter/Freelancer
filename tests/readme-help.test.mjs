import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { helpTopicIDs, readmeHelp } from '../shared/readme-help.mjs';

const source = await readFile(new URL('../README.md', import.meta.url), 'utf8');

test('every interface help topic resolves to authored README content', () => {
  const excerpts = readmeHelp(source);
  assert.deepEqual(Object.keys(excerpts).sort(), [...helpTopicIDs].sort());
  for (const excerpt of Object.values(excerpts)) {
    assert.ok(excerpt.title && excerpt.paragraphs.length);
    assert.ok(excerpt.paragraphs.every(text => text.length && !text.includes('<!--')));
  }
  const revised = source.replace('Schedules start a fresh project chat', 'Schedules create a new project chat');
  assert.match(readmeHelp(revised).schedules.paragraphs[0], /^Schedules create a new project chat/);
});

test('missing, duplicate and unterminated hooks stop the build', () => {
  assert.throws(() => readmeHelp(source.replace('<!-- help:schedules -->', '<!-- retired -->')), /Missing README help topic: schedules/);
  assert.throws(() => readmeHelp(source + '\n<!-- help:schedules -->\n### Duplicate\n\nMore text.\n<!-- /help -->'), /Duplicate README help topic: schedules/);
  assert.throws(() => readmeHelp(source.replace(/(<!-- help:schedules -->[\s\S]*?)<!-- \/help -->/, '$1')), /Malformed README help topic: schedules/);
});
