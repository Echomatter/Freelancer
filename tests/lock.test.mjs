import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireLock } from "../server/lock.mjs";
import { withRuntimeMaintenanceLock } from "../server/runtime-maintenance.mjs";
test("only one app may write shared settings, and its lock is released on close", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "freelancer-lock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const release = await acquireLock(dir);
  await assert.rejects(acquireLock(dir), /already running/);
  await release();
  const second = await acquireLock(dir);
  await second();
  await writeFile(path.join(dir, "application.lock"), "{broken");
  await assert.rejects(acquireLock(dir), /unreadable/);
  assert.equal(
    await readFile(path.join(dir, "application.lock"), "utf8"),
    "{broken",
  );
});

test('runtime maintenance uses the app lock to reject active writers and excludes new startup during maintenance', async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-maintenance-lock-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const lockDirectory=path.join(root,'.state','webpage'),releaseApp=await acquireLock(lockDirectory);
  let called=false;
  await assert.rejects(withRuntimeMaintenanceLock(root,async()=>{called=true;}),/already running/);
  assert.equal(called,false);
  await releaseApp();
  await withRuntimeMaintenanceLock(root,async()=>{
    assert.equal(await readFile(path.join(lockDirectory,'application.lock'),'utf8').then(Boolean),true);
    await assert.rejects(acquireLock(lockDirectory),/already running/);
    called=true;
  });
  assert.equal(called,true);
  await assert.rejects(readFile(path.join(lockDirectory,'application.lock'),'utf8'),{code:'ENOENT'});
});
