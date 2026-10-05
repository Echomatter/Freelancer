import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from '../server/application.mjs';
import { createHost } from '../server/host.mjs';
import { createStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
import { createRemoteAccess } from '../server/remote-access.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { checkedCatalog } from '../backend/tools/runtime/agent-catalog.mjs';
import { defaults } from '../shared/strategy.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function within(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(message)), 2500);
    })]);
  } finally { clearTimeout(timer); }
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'freelancer-project-ready-')));
  const backendRoot = path.join(root, 'backend'), directory = path.join(root, 'Café 日本語 # & project');
  const dataRoot = path.join(root, 'workspace-v2'), runtimeID = 'project-readiness-fixture';
  await mkdir(backendRoot); await mkdir(directory);
  const nativeConfig = '{"model":"opencode/free","compaction":{"auto":true,"reserved":4096}}\n';
  await writeFile(path.join(directory, 'opencode.json'), nativeConfig);
  await writeFile(path.join(directory, 'AGENTS.md'), 'User-authored instructions remain here.\n');
  const names = ['FREELANCER_DATA_HOME', 'FREELANCER_RUNTIME_DATA_MODE', 'FREELANCER_RUNTIME_ID'];
  const prior = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { FREELANCER_DATA_HOME: dataRoot, FREELANCER_RUNTIME_DATA_MODE: 'unified', FREELANCER_RUNTIME_ID: runtimeID });
  let app, runtime, store;
  t.after(async () => {
    try {
      if (runtime) await runtime.close();
      else if (app) {
        await app.indexJobs.close(); await app.history.close(); app.modelRatings.close();
        await app.gitProjects.close(); app.localData.close();
      }
      await store?.flush();
      await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    } finally {
      for (const name of names) if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name];
    }
  });
  const initial = createLocalDataStore(dataRoot);
  try { initial.initializeFreshRuntime(runtimeID); } finally { initial.close(); }
  store = createStore(backendRoot);
  const nativeRequests = [], saves = [], preferences = new Map();
  const host = createHost({ url: 'http://127.0.0.1:4096', fetchImpl: async input => {
    const url = new URL(input); nativeRequests.push(url);
    let value = [];
    if (url.pathname === '/experimental/tool/ids') value = ['read', 'delegate', 'knowledge'];
    else if (url.pathname === '/agent') value = checkedCatalog(await store.read('settings')).agents.map(agent => ({ name: agent.id, mode: 'all', permission: [] }));
    else if (url.pathname === '/config') value = JSON.parse(await readFile(path.join(url.searchParams.get('directory'), 'opencode.json'), 'utf8'));
    else if (url.pathname === '/provider') value = { connected: ['opencode'], all: [{ id: 'opencode', models: { free: { cost: { input: 0, output: 0 } } } }] };
    else if (url.pathname === '/session/status' || url.pathname === '/mcp') value = {};
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  } });
  app = createApplication({ backendRoot, store, host, dataRoot, backendFactory: (_, projectDirectory) => ({
    snapshot: async () => ({ preferences: structuredClone(preferences.get(projectDirectory) ?? { scope: 'default', revision: 0, preferences: defaults }), usage: { providers: [] }, receipts: [], history: { entries: [] } }),
    save: async input => { saves.push({ directory: projectDirectory, input }); preferences.set(projectDirectory, { ...input, revision: input.revision + 1 }); },
    refreshQuota: async () => {},
  }) });
  const settingsBefore = await store.read('settings');
  const registry = () => store.read('settings').then(settings => settings.projects.map(project => ({
    project_id: project.id, data: JSON.stringify(project),
  })).sort((a, b) => a.project_id.localeCompare(b.project_id)));
  return { root, directory, app, host, store, nativeRequests, saves, settingsBefore, registry,
    marker: path.join(directory, '.opencode', 'freelancer.json'),
    async untouched() {
      assert.deepEqual(await store.read('settings'), settingsBefore);
      assert.deepEqual(await registry(), []); assert.deepEqual(saves, []);
      await assert.rejects(readFile(path.join(directory, '.opencode', 'freelancer.json')), { code: 'ENOENT' });
      assert.equal(await readFile(path.join(directory, 'opencode.json'), 'utf8'), nativeConfig);
      assert.equal(await readFile(path.join(directory, 'AGENTS.md'), 'utf8'), 'User-authored instructions remain here.\n');
    },
    async startHTTP() {
      runtime = await startServer({ application: app, assets: backendRoot, timers: false,
        remoteAccess: await createRemoteAccess({ file: path.join(root, 'remote-access.json') }) });
      return runtime;
    },
  };
}

test('project registration waits for native readiness before acknowledging or writing policy, marker and registry', async t => {
  const f = await fixture(t), entered = deferred(), ready = deferred();
  t.after(() => ready.resolve(['read']));
  f.host.ensureReady = async options => { entered.resolve(options); return ready.promise; };
  let settled = false;
  const pending = f.app.addProject(path.join(f.directory, '..', path.basename(f.directory))).finally(() => { settled = true; });
  const options = await within(entered.promise, 'Native readiness was not requested.');
  assert.equal(options.directory, await realpath(f.directory)); assert.equal(options.timeoutMs, 55_000);
  assert.equal(settled, false); await f.untouched();
  ready.resolve(['read', 'knowledge']);
  const project = await pending;
  assert.equal(project.directory, options.directory);
  assert.equal(f.saves.length, 1); assert.equal(f.saves[0].directory, options.directory);
  const registrations = await f.registry();
  assert.equal(registrations.length, 1); assert.equal(registrations[0].project_id, project.id);
  assert.equal(JSON.parse(await readFile(f.marker, 'utf8')).projectID, project.id);
});

test('failed native project readiness preserves vanilla registration state and existing authored files', async t => {
  const f = await fixture(t), failure = Object.assign(Error('Native initialization failed.'), { status: 503 });
  let calls = 0;
  f.host.ensureReady = async () => { calls++; throw failure; };
  await assert.rejects(f.app.addProject(path.join(f.root, 'missing-folder')), /does not exist/);
  assert.equal(calls, 0, 'Folder validation precedes native initialization.');
  await assert.rejects(f.app.addProject(f.directory), error => error === failure);
  assert.equal(calls, 1); await f.untouched();
});

test('native project readiness deadline failure cannot become a successful registration', async t => {
  const f = await fixture(t), failure = new DOMException('Native initialization deadline expired.', 'TimeoutError');
  f.host.ensureReady = async ({ timeoutMs }) => { assert.equal(timeoutMs, 55_000); throw failure; };
  await assert.rejects(f.app.addProject(f.directory), error => error === failure);
  await f.untouched();
});

test('canceling pending native project readiness prevents registration writes', async t => {
  const f = await fixture(t), entered = deferred(), controller = new AbortController();
  f.host.ensureReady = ({ signal }) => new Promise((resolve, reject) => {
    entered.resolve(signal);
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  const pending = f.app.addProject(f.directory, { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  const signal = await within(entered.promise, 'Native initialization did not receive cancellation.');
  assert.equal(signal, controller.signal);
  controller.abort(); await rejected;
  await f.untouched();
});

test('registration rechecks cancellation even when native readiness returns a late successful result', async t => {
  const f = await fixture(t), controller = new AbortController();
  f.host.ensureReady = async ({ signal }) => { assert.equal(signal, controller.signal); controller.abort(); return ['read']; };
  await assert.rejects(f.app.addProject(f.directory, { signal: controller.signal }), { name: 'AbortError' });
  await f.untouched();
});

test('successful native readiness uses exact canonical project URLs and repeated registration remains unique', async t => {
  const f = await fixture(t);
  assert.equal(typeof f.host.ensureReady, 'function');
  const first = await f.app.addProject(f.directory);
  await f.app.updateProject(first.id, { name: 'Preserved project name' });
  const second = await f.app.addProject(path.join(f.directory, '.'));
  assert.equal(second.id, first.id); assert.equal(second.name, 'Preserved project name');
  const readyRequests = f.nativeRequests.filter(url => url.pathname === '/experimental/tool/ids');
  assert.equal(readyRequests.length, 2, 'Successful readiness is rechecked, without inventing a permanent success cache.');
  for (const url of readyRequests) {
    assert.equal(url.searchParams.get('directory'), await realpath(f.directory));
    assert.equal(url.origin, 'http://127.0.0.1:4096');
    assert.equal(url.searchParams.has('model'), false);
  }
  assert.equal((await f.registry()).length, 1); assert.equal(f.saves.length, 1);
  const bootstrap = await f.app.bootstrap(first.id);
  assert.equal(bootstrap.project.id, first.id); assert.equal(bootstrap.nativeModels.engineer, 'opencode/free');
  assert.equal((await f.store.read('settings')).projects.length, 1);
  assert.equal(JSON.parse(await readFile(f.marker, 'utf8')).projectID, first.id);
});

test('disconnecting project HTTP registration cancels its native wait and prevents a late acknowledgment or writes', async t => {
  const f = await fixture(t), entered = deferred(), aborted = deferred(), finished = deferred();
  f.host.ensureReady = ({ directory, signal, timeoutMs }) => new Promise((resolve, reject) => {
    assert.equal(directory, f.directory); assert.equal(timeoutMs, 55_000);
    assert.ok(signal instanceof AbortSignal); entered.resolve(signal);
    const abort = () => { aborted.resolve(signal); reject(signal.reason); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  const original = f.app.addProject.bind(f.app);
  f.app.addProject = (...args) => {
    const pending = original(...args); pending.then(() => finished.resolve('success'), error => finished.resolve(error));
    return pending;
  };
  const web = await f.startHTTP(), transport = deferred();
  let responded = false;
  const req = http.request(web.url + '/api/projects', { method: 'POST', headers: {
    'X-Freelancer-Client': 'webpage', 'Content-Type': 'application/json',
  } }, res => { responded = true; res.resume(); transport.resolve(); });
  req.on('error', error => transport.resolve(error));
  req.end(JSON.stringify({ directory: f.directory }));
  t.after(() => req.destroy());
  const signal = await within(entered.promise, 'HTTP registration did not enter native initialization.');
  assert.equal(responded, false); await f.untouched();
  req.destroy();
  await within(transport.promise, 'HTTP fixture connection did not close.');
  assert.equal(await within(aborted.promise, 'HTTP disconnect did not abort native initialization.'), signal);
  const result = await within(finished.promise, 'Canceled registration did not settle.');
  assert.equal(result.name, 'AbortError'); assert.equal(responded, false);
  await f.untouched();
});
