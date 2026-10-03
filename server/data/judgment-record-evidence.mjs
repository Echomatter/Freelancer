import { createHash } from 'node:crypto';

export const stableEvidenceJSON = value => JSON.stringify(value, (_key, item) =>
  item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
export const evidenceDigest = value => createHash('sha256').update(value).digest('hex');

/** Stored records are evidence of what was recorded, never proof of a claim. */
export function createJudgmentRecordEvidence(db) {
  const memories=db.prepare(`SELECT m.*,r.revision_id,r.revision,r.body,r.provenance_json,r.capture_boundary_json,
    (SELECT max(latest.revision) FROM memory_item_revisions latest WHERE latest.memory_id=m.memory_id) AS latest_revision,
    r.created_at AS revision_created_at FROM memory_items m JOIN memory_item_revisions r USING(memory_id)
    WHERE m.memory_id=? AND (? IS NULL OR r.revision=?) ORDER BY r.revision DESC LIMIT 1`);
  const members=db.prepare('SELECT * FROM memory_members WHERE revision_id=? ORDER BY ordinal');
  const pins=db.prepare('SELECT * FROM memory_pins WHERE memory_id=?');
  const claims=db.prepare('SELECT * FROM claims WHERE claim_id=?');
  const claimEvidence=db.prepare('SELECT * FROM claim_evidence WHERE claim_id=? ORDER BY evidence_id,relation');
  const entities=db.prepare('SELECT * FROM entities WHERE entity_id=?');
  const contents=db.prepare(`SELECT u.text,u.sha256 FROM content_unit_revisions u JOIN content_source_revisions s USING(source_identity,revision_identity)
    WHERE s.source_identity=? AND s.revision_identity=? AND u.locator=? AND u.sha256=? LIMIT 1`);
  const openCode=db.prepare(`SELECT parts_json FROM opencode_message_revisions WHERE
    source_system_id=? AND project_id=? AND session_id=? AND message_id=? AND revision_sha256=? LIMIT 1`);
  const unavailable = message => { throw Error(`Judgment evidence ${message}`); };
  function memory(memoryID, revision) {
    if (revision!==undefined && (!Number.isSafeInteger(revision)||revision<1)) unavailable('requires a positive memory revision.');
    const row=memories.get(memoryID,revision??null,revision??null);
    if (!row || row.deleted_at!==null || row.status==='forgotten') unavailable('memory revision is missing or forgotten.');
    const record={...row,members:members.all(row.revision_id),pin:pins.get(memoryID)??null};
    return {ref:{kind:'memory-revision',candidateID:row.memory_id,memoryID:row.memory_id,revision:row.revision,
      revisionID:row.revision_id,bodySha256:evidenceDigest(row.body),recordSha256:evidenceDigest(stableEvidenceJSON(record))},
      text:row.body,record};
  }
  function rememberSource(context,key,read) {
    if(context.sources.has(key)) return context.sources.get(key);
    if(context.sources.size>=256) unavailable('claim provenance exceeds 256 resolved sources.');
    const source=read();
    context.bytes+=Buffer.byteLength(source.text,'utf8');
    if(context.bytes>4_000_000) unavailable('claim provenance exceeds 4 MB of resolved source text.');
    context.sources.set(key,source);
    return source;
  }
  function fingerprint(ref, chain, context) {
    if (ref.kind==='memory' || ref.kind==='memory-revision') {
      const id=ref.memoryID, revision=ref.memoryRevision??ref.revision;
      if (typeof id!=='string'||!Number.isSafeInteger(revision)||revision<1) unavailable('claim memory source requires an exact stored revision.');
      if (ref.id!==undefined && ref.id!==`memory:${id}@${revision}`) unavailable('claim memory source ID does not match its stored revision.');
      const source=rememberSource(context,stableEvidenceJSON(['memory',id,revision]),()=>memory(id,revision));
      if (ref.bodySha256!==undefined&&ref.bodySha256!==source.ref.bodySha256) unavailable('claim memory source body hash changed.');
      if (ref.recordSha256!==undefined&&ref.recordSha256!==source.ref.recordSha256) unavailable('claim memory source record changed.');
      return source.ref;
    }
    if (ref.kind==='content-unit') {
      const hash=ref.unitSha256??ref.unitHash;
      rememberSource(context,stableEvidenceJSON(['content',ref.sourceIdentity,ref.revisionIdentity,ref.locator,hash]),()=>{
        const row=contents.get(ref.sourceIdentity,ref.revisionIdentity,ref.locator,hash);
        if (!row || evidenceDigest(row.text)!==hash) unavailable('claim indexed source revision is missing or changed.');
        return row;
      });
      return {kind:ref.kind,sourceIdentity:ref.sourceIdentity,revisionIdentity:ref.revisionIdentity,locator:ref.locator,unitSha256:hash};
    }
    if (ref.kind==='opencode-text-part') {
      rememberSource(context,stableEvidenceJSON(['opencode',ref.sourceSystemID,ref.projectID,ref.sessionID,ref.messageID,ref.revisionSha256,ref.partID,ref.partSha256]),()=>{
        const row=openCode.get(ref.sourceSystemID,ref.projectID,ref.sessionID,ref.messageID,ref.revisionSha256);
        const part=row&&JSON.parse(row.parts_json).parts.find(part=>part?.id===ref.partID&&part?.type==='text');
        if (!part||typeof part.text!=='string'||evidenceDigest(part.text)!==ref.partSha256) unavailable('claim captured conversation source is missing or changed.');
        return part;
      });
      return {...ref,text:undefined};
    }
    if (ref.kind==='claim-record') {
      if(typeof ref.claimID!=='string'||!ref.claimID.trim()) unavailable('claim source requires an exact stored claim ID.');
      const source=rememberSource(context,stableEvidenceJSON(['claim',ref.claimID]),()=>claim(ref.claimID,chain,context));
      if (ref.recordSha256!==undefined&&ref.recordSha256!==source.ref.recordSha256) unavailable('claim source record changed.');
      return source.ref;
    }
    // Opaque authored provenance is retained as recorded. It does not receive a
    // "verified source" label or become an invented native source locator.
    return {kind:'recorded-provenance',record:ref};
  }
  function claim(claimID, ancestors=new Set(),context={sources:new Map(),bytes:0}) {
    if (ancestors.has(claimID)||ancestors.size>=4) unavailable('claim provenance is cyclic or exceeds the depth bound.');
    const row=claims.get(claimID);
    if (!row) unavailable('claim record is missing.');
    const chain=new Set([...ancestors,claimID]);
    const evidence=claimEvidence.all(claimID);
    if (!evidence.length||evidence.length>1000) unavailable('claim record needs bounded retained provenance.');
    const record={...row,subject:row.subject_entity_id?entities.get(row.subject_entity_id)??null:null,
      object:row.object_entity_id?entities.get(row.object_entity_id)??null:null,
      evidence:evidence.map(row=>({...row,source:fingerprint(JSON.parse(row.evidence_json),chain,context)}))};
    const text=stableEvidenceJSON(record);
    return {ref:{kind:'claim-record',candidateID:row.claim_id,claimID:row.claim_id,recordSha256:evidenceDigest(text)},text,record};
  }
  return {memory,claim};
}
