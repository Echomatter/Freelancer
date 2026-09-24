// Session counters describe observed work, never a counterfactual saving.
export function summarizeSessions(exports, parentSession) {
  const seenSessions=new Set(), sessions=[];
  for(const exported of exports){
    const id=exported.info?.id;
    if(!id || seenSessions.has(id)) continue;
    seenSessions.add(id);
    const seenMessages=new Set(), models=new Map();
    for(const {info} of exported.messages || []){
      if(info?.role!=='assistant' || info.summary || !info.id || seenMessages.has(info.id)) continue;
      seenMessages.add(info.id);
      const model=`${info.providerID}/${info.modelID}`;
      if(!models.has(model))models.set(model,{model,messages:0,input:0,output:0,reasoning:0,cache_read:0,cache_write:0,provider_dollars:0,complete_usage:true});
      const row=models.get(model);row.messages++;
      const t=info.tokens;
      if(!t || ![t.input,t.output,t.reasoning??0,t.cache?.read??0,t.cache?.write??0].every(x=>Number.isFinite(x)&&x>=0)) {row.complete_usage=false;continue;}
      row.input+=t.input;row.output+=t.output;row.reasoning+=t.reasoning??0;row.cache_read+=t.cache?.read??0;row.cache_write+=t.cache?.write??0;
      if(!Number.isFinite(info.cost))row.provider_dollars=null;
      else if(row.provider_dollars!==null)row.provider_dollars+=info.cost;
    }
    sessions.push({session_id:id,parent_session:exported.info.parentID??null,kind:id===parentSession?'parent':'child',models:[...models.values()]});
  }
  return {parent_session:parentSession,scope:'provided session exports; each session and assistant message counted once',source:'OpenCode session assistant-message counters',sessions,
    savings:{measurable:false,reason:'No equivalent parent-only baseline. Offloaded work is not proven token or subscription-quota savings.'},
    note:'Input, output, reasoning and cache counters are separate runtime fields. Provider dollars do not measure subscription quota. Child counters are not added to parent counters.'};
}
