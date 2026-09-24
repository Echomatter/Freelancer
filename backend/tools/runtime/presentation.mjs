// Current named-agent calls retain their native delegate tool and metadata.
// The legacy display adapter below remains only to read/restore older history;
// it is never used to disguise new named-agent assignments.
const marker = 'freelancer_delegate_display';
const savedDisplay = part => part?.state?.metadata?.[marker] || part?.state?.metadata?.ai_toolkit_delegate_display;
const cleanPrompt = text => String(text || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').replace(/\r\n/g,'\n').trim();
export function handoffPreview(text, limit = 360) {
  const prompt = cleanPrompt(text).replace(/\s+/g,' ');
  if (prompt.length <= limit) return prompt;
  const prefix = prompt.slice(0,limit);
  const boundary = prefix.lastIndexOf(' ');
  return prefix.slice(0,boundary > limit*0.7 ? boundary : limit) + '…';
}
const phaseLabel = (status, failure) => {
  const reason = failure ? ` · ${failure}` : '';
  return ({selection_required:'Choosing a model',decision_required:'Needs your choice',continue_parent:'Returned to parent',
    parallel_limit:'Waiting for a free slot',paid_permission_declined:'Permission declined',running:'Working',completed:'Finished',
    failed:`Stopped${reason}`,stop_unverified:`Stop unverified${reason}`,cancelled:`Cancelled${reason}`,
    timeout:`Timed out${reason}`,quota:'Blocked · quota',throttle:'Throttled · retry later',auth:'Blocked · auth',
    provider:'Provider failed',binding:'Blocked · binding',model:'Blocked · model'}[status] || 'Preparing handoff');
};
export function completionMetadata(receipt, args) {
  const attempt = receipt.attempts?.at(-1);
  const metadata = { sessionId: attempt?.child_session, parentSessionId: receipt.parent_session,
    agentID: receipt.agent?.id, agentName: receipt.agent?.name, workflowID: receipt.workflow?.id, role: receipt.role, selected_model: attempt?.selected_model, task_id: receipt.task_id,
    freelancer_activity: receipt.activity, freelancer_status: receipt.status };
  if (args.agentID || receipt.agent?.id) return metadata;
  // The host replaces metadata on completion but retains the displayed tool/input.
  // Carry restoration data in the returned result as well as the running updates.
  return { ...metadata, [marker]: { version: 2,
    original_tool: 'delegate', original_input: args, original_metadata: metadata,
    selected_model: attempt?.selected_model, source: attempt?.child_session ? 'actual_sdk_child' : 'delegate_request' } };
}
export function taskCard(part) {
  if (part?.type !== 'tool') return null;
  if (part.tool !== 'delegate') {
    const saved = savedDisplay(part);
    if (![1,2].includes(saved?.version) || saved.original_tool !== 'delegate') return null;
    const original = structuredClone(part);
    restoreDelegateTools([{parts:[original]}]);
    const next = taskCard(original);
    // Suppress our own update events, but refresh old cards and final status.
    return next && (next.tool !== part.tool || JSON.stringify(next.state.input) !== JSON.stringify(part.state.input)) ? next : null;
  }
  // New web-native assignments do not need the retired Desktop task disguise.
  if (part.state?.input?.agentID || part.state?.input?.agent || part.state?.input?.worker) return null;
  const state = part.state;
  if (!state || !['running', 'completed', 'error'].includes(state.status)) return null;
  if (state.metadata?.freelancer_display_disabled === true || state.metadata?.ai_toolkit_display_disabled === true) return null;
  let receipt;
  if (state.status === 'completed') {
    try { receipt = JSON.parse(state.output); } catch { /* Host-truncated routing details still have trusted completion metadata. */ }
    if (receipt && receipt.parent_session !== part.sessionID) return null;
  }
  const attempt = receipt?.attempts?.at(-1);
  const meta = state.metadata || {};
  const sessionId = attempt?.child_session || meta.sessionId;
  const role = receipt?.role || meta.role || state.input?.role;
  const selected = attempt?.selected_model || meta.selected_model;
  if (!['worker','architect','researcher','review'].includes(role) || !state.input?.task) return null;
  const preview = handoffPreview(state.input.task);
  if (!sessionId || !selected) {
    // Generic host tools print every primitive argument in brackets. Use a
    // display-only label and no arguments; restoration keeps the exact call.
    // This is a request, never a fabricated native child or completed task.
    const status = receipt?.status || meta.freelancer_status || state.output?.match(/"status"\s*:\s*"([a-z_]+)"/)?.[1];
    const failure = receipt?.attempts?.at(-1)?.failure || receipt?.failure_summary?.failure || meta.freelancer_activity?.failure;
    return { ...part, tool:`Handoff to ${role} · ${phaseLabel(status, failure)}\n${preview}`,
      state:{...state,input:{},metadata:{...meta,[marker]:{version:2,original_tool:'delegate',original_input:state.input,original_metadata:meta,source:'delegate_request'}}} };
  }
  const failed = state.status === 'error' || receipt?.attempts?.at(-1)?.status === 'failed' || meta.freelancer_activity?.phase === 'failed';
  const failure = receipt?.attempts?.at(-1)?.failure || receipt?.failure_summary?.failure || meta.freelancer_activity?.failure;
  return { ...part, tool: 'task', state: { ...state,
    input: { subagent_type: role, description: `${failed ? `Stopped${failure ? ` · ${failure}` : ''} · ` : ''}${preview}`, prompt: state.input.task },
    metadata: { ...meta, sessionId, parentSessionId: part.sessionID,
      [marker]: { version: 2, original_tool: 'delegate', original_input: state.input,
        original_metadata: meta, selected_model: selected, source: 'actual_sdk_child' } },
  } };
}
export function restoreDelegateTools(messages) {
  for (const message of messages) for (const part of message.parts || []) {
    const saved = savedDisplay(part);
    if (part.type !== 'tool' || ![1,2].includes(saved?.version) || saved.original_tool !== 'delegate') continue;
    part.tool = 'delegate';
    part.state.input = saved.original_input;
    part.state.metadata = saved.original_metadata;
  }
}
export function createPresenter({ client, directory }) {
  const unwrap = r => { if(r?.error) throw new Error('Display update failed'); return r?.data ?? r; };
  async function present(part) {
    const card = taskCard(part);
    if (!card) return false;
    if (card.state.metadata[marker].source === 'actual_sdk_child') {
      const child = unwrap(await client.session.get({path:{id:card.state.metadata.sessionId},query:{directory},signal:AbortSignal.timeout(3000)}));
      const selected=card.state.metadata[marker].selected_model;
      if (child.parentID !== part.sessionID || (child.metadata?.freelancer || child.metadata?.ai_toolkit)?.selected !== selected) return false;
    }
    // Same part and callID: no synthetic inference, duplicate tool call or child.
    const args={path:{sessionID:part.sessionID,messageID:part.messageID,partID:part.id},query:{directory},body:card,signal:AbortSignal.timeout(3000)};
    // The injected v1 SDK omits Part; use its existing authenticated transport
    // for the documented endpoint (v2 exposes it as part.update).
    const result=client.part?.update ? await client.part.update(args) :
      await client._client.patch({...args,url:'/session/{sessionID}/message/{messageID}/part/{partID}',headers:{'Content-Type':'application/json'}});
    unwrap(result);
    return true;
  }
  // OpenCode 1.18.31 bridges plugin ask(), but exposes metadata() as an
  // unevaluated host Effect. Publish through the same authenticated SDK instead.
  present.metadata = async (ctx, update) => {
    const message = unwrap(await client.session.message({path:{id:ctx.sessionID,messageID:ctx.messageID},query:{directory},signal:AbortSignal.timeout(3000)}));
    const candidates = (message.parts || []).filter(p => p.type === 'tool' &&
      ['running','pending','completed'].includes(p.state?.status) && (ctx.callID ? p.callID === ctx.callID :
        p.tool === 'delegate' || savedDisplay(p)?.original_tool === 'delegate'));
    if (candidates.length !== 1) return false;
    const original = structuredClone(candidates[0]);
    restoreDelegateTools([{parts:[original]}]);
    if (original.tool !== 'delegate' || original.sessionID !== ctx.sessionID) return false;
    original.state = { ...original.state, title: update.title ?? original.state.title,
      metadata: { ...original.state.metadata, ...update.metadata } };
    if (original.state.input?.agentID || original.state.input?.agent || original.state.input?.worker) {
      // The real web UI reads the same native delegate part; no tool renaming,
      // argument replacement, duplicate tool execution, or synthetic child.
      const args = { path: { sessionID: original.sessionID, messageID: original.messageID, partID: original.id }, query: { directory }, body: original, signal: AbortSignal.timeout(3000) };
      unwrap(client.part?.update ? await client.part.update(args) : await client._client.patch({ ...args, url: '/session/{sessionID}/message/{messageID}/part/{partID}', headers: { 'Content-Type': 'application/json' } }));
      return true;
    }
    return present(original);
  };
  return present;
}
