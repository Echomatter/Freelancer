import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const required = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw Error(`Judgment evidence ${label} is required.`);
  return value;
};
const contentFields = ['kind','candidateID','sourceIdentity','revisionIdentity','locator','unitSha256'];
const openCodeFields = ['kind','candidateID','sourceSystemID','projectID','sessionID','messageID','revisionSha256','partID','partSha256'];
const refKey = ref => JSON.stringify(ref.kind === 'content-unit'
  ? contentFields.map(key => ref[key])
  : openCodeFields.map(key => ref[key]));

export function openCodeEvidenceCandidateID(sourceSystemID, projectID, sessionID) {
  const tuple = JSON.stringify([sourceSystemID, projectID, sessionID]);
  return `opencode-session:${Buffer.from(tuple, 'utf8').toString('base64url')}`;
}

export function createJudgmentEvidenceResolver(db) {
  const readContent = db.prepare(`SELECT u.text FROM content_unit_revisions u JOIN content_source_revisions s USING(source_identity,revision_identity)
    WHERE s.source_identity=? AND s.revision_identity=? AND u.locator=? AND u.sha256=? LIMIT 1`);
  const readOpenCode = db.prepare(`SELECT r.parts_json FROM opencode_message_revisions r
    WHERE r.source_system_id=? AND r.project_id=? AND r.session_id=? AND r.message_id=? AND r.revision_sha256=? LIMIT 1`);

  return function assertJudgmentEvidence({ state, candidateIDs, evidenceRefs } = {}) {
    if (!Array.isArray(candidateIDs) || !candidateIDs.length || candidateIDs.length > 500 ||
        candidateIDs.some(id => typeof id !== 'string' || !id.trim() || id.length > 2000) || new Set(candidateIDs).size !== candidateIDs.length)
      throw Error('A TypeSafe judgment requires unique stable candidate IDs.');
    if (!Array.isArray(evidenceRefs) || !evidenceRefs.length || evidenceRefs.length > 1000)
      throw Error('A TypeSafe judgment requires bounded evidence references.');
    if (!state || !Array.isArray(state.evidence) || state.evidence.length !== evidenceRefs.length)
      throw Error('Every TypeSafe evidence citation must match one source-backed evidence packet item.');

    const packet = new Map();
    for (const item of state.evidence) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.kind !== 'string')
        throw Error('Every TypeSafe evidence packet item needs a typed source reference.');
      const key = refKey(item);
      if (packet.has(key)) throw Error('TypeSafe evidence packet references must be unique.');
      packet.set(key, item);
    }

    const refs = new Set();
    const citedCandidates = new Set();
    for (const ref of evidenceRefs) {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) throw Error('TypeSafe evidence references must use typed source locators.');
      const fields = ref.kind === 'content-unit' ? contentFields : ref.kind === 'opencode-text-part' ? openCodeFields : null;
      if (!fields) throw Error('TypeSafe evidence source kind is unsupported.');
      for (const field of fields) required(ref[field], field);
      const key = refKey(ref), cited = packet.get(key);
      if (refs.has(key) || !cited) throw Error('TypeSafe packet evidence and source references do not match one-to-one.');
      refs.add(key);
      if (typeof cited.text !== 'string' || !cited.text.trim() || cited.text.length > 120_000)
        throw Error('TypeSafe cited evidence text must be bounded and nonempty.');
      if (ref.kind === 'content-unit') {
        if (!/^content-source:[a-f0-9]+$/i.test(ref.sourceIdentity) || !/^content-revision:[a-f0-9]+$/i.test(ref.revisionIdentity) ||
            !/^[a-f0-9]{64}$/i.test(ref.unitSha256) || ref.candidateID !== ref.sourceIdentity)
          throw Error('Content evidence must use its indexed source, revision, unit hash and source candidate ID.');
        const row = readContent.get(ref.sourceIdentity, ref.revisionIdentity, ref.locator, ref.unitSha256.toLowerCase());
        if (!row || !row.text.includes(cited.text)) throw Error('Cited content evidence does not resolve to the indexed source revision and text.');
        citedCandidates.add(ref.sourceIdentity);
      } else {
        if (!/^[a-f0-9]{64}$/i.test(ref.revisionSha256) || !/^[a-f0-9]{64}$/i.test(ref.partSha256) ||
            ref.candidateID !== openCodeEvidenceCandidateID(ref.sourceSystemID, ref.projectID, ref.sessionID))
          throw Error('OpenCode evidence must use its stable session candidate and revision hashes.');
        const revision = readOpenCode.get(ref.sourceSystemID, ref.projectID, ref.sessionID, ref.messageID, ref.revisionSha256.toLowerCase());
        const part = revision && JSON.parse(revision.parts_json).parts.find(value => value?.id === ref.partID && value?.type === 'text');
        if (!part || typeof part.text !== 'string' || digest(part.text) !== ref.partSha256.toLowerCase() || !part.text.includes(cited.text))
          throw Error('Cited OpenCode evidence does not resolve to the captured message revision and text part.');
        citedCandidates.add(ref.candidateID);
      }
    }
    if (packet.size !== refs.size || citedCandidates.size !== candidateIDs.length || candidateIDs.some(id => !citedCandidates.has(id)))
      throw Error('Every TypeSafe candidate must be represented by resolved source evidence.');
    return { resolved: true, evidenceCount: refs.size, candidateCount: citedCandidates.size };
  };
}
