// Required selectors shared by the native plugin and HTTP bridge. Never infer
// a write operation from title/body. Every retained item uses the memory object.
export function requireMemorySelectors(input) {
  if (typeof input?.operation !== 'string' || !input.operation.trim()) {
    throw Error('memory requires an explicit operation. Save a chat or indexed file with operation: "remember" and sourceRefJson copied from its source reference; custom memories use a title and optional body or dataJson. Retrieve with operation: "query", domain: "memories". Supply the missing operation and retry.');
  }
  if (input.operation === 'query' && (typeof input.domain !== 'string' || !input.domain.trim())) {
    throw Error('memory query requires an explicit domain: memories for retained text, structured data and snapshots, files for indexed passages, or conversations for chat text.');
  }
}

export const requireKnowledgeSelectors = requireMemorySelectors;

/** Source selection is separate from actor identity and authored enrichment. */
export function memorySourceReference(input) {
  if(input===undefined)return undefined;
  if(typeof input==='string'){
    if(input.length>20_000)throw Error('Memory source reference must be bounded JSON.');
    input=JSON.parse(input);
  }
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Memory source reference must be an object copied from a chat or indexed file.');
  const text=(name,required=true,limit=2000)=>{
    const value=input[name];
    if(value===undefined||value===null){if(required)throw Error(`Memory source reference requires ${name}.`);return undefined;}
    if(typeof value!=='string'||!value.trim()||value.length>limit)throw Error(`Memory source ${name} must be bounded text.`);
    return value.trim();
  };
  if(['chat','conversation','opencode-conversation'].includes(input.kind)){
    const projectID=text('projectID'),sessionID=text('sessionID'),sourceSystemID=text('sourceSystemID',false);
    const snapshotRevisionSha256=text('snapshotRevisionSha256',false);
    if(snapshotRevisionSha256&&(!sourceSystemID||!/^[a-f0-9]{64}$/.test(snapshotRevisionSha256)))throw Error('Exact chat capture requires the returned sourceSystemID and snapshotRevisionSha256.');
    return {kind:'conversation',projectID,sessionID,...(sourceSystemID?{sourceSystemID}:{}),...(snapshotRevisionSha256?{snapshotRevisionSha256}:{})};
  }
  if(['file','content-unit'].includes(input.kind)){
    const sourceIdentity=text('sourceIdentity',true,16_000),revisionIdentity=text('revisionIdentity'),projectID=text('projectID',false),locator=text('locator',false);
    const unitSha256=text(input.unitSha256===undefined?'unitHash':'unitSha256',false);
    if((locator===undefined)!==(unitSha256===undefined))throw Error('A selected file passage requires both its returned locator and unitSha256.');
    if(unitSha256&&!/^[a-f0-9]{64}$/.test(unitSha256))throw Error('File unit hash must be its returned SHA256.');
    return {kind:'file',sourceIdentity,revisionIdentity,...(projectID?{projectID}:{}),...(locator===undefined?{}:{locator,unitSha256})};
  }
  throw Error('Remember accepts a chat or indexed file source reference; custom memory content needs no source selector.');
}

export const memorySourceType=memory=>memory?.kind==='conversation_snapshot'?'chat':memory?.kind==='file_snapshot'?'file':'custom';
