import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrievalCorpus, resultIdentities, evaluateRetrieval } from './fixtures/retrieval-corpus.mjs';

const cli = fileURLToPath(new URL('../scripts/knowledge.mjs', import.meta.url));
const flags = { projectID: '--project-id', projectDirectory: '--project-directory', model: '--model', phrase: '--phrase', pinnedOnly: '--pinned-only', includeArchived: '--include-archived', origin: '--origin', epistemicState: '--epistemic-state', includeHistorical: '--include-historical', limit: '--limit' };
const cliArguments = input => ['query', input.domain, input.query, ...Object.entries(input).filter(([key]) => flags[key]).flatMap(([key, value]) => value === true ? [flags[key]] : [flags[key], String(value)])];

test('representative SQLite retrieval records identifiers, Unicode, scope, provenance and lexical limits honestly', async t => {
  const corpus = await retrievalCorpus(); t.after(() => corpus.close());
  const report = await evaluateRetrieval(corpus);
  assert.equal(report.passed, report.total, JSON.stringify(report.cases.filter(row => !row.passed), null, 2));
  assert.equal(report.total, 26);
  assert.deepEqual(report.semanticParaphrases, { found:0,targets:2 });
  assert.ok(report.latencyMs.maximum >= report.latencyMs.p95);
  assert.equal(report.cases.find(row => row.id === 'paraphrase-limitation').semanticTargetsFound, 0,
    'lexical fixture success must not be reported as semantic paraphrase recall');
  const conflicts = await corpus.service.query({ domain: 'facts', query: 'Configuration authority' });
  assert.deepEqual(new Set(conflicts.results.map(row => row.epistemicState)), new Set(['supported', 'disputed']));
  assert.deepEqual(new Set(conflicts.results.map(row => row.origin)), new Set(['source-reported', 'user-stated']));
  const historical = await corpus.service.query({ domain: 'facts', query: 'claim:warehouse-prior', includeHistorical: true });
  assert.equal(historical.results[0].epistemicState, 'superseded');
  assert.equal(historical.results[0].value, 'JSON files');
  const missing = corpus.store.getMemory(corpus.missingID);
  assert.equal(missing.revision.captureBoundary.status, 'missing_source');
  assert.equal(missing.members[0].availability, 'missing_source');
});

test('all representative retrieval cases have exact read-only CLI envelope parity', async t => {
  const corpus = await retrievalCorpus(); t.after(() => corpus.close());
  for (const scenario of corpus.cases) {
    const expected = await corpus.service.query(scenario.input);
    const result = spawnSync(process.execPath, [cli, ...cliArguments(scenario.input), '--data-home', corpus.dataHome], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, `${scenario.id}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), JSON.parse(JSON.stringify(expected)), `${scenario.id}: parsed shared service/CLI envelope parity`);
  }
  const bounded = await corpus.service.query({ domain: 'files', query: 'SQLite', limit: 1 });
  assert.equal(bounded.results.length, 1); assert.equal(bounded.truncated, true);
  assert.equal(typeof bounded.coverage, 'string');
});

test('retained indexed evidence survives a missing live file and rejects a changed unit hash', async t => {
  const corpus = await retrievalCorpus(); t.after(() => corpus.close());
  const source = corpus.files[0];
  await unlink(path.join(source.project.directory, source.path));
  const result = await corpus.service.query({ domain: 'files', query: 'ADR-042' });
  assert.deepEqual(resultIdentities(result), [source.sourceIdentity]);
  const ref = { sourceIdentity: source.sourceIdentity, revisionIdentity: source.revisionIdentity, locator: source.locator, unitHash: source.unitSha256 };
  const retained = corpus.store.readContentEvidence(ref);
  assert.equal(retained.availability, 'retained'); assert.equal(retained.text, source.text);
  assert.equal(corpus.store.readContentEvidence({ ...ref, unitHash: '0'.repeat(64) }).availability, 'missing_source');
});
