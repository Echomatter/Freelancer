import { tool, type Plugin } from '@opencode-ai/plugin';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const Knowledge: Plugin = async ({ directory }) => {
  const root = process.env.FREELANCER_RUNTIME_ROOT;
  if (!root) throw Error('Start this plugin through Freelancer.');
  const runtime = await import(pathToFileURL(path.join(root, 'tools/runtime/state-database.mjs')).href);
  const diagnostics = await import(pathToFileURL(path.join(root, 'tools/runtime/storage-diagnostics.mjs')).href);
  await diagnostics.observeStorageDriver(root);
  return { tool: {
    knowledge: tool({
      description: 'Shared global knowledge retrieval for every named agent. Use query with domain files, conversations, memories or facts for the same filters as Freelancer and its read-only CLI. Without projectID or projectDirectory, query searches globally. Read immutable memory revisions and retained source evidence, pin or explicitly refresh snapshots, and create evidence-linked claims or graph relations. Graph reads include exact entity lookup, opening named/ID nodes with one-hop relations, bounded graph pages, and substring search over entity names, types and current claim observations. read-graph pages entities, relations and observations independently with offsets; these pages reflect the current graph and may shift during concurrent edits. For a memory or fact, judgment-evidence takes its existing id, domain and optional memory revision and returns bounded state, candidateIDs and evidenceRefs for TypeSafe evaluation. Use those returned references exactly; changed or forgotten sources invalidate them. Evaluation asks permission before sending bounded state. A stored claim is not authorization or proof beyond its evidence.',
      args: {
        operation: tool.schema.enum(['query','search','read','status','claims','read-claim','pin','refresh','archive','restore','evidence','judgment-evidence','query-evidence','entity','entity-search','entity-read','open-nodes','read-graph','search-nodes','delete-entity','claim','correct-claim','relate','relations','revise-relation','relation-history','delete-relation','remember','revise','forget','analyze','judgment-provider-status','judgment-definition','judgment-evaluate','judgment-evaluate-batch','judgment-record','judgment-history','judgment-cache','opencode-read','warehouse-status','warehouse-backfill']),
        domain: tool.schema.enum(['files','conversations','memories','facts']).optional(),
        query: tool.schema.string().optional(),
        phrase: tool.schema.boolean().optional(),
        model: tool.schema.string().optional(),
        modelProvider: tool.schema.string().optional(),
        source: tool.schema.string().optional(),
        role: tool.schema.string().optional(),
        status: tool.schema.string().optional(),
        pinnedOnly: tool.schema.boolean().optional(),
        includeArchived: tool.schema.boolean().optional(),
        pinned: tool.schema.boolean().optional(),
        includeHistorical: tool.schema.boolean().optional(),
        global: tool.schema.boolean().optional(),
        projectDirectory: tool.schema.string().optional(),
        revision: tool.schema.number().int().positive().optional(),
        sourceIdentity: tool.schema.string().optional(),
        revisionIdentity: tool.schema.string().optional(),
        locator: tool.schema.string().optional(),
        unitHash: tool.schema.string().optional(),
        limit: tool.schema.number().int().min(1).max(200).optional(),
        cursor: tool.schema.string().max(1024).optional().describe('nextCursor from a query page; repeat the same domain, query, filters, project scope and limit. Pages reflect a moving index, not a stable snapshot.'),
        kind: tool.schema.string().optional(),
        id: tool.schema.string().optional(),
        ids: tool.schema.array(tool.schema.string()).max(100).optional().describe('Entity IDs for open-nodes; combined with names, at most 100 values.'),
        names: tool.schema.array(tool.schema.string()).max(100).optional().describe('Exact canonical names or aliases for open-nodes; combined with IDs, at most 100 values.'),
        entityOffset: tool.schema.number().int().min(0).max(100000).optional().describe('Entity page offset for read-graph.'),
        relationOffset: tool.schema.number().int().min(0).max(100000).optional().describe('Relation page offset for read-graph.'),
        observationOffset: tool.schema.number().int().min(0).max(100000).optional().describe('Current claim/observation page offset for read-graph.'),
        relationID: tool.schema.string().optional(),
        subjectEntityID: tool.schema.string().optional(),
        objectEntityID: tool.schema.string().optional(),
        valueJson: tool.schema.string().optional(),
        validFrom: tool.schema.number().int().optional(),
        validTo: tool.schema.number().int().optional(),
        asOf: tool.schema.number().int().optional(),
        type: tool.schema.string().optional(),
        name: tool.schema.string().optional(),
        alias: tool.schema.string().optional(),
        aliases: tool.schema.array(tool.schema.string()).optional(),
        sourceRef: tool.schema.string().optional(),
        title: tool.schema.string().optional(),
        body: tool.schema.string().optional(),
        reason: tool.schema.string().optional(),
        expectedRevision: tool.schema.number().int().min(0).optional(),
        expectedEpistemicState: tool.schema.enum(['unverified','supported','disputed']).optional(),
        method: tool.schema.string().optional(),
        scopeJson: tool.schema.string().optional(),
        provenanceJson: tool.schema.string().optional(),
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
        runJson: tool.schema.string().optional(),
        stateHash: tool.schema.string().optional(),
        candidateIDsJson: tool.schema.string().optional(),
        evidenceRefsJson: tool.schema.string().optional(),
        requestedProvider: tool.schema.string().optional(),
        requestedModel: tool.schema.string().optional(),
        reportedProvider: tool.schema.string().optional(),
        reportedModel: tool.schema.string().optional(),
        projectID: tool.schema.string().optional(),
        sessionID: tool.schema.string().optional().describe('Target native conversation for opencode-read; independent of the caller conversation'),
        snapshotRevisionSha256: tool.schema.string().optional().describe('Exact retained snapshot hash returned by a conversation search hit'),
        sourceSystemID: tool.schema.string().optional(),
        runID: tool.schema.string().optional(),
        resume: tool.schema.boolean().optional(),
        pageSize: tool.schema.number().int().min(1).max(500).optional(),
      },
      async execute(args, context) {
        if (['judgment-evaluate','judgment-evaluate-batch'].includes(args.operation)) {
          await context.ask({ permission: 'edit', patterns: ['shared knowledge'], always: [],
            metadata: { operation: args.operation, provider: 'TypeSafe', sends: 'bounded caller supplied evidence' } });
        } else if (['entity','delete-entity','claim','correct-claim','relate','revise-relation','delete-relation','remember','revise','forget','pin','refresh','archive','restore','judgment-definition','judgment-record','warehouse-backfill'].includes(args.operation)) {
          await context.ask({ permission: 'edit', patterns: ['shared knowledge'], always: [], metadata: { operation: args.operation } });
        }
        const launch = runtime.readState(path.join(root, '.state/webpage/launch.json'));
        const url = new URL(launch.url);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Local knowledge service required.');
        const response = await fetch(new URL('/api/knowledge/agent', url), {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': process.env.FREELANCER_GIT_BRIDGE || '' },
          // The selected source is independent of the native caller identity.
          // Stamp provenance after caller input so it cannot impersonate a session.
          body: JSON.stringify({ ...args, directory, actorSessionID: context.sessionID, messageID: context.messageID }), signal: context.abort,
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Knowledge operation failed.');
        return { title: `Knowledge · ${args.operation}`, output: JSON.stringify(result, null, 2) };
      },
    }),
  }};
};

export default Knowledge;
