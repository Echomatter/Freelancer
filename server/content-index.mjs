import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { resolveDataRoot } from './runtime-config.mjs';

const active = new Set();
const MAX_SUMMARY_BYTES=4*1024*1024, MAX_DIAGNOSTIC_CHARS=16384;

// Per-file progress is an unbounded stream over the lifetime of a job. Keep
// only its diagnostic tail; stdout remains a separately bounded JSON receipt.
function execute(file,args,{cwd,env,signal,timeout=600000}={}) {
  const child=spawn(file,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const promise=new Promise((resolve,reject)=>{
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    let stdout='',stderr='',bytes=0,settled=false,pendingError=null;
    const finish=error=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(error) {error.stderr=stderr;reject(error);}else resolve({stdout,stderr});
    };
    const terminate=error=>{
      if(settled || pendingError)return;pendingError=error;clearTimeout(timer);
      // Keep the project/job lease until close confirms the process has exited.
      // Pipes continue draining with bounded retention while termination settles.
      child.kill();
    };
    const abort=()=>terminate(Object.assign(Error('Content indexing was stopped.'),{name:'AbortError'}));
    const timer=setTimeout(()=>terminate(Object.assign(Error('Content indexing exceeded its ten-minute time limit. Narrow the source inventory with Git ignore rules before refreshing.'),{code:'INDEX_TIMEOUT'})),timeout);
    child.stdout.on('data',chunk=>{
      if(settled || pendingError)return;bytes+=Buffer.byteLength(chunk,'utf8');
      if(bytes>MAX_SUMMARY_BYTES)terminate(Object.assign(Error('The index summary exceeded its 4 MiB output limit. Existing indexes may have published; inspect status before retrying.'),{code:'INDEX_OUTPUT_LIMIT'}));
      else stdout+=chunk;
    });
    child.stderr.on('data',chunk=>{if(!settled)stderr=(stderr+chunk).slice(-MAX_DIAGNOSTIC_CHARS);});
    child.once('error',error=>{if(!child.pid)finish(error);else terminate(error);});
    child.once('close',(code)=>finish(pendingError || (code===0?null:Error(`Content indexer exited with code ${code ?? 'unknown'}.`))));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
  promise.child=child;return promise;
}

function rebuildFailure(error) {
  if(error.code==='INDEX_TIMEOUT' || error.code==='INDEX_OUTPUT_LIMIT' || error.name==='AbortError') return error.message;
  const lines=String(error.stderr??'').slice(-MAX_DIAGNOSTIC_CHARS).split(/\r?\n/).filter(line=>line.trim()&&!/^\[\d+\/\d+\]/.test(line));
  for(const line of lines.reverse()) {
    try {const diagnostic=JSON.parse(line);if(typeof diagnostic.error==='string')return diagnostic.error.slice(0,2000);}catch{}
  }
  return String(error.message || 'The indexer could not complete.').slice(0,2000);
}

export async function rebuildContentIndex({ project, backendRoot, dataRoot, run = execute, signal, onProgress = () => {} }) {
  const directory = path.resolve(project.directory);
  const key = process.platform === "win32" ? directory.toLowerCase() : directory;
  if (active.has(key)) throw Object.assign(Error("This project's index is already rebuilding."), { status: 409 });
  active.add(key);
  try {
    const script = path.join(backendRoot, "tools", "project-content-indexer.mjs");
    const database = path.join(dataRoot ?? resolveDataRoot(), "freelancer.sqlite");
    await access(script);
    const args = [script, "--db", database, "--project-key", key, "rebuild", "--root", directory, "--facts", "none"];
    {
      let stdout;
      try {
        const execution = run(process.execPath, args, { cwd: directory, windowsHide: true, timeout: 600000, maxBuffer: MAX_SUMMARY_BYTES, signal,
          env: { ...process.env, FREELANCER_NODE: process.execPath } });
        let buffer = '', lastProgressAt=0;
        execution.child?.stderr?.on('data', chunk => {
          buffer = (buffer + chunk.toString()).slice(-8192);
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop();
          for (const line of lines) {
            const match = line.match(/^\[(\d+)\/(\d+)\]/);
            if (match && (Date.now()-lastProgressAt>=250 || Number(match[1])===Number(match[2]))) {
              lastProgressAt=Date.now();onProgress(`Indexing files · ${project.name} · ${Number(match[1])}/${Number(match[2])} files`);
            }
            if (line === 'Discovering eligible project files…') onProgress(`Finding source files · ${project.name}`);
            if (line === 'Publishing project index…') onProgress(`Saving file index · ${project.name}`);
          }
        });
        ({ stdout } = await execution);
      } catch (error) {
        if(signal?.aborted) signal.throwIfAborted();
        throw Error(`Content index rebuild failed: ${rebuildFailure(error)}`);
      }
      let summary;
      try { summary = JSON.parse(stdout); }
      catch { throw Error("Content index rebuild returned an invalid summary. Check the index before retrying."); }
      signal?.throwIfAborted();
      return summary;
    }
  } finally {
    active.delete(key);
  }
}
