import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../server/data/store.mjs';

const lockProcess = `
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.argv[1]);
try {
  db.exec('BEGIN EXCLUSIVE');
  process.send('locked');
  await new Promise(resolve=>process.once('message',resolve));
  await new Promise(resolve=>setTimeout(resolve,400));
  db.exec('ROLLBACK');
} finally {db.close();process.disconnect();}
`;

for(const readOnly of [false,true])test(`startup ${readOnly?'read-only':'writable'} metadata waits for a brief exclusive lock before inspecting schema`,{timeout:15000},async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'freelancer-startup-contention-'));
  const seeded=createLocalDataStore(root),filename=seeded.filename;
  seeded.close();
  // DELETE journal mode makes an exclusive writer block metadata readers.
  // This isolated fixture's original mode is restored by normal writable startup.
  const setup=new DatabaseSync(filename);
  setup.exec('PRAGMA journal_mode = DELETE');setup.close();
  const child=spawn(process.execPath,['--input-type=module','-e',lockProcess,filename],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
  let diagnostics='';child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-3000);});
  const exited=new Promise(resolve=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',error=>resolve({error}));});
  let opened;
  t.after(async()=>{
    opened?.close();
    if(child.exitCode===null&&child.signalCode===null)child.kill();
    await exited;
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('freelancer-startup-contention-'));
    await rm(root,{recursive:true,force:true});
  });
  await new Promise((resolve,reject)=>{
    child.once('message',message=>message==='locked'?resolve():reject(Error('Expected an exclusive-lock receipt.')));
    child.once('error',reject);
    child.once('exit',code=>reject(Error(`Lock process exited before its receipt (${code}): ${diagnostics}`)));
  });
  const started=performance.now();child.send('release-after-brief-wait');
  opened=createLocalDataStore(root,{readOnly});
  assert.ok(performance.now()-started>=200,'Metadata inspection must wait while the child owns its exclusive lock.');
  assert.equal(opened.info().filename,filename);
  assert.equal(opened.info().sessions,0);
  const outcome=await exited;assert.equal(outcome.code,0,diagnostics);assert.equal(outcome.signal,null);
});
