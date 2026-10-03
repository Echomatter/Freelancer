import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { updateOpenCodeProjectModel, updateOpenCodeProjectSettings } from '../server/opencode-project-config.mjs';

async function project(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-opencode-project-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('project model save preserves JSONC and rollback restores exact source bytes', async t => {
  const root = await project(t), configDir = path.join(root, '.opencode');
  await mkdir(configDir);
  const config = path.join(configDir, 'opencode.jsonc');
  const original = '{\n  // User-owned option\n  "autoupdate": true,\n  "model": "opencode/old",\n}\n';
  await writeFile(config, original);
  const saved = await updateOpenCodeProjectModel(root, 'opencode/new-model');
  const updated = await readFile(config, 'utf8'), errors = [];
  assert.equal(parse(updated, errors, { allowTrailingComma: true, disallowComments: false }).model, 'opencode/new-model');
  assert.deepEqual(errors, []);
  assert.match(updated, /\/\/ User-owned option/);
  assert.match(updated, /"autoupdate": true/);
  await saved.rollback();
  assert.equal(await readFile(config, 'utf8'), original);
});

test('project model save creates a supported OpenCode config without touching existing project files', async t => {
  const root = await project(t);
  await writeFile(path.join(root, 'source.txt'), 'project file remains');
  const saved = await updateOpenCodeProjectModel(root, 'openai/example-model');
  const config = JSON.parse(await readFile(path.join(root, 'opencode.jsonc'), 'utf8'));
  assert.equal(config.model, 'openai/example-model');
  assert.equal(await readFile(path.join(root, 'source.txt'), 'utf8'), 'project file remains');
  await saved.rollback();
  await assert.rejects(readFile(path.join(root, 'opencode.jsonc')), { code: 'ENOENT' });
});

test('rollback refuses to overwrite a later native configuration edit', async t => {
  const root = await project(t), config = path.join(root, 'opencode.jsonc');
  const saved = await updateOpenCodeProjectModel(root, 'openai/example-model');
  await writeFile(config, '{"model":"openai/newer"}\n');
  await assert.rejects(saved.rollback(), /automatic rollback was refused/);
  assert.match(await readFile(config, 'utf8'), /openai\/newer/);
});

test('compaction save changes only auto and retains nested comments, sibling options and permissions', async t => {
  const root = await project(t), file = path.join(root, 'opencode.jsonc');
  const original = '{\n  "compaction": {\n    // Keep pruning policy\n    "prune": false,\n    "reserved": 8192,\n    "auto": true\n  },\n  "permission": { "edit": "ask" }\n}\n';
  await writeFile(file, original);
  const saved = await updateOpenCodeProjectSettings(root, { compaction: { auto: false } });
  const text = await readFile(file, 'utf8');
  assert.match(text, /Keep pruning policy/);
  assert.deepEqual(parse(text), { compaction: { prune: false, reserved: 8192, auto: false }, permission: { edit: 'ask' } });
  await saved.rollback();
  assert.equal(await readFile(file, 'utf8'), original);
});

test('native edits add missing compaction and reject unrelated settings without rewriting existing files', async t => {
  const root = await project(t), file = path.join(root, 'opencode.jsonc');
  const original = '{ // Existing policy\n "permission": { "edit": "ask" }\n}\n';
  await writeFile(file, original);
  await assert.rejects(updateOpenCodeProjectSettings(root, { permission: { edit: 'allow' } }), /supported/);
  await assert.rejects(updateOpenCodeProjectSettings(root, { compaction: { auto: false, prune: true } }), /valid OpenCode compaction/);
  assert.equal(await readFile(file, 'utf8'), original);
  const saved = await updateOpenCodeProjectSettings(root, { model: 'opencode/example', compaction: { auto: false } });
  assert.deepEqual(parse(await readFile(file, 'utf8')), { permission: { edit: 'ask' }, model: 'opencode/example', compaction: { auto: false } });
  await saved.rollback();
  assert.equal(await readFile(file, 'utf8'), original);
});
