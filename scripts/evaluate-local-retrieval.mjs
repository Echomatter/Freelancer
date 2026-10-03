import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { retrievalCorpus, evaluateRetrieval } from '../tests/fixtures/retrieval-corpus.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw Error('Usage: node scripts/evaluate-local-retrieval.mjs [--output report.json]');
const corpus = await retrievalCorpus();
try {
  const report = await evaluateRetrieval(corpus);
  if (args[0]) {
    const filename = path.resolve(args[1]);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(args[0] ? { report:path.resolve(args[1]), passed:report.passed, total:report.total, latencyMs:report.latencyMs, semanticParaphrases:report.semanticParaphrases, limitations:report.limitations } : report, null, 2));
  if (report.passed !== report.total) process.exitCode = 1;
} finally { await corpus.close(); }
