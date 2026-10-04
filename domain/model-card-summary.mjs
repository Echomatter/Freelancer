import { modelObservationKey } from './model-data-unified.mjs';

export const MODEL_CARD_DEPLOYMENT_KEYS = Object.freeze(['limits.context','limits.output','pricing.input','pricing.output']);
export const MODEL_CARD_RATING_KEYS = Object.freeze(['ratings.artificial-analysis.intelligence','ratings.artificial-analysis.coding',
  'ratings.artificial-analysis.agentic','performance.output_tokens_per_second','performance.time_to_first_token']);
const sourceOf = record => record.source ?? record.identifiers?.source;
const isPartial = detail => detail.factsTruncated === true || detail.observationsTruncated === true || !!detail.nextCursor;
function entries(detail) {
  if(!detail)return [];
  const rows=detail.matches ?? (detail.record?[detail]:detail.records??[]);
  return rows.map(row=>({record:row.record??row,facts:row.facts??row.observations??[],partial:isPartial(row)}));
}
function identityFor(record,modelID) {
  const identity=record.identityMatch??{};
  return {status:identity.status??'unmatched',method:identity.method??null,nativeIDs:[modelID],
    ...(identity.canonicalModelIDs?{canonicalModelIDs:identity.canonicalModelIDs}:{}),
    ...(identity.evidence?{evidence:identity.evidence}:{})};
}
function matched(record,modelID) {
  const identity=record.identityMatch??{};
  const candidates=identity.nativeIDs??identity.candidateIDs??[];
  return identity.status!=='unmatched'&&Array.isArray(candidates)&&candidates.includes(modelID);
}
function provenance(record) {
  return {source:sourceOf(record),recordID:record.id,snapshotID:record.snapshotID??null,snapshotSha256:record.snapshotSha256??null,
    sourceRef:record.sourceReference??null,sourceDates:record.sourceDates??{},retrievedAt:record.retrievedAt??null};
}
function safeURL(reference) {
  try{const url=new URL(reference?.url);return url.protocol==='https:'?url.href:null;}catch{return null;}
}
function scalar(entry,key) {
  const source=sourceOf(entry.record);
  let rows=entry.facts.filter(fact=>(fact.key??modelObservationKey(source,fact.attribute))===key);
  // The compact deployment price is its base published price. Context tiers and
  // experimental modes remain separate facts and never replace that base value.
  if(source==='modelsdev'&&key.startsWith('pricing.'))rows=rows.filter(fact=>
    fact.attribute===`cost.${key.slice('pricing.'.length)}`&&!fact.configuration?.priceTier&&!fact.configuration?.mode);
  if(rows.length!==1)return {key,value:null,availability:rows.length?'conflicting':entry.partial?'not-in-page':'not-recorded',
    units:null,scale:null,configuration:entry.record.configuration??{},sourceRef:null,dates:{},
    provenance:{recordID:entry.record.id,snapshotID:entry.record.snapshotID??null},
    ...(rows.length>1?{observationCount:rows.length}:{})};
  const fact=rows[0],number=typeof fact.value==='number'&&Number.isFinite(fact.value);
  return {key,attribute:fact.attribute,value:number?fact.value:null,
    availability:fact.value===null?'source-reported-unavailable':number?'present':'invalid-source-value',
    units:fact.units??null,scale:fact.scale??null,configuration:fact.configuration??entry.record.configuration??{},
    sourceRef:fact.sourceRef??null,dates:fact.dates??{},provenance:{observationID:fact.id??null,recordID:entry.record.id,
      snapshotID:entry.record.snapshotID??null}};
}
function recordSummary(entry,modelID,keys) {
  const record=entry.record;
  return {id:record.id,name:record.name,url:safeURL(record.sourceReference),retrievedAt:record.retrievedAt??null,
    configuration:record.configuration??{},identity:identityFor(record,modelID),provenance:provenance(record),
    metrics:Object.fromEntries(keys.map(key=>[key,scalar(entry,key)]))};
}
function configurationLabel(testedName,modelName) {
  // Shorten only an already asserted link's literal display prefix. The suffix
  // remains source text; it does not become a native reasoning setting.
  if(typeof modelName==='string'&&modelName&&testedName.toLowerCase().startsWith(modelName.toLowerCase())) {
    const suffix=testedName.slice(modelName.length).trim();
    if(suffix.startsWith('(')&&suffix.endsWith(')'))return suffix.slice(1,-1);
  }
  return testedName;
}

/** Small read-only presentation view; native support and source measurements remain distinct. */
export function summarizeNativeModelSources(model,detail) {
  const modelID=model.id,provider=model.provider??model.providerID??modelID.slice(0,modelID.indexOf('/'));
  const selected=entries(detail).filter(entry=>matched(entry.record,modelID));
  const deployments=selected.filter(entry=>sourceOf(entry.record)==='modelsdev'&&entry.record.kind==='deployment'&&
    (entry.record.provider??entry.record.identifiers?.providerID)===provider);
  const exact=deployments.filter(entry=>entry.record.identifiers?.nativeID===modelID);
  const eligible=exact.length?exact:deployments;
  const chosen=eligible.length===1?eligible[0]:null;
  const deployment=chosen?recordSummary(chosen,modelID,MODEL_CARD_DEPLOYMENT_KEYS):null;
  const ratingEntries=selected.filter(entry=>sourceOf(entry.record)==='artificial-analysis'&&entry.record.kind==='configuration');
  const ratings=ratingEntries.map(entry=>{
    const row=recordSummary(entry,modelID,MODEL_CARD_RATING_KEYS);
    const testedName=entry.record.configuration?.testedName??entry.record.name??entry.record.id;
    return {...row,testedName,label:configurationLabel(testedName,model.name??deployment?.name)};
  }).sort((a,b)=>a.testedName.localeCompare(b.testedName)||a.id.localeCompare(b.id));
  const sourceCoverage=detail?.sourceCoverage??{};
  const recordsTruncated=detail?.recordsTruncated===true||Object.values(sourceCoverage).some(row=>row.recordsTruncated===true);
  const factsTruncated=[...deployments,...ratingEntries].some(entry=>entry.partial);
  const ratingRecordsTruncated=sourceCoverage['artificial-analysis']?.recordsTruncated??recordsTruncated;
  return {native:{id:modelID,provider},deployment,ratings,coverage:{partial:recordsTruncated||factsTruncated,
    recordsTruncated,factsTruncated,deploymentsReturned:deployments.length,configurationsReturned:ratings.length,
    configurationTotal:ratingRecordsTruncated?null:ratings.length,deploymentAmbiguous:eligible.length>1,
    ...(eligible.length>1?{deploymentCandidateIDs:eligible.map(entry=>entry.record.id)}:{}),sourceCoverage}};
}
