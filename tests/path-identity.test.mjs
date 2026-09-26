import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { createPathIdentity, cleanWindowsPath, pathIdentity } from '../server/path-identity.mjs';

const missing = () => { throw Object.assign(Error('Missing'), { code: 'ENOENT' }); };
function windowsIdentity() {
  const aliases = new Map([
    ['c:\\users\\runner~1', 'C:\\Users\\runneradmin'],
    ['c:\\users\\runneradmin', 'C:\\Users\\runneradmin'],
    ['c:\\users', 'C:\\Users'], ['c:\\', 'C:\\'],
  ]);
  return createPathIdentity({ platform: 'win32', resolveRealpath: value => aliases.get(value.toLowerCase()) ?? missing() });
}

test('Windows short names and long names identify the same exact project, including a missing historical suffix', () => {
  const identity = windowsIdentity();
  assert.equal(identity.key('C:\\Users\\RUNNER~1\\Temp\\Project'), 'c:\\users\\runneradmin\\temp\\project');
  assert.equal(identity.same('C:\\Users\\RUNNER~1\\Temp\\Project', 'C:\\Users\\runneradmin\\Temp\\Project'), true);
  assert.equal(identity.same('C:\\Users\\RUNNER~1\\old\\Project', 'C:\\Users\\runneradmin\\new\\Project'), false);
});

test('extended Windows drive and UNC paths preserve their root', () => {
  assert.equal(cleanWindowsPath('\\\\?\\C:\\Users\\runneradmin'), 'C:\\Users\\runneradmin');
  assert.equal(cleanWindowsPath('\\\\?\\UNC\\server\\share\\Project'), '\\\\server\\share\\Project');
  const identity = createPathIdentity({ platform: 'win32', resolveRealpath: value => value });
  assert.equal(identity.same('\\\\?\\UNC\\server\\share\\Project', '\\\\server\\share\\project'), true);
  assert.equal(identity.same('\\\\server\\share\\Project', '\\\\other\\share\\Project'), false);
});

test('POSIX identity retains case and does not follow links as an incidental behavior change', () => {
  const identity = createPathIdentity({ platform: 'linux', resolveRealpath: () => { throw Error('Must not be called'); } });
  assert.equal(identity.same('/tmp/Project', '/tmp/project'), false);
  assert.equal(identity.same('/tmp/Project/../Project', '/tmp/Project'), true);
});

test('permission errors and link loops never become a guessed identity', () => {
  for (const code of ['EACCES', 'EPERM', 'ELOOP', 'EIO']) {
    const identity = createPathIdentity({ platform: 'win32', resolveRealpath: () => { throw Object.assign(Error(code), { code }); } });
    assert.throws(() => identity.key('C:\\private\\Project'), { code });
  }
});

test('a completely missing Windows root keeps a bounded lexical identity', () => {
  let calls = 0;
  const identity = createPathIdentity({ platform: 'win32', resolveRealpath: () => { calls++; return missing(); } });
  assert.equal(identity.key('Z:\\missing\\Project'), 'z:\\missing\\project');
  assert.equal(calls, 3);
});

test('resolved-location checks are lexical and detect retargeting instead of following both sides', () => {
  const identity = createPathIdentity({ platform: 'win32', resolveRealpath: value => value.replace(/preview/ig, 'elsewhere') });
  assert.equal(identity.same('C:\\preview\\chat.jsonl', 'C:\\elsewhere\\chat.jsonl'), true);
  assert.notEqual(identity.lexicalKey('C:\\preview\\chat.jsonl'), identity.lexicalKey('C:\\elsewhere\\chat.jsonl'));
});

test('native Windows junction aliases resolve to the same directory without basename matching', { skip: process.platform !== 'win32' }, async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'freelancer-path-')));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }));
  const actual = path.join(root, 'actual'), alias = path.join(root, 'alias'), other = path.join(root, 'other');
  await mkdir(actual); await mkdir(other);
  await symlink(actual, alias, 'junction');
  assert.equal(pathIdentity.same(actual, alias), true);
  assert.equal(pathIdentity.same(path.join(actual, 'missing', 'Project'), path.join(alias, 'missing', 'Project')), true);
  assert.equal(pathIdentity.same(path.join(actual, 'Project'), path.join(other, 'Project')), false);
});
