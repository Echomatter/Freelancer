import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { openCodeSourceIdentity } from '../server/data/opencode-warehouse.mjs';

const executeNode = promisify(execFile);
// The HTTP fixture shares this event loop; leave its socket lifecycle responsive.
async function runNode(args, options = {}) {
  const output = await executeNode(process.execPath, args, { encoding: 'utf8', timeout: 30_000, windowsHide: true, ...options });
  return { ...output, status: 0 }; // execFile rejects unsuccessful child exits.
}

async function fixture(t) {
  const f = await localDataFixture({ timers: false });
  t.after(() => f.close());
  const data = f.app.localData.get(), source = openCodeSourceIdentity(path.join(f.root, 'native-evidence.sqlite'));
  data.initializeFreshRuntime('query-evidence-fixture');
  const registration = new DatabaseSync(data.filename);
  try { registration.prepare('INSERT INTO project_registrations(runtime_id,project_id,data) VALUES(?,?,?)')
    .run('query-evidence-fixture', f.project.id, JSON.stringify(f.project)); }
  finally { registration.close(); }
  const capture = (id, text, { parentID, title = id, origin = source, publish = true } = {}) => {
    const saved = data.recordOpenCodeSnapshot({ ...origin, projectID: f.project.id,
      session: { id, parentID, title, directory: f.project.directory, time: { created: 100, updated: 200 } },
      messages: [{ info: { id: `message:${id}`, role: 'assistant', model: { providerID: 'fixture', modelID: 'evidence' } },
        parts: [{ id: `part:${id}`, type: 'text', text }] }], projectionSafe: true });
    if (publish) assert.equal(data.publishWarehouseDerivationJob({ id: saved.derivationJobID, revisionToken: saved.derivationRevisionToken }).published, true);
    return saved;
  };
  return { ...f, data, source, capture };
}

test('conversation API adapter and CLI preserve exact worker and orphan identity, evidence, bounds and ordering', async t => {
  const f = await fixture(t);
  f.capture('ses_worker', 'Café 日本語 exact worker evidence', { parentID: 'ses_history', title: 'Linked worker' });
  f.capture('ses_orphan', 'Café 日本語 exact orphan evidence', { parentID: 'ses_missing', title: 'Orphan worker' });
  f.data.remember(f.project.id, f.state.sessions);
  for (const query of ['日本語', 'ses_worker', 'message:ses_orphan']) {
    const expected = await f.app.knowledgeQuery.query({ domain: 'conversations', query, projectID: f.project.id, limit: 1 });
    const actual = await f.api(`history/search?${new URLSearchParams({ q: query, project: f.project.id, limit: '1' })}`);
    assert.deepEqual(actual.results.map(({ navigationSession, navigationTitle, projectName, organization, ...row }) => row), expected.results);
    assert.equal(actual.truncated, expected.truncated);
    const cli = await runNode(['scripts/knowledge.mjs', 'query', 'conversations', query,
      '--data-home', path.dirname(f.data.filename), '--runtime-id', 'query-evidence-fixture', '--project-id', f.project.id, '--limit', '1'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout), expected);
  }
  const worker = (await f.app.history.searchChats('ses_worker')).results[0];
  assert.equal(worker.session, 'ses_worker'); assert.equal(worker.navigationSession, 'ses_history');
  const orphan = (await f.app.history.searchChats('ses_orphan')).results[0];
  assert.equal(orphan.session, 'ses_orphan'); assert.equal(orphan.navigationSession, 'ses_orphan');
  assert.equal(orphan.evidence.sourceSystemID, f.source.sourceSystemID);
  assert.ok(orphan.capturedAt > 0); assert.ok(orphan.indexedAt >= orphan.capturedAt);
});

test('search evidence reads the exact published revision while a changed native window awaits publication', async t => {
  const f = await fixture(t);
  const first = f.capture('ses_evidence', 'Original retained needle.', { title: 'Original title' });
  const hit = (await f.app.knowledgeQuery.query({ domain: 'conversations', query: 'needle' })).results[0];
  f.capture('ses_evidence', 'Replacement native text.', { title: 'Replacement title', publish: false });
  assert.deepEqual((await f.app.knowledgeQuery.query({ domain: 'conversations', query: 'needle' })).results[0], hit);
  assert.equal(hit.evidence.snapshotRevisionSha256, first.snapshotRevisionSha256);
  const retained = await f.api('knowledge', { operation: 'opencode-read', ...hit.evidence });
  assert.equal(retained.status, 'ok'); assert.equal(retained.session.title, 'Original title');
  assert.equal(retained.messages[0].parts[0].text, 'Original retained needle.');
  assert.equal(retained.isCurrent, false);
  const latest = f.data.readOpenCodeSession({ projectID: f.project.id, sessionID: 'ses_evidence', sourceSystemID: f.source.sourceSystemID });
  assert.equal(latest.messages[0].parts[0].text, 'Replacement native text.');
  assert.equal(f.data.readOpenCodeSession({ ...hit.evidence, snapshotRevisionSha256: '0'.repeat(64) }).status, 'missing');
  assert.throws(() => f.data.readOpenCodeSession({ ...hit.evidence, snapshotRevisionSha256: '' }), /exact retained/);
});

test('conversation publication binds the actual source origin and direct projections clear unsupported evidence', async t => {
  const f = await fixture(t), second = openCodeSourceIdentity(path.join(f.root, 'second-native.sqlite'));
  f.capture('ses_collision', 'First source needle.');
  const saved = f.capture('ses_collision', 'Second source needle.', { origin: second });
  let hit = (await f.app.knowledgeQuery.query({ domain: 'conversations', query: 'needle' })).results[0];
  assert.equal(hit.evidence.sourceSystemID, second.sourceSystemID);
  assert.equal(hit.evidence.snapshotRevisionSha256, saved.snapshotRevisionSha256);
  assert.equal(f.data.readOpenCodeSession(hit.evidence).messages[0].parts[0].text, 'Second source needle.');
  f.data.indexChat(f.project.id, { id: 'ses_collision', title: 'Direct index', time: { updated: 201 } }, [
    { info: { id: 'direct', role: 'user' }, parts: [{ type: 'text', text: 'Uncaptured needle.' }] }]);
  hit = (await f.app.knowledgeQuery.query({ domain: 'conversations', query: 'needle' })).results[0];
  assert.equal(hit.evidence, null); assert.equal(hit.evidenceAvailability, 'unavailable');
  const db = new DatabaseSync(f.data.filename, { readOnly: true });
  try { assert.equal(db.prepare('SELECT derivation_job_id FROM chat_search_state WHERE session_id=?').get('ses_collision').derivation_job_id, null); }
  finally { db.close(); }
});

test('direct conversation result identity survives identical reindex and changes with cached text',async t=>{
  const f=await fixture(t),session={id:'ses_direct_identity',title:'Direct source',time:{updated:201}};
  const messages=text=>[{info:{id:'direct-message',role:'user'},parts:[{type:'text',text}]}];
  const query=async()=> (await f.app.knowledgeQuery.query({domain:'conversations',query:'identityneedle'})).results[0];
  f.data.indexChat(f.project.id,session,messages('Original identityneedle.'));
  const original=await query();
  assert.match(original.indexedTextSha256,/^[a-f0-9]{64}$/);
  assert.equal(original.sourceRevision.hash,null,'a cached-text digest is not a native source revision');
  const raw=new DatabaseSync(f.data.filename);
  try {raw.prepare('UPDATE chat_search_state SET indexed_at=indexed_at-10000 WHERE session_id=?').run(session.id);}
  finally {raw.close();}
  f.data.indexChat(f.project.id,session,messages('Original identityneedle.'));
  const repeated=await query();
  assert.equal(repeated.resultID,original.resultID);
  assert.equal(repeated.indexedTextSha256,original.indexedTextSha256);
  f.data.indexChat(f.project.id,session,messages('Changed identityneedle.'));
  const changed=await query();
  assert.notEqual(changed.resultID,original.resultID);
  assert.notEqual(changed.indexedTextSha256,original.indexedTextSha256);
  assert.equal(changed.evidence,null);
});
