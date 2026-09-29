// Synthetic, isolated measurements only. No live state, provider or credentials.
// Run: node scripts/benchmark-store-growth.mjs
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createStore } from '../server/store.mjs';
import { replaceFile } from '../server/replace-file.mjs';

const mib = 1024 * 1024;
export async function measureStoreGrowth({ counts = [10, 100, 250], receiptBytes = 64 * 1024, repeats = 3 } = {}) {
  if (!Array.isArray(counts) || !counts.length || counts.length > 6 ||
      counts.some(count => !Number.isInteger(count) || count < 1 || count > 1000) ||
      new Set(counts).size !== counts.length ||
      !Number.isInteger(receiptBytes) || receiptBytes < 128 || receiptBytes > mib ||
      !Number.isInteger(repeats) || repeats < 1 || repeats > 10 ||
      Math.max(...counts) * (receiptBytes + 4096) > 64 * mib)
    throw Error('Choose 1–6 distinct workloads, 1–1000 receipts, 128–1048576 bytes per receipt, 1–10 repeats and at most 64 MiB per workload.');

  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-growth-benchmark-'));
  const results = [];
  try {
    for (const count of counts) {
      const directory = path.join(root, String(count));
      const state = path.join(directory, '.state', 'webpage');
      await mkdir(state, { recursive: true });
      const description = 'synthetic '.repeat(Math.ceil(receiptBytes / 10)).slice(0, receiptBytes);
      const records = Object.fromEntries(Array.from({ length: count }, (_, index) => [`req${index}`, {
        id: `req${index}`, projectID: 'synthetic_project', sessionID: `ses_${index % 10}`, status: 'accepted',
        agent: { id: 'engineer', name: 'Engineer' }, mode: 'build',
        catalogModels: [{ id: 'synthetic/model', description }],
      }]));
      await writeFile(path.join(state, 'requests.json'), JSON.stringify({ version: 1, records }, null, 2));
      await writeFile(path.join(state, 'usage.json'), JSON.stringify({ version: 1, records: {} }));
      let replacements = 0;
      const store = createStore(directory, { replace: async (source, target) => {
        await replaceFile(source, target);
        replacements++;
      } });
      const samples = [];
      const measure = async (operation, run, action) => {
        const writes = replacements, cpuStart = process.cpuUsage(), start = performance.now();
        await action();
        const elapsedMs = performance.now() - start, cpu = process.cpuUsage(cpuStart);
        samples.push({ operation, run, elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000, replacements: replacements - writes });
      };
      try {
        // Warm the parse cache separately; do not confuse cold parsing with writes.
        await measure('cold scoped read', 0, () => store.requestSummaries('synthetic_project', 'ses_0'));
        for (let run = 0; run < repeats; run++) {
          const row = { id: 'synthetic_response', sessionID: 'ses_0', parentMessageID: 'req0',
            providerID: 'synthetic', modelID: 'model', completed: run % 2 === 0, tokens: run + 1 };
          await measure('changed observation', run, () => store.observe([row]));
          await measure('identical observation', run, () => store.observe([row]));
          await measure('warm scoped read', run, () => store.requestSummaries('synthetic_project', 'ses_0'));
        }
        const requestBytes = (await stat(path.join(state, 'requests.json'))).size;
        const operations = [...new Set(samples.map(sample => sample.operation))].map(operation => {
          const rows = samples.filter(sample => sample.operation === operation);
          const median = key => {
            const values = rows.map(row => row[key]).sort((a, b) => a - b), middle = Math.floor(values.length / 2);
            return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
          };
          return { operation, medianElapsedMs: median('elapsedMs'), medianCpuMs: median('cpuMs'), replacements: rows.reduce((total, row) => total + row.replacements, 0) };
        });
        results.push({ receipts: count, payloadBytesPerReceipt: receiptBytes, requestBytes, operations, samples });
      } finally {
        await store.flush();
      }
    }
    return {
      kind: 'synthetic request-store growth; not live or end-to-end latency',
      recordedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
      repeats, workloads: results,
    };
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) throw Error('Run without arguments; the benchmark never accepts a live data directory.');
  const result = await measureStoreGrowth();
  const output = new URL('../artifacts/performance/store-growth.json', import.meta.url);
  await mkdir(new URL('./', output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  console.log('Aggregate synthetic evidence saved to artifacts/performance/store-growth.json');
}
