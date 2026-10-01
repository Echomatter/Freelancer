import { tool, type Plugin } from '@opencode-ai/plugin';
import { readStateText as readFile } from '../../tools/runtime/state-database.mjs';
import path from 'node:path';

const Goals: Plugin = async ({ directory }) => ({
  tool: {
    goal_checkpoint: tool({
      description: 'Record a goal interpretation, progress checkpoint and proposed outcome. Only the active goal parent may report. The application reconciles native tasks and workers before completing or continuing.',
      args: {
        outcome: tool.schema.enum(['continue', 'waiting', 'pause', 'complete']),
        interpretation: tool.schema.string().min(1).max(12000),
        checkpoint: tool.schema.string().min(1).max(12000),
        reason: tool.schema.string().min(1).max(2000),
        evidence: tool.schema.string().max(16000),
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
