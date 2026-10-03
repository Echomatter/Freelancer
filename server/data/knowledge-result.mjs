import { evidenceDigest, stableEvidenceJSON } from './judgment-record-evidence.mjs';

const digestDatabases = new WeakSet();
export function installKnowledgeResultFunctions(db) {
  if (digestDatabases.has(db)) return;
  if (typeof db.function !== 'function') throw Error('Knowledge metadata requires the Node SQLite function API.');
  db.function('freelancer_body_sha256', { deterministic: true }, evidenceDigest);
  digestDatabases.add(db);
}

const compact = (value, limit = 2000) => String(value ?? '').slice(0, limit);
const date = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const resultID = (type, identity) => `${type}:${evidenceDigest(stableEvidenceJSON(identity))}`;
export const KNOWLEDGE_RESULT_BYTE_LIMIT = 4000000;

/** Bound the serialized page separately from source hashing, without hiding hits. */
export function boundKnowledgeResults(results) {
  let remaining = KNOWLEDGE_RESULT_BYTE_LIMIT - 2 - results.length;
  return results.map((original,index) => {
    let row=original;
    const budget=Math.floor(remaining/(results.length-index));
    const bytes=()=>Buffer.byteLength(JSON.stringify(row),'utf8');
    if(bytes()>budget) {
      row={...row,metadataTruncated:true,metadataTruncationReasons:['page-byte-limit'],originalSourceRef:{...row.originalSourceRef}};
      if(row.value!==undefined&&row.value!==null) {row.value=null;row.valueTruncated=true;}
      while(bytes()>budget) {
        const refs=row.sourceRefs??row.evidence??row.originalSourceRef.members??row.originalSourceRef.evidence??[];
        if(!refs.length) break;
        const kept=refs.slice(0,Math.floor(refs.length/2));
        row.sourceRefs=kept;row.sourceRefsTruncated=true;
        if(row.evidence) row.evidence=kept;
        if(row.originalSourceRef.members) {row.originalSourceRef.members=kept;row.originalSourceRef.membersTruncated=true;}
        if(row.originalSourceRef.evidence) {row.originalSourceRef.evidence=kept;row.originalSourceRef.evidenceTruncated=true;}
      }
      if(bytes()>budget&&row.scope) {row.scope=null;row.scopeTruncated=true;}
    }
    const size=bytes();
    if(size>budget) throw Error('Required knowledge result metadata exceeds the bounded page budget.');
    remaining-=size;
    return row;
  });
}

/** Add one bounded descriptive shape without turning recorded provenance into proof. */
export function knowledgeResult(domain, row, { query, phrase, filters, coverage }) {
  if(typeof row.excerpt==='string'&&row.excerpt.length>2400) row={...row,excerpt:compact(row.excerpt,2400),excerptTruncated:true};
  if(typeof row.heading==='string'&&row.heading.length>1000) row={...row,heading:compact(row.heading,1000),headingTruncated:true};
  let type, identity, originalSourceRef, sourceRevision, evidenceStatus, claimStatus = null;
  if (domain === 'files') {
    type = 'file-unit';
    identity = [row.sourceIdentity, row.revisionIdentity, row.unit, row.locator, row.unitSha256];
    originalSourceRef = { kind: 'content-unit', projectID: row.projectID, path: row.path,
      sourceIdentity: row.sourceIdentity, revisionIdentity: row.revisionIdentity, unit: row.unit, locator: row.locator, unitSha256: row.unitSha256 };
    sourceRevision = { id: row.revisionIdentity ?? null, hash: row.sourceSha256 ?? null,
      hashKind: row.sourceSha256 ? 'source-sha256' : null, unitHash: row.unitSha256 ?? null };
    evidenceStatus = row.evidenceAvailability ?? 'unavailable';
  } else if (domain === 'conversations') {
    type = 'conversation-text';
    identity = [row.evidence?.sourceSystemID ?? null, row.projectID, row.session, row.message, row.role,
      row.evidence?.snapshotRevisionSha256 ?? row.indexedTextSha256 ?? null];
    originalSourceRef = { kind: 'opencode-conversation', sourceSystemID: row.evidence?.sourceSystemID ?? null,
      projectID: row.projectID, sessionID: row.session, messageID: row.message || null };
    sourceRevision = { id: row.evidence?.snapshotRevisionSha256 ?? null, hash: row.evidence?.snapshotRevisionSha256 ?? null,
      hashKind: row.evidence?.snapshotRevisionSha256 ? 'opencode-snapshot-sha256' : null,
      sessionHash: row.evidence?.sessionRevisionSha256 ?? null };
    evidenceStatus = row.evidenceAvailability ?? 'unavailable';
  } else if (domain === 'memories') {
    type = 'memory';
    identity = [row.id, row.revisionID, row.revision];
    originalSourceRef = { kind: 'memory-revision', memoryID: row.id, revision: row.revision,
      revisionID: row.revisionID ?? null, system: row.source?.system ?? null, projectID: row.projectID,
      sessionID: row.sessionID ?? null, members: row.sourceRefs ?? [], memberCount: row.sourceRefCount ?? 0,
      membersTruncated: row.sourceRefsTruncated === true };
    sourceRevision = { id: row.revisionID ?? null, hash: row.bodySha256 ?? null,
      hashKind: row.bodySha256 ? 'memory-body-sha256' : null, hashUnavailableReason:row.bodyHashUnavailableReason??null, snapshotHash: row.snapshotHash ?? null };
    evidenceStatus = row.sourceAvailability ?? row.boundary?.status ?? 'authored';
  } else {
    type = 'claim';
    identity = [row.id, row.recordedAt, row.supersededAt, row.epistemicState];
    originalSourceRef = { kind: 'claim-record', claimID: row.id, evidence: row.sourceRefs ?? [],
      evidenceCount: row.sourceRefCount ?? 0, evidenceTruncated: row.sourceRefsTruncated === true };
    sourceRevision = { id: row.id, hash: row.recordSha256 ?? null, hashKind: row.recordSha256 ? 'claim-record-sha256' : null };
    evidenceStatus = row.sourceEvidenceStatus ?? row.hashStatus ?? 'unknown';
    claimStatus = row.epistemicState ?? null;
  }
  const id = resultID(type, identity);
  const matchKind = row.matchKind === 'exact-id' ? 'exact-id' : query.trim() ? phrase ? 'fts-phrase' : 'fts-terms' : 'browse';
  const matchReasons = [{ kind: matchKind, query }, ...Object.entries(filters).filter(([name]) => !['limit', 'phrase', 'global'].includes(name))
    .map(([name, value]) => ({ kind: 'filter', name, value }))];
  const snippet = row.excerpt ?? row.predicate ?? '';
  const description = [type, row.title ?? row.predicate ?? row.path ?? row.session ?? row.id,
    claimStatus ?? row.status ?? evidenceStatus, compact(snippet, 1200),
    domain==='facts'&&row.value!==null&&row.value!==undefined?compact(stableEvidenceJSON(row.value),400):''].filter(Boolean).join(' · ');
  return { ...row, id: row.id ?? id, resultID: id, type, originalSourceRef, sourceRevision,
    observedAt: date(row.observedAt), capturedAt: date(row.capturedAt), indexedAt: date(row.indexedAt),
    matchReasons, evidenceStatus, claimStatus, coverage: row.coverage ?? row.boundary?.status ?? coverage,
    modelText: compact(description) };
}
