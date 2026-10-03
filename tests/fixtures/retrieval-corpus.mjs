import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../../server/data/store.mjs';
import { createKnowledgeQuery } from '../../server/data/knowledge-query.mjs';
import { FRESH_RUNTIME_ID } from '../../server/runtime-config.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;

/** Representative authored test data; it contains no production history or credentials. */
export async function retrievalCorpus() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-retrieval-'));
  const dataHome = path.join(root, 'data'), store = createLocalDataStore(dataHome);
  store.initializeFreshRuntime(FRESH_RUNTIME_ID);
  const projects = ['client-api', 'handoff'].map(id => ({ id, name: id === 'client-api' ? 'Client API' : 'Handoff', directory: path.join(root, id) }));
  const files = [
    { id: 'adr', project: projects[0], path: 'architecture/ADR-042.md', text: 'ADR-042: OpenCode owns provider authentication and MCP connections. Freelancer stores application organization in SQLite. Conversations remain native.' },
    { id: 'unicode', project: projects[0], path: 'reference/international.md', text: 'München café 日本語 résumé. Keep original Unicode names in retained references.' },
    { id: 'fresh', project: projects[0], path: 'operations/fresh-setup.md', text: 'Fresh setup starts with an empty warehouse. Prior Freelancer organization is preserved elsewhere and never imported.' },
    { id: 'drafts', project: projects[1], path: 'notes/draft-revisions.md', text: 'SQLite draft revisions preserve unsent text. The Handoff project owns its deployment cadence.' },
  ].map(file => ({ ...file, sourceIdentity: `content-source:retrieval:${file.id}`, revisionIdentity: `content-revision:${hash(file.text)}`, locator: 'L1', unitSha256: hash(file.text) }));
  const db = new DatabaseSync(store.filename);
  try {
    for (const project of projects) {
      await mkdir(project.directory, { recursive: true });
      db.prepare('INSERT INTO project_registrations(runtime_id,project_id,data) VALUES(?,?,?)').run(FRESH_RUNTIME_ID, project.id, JSON.stringify(project));
    }
    for (const file of files) {
      await mkdir(path.dirname(path.join(file.project.directory, file.path)), { recursive: true });
      await writeFile(path.join(file.project.directory, file.path), file.text);
      const source = db.prepare(`INSERT INTO content_sources(project_key,filename,virtual_path,container_path,extension,source_role,status,routing_rank,
        file_size_bytes,modified_utc,sha256,unit_count,locator_kind,extraction_method,extraction_status,text_chars,word_count,source_identity,revision_identity)
        VALUES(?,?,?,?,'.md','current_project_source','current',80,?,'2026-10-02T00:00:00Z',?,1,'line','plain-text','ok',?,?,?,?)`)
        .run(key(file.project.directory), path.basename(file.path), file.path, path.join(file.project.directory, file.path), Buffer.byteLength(file.text), hash(file.text), file.text.length, file.text.split(/\s+/u).length, file.sourceIdentity, file.revisionIdentity);
      const unit = db.prepare('INSERT INTO content_units(source_id,unit_no,locator,text,word_count,char_count,sha256) VALUES(?,1,?,?,?,?,?)')
        .run(source.lastInsertRowid, file.locator, file.text, file.text.split(/\s+/u).length, file.text.length, file.unitSha256);
      db.prepare(`INSERT INTO content_units_fts(rowid,project_key,filename,virtual_path,source_role,status,heading,locator,text)
        VALUES(?,?,?,?,'current_project_source','current','',?,?)`).run(unit.lastInsertRowid, key(file.project.directory), path.basename(file.path), file.path, file.locator, file.text);
      db.prepare('INSERT INTO content_source_revisions VALUES(?,?,?,?,?,?)').run(file.sourceIdentity, file.revisionIdentity, key(file.project.directory), file.path, JSON.stringify({ extractionMethod: 'plain-text' }), 1000);
      db.prepare('INSERT INTO content_unit_revisions VALUES(?,?,1,?,\'\',?,?,?,?)').run(file.sourceIdentity, file.revisionIdentity, file.locator, file.text, file.text.split(/\s+/u).length, file.text.length, file.unitSha256);
    }
  } finally { db.close(); }
  const session = { id: 'ses_retained_configuration', title: 'Native configuration decision', time: { created: 1000, updated: 2000 } };
  const messages = [
    { info: { id: 'msg_configuration_question', role: 'user' }, parts: [{ type: 'text', text: 'Who owns provider authentication and MCP connections?' }] },
    { info: { id: 'msg_configuration_answer', role: 'assistant', model: { providerID: 'opencode', modelID: 'free' } }, parts: [{ type: 'text', text: 'OpenCode owns provider authentication and MCP connections. Keep the native configuration authoritative.' }] },
  ];
  store.indexChat(projects[0].id, session, messages);
  store.indexChat(projects[1].id, { id: 'ses_handoff_drafts', title: 'Draft revision decision', time: { updated: 3000 } }, [
    { info: { id: 'msg_handoff_sqlite', role: 'assistant', model: { providerID: 'fixture', modelID: 'cheap' } }, parts: [{ type: 'text', text: 'SQLite draft revisions preserve unsent text across restarts.' }] },
  ]);
  const retainedID = 'memory:configuration-snapshot';
  store.createMemory({ id: retainedID, kind: 'conversation_snapshot', title: session.title,
    body: messages.map(message => message.parts[0].text).join('\n\n'), source: { projectID: projects[0].id, sessionID: session.id },
    boundary: { status: 'complete', messageCount: messages.length }, provenance: { method: 'captured native text', snapshotHash: hash(JSON.stringify(messages)) },
    members: messages.map((message, ordinal) => ({ kind: 'opencode_text', ref: message.info.id, revision: 'native-fixture-1', availability: 'available',
      hash: hash(message.parts[0].text), locator: { ordinal, role: message.info.role, text: message.parts[0].text, providerID: message.info.model?.providerID, modelID: message.info.model?.modelID } })) });
  store.setMemoryPin({ id: retainedID, pinned: true, expectedRevision: 0 });
  const missingID = 'memory:missing-original';
  store.createMemory({ id: missingID, kind: 'conversation_snapshot', title: 'Missing original configuration discussion', body: 'Configuration evidence has a missing original source.',
    source: { projectID: projects[1].id, sessionID: 'ses_missing_original' }, boundary: { status: 'missing_source', missingSources: ['ses_missing_original'] },
    members: [{ kind: 'session', ref: 'ses_missing_original', availability: 'missing_source' }] });
  store.setMemoryPin({ id: missingID, pinned: true, expectedRevision: 0 });
  store.createMemory({ id: 'memory:vanilla-setup', kind: 'note', title: 'Fresh setup agreement', body: 'Start with an empty warehouse; OpenCode remains authoritative for native settings.', source: { projectID: projects[0].id } });
  store.createMemory({ id: 'memory:archived-note', kind: 'note', title: 'Archived setup note', body: 'Historical setup instructions are retained as an archived note.', source: { projectID: projects[1].id } });
  store.archiveMemory({ id: 'memory:archived-note', expectedRevision: 0 });
  const evidence = { id: `file:${files[0].sourceIdentity}@${files[0].revisionIdentity}:L1`, kind: 'file', ...Object.fromEntries(['sourceIdentity', 'revisionIdentity', 'locator', 'unitSha256'].map(name => [name, files[0][name]])), relation: 'supports' };
  store.addClaim({ id: 'claim:configuration-native', predicate: 'Configuration authority', value: 'OpenCode', origin: 'source-reported', epistemicState: 'supported', method: 'retained ADR-042', scope: { projectID: projects[0].id }, evidence: [evidence] });
  store.addClaim({ id: 'claim:configuration-disputed', predicate: 'Configuration authority', value: 'Freelancer', origin: 'user-stated', epistemicState: 'disputed', method: 'contradictory user statement', scope: { projectID: projects[0].id }, evidence: [{ ...evidence, relation: 'contradicts' }] });
  store.addClaim({ id: 'claim:warehouse-prior', predicate: 'Warehouse persistence engine', value: 'JSON files', origin: 'source-reported', epistemicState: 'unverified', method: 'historic note', scope: { projectID: projects[1].id }, evidence: [{ id: missingID, memoryID: missingID, memoryRevision: 1, relation: 'supports' }] });
  const corrected = store.correctClaim({ id: 'claim:warehouse-prior', value: 'SQLite', epistemicState: 'supported', method: 'reviewed draft persistence source', evidence: [{ ...evidence, relation: 'supersedes' }] });
  const service = createKnowledgeQuery({ data: store, getProjects: () => projects });
  const cases = [
    { id: 'literal-file-identifier', input: { domain: 'files', query: 'ADR-042' }, expected: [files[0].sourceIdentity] },
    { id: 'unicode-exact-phrase', input: { domain: 'files', query: 'München café 日本語', phrase: true }, expected: [files[1].sourceIdentity] },
    { id: 'unicode-diacritics', input: { domain: 'files', query: 'resume' }, expected: [files[1].sourceIdentity] },
    { id: 'phrase-order', input: { domain: 'files', query: '日本語 café', phrase: true }, expected: [] },
    { id: 'paraphrase-limitation', input: { domain: 'files', query: 'credential keeper' }, expected: [], semanticTargets: [files[0].sourceIdentity], limitation: 'Lexical search does not infer authentication from credential keeper. No JEV or semantic fallback is invoked.' },
    { id: 'multi-project-global', input: { domain: 'files', query: 'SQLite' }, expected: [files[0].sourceIdentity, files[3].sourceIdentity] },
    { id: 'project-id-scope', input: { domain: 'files', query: 'SQLite', projectID: projects[1].id }, expected: [files[3].sourceIdentity] },
    { id: 'project-directory-scope', input: { domain: 'files', query: 'SQLite', projectDirectory: projects[0].directory }, expected: [files[0].sourceIdentity] },
    { id: 'native-session-id', input: { domain: 'conversations', query: session.id }, expected: [session.id] },
    { id: 'native-message-id', input: { domain: 'conversations', query: messages[1].info.id, model: 'opencode/free' }, expected: [session.id] },
    { id: 'native-message-model-denial', input: { domain: 'conversations', query: messages[1].info.id, model: 'fixture/other' }, expected: [] },
    { id: 'native-id-scope', input: { domain: 'conversations', query: session.id, projectID: projects[1].id }, expected: [] },
    { id: 'conversation-phrase-model', input: { domain: 'conversations', query: 'OpenCode owns provider authentication', phrase: true, model: 'opencode/free' }, expected: [session.id] },
    { id: 'memory-exact-id', input: { domain: 'memories', query: 'memory:vanilla-setup' }, expected: ['memory:vanilla-setup'] },
    { id: 'pinned-home', input: { domain: 'memories', query: '', pinnedOnly: true }, expected: [retainedID, missingID] },
    { id: 'pinned-project-model', input: { domain: 'memories', query: '', pinnedOnly: true, projectID: projects[0].id, model: 'opencode/free' }, expected: [retainedID] },
    { id: 'missing-source-retained', input: { domain: 'memories', query: 'memory:missing-original' }, expected: [missingID] },
    { id: 'memory-paraphrase-limitation', input: { domain: 'memories', query: 'remembered discussions' }, expected: [], semanticTargets: [retainedID], limitation: 'Lexical memory search does not translate remembered discussions into captured conversation evidence. No JEV or semantic fallback is invoked.' },
    { id: 'archived-hidden', input: { domain: 'memories', query: 'memory:archived-note' }, expected: [] },
    { id: 'archived-explicit', input: { domain: 'memories', query: 'memory:archived-note', includeArchived: true }, expected: ['memory:archived-note'] },
    { id: 'contradictions-retained', input: { domain: 'facts', query: 'Configuration authority' }, expected: ['claim:configuration-native', 'claim:configuration-disputed'] },
    { id: 'origin-independent-from-support', input: { domain: 'facts', query: 'Configuration authority', origin: 'source-reported', epistemicState: 'supported' }, expected: ['claim:configuration-native'] },
    { id: 'claim-exact-id', input: { domain: 'facts', query: 'claim:configuration-disputed' }, expected: ['claim:configuration-disputed'] },
    { id: 'current-claim-replacement', input: { domain: 'facts', query: 'Warehouse persistence engine' }, expected: [corrected.id] },
    { id: 'historical-claim-included', input: { domain: 'facts', query: 'claim:warehouse-prior', includeHistorical: true }, expected: ['claim:warehouse-prior'] },
    { id: 'historical-claim-hidden', input: { domain: 'facts', query: 'claim:warehouse-prior' }, expected: [] },
  ];
  return { root, dataHome, store, service, projects, files, cases, retainedID, missingID, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

export const resultIdentities = envelope => [...new Set(envelope.results.map(row => envelope.domain === 'files' ? row.sourceIdentity : envelope.domain === 'conversations' ? row.session : row.id))].sort();

export async function evaluateRetrieval(corpus) {
  const cases = [];
  for (const scenario of corpus.cases) {
    const started = performance.now(), envelope = await corpus.service.query(scenario.input), elapsedMs = performance.now() - started;
    const actual = resultIdentities(envelope), expected = [...scenario.expected].sort();
    cases.push({ id: scenario.id, input: scenario.input, expected, actual, passed: JSON.stringify(actual) === JSON.stringify(expected), returnedRows: envelope.results.length,
      elapsedMs: Number(elapsedMs.toFixed(3)), truncated: envelope.truncated,
      ...(scenario.limitation ? { limitation: scenario.limitation, semanticTargets: scenario.semanticTargets, semanticTargetsFound: scenario.semanticTargets.filter(id => actual.includes(id)).length } : {}) });
  }
  const times = cases.map(row => row.elapsedMs).sort((a,b) => a-b), semantic = cases.filter(row => row.limitation);
  return { corpus: 'representative authored Freelancer warehouse fixture', corpusSize: { files:4, conversations:2, memories:4, claims:4 }, cases, passed: cases.filter(row => row.passed).length, total: cases.length,
    latencyMs: { average: Number((times.reduce((sum,value) => sum+value,0)/times.length).toFixed(3)), p95: times[Math.ceil(times.length*0.95)-1], maximum: times.at(-1) },
    semanticParaphrases: { found: semantic.reduce((count,row) => count+row.semanticTargetsFound,0), targets: semantic.reduce((count,row) => count+row.semanticTargets.length,0) },
    inference: 'None. Real SQLite shared queries only; no paid inference or JEV fallback.', limitations: cases.filter(row => row.limitation).map(row => row.limitation) };
}
