import test from "node:test";
import assert from "node:assert/strict";
import { createHost, hostEnvironment, startHost } from "../server/host.mjs";
import { buildRuntimeConfig } from "../server/runtime-config.mjs";
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {
  let resolve, reject;
  const work = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { work, resolve, reject };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const project = path.resolve('fixtures', 'native-readiness');
const otherProject = path.resolve('fixtures', 'other-readiness');
function hostFixture(t, fetchImpl, extra = {}) {
  const host = createHost({ url: 'http://127.0.0.1:4096', fetchImpl, ...extra });
  t.after(() => host.closePending());
  return host;
}
class FixtureChild extends EventEmitter {
  constructor({ closeDelay = 0 } = {}) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.pid = 765432;
    this.exitCode = null;
    this.signalCode = null;
    this.kills = [];
    this.closed = false;
    this.closeDelay = closeDelay;
  }
  kill(signal = 'SIGTERM') {
    this.kills.push(signal);
    if (this.exitCode !== null || this.signalCode !== null) return false;
    this.signalCode = signal;
    queueMicrotask(() => {
      this.emit('exit', null, signal);
      setTimeout(() => {
        this.stdout.end(); this.stderr.end(); this.closed = true;
        this.emit('close', null, signal);
      }, this.closeDelay);
    });
    return true;
  }
}
function startupFixture(t, { listenDelay = 0, closeDelay = 0, fetchImpl = async target =>
  json(target.pathname === '/global/health' ? { version: '1.18.31' } : ['native-any-tool']), ...options } = {}) {
  const child = new FixtureChild({ closeDelay });
  const calls = [];
  const settings = { backendRoot: project, executable: 'fixture-opencode.exe', fetchImpl,
    spawnImpl: (executable, args, childOptions) => {
      calls.push({ executable, args, options: childOptions });
      const timer = setTimeout(() => {
        if (child.signalCode === null) child.stdout.write('OpenCode server listening on http://127.0.0.1:4096\n');
      }, listenDelay);
      child.once('exit', () => clearTimeout(timer));
      return child;
    }, ...options };
  t.after(async () => {
    if (!child.closed && calls.length) {
      const closed = new Promise(resolve => child.once('close', resolve));
      child.kill(); await closed;
    }
  });
  return { child, calls, settings };
}

test("native host overlays Freelancer plugins without replacing user OpenCode settings or MCP", () => {
  const config = buildRuntimeConfig("F:\\Freelancer");
  const native = { model: "native/provider-model", mcp: { existing: { type: "remote", url: "https://example.invalid/mcp" } }, plugin: ["native-plugin"] };
  const env = hostEnvironment(config, { OPENCODE_CONFIG_CONTENT: JSON.stringify(native), XDG_CONFIG_HOME: "F:\\NativeConfig", XDG_DATA_HOME: "F:\\NativeData" });
  assert.equal(env.FREELANCER_RUNTIME_ROOT, config.backendRoot);
  assert.equal(env.FREELANCER_DATA_HOME, config.dataRoot);
  assert.equal(env.FREELANCER_RUNTIME_DATA_MODE, 'unified');
  assert.equal(env.FREELANCER_RUNTIME_ID, 'freelancer-workspace-v2');
  assert.equal(env.XDG_CONFIG_HOME, "F:\\NativeConfig");
  assert.equal(env.XDG_DATA_HOME, "F:\\NativeData");
  assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT).mcp, native.mcp);
  assert.equal(JSON.parse(env.OPENCODE_CONFIG_CONTENT).model, native.model);
  assert.ok(JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugin.includes("native-plugin"));
  assert.ok(JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugin.some(value => value.endsWith("/delegation.ts")));
  for (const name of ['content-index', 'knowledge', 'model-catalog', 'evidence-evaluation'])
    assert.ok(JSON.parse(env.OPENCODE_CONFIG_CONTENT).plugin.some(value => value.endsWith(`/${name}.ts`)));
  assert.ok(JSON.parse(env.OPENCODE_CONFIG_CONTENT).instructions.some(value => value.endsWith("WORKSTYLE.md")));
  assert.equal(Object.hasOwn(env, "OPENCODE_CONFIG_DIR"), false);
  assert.equal(Object.hasOwn(env, "OPENCODE_CONFIG"), false);
});

test("native host preserves provider error details, status and stable code", async () => {
  const host = createHost({
    url: "http://127.0.0.1:4096",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: { message: "Provider is unavailable" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
  });
  await assert.rejects(host.request("/session"), (error) => {
    assert.equal(error.message, "Provider is unavailable");
    assert.equal(error.status, 503);
    assert.equal(error.code, "OPENCODE_HTTP_503");
    return true;
  });
});

test("native host falls back to a bounded status message for malformed errors", async () => {
  const host = createHost({
    url: "http://127.0.0.1:4096",
    fetchImpl: async () => new Response("not json", { status: 401 }),
  });
  await assert.rejects(host.request("/provider"), (error) => {
    assert.equal(error.message, "OpenCode request failed (401)");
    assert.equal(error.status, 401);
    assert.equal(error.code, "OPENCODE_HTTP_401");
    return true;
  });
});

test('optional host diagnostics report request stages without request bodies or credentials', async () => {
  const events=[];
  const host=createHost({url:'http://127.0.0.1:4096',password:'private-password',diagnostics:event=>events.push(event),
    fetchImpl:async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})});
  await host.request('/config',{method:'PATCH',body:{apiKey:'private-key'}});
  assert.deepEqual(events.map(event=>event.stage),['request-started','request-responded']);
  assert.equal(events[1].status,200);
  assert.ok(events[1].durationMs>=0);
  assert.doesNotMatch(JSON.stringify(events),/private-password|private-key|Authorization|body/);
  const failed=createHost({url:'http://127.0.0.1:4096',diagnostics:event=>events.push(event),fetchImpl:async()=>{throw new DOMException('Cancelled','AbortError');}});
  await assert.rejects(failed.request('/agent'),{name:'AbortError'});
  assert.equal(events.at(-1).stage,'request-failed');
  assert.equal(events.at(-1).error,'AbortError');
});

test('native host optionally exposes only x-next-cursor metadata and preserves ordinary JSON callers', async () => {
  const rows=[{id:'ses_fixture',time:{updated:800}}];
  const host=createHost({url:'http://127.0.0.1:4096',fetchImpl:async()=>new Response(JSON.stringify(rows),{
    headers:{'Content-Type':'application/json','x-next-cursor':'800','set-cookie':'private-cookie','authorization':'private-value'},
  })});
  assert.deepEqual(await host.request('/experimental/session'),rows);
  assert.deepEqual(await host.request('/experimental/session',{responseMetadata:true}),{body:rows,metadata:{'x-next-cursor':'800'}});
  const empty=createHost({url:'http://127.0.0.1:4096',fetchImpl:async()=>new Response(null,{status:204})});
  assert.equal(await empty.request('/session/fixture'),null);
  assert.deepEqual(await empty.request('/session/fixture',{responseMetadata:true}),{body:null,metadata:{'x-next-cursor':null}});
});

test('readiness observes actual project tool IDs without an authority gate or a successful cache', async t => {
  const urls = [], events = [];
  const returned = [[], ['custom-native-tool', 'another-tool']];
  const host = hostFixture(t, async target => { urls.push(target); return json(returned.shift()); },
    { defaultDirectory: project, diagnostics: event => events.push(event) });
  assert.deepEqual(await host.ensureReady(), []);
  assert.deepEqual(await host.ensureReady({ directory: project }), ['custom-native-tool', 'another-tool']);
  assert.equal(urls.length, 2);
  for (const target of urls) {
    assert.equal(target.pathname, '/experimental/tool/ids');
    assert.equal(target.searchParams.get('directory'), project);
  }
  assert.deepEqual(events.filter(event => event.stage === 'readiness-observed').map(event => event.toolCount), [0, 2]);
  assert.doesNotMatch(JSON.stringify(events), /custom-native-tool|another-tool|permission|model|Authorization|body/);
});

test('readiness joins only inflight canonical directories and gives each caller its own result', async t => {
  const reads = [];
  const host = hostFixture(t, (target, options) => {
    const response = deferred(); reads.push({ target, signal: options.signal, response }); return response.work;
  });
  const first = host.ensureReady({ directory: project });
  const alias = path.join(project, 'temporary', '..');
  const second = host.ensureReady({ directory: process.platform === 'win32' ? alias.toUpperCase() : alias });
  const other = host.ensureReady({ directory: otherProject });
  assert.equal(reads.length, 2);
  reads[0].response.resolve(json(['one'])); reads[1].response.resolve(json(['two']));
  const values = await Promise.all([first, second, other]);
  assert.deepEqual(values, [['one'], ['one'], ['two']]);
  values[0].push('only-first');
  assert.deepEqual(values[1], ['one']);
});

test('caller cancellation detaches a readiness waiter without cancelling another caller', async t => {
  const response = deferred(), cancelled = new AbortController();
  let readSignal, reads = 0;
  const host = hostFixture(t, (target, options) => { reads++; readSignal = options.signal; return response.work; });
  const preCancelled = new AbortController(); preCancelled.abort();
  await assert.rejects(host.ensureReady({ directory: project, signal: preCancelled.signal }), { name: 'AbortError' });
  assert.equal(reads, 0);
  const first = host.ensureReady({ directory: project, signal: cancelled.signal });
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const second = host.ensureReady({ directory: project });
  cancelled.abort(); await firstRejected;
  assert.equal(readSignal.aborted, false);
  assert.equal(reads, 1);
  response.resolve(json(['native-tool']));
  assert.deepEqual(await second, ['native-tool']);
});

test('a shorter readiness timeout does not cancel a longer joined native observation', async t => {
  const response = deferred(); let readSignal;
  const host = hostFixture(t, (target, options) => { readSignal = options.signal; return response.work; });
  const first = host.ensureReady({ directory: project, timeoutMs: 20 });
  const firstRejected = assert.rejects(first, { name: 'TimeoutError' });
  const second = host.ensureReady({ directory: project, timeoutMs: 1000 });
  await firstRejected;
  assert.equal(readSignal.aborted, false);
  response.resolve(json(['after-short-waiter']));
  assert.deepEqual(await second, ['after-short-waiter']);
});

test('readiness rejects unsupported tool inventories and failures then retries with a fresh read', async t => {
  const returned = [{ tools: ['one'] }, ['one', 2], { error: 'temporarily unavailable' }, ['recovered']];
  let reads = 0;
  const host = hostFixture(t, async () => json(returned[reads++], reads === 3 ? 503 : 200));
  await assert.rejects(host.ensureReady({ directory: project }), /unsupported response shape/);
  await assert.rejects(host.ensureReady({ directory: project }), /unsupported response shape/);
  await assert.rejects(host.ensureReady({ directory: project }), { code: 'OPENCODE_HTTP_503' });
  assert.deepEqual(await host.ensureReady({ directory: project }), ['recovered']);
  assert.equal(reads, 4);
});

test('native disposal invalidates the matching inflight readiness generation and leaves other scopes intact', async t => {
  const reads = [], disposal = deferred();
  const host = hostFixture(t, (target, options) => {
    if (target.pathname === '/instance/dispose') return disposal.work;
    const response = deferred(); reads.push({ target, response, signal: options.signal }); return response.work;
  }, { defaultDirectory: project });
  const old = host.ensureReady();
  const oldRejected = assert.rejects(old, { name: 'AbortError' });
  const other = host.ensureReady({ directory: otherProject });
  const disposing = host.request('/instance/dispose', { method: 'POST' });
  await oldRejected;
  assert.equal(reads[0].signal.aborted, true);
  assert.equal(reads[1].signal.aborted, false);
  await assert.rejects(host.ensureReady(), /configuration is refreshing/);
  disposal.resolve(json(true)); await disposing;
  const newer = host.ensureReady();
  reads[0].response.resolve(json(['obsolete']));
  await delay(0);
  const joined = host.ensureReady();
  assert.equal(reads.length, 3);
  reads[1].response.resolve(json(['other'])); reads[2].response.resolve(json(['new']));
  assert.deepEqual(await Promise.all([other, newer, joined]), [['other'], ['new'], ['new']]);
});

test('global disposal and shutdown abort bounded readiness even if the fetch adapter ignores its signal', async t => {
  let reads = 0;
  const host = hostFixture(t, target => {
    if (target.pathname === '/global/dispose') return Promise.resolve(json(true));
    reads++; return new Promise(() => {});
  });
  const first = host.ensureReady({ directory: project });
  const second = host.ensureReady({ directory: otherProject });
  const failures = [assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })];
  await host.request('/global/dispose', { method: 'POST' }); await Promise.all(failures);
  const third = host.ensureReady({ directory: project });
  const rejected = assert.rejects(third, { name: 'AbortError' });
  await host.closePending(); await rejected;
  assert.equal(reads, 3);
  await assert.rejects(host.ensureReady({ directory: project }), /OpenCode is closing/);
});

test('readiness timeouts evict the observation and invalid inputs never contact native OpenCode', async t => {
  const signals = [];
  const host = hostFixture(t, (target, options) => { signals.push(options.signal); return new Promise(() => {}); });
  for (const timeoutMs of [0, -1, NaN, Infinity, 75001, 1.5])
    await assert.rejects(host.ensureReady({ directory: project, timeoutMs }), /timeout must be between/);
  await assert.rejects(host.ensureReady({ directory: 'relative' }), /absolute project directory/);
  assert.equal(signals.length, 0);
  await assert.rejects(host.ensureReady({ directory: project, timeoutMs: 10 }), { name: 'TimeoutError' });
  assert.equal(signals[0].aborted, true);
  const retry = host.ensureReady({ directory: project });
  const rejected = assert.rejects(retry, { name: 'AbortError' });
  assert.equal(signals.length, 2);
  await host.closePending(); await rejected;
});

test('startHost returns only after actual backend tool inventory while preserving native configuration', async t => {
  const ready = deferred(), observed = deferred(), events = [];
  const config = { backendRoot: project, dataRoot: path.join(project, 'data') };
  const native = { model: 'native/model', mcp: { existing: { type: 'remote', url: 'https://example.invalid/mcp' } } };
  const fixture = startupFixture(t, { config, env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(native), XDG_CONFIG_HOME: 'fixture-native-config' },
    diagnostics: event => events.push(event), fetchImpl: async (target, options) => {
      if (target.pathname === '/global/health') return json({ version: '1.18.31' });
      observed.resolve({ target, options }); return ready.work;
    } });
  let returned = false;
  const work = startHost(fixture.settings).then(host => { returned = true; return host; });
  const { target, options } = await observed.work;
  assert.equal(returned, false);
  assert.equal(target.pathname, '/experimental/tool/ids');
  assert.equal(target.searchParams.get('directory'), project);
  assert.equal(options.method, 'GET');
  const childEnv = fixture.calls[0].options.env;
  assert.equal(childEnv.XDG_CONFIG_HOME, 'fixture-native-config');
  const actualConfig = JSON.parse(childEnv.OPENCODE_CONFIG_CONTENT);
  assert.equal(actualConfig.model, native.model); assert.deepEqual(actualConfig.mcp, native.mcp);
  assert.equal(actualConfig.plugin.length, 7);
  assert.match(childEnv.OPENCODE_SERVER_PASSWORD, /^[0-9a-f]{64}$/);
  ready.resolve(json(['any-user-native-tool']));
  const host = await work;
  assert.equal(host.nativeVersion, '1.18.31');
  assert.ok(host.startupDeadline > Date.now());
  assert.ok(host.remainingStartupMs() > 0 && host.remainingStartupMs() <= 75000);
  assert.equal(events.at(-1).stage, 'ready');
  assert.doesNotMatch(JSON.stringify(events), /any-user-native-tool|Authorization|password|fixture-native-config/);
  await host.close();
  assert.equal(fixture.child.closed, true);
});

test('startHost shares one deadline across resolution, listening, health and readiness then confirms cleanup', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const observed = deferred(), accessStarted = deferred(), resolverStarted = deferred(), spawned = deferred(), healthStarted = deferred();
  let resolverOptions;
  const fixture = startupFixture(t, { executable: undefined, startupTimeoutMs: 180, listenDelay: 40, closeDelay: 25,
    diagnostics: event => { if (event.stage === 'spawned') spawned.resolve(); },
    accessImpl: async () => { accessStarted.resolve(); await delay(40); throw Error('not installed here'); },
    execImpl: async (executable, args, options) => {
      resolverOptions = options; resolverStarted.resolve(); await delay(40); return { stdout: 'fixture-opencode.exe' };
    },
    fetchImpl: async (target, options) => {
      if (target.pathname === '/global/health') { healthStarted.resolve(); await delay(20); return json({ version: '1.18.31' }); }
      observed.resolve(options.signal); return new Promise(() => {});
    } });
  const before = Date.now();
  const work = startHost(fixture.settings);
  const rejected = assert.rejects(work, { name: 'TimeoutError' });
  const waitForStage = async (stage, name) => {
    const outcome = await Promise.race([
      stage.then(value => ({ value })),
      work.then(() => ({ ended: true }), error => ({ error })),
    ]);
    if (outcome.error) throw outcome.error;
    assert.notEqual(outcome.ended, true, `Startup ended before reaching ${name}.`);
    return outcome.value;
  };
  await waitForStage(accessStarted.work, 'native executable resolution');
  t.mock.timers.tick(40);
  await waitForStage(resolverStarted.work, 'PowerShell executable fallback');
  t.mock.timers.tick(40);
  await waitForStage(spawned.work, 'native process spawn');
  t.mock.timers.tick(40);
  await waitForStage(healthStarted.work, 'native health check');
  t.mock.timers.tick(20);
  const readSignal = await waitForStage(observed.work, 'tool readiness');
  const childExited = new Promise(resolve => fixture.child.once('exit', resolve));
  t.mock.timers.tick(40);
  await childExited;
  t.mock.timers.tick(25);
  await rejected;
  assert.equal(readSignal.aborted, true);
  assert.ok(resolverOptions.timeout < 180 && resolverOptions.timeout > 0);
  assert.equal(resolverOptions.signal.aborted, true);
  assert.equal(resolverOptions.windowsHide, true);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.child.closed, true);
  assert.deepEqual(fixture.child.kills, ['SIGTERM']);
  assert.ok(Date.now() - before >= 180);
});

test('startHost bounds executable resolution without spawning a native child', async () => {
  let spawned = false, resolved = false;
  await assert.rejects(startHost({ backendRoot: project, startupTimeoutMs: 15,
    accessImpl: () => new Promise(() => {}), execImpl: async () => { resolved = true; },
    spawnImpl: () => { spawned = true; } }), { name: 'TimeoutError' });
  assert.equal(spawned, false); assert.equal(resolved, false);
});

test('startHost inventory failure awaits actual child close before rejecting', async t => {
  const events = [];
  const fixture = startupFixture(t, { closeDelay: 30, diagnostics: event => events.push(event),
    fetchImpl: async target => json(target.pathname === '/global/health' ? { version: '1.18.31' } : { wrong: [] }) });
  await assert.rejects(startHost(fixture.settings), /unsupported response shape/);
  assert.equal(fixture.child.closed, true);
  assert.ok(events.findIndex(event => event.stage === 'closed') > events.findIndex(event => event.stage === 'exited'));
  assert.deepEqual(fixture.child.kills, ['SIGTERM']);
});

test('host.close is idempotent, aborts pending readiness and awaits close rather than exit', async t => {
  const fixture = startupFixture(t, { closeDelay: 30 });
  const host = await startHost(fixture.settings);
  let observedClose = false;
  host.whenClosed.then(() => { observedClose = true; });
  const first = host.close(), second = host.close();
  assert.equal(first, second);
  await new Promise(resolve => fixture.child.once('exit', resolve));
  assert.equal(fixture.child.closed, false);
  assert.equal(observedClose, false);
  await first;
  assert.equal(fixture.child.closed, true);
  assert.equal(observedClose, true);
  assert.deepEqual(fixture.child.kills, ['SIGTERM']);
  await assert.rejects(host.ensureReady({ directory: project }), /OpenCode is closing/);
});

test('failed startup exposes a private actual-close observation after bounded shutdown remains uncertain', { timeout: 10000 }, async t => {
  const fixture = startupFixture(t, { fetchImpl: async target =>
    json(target.pathname === '/global/health' ? { version: '1.18.31' } : { wrong: [] }) });
  fixture.child.kill = signal => {
    fixture.child.kills.push(signal);
    fixture.child.signalCode = signal;
    queueMicrotask(() => fixture.child.emit('exit', null, signal));
    return true;
  };
  let failure;
  await assert.rejects(startHost(fixture.settings), error => {
    failure = error;
    assert.equal(error.code, 'OPENCODE_SHUTDOWN_UNCONFIRMED');
    assert.match(error.cause.message, /unsupported response shape/);
    assert.equal(error.whenClosed instanceof Promise, true);
    assert.equal(Object.getOwnPropertyDescriptor(error, 'whenClosed').enumerable, false);
    assert.equal(Object.keys(error).includes('whenClosed'), false);
    return true;
  });
  assert.equal(fixture.child.closed, false);
  let observedClose = false;
  failure.whenClosed.then(() => { observedClose = true; });
  await delay(0);
  assert.equal(observedClose, false);
  // Exit was already observed. Only the later actual close releases ownership.
  fixture.child.stdout.end(); fixture.child.stderr.end(); fixture.child.closed = true;
  fixture.child.emit('close', null, 'SIGTERM');
  await failure.whenClosed;
  assert.equal(observedClose, true);
  assert.deepEqual(fixture.child.kills, ['SIGTERM']);
});

test('diagnostic transport-only opt-out is explicit while product startup warms by default', async t => {
  const urls = [];
  const fixture = startupFixture(t, { waitForReady: false, fetchImpl: async target => {
    urls.push(target.pathname); return json({ version: '1.18.31' });
  } });
  const host = await startHost(fixture.settings);
  assert.deepEqual(urls, ['/global/health']);
  await host.close();
});
