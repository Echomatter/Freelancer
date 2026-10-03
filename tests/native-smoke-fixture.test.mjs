import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, stat, rm } from 'node:fs/promises';
import { nativeSmokeConfigPaths, seedNativeSmokeDependencies } from '../scripts/native-smoke-fixture.mjs';

test('native smoke config paths match OpenCode XDG global config resolution',()=>{
  const root=path.join(os.tmpdir(),'freelancer-config-layout');
  const {xdgConfigHome,nativeConfig}=nativeSmokeConfigPaths(root);
  assert.equal(xdgConfigHome,path.join(root,'native-config'));
  assert.equal(nativeConfig,path.join(xdgConfigHome,'opencode'));
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-smoke-seeder-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const appRoot=path.join(root,'app'), {nativeConfig}=nativeSmokeConfigPaths(root), directory=path.join(root,'project');
  await mkdir(path.join(appRoot,'node_modules'),{recursive:true});
  await mkdir(nativeConfig,{recursive:true}); await mkdir(directory);
  await writeFile(path.join(appRoot,'node_modules','source-marker'),'retained');
  await writeFile(path.join(appRoot,'package-lock.json'),JSON.stringify({packages:{'':{dependencies:{'@opencode-ai/plugin':'1.18.31'}},'node_modules/@opencode-ai/plugin':{version:'1.18.31'}}}));
  return {fixtureRoot:root,appRoot,nativeConfig,projectDirectories:[directory]};
}

test('native fixture dependencies are idempotent and preserve authored native configuration and source packages',async t=>{
  const input=await fixture(t), config=path.join(input.nativeConfig,'opencode.jsonc');
  const bytes=Buffer.from('{\n // native settings\n "permission": {"edit":"ask"}\n}\n');
  await writeFile(config,bytes);
  const first=await seedNativeSmokeDependencies(input);
  assert.equal(first.destinations.length,2);
  assert.ok(first.destinations.includes(input.nativeConfig));
  assert.ok(!first.destinations.includes(path.join(input.nativeConfig,'opencode')),
    'The global config root must not be seeded a second time beneath the configured directory.');
  assert.deepEqual(await seedNativeSmokeDependencies(input),first);
  for (const destination of first.destinations) {
    assert.equal(await realpath(path.join(destination,'node_modules')),await realpath(path.join(input.appRoot,'node_modules')));
    assert.equal(JSON.parse(await readFile(path.join(destination,'package.json'),'utf8')).dependencies['@opencode-ai/plugin'],'1.18.31');
  }
  assert.deepEqual(await readFile(config),bytes);
  await rm(input.nativeConfig,{recursive:true,force:true});
  assert.equal(await readFile(path.join(input.appRoot,'node_modules','source-marker'),'utf8'),'retained');
});

test('fixture seeding rejects outside paths and redirected parents before writing metadata',async t=>{
  const input=await fixture(t), outside=await mkdtemp(path.join(os.tmpdir(),'freelancer-outside-fixture-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  await assert.rejects(seedNativeSmokeDependencies({...input,projectDirectories:[outside]}),/inside the disposable/);
  assert.equal(await stat(path.join(input.nativeConfig,'package.json')).catch(()=>false),false);
  const alias=path.join(input.fixtureRoot,'redirected');
  await symlink(outside,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(seedNativeSmokeDependencies({...input,projectDirectories:[alias]}),/escapes the disposable/);
  assert.equal(await stat(path.join(outside,'.opencode')).catch(()=>false),false);
});

test('fixture seeding never replaces unrelated dependency folders or linked metadata',async t=>{
  const input=await fixture(t), target=path.join(input.nativeConfig,'node_modules');
  await mkdir(target);
  await assert.rejects(seedNativeSmokeDependencies(input),/unrelated dependencies/);
  await rm(target,{recursive:true});
  await symlink(path.join(input.appRoot,'package-lock.json'),path.join(input.nativeConfig,'package-lock.json'));
  await assert.rejects(seedNativeSmokeDependencies(input),/ordinary fixture files/);
});
