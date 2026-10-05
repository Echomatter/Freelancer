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
      row={...row,metadataTruncated:true,metadataTruncationReasons:[...new Set([...(row.metadataTruncationReasons??[]),'page-byte-limit'])],originalSourceRef:{...row.originalSourceRef}};
      if(row.value!==undefined&&row.value!==null) {row.value=null;row.valueTruncated=true;}
      if(row.data!==undefined&&row.data!==null) {row.data=null;row.dataTruncated=true;}
      while(bytes()>budget) {
        const members=row.sourceRefs??row.originalSourceRef.members??[],evidence=row.evidence??row.originalSourceRef.evidence??[];
        if(!members.length&&!evidence.length) break;
        if(members.length>=evidence.length) {
          const kept=members.slice(0,Math.floor(members.length/2));
          row.sourceRefs=kept;row.sourceRefsTruncated=true;
          if(row.originalSourceRef.members) {row.originalSourceRef.members=kept;row.originalSourceRef.membersTruncated=true;}
        } else {
          const kept=evidence.slice(0,Math.floor(evidence.length/2));
          row.evidence=kept;row.evidenceTruncated=true;
          if(row.originalSourceRef.evidence) {row.originalSourceRef.evidence=kept;row.originalSourceRef.evidenceTruncated=true;}
        }
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
  if(domain==='facts') domain='memories';
  if(typeof row.excerpt==='string'&&row.excerpt.length>2400) row={...row,excerpt:compact(row.excerpt,2400),excerptTruncated:true};
  if(typeof row.heading==='string'&&row.heading.length>1000) row={...row,heading:compact(row.heading,1000),headingTruncated:true};
  let type, identity, originalSourceRef, sourceRevision, evidenceStatus;
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
      projectID: row.projectID, sessionID: row.session, messageID: row.message || null,
      snapshotRevisionSha256: row.evidence?.snapshotRevisionSha256 ?? null };
    sourceRevision = { id: row.evidence?.snapshotRevisionSha256 ?? null, hash: row.evidence?.snapshotRevisionSha256 ?? null,
      hashKind: row.evidence?.snapshotRevisionSha256 ? 'opencode-snapshot-sha256' : null,
      sessionHash: row.evidence?.sessionRevisionSha256 ?? null };
    evidenceStatus = row.evidenceAvailability ?? 'unavailable';
  } else if (domain === 'memories') {
    type = 'memory';
    identity = [row.id, row.revisionID, row.revision];
    originalSourceRef = { kind: 'memory-revision', id: `memory:${row.id}@${row.revision}`, candidateID:row.id,memoryID: row.id, revision: row.revision,
      revisionID: row.revisionID ?? null, system: row.source?.system ?? null, projectID: row.projectID,
      bodySha256:row.bodySha256??null,recordSha256:row.recordSha256??null,
      sessionID: row.sessionID ?? null, members: row.sourceRefs ?? [], memberCount: row.sourceRefCount ?? 0,
      membersTruncated: row.sourceRefsTruncated === true, evidence:row.evidence??[],evidenceCount:row.evidenceCount??0,
      evidenceTruncated:row.evidenceTruncated===true };
    sourceRevision = { id: row.revisionID ?? null, hash: row.recordSha256 ?? null,
      hashKind: row.recordSha256 ? 'memory-record-sha256' : null, hashUnavailableReason:row.hashUnavailableReason??null,
      bodyHash:row.bodySha256??null,bodyHashUnavailableReason:row.bodyHashUnavailableReason??null,snapshotHash: row.snapshotHash ?? null };
    evidenceStatus = row.boundary?.bodyEdited===true ? 'authored' : row.sourceAvailability ?? row.boundary?.status ?? 'authored';
  } else throw Error('Unknown knowledge result domain.');
  const id = resultID(type, identity);
  const matchKind = row.matchKind === 'exact-id' ? 'exact-id' : query.trim() ? phrase ? 'fts-phrase' : 'fts-terms' : 'browse';
  const matchReasons = [{ kind: matchKind, query }, ...Object.entries(filters).filter(([name]) => !['limit', 'phrase', 'global'].includes(name))
    .map(([name, value]) => ({ kind: 'filter', name, value }))];
  const snippet = row.excerpt ?? row.predicate ?? '';
  const epistemicState = row.epistemicState ?? row.data?.epistemicState ?? null;
  const structuredValue = row.data?.value ?? row.value;
  const description = [type, row.title ?? row.predicate ?? row.path ?? row.session ?? row.id,
    epistemicState ?? row.status ?? evidenceStatus, compact(snippet, 1200),
    domain==='memories'&&structuredValue!==null&&structuredValue!==undefined?compact(stableEvidenceJSON(structuredValue),400):''].filter(Boolean).join(' · ');
  return { ...row, id: row.id ?? id, resultID: id, type, originalSourceRef, sourceRevision,
    observedAt: date(row.observedAt), capturedAt: date(row.capturedAt), indexedAt: date(row.indexedAt),
    ...(domain==='memories'?{sourceType:row.kind==='conversation_snapshot'?'chat':row.kind==='file_snapshot'?'file':'custom',
      textOrigin:row.boundary?.bodyEdited===true?'authored':['conversation_snapshot','file_snapshot'].includes(row.kind)?(row.body?.trim()?'captured-source':'source-metadata'):'authored',
      sourceEvidenceStatus:row.sourceAvailability??row.boundary?.status??'authored'}:{}),
    matchReasons, evidenceStatus, epistemicState, coverage: row.coverage ?? row.boundary?.status ?? coverage,
    modelText: compact(description) };
}
