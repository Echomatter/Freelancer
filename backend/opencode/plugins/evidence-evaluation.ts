import { tool, type Plugin } from '@opencode-ai/plugin';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativeEvidenceOutput, evidenceReceiptStateHash } from '../../../domain/evidence-evaluation-view.mjs';

const jsonLimit = 120_000;
function boundedJSON(text: unknown, label: string) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > jsonLimit)
    throw Error(label + ' must be JSON text within 120 KB.');
  try { return JSON.parse(text); }
  catch { throw Error(label + ' must contain valid JSON.'); }
}

const EvidenceEvaluation: Plugin = async ({ directory }) => {
  const root = process.env.FREELANCER_RUNTIME_ROOT;
  if (!root) throw Error('Start this plugin through Freelancer.');
  const runtime = await import(pathToFileURL(path.join(root, 'tools/runtime/state-database.mjs')).href);
  // Only oversized recomposed views need this cache. Their service receipt
  // remains unchanged, and every page still verifies native owner/expiry.
  const presentationViews = new Map<string, { result: object; stateHash: string; expiresAt: number }>();
  return { tool: { evidence_evaluation: tool({
    description: 'Check, classify or score selected evidence with optional TypeSafe/Jev judgments. describe returns Freelancer\'s local schema and limits; prepare selects evidence without inference; evaluate accepts a contract or prepared receipt; inspect reads receipts without replay. Use small relevant fields, explicit unknowns and comparable criteria across batches. Follow presentation.nextCursor before claiming complete coverage. Answers are advisory: no source refresh, action execution, permission or proof of success. Code handles exact calculations; knowledge owns intentionally retained judgment definitions, not a prerequisite for this one-off workflow.',
    args: {
      operation: tool.schema.enum(['describe', 'prepare', 'evaluate', 'inspect']).describe('describe needs no payload; prepare needs contractJson; evaluate needs contractJson or receiptID; inspect needs receiptID.'),
      contractJson: tool.schema.string().max(jsonLimit).optional().describe('Freelancer version-one contract JSON; describe supplies the local schema and shared catalog keys. Question inputs must be an array of evidence IDs. Choice-to-numeric composition requires an explicit numeric mapping for every option. UTF-8 size is limited to 120 KB; this is not the TypeSafe wire request.'),
      receiptID: tool.schema.string().min(1).max(512).optional().describe('Exact receipt from prepare/evaluate in this calling conversation.'),
      outputCursor: tool.schema.string().max(100).optional().describe('Inspect only: exact presentation.nextCursor for a large receipt. Read-only JSON chunks preserve complete facts and answers without repeating evaluation.'),
      compositionJson: tool.schema.string().max(jsonLimit).optional().describe('Optional bounded composition array for recombining an evaluated receipt without inference. For a new request, include composition in contractJson. describe supplies the supported operators.'),
    },
    async execute(args, context) {
      const launch = runtime.readState(path.join(root, '.state/webpage/launch.json'));
      const url = new URL(launch.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Local evidence service required.');
      const send = async (body: object) => {
        const response = await fetch(new URL('/api/evidence/evaluate/agent', url), {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': process.env.FREELANCER_GIT_BRIDGE || '' },
          // Native context owns identity; contract fields cannot impersonate another caller.
          body: JSON.stringify({ ...body, directory, actorSessionID: context.sessionID, messageID: context.messageID }), signal: context.abort,
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Evidence operation failed.');
        return result;
      };
      let contract, composition;
      if (args.outputCursor !== undefined && args.operation !== 'inspect') throw Error('Output pagination is available only when inspecting an existing receipt.');
      if (args.contractJson !== undefined) contract = boundedJSON(args.contractJson, 'Evidence contract');
      if (args.compositionJson !== undefined) composition = boundedJSON(args.compositionJson, 'Evidence composition');
      if (args.contractJson !== undefined && args.receiptID !== undefined) throw Error('Choose a contract or an existing receipt.');
      if (contract !== undefined && composition !== undefined) throw Error('For a new request, include composition in its contract. compositionJson recombines an evaluated receipt.');
      let result;
      if (args.operation === 'evaluate') {
        if (contract === undefined && !args.receiptID) throw Error('Evaluation requires a contract or a receipt.');
        const prepared = contract === undefined
          ? await send({ operation: 'inspect', receiptID: args.receiptID })
          : await send({ operation: 'prepare', contract });
        if (typeof prepared.requiresInference !== 'boolean' || typeof prepared.receiptID !== 'string')
          throw Error('Evidence preparation could not establish its inference requirements.');
        if (composition !== undefined && prepared.status === 'prepared') throw Error('Evaluate this prepared receipt before recombining its answers.');
        if (prepared.requiresInference) await context.ask({ permission: 'edit', patterns: ['shared knowledge'], always: [],
          metadata: { operation: 'evaluate', provider: 'TypeSafe', sends: 'bounded prepared evidence', receiptID: prepared.receiptID } });
        result = await send({ operation: 'evaluate', receiptID: prepared.receiptID,
          ...(composition === undefined ? {} : { composition }) });
      } else if (args.operation === 'prepare') {
        if (contract === undefined || composition !== undefined) throw Error('Prepare requires a contract; composition belongs to evaluation.');
        result = await send({ operation: 'prepare', contract });
      } else if (args.operation === 'inspect') {
        if (!args.receiptID || contract !== undefined || composition !== undefined) throw Error('Inspect requires only an existing receipt.');
        result = await send({ operation: 'inspect', receiptID: args.receiptID });
      } else if (args.operation === 'describe') {
        if (contract !== undefined || args.receiptID !== undefined || composition !== undefined) throw Error('Describe does not take a contract or receipt.');
        result = await send({ operation: 'describe' });
      } else throw Error('Unknown evidence operation.');
      for (const [key, cached] of presentationViews) if (cached.expiresAt <= Date.now()) presentationViews.delete(key);
      const pageKey = (digest: string) => JSON.stringify([context.sessionID, result.receiptID, digest]);
      if (args.outputCursor !== undefined) {
        const cached = presentationViews.get(pageKey(args.outputCursor.split(':')[0]));
        if (cached) {
          if (cached.stateHash !== evidenceReceiptStateHash(result)) throw Error('Evidence receipt changed. Inspect the current receipt without a cursor; do not repeat evaluation.');
          result = cached.result;
        }
      }
      const output = nativeEvidenceOutput(result, { outputCursor: args.outputCursor });
      if (args.outputCursor === undefined && result.recombined === true) {
        const page = JSON.parse(output);
        if (page.presentation?.encoding === 'json-string-chunks') {
          if (presentationViews.size >= 32) presentationViews.delete(presentationViews.keys().next().value!);
          presentationViews.set(pageKey(page.presentation.outputSha256), { result, stateHash: evidenceReceiptStateHash(result),
            expiresAt: Math.min(result.expiresAt ?? Infinity, Date.now() + 3600000) });
        }
      }
      return { title: 'Evidence evaluation · ' + args.operation, output };
    },
  }) } };
};
export default EvidenceEvaluation;
