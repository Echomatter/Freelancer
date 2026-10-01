import { visibleActivity } from './activity.mjs';
import { delegateChildSession, isHandoffPart, latestToolParts } from './chat-view.mjs';
import { isInternalMessage } from './sender.mjs';

export const isGoalMessage = message => isInternalMessage(message) && (message.parts ?? []).some(part => /^\[Freelancer Goal (?:handoff|activity) /.test(part.text ?? ''));

export const isAgentTool = part => part.type === 'tool' && (['delegate', 'task'].includes(part.tool) || isHandoffPart(part));
export const commandMessages = messages => messages.map(message => ({ ...message, parts: (message.parts ?? []).filter(part => !isAgentTool(part)) }));

export function turnTools(request, activity = []) {
  const messages = request?.allMessages ?? [];
  const agentTools = latestToolParts(messages, { collapseWorkers: false }).filter(isAgentTool);
  const handoffs = agentTools.filter(isHandoffPart);
  const children = new Set(handoffs.map(delegateChildSession).filter(Boolean));
  const assignments = new Set(agentTools.map(part => part.state?.metadata?.task_id).filter(Boolean));
  const ids = new Set(messages.map(message => message.info?.id).filter(Boolean));
  if (request?.requestID) ids.add(request.requestID);
  return {
    handoffs,
    agentTools,
    commands: latestToolParts(commandMessages(messages)),
    // An explicit request identity wins over a reused child session: a later
    // continuation must not replace the earlier turn's recorded report.
    agents: visibleActivity(activity.filter(row => {
      if (row.requestID) return ids.has(row.requestID);
      const owner = row.requestID ?? row.raw?.user_task_id;
      return assignments.has(row.id) || (owner ? ids.has(owner) || ids.has(owner.split('/').at(-1)) : children.has(row.child));
    })),
    agentMessages: messages.filter(message => isInternalMessage(message) && !isGoalMessage(message)),
    goalMessages: messages.filter(isGoalMessage),
    models: [...new Set(messages.filter(message => message.info?.role === 'assistant' && message.info?.modelID).map(message => `${message.info.providerID}/${message.info.modelID}`))],
  };
}

export function agentTurnEntries(details) {
  const entries = new Map(details.agents.map(row => [row.child ?? row.id, { key: row.child ?? row.id, activity: row, parts: [], messages: [] }]));
  details.agentTools.forEach((part, index) => {
    // Discovery and transcript reads are commands, not additional workers.
    const input = part.state?.input ?? {};
    if (input.worker && !input.task && !input.prompt && !input.cancel &&
        part.state?.metadata?.freelancer_status !== 'worker_handoff') return;
    if (!part.state?.input?.task && !part.state?.input?.prompt &&
        ['catalog','workers','worker_transcript'].includes(part.state?.metadata?.freelancer_status)) return;
    const key = delegateChildSession(part) ?? part.state?.metadata?.task_id ?? part.callID ?? part.id ?? `agent-${index}`;
    if (!entries.has(key)) entries.set(key, { key, parts: [], messages: [] });
    entries.get(key).parts.push(part);
  });
  const unmatched = [];
  for (const message of details.agentMessages) {
    const id = message.parts?.find(p => p.type === 'text')?.text?.match(/^\[Freelancer \w+ handoff ([\w-]+)\]/)?.[1];
    const entry = id && [...entries.values()].find(entry => entry.parts.some(part => JSON.stringify(part.state?.input ?? {}).includes(id)));
    if (entry) entry.messages.push(message);
    else unmatched.push(message);
  }
  const summoned = entry => Math.max(
    Date.parse(entry.activity?.attempt?.started_at ?? entry.activity?.raw?.created_at) || 0,
    ...entry.parts.map(part => part.state?.time?.start ?? part.time?.start ?? 0));
  return { entries: [...entries.values()].reverse().sort((a, b) => summoned(b) - summoned(a)), unmatched };
}

export function chatAgentDetails(requests = [], activity = []) {
  const details = turnTools({ allMessages: requests.flatMap(request => request.allMessages ?? []) }, []);
  return { ...details, agents: visibleActivity(activity) };
}

export function turnWorking(details, { current = false, busy = false, blocked = false, goalStatus = '' } = {}) {
  const active = part => ['running', 'pending'].includes(part.state?.status);
  const parent = current && busy && !blocked;
  const commands = !!parent && details.commands.some(active);
  const agents = details.agents.some(row => !row.stale && ['working', 'running', 'starting', 'tool'].includes(row.phase)) ||
    !!parent && details.agentTools.some(active);
  // Busy includes tools and approval waits; it is not by itself model work.
  const models = !!parent && ![...details.commands, ...details.agentTools].some(active);
  return { commands, agents, models, goals: !!current && goalStatus === 'running' && (commands || agents || models) };
}

// Goal events carry timestamps rather than native message IDs. Associate them
// with the latest request already started at that time; never duplicate them.
export function goalEventsByTurn(requests, events = []) {
  const result = requests.map(() => []);
  for (const event of events) {
    let owner = 0;
    requests.forEach((request, index) => {
      const created = request.userMessages[0]?.info?.time?.created ?? request.allMessages[0]?.info?.time?.created;
      if (Number.isFinite(created) && created <= event.at) owner = index;
    });
    result[owner]?.push(event);
  }
  return result;
}
