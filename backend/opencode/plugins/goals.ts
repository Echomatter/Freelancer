import { tool, type Plugin } from '@opencode-ai/plugin';
import { readStateText as readFile } from '../../tools/runtime/state-database.mjs';
import path from 'node:path';

const Goals: Plugin = async ({ directory }) => ({
  tool: {
    goal_checkpoint: tool({
      description: 'Record progress and a proposed outcome for the active saved-goal parent under its current run and objective revision. Include actual work, evidence and remaining gaps. The recorded receipt is not a completed goal: the controller reconciles native todos, workers and activity before changing status or continuing. Ordinary chats and delegated workers do not report goal checkpoints. This records state without directly launching or aborting work.',
      args: {
        outcome: tool.schema.enum(['continue', 'waiting', 'pause', 'complete']).describe('continue: useful parent work remains; waiting: next progress depends on an answer, worker or capacity; pause: inspection/explicit Resume needed; complete: objective and required checks are satisfied with native plan reconciled.'),
        interpretation: tool.schema.string().min(1).max(12000).describe('Current objective interpretation and acceptance criteria, preserving user steering and captured constraints.'),
        checkpoint: tool.schema.string().min(1).max(12000).describe('Concrete completed work, decisions, unresolved gaps and next action. Preserve native todos and existing worker identities.'),
        reason: tool.schema.string().min(1).max(2000).describe('Specific reason for the proposed outcome; ending a response alone is not completion.'),
        evidence: tool.schema.string().max(16000).describe('Checks actually performed, results and stable source/receipt references; label failed, unrun or unavailable checks. Retained claims and tool completion are not proof of success.'),
      },
      async execute(args, context) {
        const root = process.env.FREELANCER_RUNTIME_ROOT;
        if (!root) throw Error('Start through Freelancer.');
        const launch = JSON.parse(await readFile(path.join(root, '.state/webpage/launch.json'), 'utf8'));
        const url = new URL(launch.url);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Local goal controller required.');
        const response = await fetch(new URL('/api/goals/checkpoint', url), {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': process.env.FREELANCER_GIT_BRIDGE || '' },
          body: JSON.stringify({ ...args, directory, sessionID: context.sessionID, messageID: context.messageID }), signal: context.abort,
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Checkpoint rejected.');
        return { title: 'Goal checkpoint recorded', output: JSON.stringify(result) };
      },
    }),
  },
});
export default Goals;
