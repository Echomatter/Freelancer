// Present the selector's qualified routes using OpenCode's native question tool.
// This module formats choices; it neither ranks models nor grants permissions.
import { isDeepStrictEqual } from 'node:util';

const first = rows => Array.isArray(rows) ? rows[0] : rows;
const allowance = surface => ({ 'opencode-free': 'OpenCode free allowance', 'openai-oauth': 'ChatGPT subscription',
  'opencode-go': 'OpenCode Go allowance', 'github-copilot-oauth': 'GitHub Copilot allowance' })[surface] || surface;
const capabilityNames = { coding: 'coding', tool_use: 'tool use', research: 'research',
  repo_understanding: 'repository analysis', repo_navigation: 'code navigation',
  deep_reasoning: 'deep reasoning', long_horizon_engineering: 'complex engineering',
  architecture: 'architecture', debugging: 'debugging', code_review: 'code review',
  terminal_agent_work: 'terminal work', agentic_work: 'multi-step work', long_context: 'large inputs' };
const evidenceSummary = candidate => [...new Set((candidate?.basis || '').split(';')
  .map(row => capabilityNames[row.split('=')[0].trim()]).filter(Boolean))].slice(0, 4).join(', ');
export function makeDecision({ id, args, agentName = args.agentID, workMode = args.mode, selection, parentModel, sessionID, userMessageID, createdAt, allowParent = true, failure }) {
  const choices = [], options = [];
  const add = (label, description, action, model) => {
    choices.push({ label, action, model }); options.push({ label, description });
  };
  const offered = new Set();
  const route = (label, candidate, explanation) => {
    if (!candidate?.id || offered.has(candidate.id)) return;
    offered.add(candidate.id);
    const cost = candidate.surface === 'openai-oauth' ? 'Exact subscription usage is not known in advance.' :
      'Subject to the provider\'s current limits.';
    add(label, `${candidate.id} — ${allowance(candidate.surface)}. ${explanation} ${candidate.assessment_notes?.length ? `Evidence uncertainty: ${candidate.assessment_notes.join(' ')}` : ''} ${cost}`, 'child', candidate.id);
  };
  const recommended = selection?.choices?.recommended || (selection?.selected_model ?
    { id: selection.selected_model, surface: selection.surface, cost_note: selection.consumption_estimate?.note } : null);
  const lower = first(selection?.choices?.lower_cost), free = first(selection?.choices?.free);
  const evidence = evidenceSummary(recommended);
  const reason = selection?.host_reason ? `Host assessment: ${selection.host_reason}` : evidence ? `Recorded evidence covers the requested ${evidence}.` : selection?.is_consequential ? 'Recommended for the deeper reasoning or consequences of this assignment.' :
    'Qualified for this assignment. Cheaper models may be unavailable or lack the required recorded evidence.';
  route('Recommended child', recommended, reason);
  route('Lower-cost child', lower, 'Lower cost estimate; passes execution constraints. Review any evidence uncertainty. Estimates may use pricing as a guide.');
  route('Free child', free, 'Passes execution constraints; review any evidence uncertainty. Subject to provider availability.');
  if (allowParent) add('Continue current', `Keep ${parentModel} and use its existing allowance.${workMode === 'review' ? ' This is not an independent review.' : ''}`, 'continue_parent');
  add('Wait', 'Stop here. Resume when you choose; no automatic retry or scheduled wakeup.', 'wait_requested');
  add('Cancel', 'Cancel this assignment without starting a child.', 'cancelled');
  const unavailable = [!lower && 'Lower-cost child: no qualified alternative with a lower comparable estimate.',
    !free && 'Free child: currently unavailable under the task requirements and availability checks.'].filter(Boolean).join('\n');
  const evidenceGap = (selection?.filtered_out || []).some(r => /evidence|not proven/i.test(r.reason));
  const failureNote = failure ? `The previous child stopped (${failure}). ${allowParent ? 'Its stop was verified; inspect any partial edits before continuing.' : 'Its stop is unverified; resolve that before doing overlapping work.'}\n` : '';
  const question = { header: 'Model choice', question: `How should we handle this ${agentName} assignment?\n${args.task}\n\n${failureNote}${unavailable}${evidenceGap ? '\nSome alternatives lack recorded evidence; this does not prove that a stronger model is necessary.' : ''}\nYour main model stays ${parentModel}. Subscription children still follow your OpenCode permissions.`, options, multiple: false };
  return { id, args, sessionID, userMessageID, createdAt, choices, question };
}

export function answeredChoice(decision, messages, now) {
  if (now - Date.parse(decision.createdAt) > 30 * 60 * 1000) throw new Error('Model choice expired; request a fresh proposal.');
  const user = messages.filter(m => m.info?.role === 'user').at(-1);
  if (user?.info?.id !== decision.userMessageID) throw new Error('The user request changed; request a fresh proposal.');
  for (const message of [...messages].reverse()) for (const part of [...(message.parts || [])].reverse()) {
    if (part.type !== 'tool' || part.tool !== 'question' || part.state?.status !== 'completed' ||
        !(part.state.time?.start >= Date.parse(decision.createdAt))) continue;
    const index = (part.state.input?.questions || []).findIndex(q => isDeepStrictEqual(q, decision.question));
    if (index < 0) continue;
    const answers = part.state.metadata?.answers?.[index];
    if (!Array.isArray(answers) || answers.length !== 1) break;
    const selected = decision.choices.find(c => c.label === answers[0]);
    if (selected) return { ...selected, questionCallID: part.callID };
    break;
  }
  throw new Error('No matching recorded user choice. Ask the native question with the exact supplied question payload; never answer it yourself.');
}
