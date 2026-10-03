import { tool, type Plugin } from '@opencode-ai/plugin';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const Knowledge: Plugin = async ({ directory }) => {
  const root = process.env.FREELANCER_RUNTIME_ROOT;
  if (!root) throw Error('Start this plugin through Freelancer.');
  const runtime = await import(pathToFileURL(path.join(root, 'tools/runtime/state-database.mjs')).href);
  return { tool: {
    knowledge: tool({
      description: 'Shared global memory and evidence retrieval for every named agent. Search source-backed memories, inspect provenance, and create evidence-linked claims or graph relations. Optional TypeSafe judgments require candidate IDs and evidence references that resolve to indexed content units or captured OpenCode text parts; packet text must match those sources. Evaluation asks native permission before sending bounded state. A stored claim is not authorization or proof beyond its evidence.',
      args: {
        operation: tool.schema.enum(['search','read','status','entity','entity-search','delete-entity','claim','correct-claim','relate','relations','delete-relation','remember','revise','forget','analyze','judgment-provider-status','judgment-definition','judgment-evaluate','judgment-evaluate-batch','judgment-record','judgment-history','judgment-cache','opencode-read','warehouse-status','warehouse-backfill']),
        query: tool.schema.string().optional(),
        limit: tool.schema.number().int().min(1).max(100).optional(),
        kind: tool.schema.string().optional(),
        id: tool.schema.string().optional(),
        relationID: tool.schema.string().optional(),
        subjectEntityID: tool.schema.string().optional(),
        objectEntityID: tool.schema.string().optional(),
        valueJson: tool.schema.string().optional(),
        validFrom: tool.schema.number().int().optional(),
        validTo: tool.schema.number().int().optional(),
        type: tool.schema.string().optional(),
        name: tool.schema.string().optional(),
        alias: tool.schema.string().optional(),
        aliases: tool.schema.array(tool.schema.string()).optional(),
        sourceRef: tool.schema.string().optional(),
        title: tool.schema.string().optional(),
        body: tool.schema.string().optional(),
        reason: tool.schema.string().optional(),
        expectedRevision: tool.schema.number().int().positive().optional(),
        expectedEpistemicState: tool.schema.enum(['unverified','supported','disputed']).optional(),
        method: tool.schema.string().optional(),
        scopeJson: tool.schema.string().optional(),
        from: tool.schema.string().optional(),
        to: tool.schema.string().optional(),
        predicate: tool.schema.string().optional(),
        origin: tool.schema.enum(['human-authored','user-stated','source-reported','directly-observed','deterministically-extracted','model-inferred']).optional(),
        epistemicState: tool.schema.enum(['unverified','supported','disputed','superseded']).optional(),
        evidenceJson: tool.schema.string().optional(),
        sql: tool.schema.string().optional(),
        paramsJson: tool.schema.string().optional(),
        definitionID: tool.schema.string().optional(),
        definitionVersion: tool.schema.number().int().positive().optional(),
        questionID: tool.schema.string().optional(),
        primitive: tool.schema.enum(['check','classify','score']).optional(),
        questionJson: tool.schema.string().optional(),
        criteriaJson: tool.schema.string().optional(),
        stateJson: tool.schema.string().optional(),
        definitionsJson: tool.schema.string().optional(),
        requestedModel: tool.schema.string().optional(),
        runJson: tool.schema.string().optional(),
        stateHash: tool.schema.string().optional(),
        candidateIDsJson: tool.schema.string().optional(),
        evidenceRefsJson: tool.schema.string().optional(),
        requestedProvider: tool.schema.string().optional(),
        requestedModel: tool.schema.string().optional(),
        reportedProvider: tool.schema.string().optional(),
        reportedModel: tool.schema.string().optional(),
        projectID: tool.schema.string().optional(),
        sessionID: tool.schema.string().optional(),
        sourceSystemID: tool.schema.string().optional(),
        runID: tool.schema.string().optional(),
        resume: tool.schema.boolean().optional(),
        pageSize: tool.schema.number().int().min(1).max(500).optional(),
      },
      async execute(args, context) {
        if (['judgment-evaluate','judgment-evaluate-batch'].includes(args.operation)) {
          await context.ask({ permission: 'edit', patterns: ['shared knowledge'], always: [],
            metadata: { operation: args.operation, provider: 'TypeSafe', sends: 'bounded caller supplied evidence' } });
        } else if (['entity','delete-entity','claim','correct-claim','relate','delete-relation','remember','revise','forget','judgment-definition','judgment-record','warehouse-backfill'].includes(args.operation)) {
          await context.ask({ permission: 'edit', patterns: ['shared knowledge'], always: [], metadata: { operation: args.operation } });
        }
        const launch = runtime.readState(path.join(root, '.state/webpage/launch.json'));
        const url = new URL(launch.url);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Local knowledge service required.');
        const response = await fetch(new URL('/api/knowledge/agent', url), {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': process.env.FREELANCER_GIT_BRIDGE || '' },
          body: JSON.stringify({ ...args, directory, sessionID: context.sessionID, messageID: context.messageID }), signal: context.abort,
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Knowledge operation failed.');
        return { title: `Knowledge · ${args.operation}`, output: JSON.stringify(result, null, 2) };
      },
    }),
  }};
};

export default Knowledge;
