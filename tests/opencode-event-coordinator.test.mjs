import test from 'node:test';
import assert from 'node:assert/strict';
import { openCodeSourceIdentity } from '../server/data/opencode-warehouse.mjs';
import { createOpenCodeEventCoordinator } from '../server/opencode-event-coordinator.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { codexHistoryFixture } from './fixtures/codex-history.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function refreshStore(history = {}) {
  let sequence = 0;
  return Object.assign({
    async markWarehouseRefreshNeeded({ projectID, sessionID }) {
      return { id: `refresh_${++sequence}`, revision: 1, projectID, sessionID };
    },
    async clearWarehouseRefreshNeeded() { return { cleared: true }; },
    async failWarehouseRefreshNeeded() { return { failed: true }; },
    async listWarehouseRefreshNeeded() { return []; },
  }, history);
}
async function waitFor(predicate, message = 'condition was not reached') {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(message);
}

function eventHost() {
  const channels = new Map();
  let opens = 0;
  return {
    get opens() { return opens; },
    events(directory, signal) {
      opens++;
      const encoder = new TextEncoder();
      let controller;
      const stream = new ReadableStream({
        start(value) { controller = value; },
        cancel() { channels.delete(directory); },
      });
      const channel = {
        send(value) { if (!signal.aborted) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)); },
        sendMany(values) { if (!signal.aborted) controller.enqueue(encoder.encode(values.map(value => `data: ${JSON.stringify(value)}\n\n`).join(''))); },
        fail(error) { try { controller.error(error); } catch {} },
        close() { try { controller.close(); } catch {} },
      };
      channels.set(directory, channel);
      signal.addEventListener('abort', () => {
        channels.delete(directory);
        try { controller.close(); } catch {}
      }, { once: true });
      return Promise.resolve(stream);
    },
    send(directory, value) { channels.get(directory)?.send(value); },
    sendMany(directory, values) { channels.get(directory)?.sendMany(values); },
    fail(directory, error = Error('fixture stream disconnected')) { channels.get(directory)?.fail(error); },
  };
}

const messageEvent = sessionID => ({
  type: 'message.part.updated',
  properties: { part: { id: 'part_fixture', sessionID } },
});

test('native message hints coalesce per session and refresh both parent and worker snapshots', async t => {
  const calls = [];
  const host = eventHost();
  const store = { read: async () => ({ projects: [
    { id: 'one', directory: 'C:/projects/one' },
    { id: 'two', directory: 'C:/projects/two' },
  ] }) };
  const history = refreshStore({ async refreshSessionSnapshot(projectID, sessionID) {
    calls.push({ projectID, sessionID });
    await tick();
    return { captured: true };
  } });
  const coordinator = createOpenCodeEventCoordinator({ host, store, history, reconnectMs: 5, projectRefreshMs: 100_000 });
  t.after(() => coordinator.stop());
  await coordinator.refreshProjects();
  assert.equal(host.opens, 2);
  host.sendMany('C:/projects/one', [
    { type: 'message.removed', properties: { sessionID: 'ses_parent' } },
    { type: 'session.compacted', properties: { info: { id: 'ses_parent' } } },
    { type: 'session.status', properties: { sessionID: 'ses_worker' } },
  ]);
  host.send('C:/projects/other', messageEvent('ses_wrong_project'));
  await waitFor(() => calls.length >= 2);
  await coordinator.flush();
  assert.equal(calls.filter(row => row.sessionID === 'ses_parent').length, 1, 'repeated hints for a pending/current read coalesce');
  assert.deepEqual(calls, [
    { projectID: 'one', sessionID: 'ses_parent' },
    { projectID: 'one', sessionID: 'ses_worker' },
  ]);
  assert.equal(coordinator.status.snapshots, 2);
  assert.equal(coordinator.status.unaddressableHints, 0, 'unknown projects cannot enqueue session IDs');
});

test('snapshot refresh verifies native project ownership and records only authoritative message responses', async t => {
  const fixture = await localDataFixture();
  t.after(() => fixture.close());
  const row = text => ({ info: { id: 'msg_event', role: 'assistant', time: { created: 100 } },
    parts: [{ id: 'part_event', type: 'text', text }] });
  fixture.state.messages.ses_history = [row('initial event snapshot')];
  const source = openCodeSourceIdentity(await fixture.host.databasePath());
  const read = () => fixture.app.localData.get().readOpenCodeSession({ projectID: fixture.project.id,
    sessionID: 'ses_history', sourceSystemID: source.sourceSystemID });

  const first = await fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_history');
  assert.equal(first.captured, true);
  assert.equal(read().messages[0].parts[0].text, 'initial event snapshot');

  fixture.state.messages.ses_history = [{ ...row('unsupported role'), info: { ...row('x').info, role: 'system' } }];
  await assert.rejects(fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_history'), /malformed message snapshot/);
  fixture.state.messages.ses_history = [{ ...row('foreign message'), info: { ...row('x').info, sessionID: 'ses_other' } }];
  await assert.rejects(fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_history'), /malformed message snapshot/);
  assert.equal(read().messages[0].parts[0].text, 'initial event snapshot', 'unsupported or foreign message rows cannot alter stored evidence');

  fixture.state.sessions.push({ id: 'ses_foreign', title: 'Foreign', directory: 'C:/not-registered', time: { created: 1, updated: 2 } });
  await assert.rejects(fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_foreign'), /belongs to another project/);
  assert.equal(fixture.app.localData.get().readOpenCodeSession({ projectID: fixture.project.id, sessionID: 'ses_foreign' }).status, 'missing');

  fixture.state.messages.ses_history = [row('denied update must not replace evidence')];
  const originalRequest = fixture.host.request.bind(fixture.host);
  fixture.host.request = async (route, options) => {
    if (route.endsWith('/message')) throw Object.assign(Error('native read denied'), { status: 403 });
    return originalRequest(route, options);
  };
  await assert.rejects(fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_history'), /native read denied/);
  assert.equal(read().messages[0].parts[0].text, 'initial event snapshot');
  fixture.host.request = originalRequest;

  fixture.state.messages.ses_history = [row('x'.repeat(8 * 1024 * 1024 + 1))];
  const bounded = await fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_history');
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.completeness, 'partial');
  assert.equal(read().messages[0].parts[0].text, 'initial event snapshot', 'a byte-capped partial refresh cannot erase retained messages');

  let headerRelease, headerEnteredResolve;
  const headerEntered = new Promise(resolve => { headerEnteredResolve = resolve; });
  const headerBlocked = new Promise(resolve => { headerRelease = resolve; });
  fixture.host.request = async (route, options) => {
    if (route === '/session/ses_history') {
      assert.ok(options.signal instanceof AbortSignal, 'the native session-header request receives stop cancellation');
      headerEnteredResolve();
      await headerBlocked;
    }
    return originalRequest(route, options);
  };
  const headerController = new AbortController();
  const headerPending = fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_history', { signal: headerController.signal });
  await headerEntered;
  headerController.abort();
  headerRelease();
  await assert.rejects(headerPending, { name: 'AbortError' });
  assert.equal(read().messages[0].parts[0].text, 'initial event snapshot');

  let release, enteredResolve;
  const entered = new Promise(resolve => { enteredResolve = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  fixture.host.request = async (route, options) => {
    if (route.endsWith('/message')) { enteredResolve(); await blocked; }
    return originalRequest(route, options);
  };
  fixture.state.messages.ses_history = [row('late response after stop')];
  const controller = new AbortController();
  const pending = fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_history', { signal: controller.signal });
  await entered;
  controller.abort();
  release();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(read().messages[0].parts[0].text, 'initial event snapshot', 'an aborted native read cannot write a late snapshot');

  fixture.host.request = async (route, options) => {
    if (route.endsWith('/message')) {
      await fixture.store.update('settings', settings => ({ ...settings,
        projects: settings.projects.map(project => project.id === fixture.project.id ? { ...project, directory: fixture.root } : project) }));
    }
    return originalRequest(route, options);
  };
  await assert.rejects(fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_history'), /no longer registered/);
  assert.equal(read().messages[0].parts[0].text, 'initial event snapshot', 'a project move during the native read prevents persistence');
});

test('a replacement subscription cannot lose its first hint to an aborted read from the old generation', async () => {
  const host = eventHost();
  let directory = 'C:/projects/old';
  const store = { read: async () => ({ projects: [{ id: 'same-project', directory }] }) };
  const calls = [];
  const history = refreshStore({ async refreshSessionSnapshot(projectID, sessionID, { signal }) {
    calls.push({ projectID, sessionID });
    if (calls.length === 1) {
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name: 'AbortError' })), { once: true }));
    }
    signal.throwIfAborted();
    return { captured: true };
  } });
  const coordinator = createOpenCodeEventCoordinator({ host, store, history, concurrency: 1, projectRefreshMs: 100_000 });
  await coordinator.refreshProjects();
  host.send('C:/projects/old', messageEvent('ses_same'));
  await waitFor(() => calls.length === 1, 'old generation starts its read');
  directory = 'C:/projects/new';
  await coordinator.refreshProjects();
  host.send('C:/projects/new', messageEvent('ses_same'));
  await waitFor(() => calls.length === 2, 'replacement generation receives the same session hint');
  await coordinator.flush();
  assert.equal(coordinator.status.snapshots, 1, 'only the replacement generation can report a completed capture');
  assert.deepEqual(calls, [
    { projectID: 'same-project', sessionID: 'ses_same' },
    { projectID: 'same-project', sessionID: 'ses_same' },
  ]);
  await coordinator.stop();
});

test('stream reconnects, failed snapshots stay retryable, overflow is reported, and shutdown cancels pending work', async t => {
  const host = eventHost();
  const store = { read: async () => ({ projects: [{ id: 'p', directory: 'C:/project' }] }) };
  const calls = [];
  let failure = true, release;
  const blocked = new Promise(resolve => { release = resolve; });
  const history = refreshStore({ async refreshSessionSnapshot(projectID, sessionID, { signal }) {
    calls.push(sessionID);
    if (failure) { failure = false; throw Object.assign(Error('native denied'), { status: 403 }); }
    if (sessionID === 'ses_blocked') await Promise.race([blocked, new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))]);
    signal.throwIfAborted();
    return { captured: true };
  } });
  const coordinator = createOpenCodeEventCoordinator({ host, store, history, concurrency: 1, maxPending: 1,
    reconnectMs: 5, projectRefreshMs: 100_000 });
  t.after(() => coordinator.stop());
  await coordinator.refreshProjects();
  host.send('C:/project', messageEvent('ses_denied'));
  await waitFor(() => coordinator.status.failures > 0);
  host.fail('C:/project');
  await waitFor(() => host.opens >= 2, 'event stream reconnect');
  host.send('C:/project', messageEvent('ses_retry'));
  await waitFor(() => coordinator.status.snapshots === 1);
  host.send('C:/project', messageEvent('ses_blocked'));
  await waitFor(() => calls.includes('ses_blocked'));
  host.send('C:/project', messageEvent('ses_queued'));
  host.send('C:/project', messageEvent('ses_overflow'));
  await waitFor(() => coordinator.status.droppedHints === 1);
  await coordinator.stop();
  release();
  assert.equal(coordinator.status.subscribedProjects, 0);
  assert.equal(coordinator.status.pendingSessions, 0);
  assert.equal(calls.includes('ses_overflow'), false);
  assert.equal(coordinator.status.snapshots, 1, 'failed, aborted, and dropped hints are not reported as captures');
});

test('shutdown waits for deferred project discovery without starting a late subscription', async () => {
  let release;
  const read = new Promise(resolve => { release = resolve; });
  const host = eventHost();
  const coordinator = createOpenCodeEventCoordinator({ host, store: { read: () => read },
    history: refreshStore({ refreshSessionSnapshot: async () => ({ captured: true }) }), projectRefreshMs: 100_000 });
  const syncing = coordinator.refreshProjects();
  const stopping = coordinator.stop();
  release({ projects: [{ id: 'late-project', directory: 'C:/late' }] });
  await Promise.all([syncing, stopping]);
  assert.equal(host.opens, 0);
  assert.equal(coordinator.status.subscribedProjects, 0);
});

test('startup resumes persisted session hints and clears them only after a safe authoritative snapshot', async t => {
  const host = eventHost(), cleared = [], failed = [], calls = [];
  const rows = [{ id: 'refresh_saved', revision: 3, projectID: 'p', sessionID: 'ses_saved', reason: 'stream-failed', state: 'pending' }];
  const history = refreshStore({
    async listWarehouseRefreshNeeded() { return rows.filter(row => row.state === 'pending'); },
    async refreshSessionSnapshot(projectID, sessionID) {
      calls.push({ projectID, sessionID });
      return { captured: true, adequateCapture: true };
    },
    async clearWarehouseRefreshNeeded(input) {
      cleared.push(input);
      const row = rows.find(item => item.id === input.id && item.revision === input.revision);
      if (row) row.state = 'cleared';
      return { cleared: !!row };
    },
    async failWarehouseRefreshNeeded(input) { failed.push(input); return { failed: true }; },
    async processWarehouseDerivationJobs() { return { processed: 0 }; },
  });
  const coordinator = createOpenCodeEventCoordinator({ host, store: { read: async () => ({ projects: [{ id: 'p', directory: 'C:/p' }] }) },
    history, projectRefreshMs: 100_000, reconciliationIntervalMs: 100_000 });
  t.after(() => coordinator.stop());
  coordinator.start();
  await waitFor(() => cleared.length === 1, 'the persisted marker is retried during startup recovery');
  await coordinator.flush();
  assert.deepEqual(calls, [{ projectID: 'p', sessionID: 'ses_saved' }]);
  assert.deepEqual(cleared, [{ id: 'refresh_saved', revision: 3 }]);
  assert.equal(failed.length, 0);
});

test('source-wide dirty markers fan out to registered projects before bounded recovery', async t => {
  const host = eventHost(), marks = [], cleared = [];
  let sourceMarker = true;
  const history = refreshStore({
    async listWarehouseRefreshNeeded() {
      if (sourceMarker) return [{ id: 'refresh_source', revision: 1, projectID: null, sessionID: null, reason: 'overflow' }];
      return [];
    },
    async markWarehouseRefreshNeeded(input) { marks.push(input); return { id: `child_${marks.length}`, revision: 1, ...input }; },
    async clearWarehouseRefreshNeeded(input) { cleared.push(input); sourceMarker = false; return { cleared: true }; },
    async processWarehouseDerivationJobs() { return { processed: 0 }; },
    async refreshSessionSnapshot() { return { captured: true, adequateCapture: true }; },
  });
  const coordinator = createOpenCodeEventCoordinator({ host, store: { read: async () => ({ projects: [
    { id: 'p1', directory: 'C:/p1' }, { id: 'p2', directory: 'C:/p2' },
  ] }) }, history, projectRefreshMs: 100_000, reconciliationIntervalMs: 100_000 });
  t.after(() => coordinator.stop());
  coordinator.start();
  await waitFor(() => cleared.length === 1, 'source-wide uncertainty is expanded before its marker is acknowledged');
  assert.deepEqual(marks.filter(row => row.reason === 'overflow').map(row => row.projectID).sort(), ['p1', 'p2']);
  assert.deepEqual(cleared, [{ id: 'refresh_source', revision: 1 }]);
});

test('indexing an imported Codex conversation preserves search without recording an OpenCode source', async t => {
  const fixture = await localDataFixture();
  t.after(() => fixture.close());
  await codexHistoryFixture(fixture);
  const preview = await fixture.app.chatgpt.preview(fixture.directory);
  const setup = await fixture.app.chatgpt.complete(preview.token, ['codex-exact']);
  const imported = fixture.app.chatgpt.list(setup.project.id)[0];
  const chat = fixture.app.chatgpt.get(setup.project.id, imported.id);
  await fixture.app.history.indexCurrent(setup.project.id, imported.id, chat.messages);
  const search = await fixture.app.history.searchChats('turquoise', { project: setup.project.id });
  assert.ok(search.results.some(row => row.session === imported.id));
  assert.equal(fixture.app.localData.get().readOpenCodeSession({ projectID: setup.project.id, sessionID: imported.id }).status, 'missing');
});

test('OpenCode identity failures retry, and closing history cancels in-flight indexes before late writes', async t => {
  {
    const fixture = await localDataFixture();
    t.after(() => fixture.close());
    fixture.state.messages.ses_history = [{ info: { id: 'msg_retry_identity', role: 'assistant', time: { created: 1 } },
      parts: [{ id: 'part_retry_identity', type: 'text', text: 'identity retry remains searchable' }] }];
    const databasePath = fixture.host.databasePath.bind(fixture.host);
    let attempts = 0;
    fixture.host.databasePath = async () => {
      attempts++;
      if (attempts === 1) throw Error('transient native database locator failure');
      return databasePath();
    };
    await assert.rejects(fixture.app.history.indexCurrent(fixture.project.id, 'ses_history', fixture.state.messages.ses_history), /transient native database locator/);
    await fixture.app.history.indexCurrent(fixture.project.id, 'ses_history', fixture.state.messages.ses_history);
    assert.equal(attempts, 2, 'failed locator resolution is not cached permanently');
    assert.equal(fixture.app.localData.get().readOpenCodeSession({ projectID: fixture.project.id, sessionID: 'ses_history' }).status, 'ok');
  }
  {
    const fixture = await localDataFixture();
    t.after(() => fixture.close());
    fixture.state.messages.ses_history = [{ info: { id: 'msg_close_header', role: 'assistant', time: { created: 1 } },
      parts: [{ id: 'part_close_header', type: 'text', text: 'must not persist after header cancellation' }] }];
    const originalRequest = fixture.host.request.bind(fixture.host);
    let enteredResolve;
    const entered = new Promise(resolve => { enteredResolve = resolve; });
    fixture.host.request = async (route, options = {}) => {
      if (route === '/session/ses_history') {
        enteredResolve();
        await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      }
      return originalRequest(route, options);
    };
    const pending = fixture.app.history.indexCurrent(fixture.project.id, 'ses_history', fixture.state.messages.ses_history);
    await entered;
    await fixture.app.history.close();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(fixture.app.localData.get().readOpenCodeSession({ projectID: fixture.project.id, sessionID: 'ses_history' }).status, 'missing');
  }
  {
    const fixture = await localDataFixture();
    t.after(() => fixture.close());
    fixture.state.messages.ses_history = [{ info: { id: 'msg_close_source', role: 'assistant', time: { created: 1 } },
      parts: [{ id: 'part_close_source', type: 'text', text: 'must not persist after source lookup cancellation' }] }];
    const databasePath = fixture.host.databasePath.bind(fixture.host);
    let enteredResolve, release;
    const entered = new Promise(resolve => { enteredResolve = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    fixture.host.databasePath = async () => { enteredResolve(); await waiting; return databasePath(); };
    const pending = fixture.app.history.indexCurrent(fixture.project.id, 'ses_history', fixture.state.messages.ses_history);
    await entered;
    await fixture.app.history.close();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(fixture.app.localData.get().readOpenCodeSession({ projectID: fixture.project.id, sessionID: 'ses_history' }).status, 'missing');
    release();
    await tick();
    assert.equal(fixture.app.localData.get().readOpenCodeSession({ projectID: fixture.project.id, sessionID: 'ses_history' }).status, 'missing',
      'a shared locator that finishes after close cannot write through the canceled index');
  }
});

test('archive and registration changes during source identity lookup prevent all snapshot writes', async t => {
  for (const change of ['archiving', 'directory']) {
    const fixture = await localDataFixture();
    t.after(() => fixture.close());
    fixture.state.messages.ses_history = [{ info: { id: 'msg_during_lookup', role: 'assistant', time: { created: 1 } },
      parts: [{ id: 'part_during_lookup', type: 'text', text: `must not persist while ${change}` }] }];
    let release, enteredResolve;
    const entered = new Promise(resolve => { enteredResolve = resolve; });
    const waiting = new Promise(resolve => { release = resolve; });
    const databasePath = fixture.host.databasePath.bind(fixture.host);
    fixture.host.databasePath = async () => { enteredResolve(); await waiting; return databasePath(); };
    const pending = fixture.app.history.refreshSessionSnapshot(fixture.project.id, 'ses_history');
    await entered;
    if (change === 'archiving') fixture.app.indexJobs.isArchiving = () => true;
    else await fixture.store.update('settings', settings => ({ ...settings,
      projects: settings.projects.map(project => project.id === fixture.project.id ? { ...project, directory: fixture.root } : project) }));
    release();
    await assert.rejects(pending, change === 'archiving' ? /archiving or archived/ : /no longer registered/);
    assert.equal(fixture.app.localData.get().readOpenCodeSession({ projectID: fixture.project.id, sessionID: 'ses_history' }).status, 'missing');
  }
});
