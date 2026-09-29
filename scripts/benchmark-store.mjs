// Isolated synthetic comparison with the pre-cache observation algorithm.
// Never opens the live backend state. Run: node scripts/benchmark-store.mjs
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createStore } from '../server/store.mjs';

function baseline(root) {
  const file = name => path.join(root, '.state/webpage', `${name}.json`);
  const read = async name => JSON.parse(await readFile(file(name), 'utf8'));
  async function update(name, change) {
    const data = await read(name), next = await change(structuredClone(data));
    if (JSON.stringify(data) === JSON.stringify(next)) return next;
    await writeFile(file(name) + '.tmp', JSON.stringify(next, null, 2));
    await rename(file(name) + '.tmp', file(name));
    return next;
  }
  return { async observe(rows) {
    await update('requests', s => {
      for (const row of rows) {
        const receipt = s.records[row.parentMessageID];
        receipt.status = 'observed';
        receipt.responses = { ...receipt.responses, [row.id]: {
          model: `${row.providerID}/${row.modelID}`, completed: row.completed,
        } };
      }
      return s;
    });
    return update('usage', async s => {
      const requests = await read('requests');
      for (const row of rows) {
        const receipt = requests.records[row.parentMessageID];
        s.records[row.id] = { ...s.records[row.id], ...row,
          agentID: receipt.agent.id, agentName: receipt.agent.name,
          requestID: receipt.id };
      }
      return s;
    });
  } };
}

const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-store-benchmark-'));
try {
  const snapshot = 'captured '.repeat(35000);
  const requests = { version: 1, records: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`req${i}`, {
    id: `req${i}`, sessionID: 'session', status: 'accepted',
    agent: { id: 'engineer', name: 'Engineer' }, mode: 'build',
    catalogModels: [{ id: 'provider/model', description: snapshot }],
  }])) };
  const serialized = JSON.stringify(requests, null, 2);
  console.log(`Synthetic request file: ${(Buffer.byteLength(serialized) / 1048576).toFixed(1)} MiB; 100 receipts`);
  const row = { id: 'response', sessionID: 'session', parentMessageID: 'req0',
    providerID: 'provider', modelID: 'model', completed: true, tokens: 1 };
  for (const [label, factory] of [['baseline', baseline], ['current', createStore]]) {
    const directory = path.join(root, label);
    await mkdir(path.join(directory, '.state/webpage'), { recursive: true });
    await writeFile(path.join(directory, '.state/webpage/requests.json'), serialized);
    await writeFile(path.join(directory, '.state/webpage/usage.json'), JSON.stringify({ version: 1, records: {} }));
    const store = factory(directory);
    for (const operation of ['changed, cold', 'unchanged, warm']) {
      const cpuStart = process.cpuUsage(), start = performance.now();
      await store.observe([row]);
      const elapsedMs = performance.now() - start, cpu = process.cpuUsage(cpuStart);
      console.log(JSON.stringify({ label, operation, elapsedMs: Math.round(elapsedMs), cpuMs: Math.round((cpu.user + cpu.system) / 1000) }));
    }
  }
} finally { await rm(root, { recursive: true, force: true }); }
