import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../server/http.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createModelDataService } from '../server/model-data.mjs';
import { normalizeModelsDev } from '../domain/model-data.mjs';
import ModelCatalog from '../backend/opencode/plugins/model-catalog.ts';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-model-catalog-http-'));
  const assets = path.join(root, 'assets'); await mkdir(assets);
  await writeFile(path.join(assets, 'index.html'), '<main>Freelancer</main>');
  const db = createLocalDataStore(root); let calls = 0;
  const data = createModelDataService({ localData: { get: () => db }, env: {},
    vault: { available: true, async seal(key) { return 'dpapi-current-user:v1:' + Buffer.from(key).toString('base64'); } },
    fetchSource: async () => {
      calls++;
      return normalizeModelsDev({ providers: {}, models: { model: { id: 'model', name: 'Synthetic canonical', description: 'Fixture metadata',
        license: 'Fixture', benchmarks: [{ name: 'Fixture published benchmark', score: 0.5, metric: 'accuracy' }] } } }, { retrievedAt: Date.now() });
    } });
  data.setNativeModels([{ id: 'fixture/model', provider: 'fixture', api: { id: 'model' } }]);
  const captured = [];
  const application = { modelData: data, modelRatings: { status: () => null, close() {}, start() { throw Object.assign(Error('Retired'), { status: 410 }); } },
    async refreshModelData(input) { return data.refresh(input); },
    async modelDataAgentAction(input) {
      captured.push(input);
      if (input.operation === 'refresh') return data.refresh(input);
      return data.agentAction(input);
    } };
  const oldBridge = process.env.FREELANCER_GIT_BRIDGE, oldRoot = process.env.FREELANCER_RUNTIME_ROOT;
  process.env.FREELANCER_GIT_BRIDGE = 'synthetic-native-bridge';
  const { server, url, close } = await startServer({ application, assets, timers: false });
  t.after(async () => {
    await close(); db.close();
    for (const [name, value] of [['FREELANCER_GIT_BRIDGE', oldBridge], ['FREELANCER_RUNTIME_ROOT', oldRoot]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  const request = async (route, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(url + route, { method, headers: { 'X-Freelancer-Client': 'webpage',
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, value: await response.json() };
  };
  return { root, data, db, captured, url, request, get calls() { return calls; } };
}

test('HTTP reads never fetch; explicit source refresh shares the bounded native tool result and stamps caller context', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/models/data?operation=list')).value.total, 0);
  assert.equal((await f.request('/api/models/data?operation=status')).status, 200);
  assert.equal(f.calls, 0);
  const started = await f.request('/api/models/data', { method: 'POST', body: { operation: 'refresh', sources: ['modelsdev'] } });
  assert.equal(started.status, 202);
  while (f.data.isRunning()) await new Promise(resolve => setTimeout(resolve, 5));
  const ui = (await f.request('/api/models/data?operation=list')).value;
  const runtimeRoot = path.join(f.root, 'runtime');
  await mkdir(path.join(runtimeRoot, 'tools/runtime'), { recursive: true });
  await mkdir(path.join(runtimeRoot, '.state/webpage'), { recursive: true });
  await writeFile(path.join(runtimeRoot, 'tools/runtime/state-database.mjs'), "import {readFileSync} from 'node:fs'; export const readState=file=>JSON.parse(readFileSync(file,'utf8'));\n");
  await writeFile(path.join(runtimeRoot, '.state/webpage/launch.json'), JSON.stringify({ url: f.url }));
  process.env.FREELANCER_RUNTIME_ROOT = runtimeRoot;
  const plugin = await ModelCatalog({ directory: 'fixture-project' });
  const asks = [];
  const context = { sessionID: 'ses_fixture', messageID: 'msg_fixture', abort: new AbortController().signal,
    ask: async input => { asks.push(input); } };
  const tool = plugin.tool.model_catalog;
  const native = JSON.parse((await tool.execute({ operation: 'list' }, context)).output);
  assert.deepEqual(native.records.map(record=>record.id), ui.records.map(record=>record.id));
  assert.equal(native.schema.id,'freelancer.model-observations');assert.equal(native.records[0].observationsRequested,false);
  assert.equal(f.calls, 1); assert.deepEqual(asks, []);
  const schema=JSON.parse((await tool.execute({operation:'schema'},context)).output);
  assert.equal(schema.schema.id,native.schema.id);assert.equal(f.calls,1);
  assert.equal(f.captured.at(-1).directory, 'fixture-project');
  assert.equal(f.captured.at(-1).sessionID, 'ses_fixture'); assert.equal(f.captured.at(-1).messageID, 'msg_fixture');
  const id = ui.records[0].id;
  const uiDetail = (await f.request('/api/models/data?operation=detail&id=' + encodeURIComponent(id))).value;
  const nativeDetail = JSON.parse((await tool.execute({ operation: 'detail', id }, context)).output);
  assert.equal(nativeDetail.records[0].id,uiDetail.record.id);
  assert.equal(nativeDetail.records[0].observations.find(fact=>fact.key==='benchmarks.score').value,0.5);
  assert.deepEqual(nativeDetail.records[0].observations.map(fact=>fact.attribute),uiDetail.facts.map(fact=>fact.attribute));
  await tool.execute({ operation: 'refresh', sources: ['modelsdev'] }, context);
  assert.equal(asks.length, 1); assert.equal(asks[0].permission, 'edit');
  assert.deepEqual(asks[0].patterns, ['shared model catalog']);
  while (f.data.isRunning()) await new Promise(resolve => setTimeout(resolve, 5));
});

test('catalog bridge requires its native credential; credential receipts are write-only and legacy start is retired', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/models/data/agent', { method: 'POST', body: { operation: 'status' } })).status, 403);
  const saved = await f.request('/api/models/data/credentials', { method: 'PUT', body: { artificialAnalysisKey: 'synthetic-write-only-key' } });
  assert.equal(saved.status, 200); assert.equal(saved.value.artificialAnalysis.configured, true);
  const receipt = await f.request('/api/models/data/credentials');
  assert.equal(JSON.stringify(receipt).includes('synthetic-write-only-key'), false);
  assert.equal(JSON.stringify((await f.request('/api/models/data?operation=status')).value).includes('synthetic-write-only-key'), false);
  assert.equal((await f.request('/api/models/ratings', { method: 'POST', body: {} })).status, 410);
  assert.equal((await f.request('/api/models/data', { method: 'POST', body: { operation: 'unknown' } })).status, 400);
  assert.equal((await f.request('/api/models/data?operation=list&limit=10000')).status, 400);
  assert.equal((await f.request('/api/models/data/credentials', { method: 'DELETE' })).value.artificialAnalysis.configured, false);
  assert.equal(f.calls, 0);
});
