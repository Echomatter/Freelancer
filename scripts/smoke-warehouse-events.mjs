// Real native SSE -> authoritative snapshot capture, using disposable empty chats.
// Installed source dependencies only; no prompts, provider calls or model inference.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { startHost } from '../server/host.mjs';
import { createApplication } from '../server/application.mjs';
import { createOpenCodeEventCoordinator } from '../server/opencode-event-coordinator.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { FRESH_RUNTIME_ID, runtimeEnv } from '../server/runtime-config.mjs';
import { nativeSmokeConfigPaths, seedNativeSmokeDependencies } from './native-smoke-fixture.mjs';

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'freelancer-warehouse-events-'));
const backendRoot = path.join(fixtureRoot, 'backend');
const directory = path.join(fixtureRoot, 'project');
const { xdgConfigHome, nativeConfig } = nativeSmokeConfigPaths(fixtureRoot);
const nativeHome = path.join(fixtureRoot, 'native-home');
const nativeTemp = path.join(fixtureRoot, 'native-temp');
const config = { backendRoot, dataRoot: path.join(fixtureRoot, 'data'), runtimeID: FRESH_RUNTIME_ID,
  opencodePlugins: [], instructions: [] };
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|TEMP|TMP|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
const env = { ...inherited, ...runtimeEnv(config), OPENCODE_CONFIG_DIR: nativeConfig, XDG_CONFIG_HOME: xdgConfigHome,
  XDG_DATA_HOME: path.join(fixtureRoot, 'native-data'), XDG_CACHE_HOME: path.join(fixtureRoot, 'cache'),
  XDG_STATE_HOME: path.join(fixtureRoot, 'state'), OPENCODE_TEST_HOME: nativeHome, HOME: nativeHome, USERPROFILE: nativeHome,
  APPDATA: path.join(nativeHome, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(nativeHome, 'AppData', 'Local'),
  TEMP: nativeTemp, TMP: nativeTemp };
const priorRuntime = Object.fromEntries(Object.keys(runtimeEnv(config)).map(key => [key, process.env[key]]));
const overall = AbortSignal.timeout(60_000);
let host, app, coordinator;

async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label} exceeded ${milliseconds}ms.`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function waitFor(predicate, label) {
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    overall.throwIfAborted();
    if (predicate()) return;
    await delay(25, undefined, { signal: overall });
  }
  throw Error(`${label} was not observed through native SSE. ${JSON.stringify(coordinator?.status)}`);
}

async function stopNative() {
  const child = host?.process;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await host.request('/global/dispose', { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => {});
  const closed = once(child, 'close');
  host.stop();
  try { await bounded(closed, 5000, 'Native shutdown'); }
  catch {
    child.kill('SIGKILL');
    await bounded(closed, 3000, 'Native forced shutdown');
  }
}

try {
  await Promise.all([backendRoot, directory, xdgConfigHome, nativeConfig, nativeHome, nativeTemp, env.APPDATA, env.LOCALAPPDATA]
    .map(folder => mkdir(folder, { recursive: true })));
  await writeFile(path.join(nativeConfig, 'opencode.jsonc'), '{"autoupdate":false,"share":"disabled"}\n');
  await seedNativeSmokeDependencies({ fixtureRoot, appRoot: fileURLToPath(new URL('..', import.meta.url)),
    nativeConfig, projectDirectories: [backendRoot, directory] });
  Object.assign(process.env, runtimeEnv(config));
  const initialData = createLocalDataStore(config.dataRoot);
  try { initialData.initializeFreshRuntime(config.runtimeID); }
  finally { initialData.close(); }
  host = await startHost({ backendRoot, config, env,
    ...(process.env.FREELANCER_SMOKE_OPENCODE ? { executable: process.env.FREELANCER_SMOKE_OPENCODE } : {}) });
  const nativeRequest = host.request.bind(host);
  const nativeEvents = host.events.bind(host);
  const boundedHost = { ...host,
    request: (route, options = {}) => nativeRequest(route, { ...options,
      signal: AbortSignal.any([options.signal ?? AbortSignal.timeout(15_000), overall]) }),
    events: (projectDirectory, signal) => nativeEvents(projectDirectory, AbortSignal.any([signal, overall])),
  };
  const read = (route, options = {}) => boundedHost.request(route, { directory, ...options });
  const health = await read('/global/health');
  assert.equal(health.version, '1.18.31', 'This native transport proof uses the documented baseline.');

  // Use the actual application registry and history service, with automatic
  // execution disabled. Every authored path and stored row belongs to this fixture.
  app = createApplication({ backendRoot, host: boundedHost, dataRoot: config.dataRoot, automaticWorkAllowed: false });
  const project = { id: 'native-warehouse-events-project', name: 'Native warehouse events fixture', directory };
  await app.store.update('settings', settings => ({ ...settings, projects: [project], lastProjectID: project.id }));
  assert.deepEqual((await app.store.read('settings')).projects, [project]);
  const data = app.localData.get();
  const saved = sessionID => data.readOpenCodeSession({ projectID: project.id, sessionID });
  coordinator = createOpenCodeEventCoordinator({ host: boundedHost, store: app.store, history: app.history });
  coordinator.start();
  await coordinator.refreshProjects();
  await waitFor(() => coordinator.status.subscribedProjects === 1 && coordinator.status.lastEventAt !== null,
    'Initial native event stream');

  const parent = await read('/session', { method: 'POST', body: { title: 'SSE parent initial' } });
  const child = await read('/session', { method: 'POST', body: { title: 'SSE child initial', parentID: parent.id } });
  assert.equal(child.parentID, parent.id);
  const sessions = [parent, child];
  await waitFor(() => sessions.every(session => saved(session.id).status === 'ok'), 'Parent and child header captures');
  await bounded(coordinator.flush(), 5000, 'Initial snapshot flush');
  const initial = sessions.map(session => saved(session.id));
  for (const [index, row] of initial.entries()) {
    assert.equal(row.session.sessionID, sessions[index].id);
    assert.equal(row.session.projectID, project.id);
    assert.equal(row.session.title, sessions[index].title);
    assert.deepEqual(row.messages, []);
    assert.match(row.session.currentRevisionSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(initial[1].session.parentID, parent.id);
  assert.equal(initial[0].session.sourceSystemID, initial[1].session.sourceSystemID);

  const finalTitles = ['SSE parent changed', 'SSE child changed'];
  for (const [index, session] of sessions.entries())
    await read(`/session/${encodeURIComponent(session.id)}`, { method: 'PATCH', body: { title: finalTitles[index] } });
  await waitFor(() => sessions.every((session, index) => saved(session.id).session?.title === finalTitles[index]),
    'Changed native header revisions');
  await bounded(coordinator.flush(), 5000, 'Changed snapshot flush');
  assert.equal(coordinator.status.failures, 0, JSON.stringify(coordinator.status));
  assert.equal(coordinator.status.droppedHints, 0);
  assert.ok(coordinator.status.snapshots >= 4, 'Both initial and changed headers came through coordinator captures.');

  let retainedRevisions = 0;
  for (const [index, session] of sessions.entries()) {
    const current = saved(session.id);
    const native = await read(`/session/${encodeURIComponent(session.id)}`);
    assert.equal(current.status, 'ok');
    assert.equal(current.session.sessionID, native.id);
    assert.equal(current.session.title, native.title);
    assert.equal(current.session.parentID, native.parentID ?? null);
    assert.deepEqual(current.messages, []);
    assert.deepEqual(await read(`/session/${encodeURIComponent(session.id)}/message`), []);
    assert.notEqual(current.session.currentRevisionSha256, initial[index].session.currentRevisionSha256);
    const revisions = await data.analyze(`SELECT revision_sha256 AS revisionSha256, payload_json AS payloadJson
      FROM opencode_session_revisions WHERE source_system_id=$source AND project_id=$project AND session_id=$session
      ORDER BY captured_at, revision_sha256`, {
      $source: current.session.sourceSystemID, $project: project.id, $session: session.id,
    });
    const original = revisions.rows.find(row => row.revisionSha256 === initial[index].session.currentRevisionSha256);
    const changed = revisions.rows.find(row => row.revisionSha256 === current.session.currentRevisionSha256);
    assert.ok(original && changed, 'The changed header must retain the exact earlier immutable revision.');
    assert.equal(JSON.parse(original.payloadJson).title, session.title);
    assert.equal(JSON.parse(changed.payloadJson).title, finalTitles[index]);
    retainedRevisions += revisions.rows.length;
  }
  const coverage = data.openCodeCoverage();
  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].sessions, 2);
  assert.equal(coverage[0].messages, 0);
  const sourceVersion = await data.analyze('SELECT api_version AS version FROM opencode_sources WHERE source_system_id=$source',
    { $source: initial[0].session.sourceSystemID });
  assert.equal(sourceVersion.rows[0]?.version, health.version, 'Warehouse source metadata records the observed native version.');
  assert.ok(sessions.every(session => data.searchChats(session.id, { project: project.id }).some(hit => hit.session === session.id)));
  console.log(JSON.stringify({ proof: 'native-warehouse-events', opencodeConfigDir:nativeConfig, xdgConfigHome, nativeVersion: health.version,
    sessions: sessions.length, emptyMessages: true, retainedHeaderRevisions: retainedRevisions,
    eventSnapshots: coordinator.status.snapshots, eventFailures: coordinator.status.failures,
    dependencies: 'installed-source-disposable-fixture', inference: false }));
  console.log('Actual OpenCode SSE captured empty parent and child headers, retained initial and changed title revisions, and matched final exact native session retrieval. This proves event transport and source identity; it does not prove message capture, provider authentication, inference or cold dependency installation.');
} finally {
  // Stop event producers and await their active reads before closing the database.
  if (coordinator) {
    try { await bounded(coordinator.stop(), 5000, 'Warehouse coordinator stop'); }
    catch {
      await stopNative();
      await bounded(coordinator.stop(), 5000, 'Warehouse coordinator stop after native exit');
    }
  }
  if (app) {
    await bounded(Promise.all([app.history.close(), app.indexJobs.close(), app.gitProjects.close(), app.store.flush()]),
      5000, 'Application fixture shutdown');
    app.modelRatings.close();
    app.localData.close();
  }
  await stopNative();
  for (const [key, value] of Object.entries(priorRuntime)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const resolved = await realpath(fixtureRoot), temporary = await realpath(os.tmpdir());
  const relative = path.relative(temporary, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
      !path.basename(resolved).startsWith('freelancer-warehouse-events-'))
    throw Error('Unsafe native event fixture cleanup path.');
  await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
