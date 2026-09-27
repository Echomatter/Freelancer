import { summarizeRequestWork } from './chat-view.mjs';
import { contextTokens, contextUsage } from '../shared/context-usage.mjs';

const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const quantity = value => value === null ? 'Not reported' : new Intl.NumberFormat('en', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);

// Context is the latest native model call, never the sum of a chat's usage.
// Reasoning is already included in output; cache tokens still occupy context.
export function reportedContext(messages = [], models = []) {
  const usage = contextUsage(messages.map(m => m.info), info => models.find(m => m.id === `${info.providerID}/${info.modelID}`)?.context);
  const { used, limit } = usage;
  return { ...usage,
    label: used !== null && limit ? `${quantity(used)} / ${quantity(limit)} tokens · last reported context` : 'Context usage not reported' };
}

export function turnStatistics(request, models = [], live = false) {
  const summary = summarizeRequestWork(request.allMessages);
  const responses = request.responseMessages;
  const reported = responses.filter(m => contextTokens(m.info?.tokens) !== null);
  const input = reported.length ? reported.reduce((sum, m) => sum + (count(m.info.tokens.input) ?? 0) + (count(m.info.tokens.cache?.read) ?? 0) + (count(m.info.tokens.cache?.write) ?? 0), 0) : null;
  const output = reported.length ? reported.reduce((sum, m) => sum + (count(m.info.tokens.output) ?? 0), 0) : null;
  const start = request.userMessages.find(m => count(m.info?.time?.created) !== null)?.info.time.created;
  const finished = responses.findLast(m => count(m.info?.time?.completed) !== null)?.info.time.completed;
  const duration = typeof start === 'number' && typeof finished === 'number' && finished >= start ? finished - start : null;
  const ids = [...new Set(responses.filter(m => m.info?.providerID && m.info?.modelID).map(m => `${m.info.providerID}/${m.info.modelID}`))];
  const imported = request.allMessages.some(m => m.info?.imported);
  const error = summary.errors || responses.some(m => m.info?.error);
  const status = imported ? 'Imported' : live ? 'Working' : error ? 'Has errors' : responses.some(m => m.info?.finish === 'stop') ? 'Completed' : 'Recorded';
  return { preview: request.userMessages.flatMap(m => m.parts ?? []).filter(p => p.type === 'text' && !p.synthetic).map(p => p.text).join(' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Conversation activity',
    status,
    stats: [
      { label: 'Actions', value: String(summary.toolCount + summary.workerCount) },
      { label: 'Helpers', value: String(summary.workerCount) },
      { label: 'Input + cache', value: quantity(input) },
      { label: 'Output', value: quantity(output) },
      ...(duration !== null ? [{ label: 'Elapsed', value: duration < 60000 ? `${Math.max(1, Math.round(duration / 1000))}s` : `${Math.round(duration / 6000) / 10}m` }] : []),
      ...(ids.length ? [{ label: 'Model', value: ids.map(id => models.find(m => m.id === id)?.name ?? id).join(', ') }] : []),
    ] };
}
