import { tool, type Plugin } from '@opencode-ai/plugin';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireKnowledgeSelectors } from '../../../domain/knowledge-input.mjs';

const Knowledge: Plugin = async ({ directory }) => {
  const root = process.env.FREELANCER_RUNTIME_ROOT;
  if (!root) throw Error('Start this plugin through Freelancer.');
  const runtime = await import(pathToFileURL(path.join(root, 'tools/runtime/state-database.mjs')).href);
  const diagnostics = await import(pathToFileURL(path.join(root, 'tools/runtime/storage-diagnostics.mjs')).href);
  await diagnostics.observeStorageDriver(root);
  return { tool: {
    knowledge: tool({
      description: 'Knowledge is the shared retrieval/retention tool. Always supply operation. Save ordinary durable notes with operation="remember", title and body; retrieve them with operation="query", domain="memories". Use claim only for a structured predicate/value assertion with origin, status, scope and evidence; those records use domain="facts". Remember is also an optional skill, not a second tool. Queries default globally; read exact source/revision and capture limits. Mutations retain native permission. Missing arguments do not mean storage is unavailable; correct the call instead of changing record type. External Memory MCP and Jev are unnecessary for saving notes.',
      args: {
        operation: tool.schema.enum(['query','search','read','status','claims','read-claim','pin','refresh','archive','restore','evidence','judgment-evidence','query-evidence','entity','entity-search','entity-read','open-nodes','read-graph','search-nodes','delete-entity','claim','correct-claim','relate','relations','revise-relation','relation-history','delete-relation','remember','revise','forget','analyze','judgment-provider-status','judgment-definition','judgment-evaluate','judgment-evaluate-batch','judgment-record','judgment-history','judgment-cache','opencode-read','warehouse-status','warehouse-backfill']).describe('Required on every call. remember saves an ordinary title/body note. query requires domain; search/claims are memory/fact shortcuts. Read operations open exact returned references. Graph reads use nodes or independent offsets. analyze is read-only SQL. refresh/backfill ingest sources, never execute chats. Judgments use stored definitions and evidence packets.'),
        domain: tool.schema.enum(['files','conversations','memories','facts']).optional().describe('query requires files (indexed units), conversations (chat text), memories (retained notes/snapshots), or facts (evidence-linked claims, not extracted index values). judgment-evidence/query-evidence accept memories/facts only.'),
        query: tool.schema.string().optional().describe('query/search/claims: at most 200 characters; empty browses memories/facts. entity-search: exact name/alias. search-nodes: substring.'),
        phrase: tool.schema.boolean().optional().describe('Exact phrase for query/search/claims; otherwise up to 12 terms match with AND.'),
        model: tool.schema.string().optional().describe('conversations/memories: exact provider/model filter. facts: provider/model or model ID plus modelProvider. Unsupported for files.'),
        modelProvider: tool.schema.string().optional().describe('facts provider filter/claim provenance; must agree with provider/model.'),
        source: tool.schema.string().optional().describe('files query only: path substring filter.'),
        role: tool.schema.string().optional().describe('files query only: exact inferred source role.'),
        status: tool.schema.string().optional().describe('files query only: exact inferred source status, not worker/claim lifecycle.'),
        pinnedOnly: tool.schema.boolean().optional().describe('memories query/search only: return retained pinned records.'),
        includeArchived: tool.schema.boolean().optional().describe('memories query/search only: include archived retained records.'),
        pinned: tool.schema.boolean().optional().describe('pin requires true/false for an existing memory ID; unpin preserves content. Legacy search alias for pinnedOnly.'),
        includeHistorical: tool.schema.boolean().optional().describe('facts query/claims only: include superseded claim records.'),
        global: tool.schema.boolean().optional().describe('query/search/claims: default global; true rejects project selectors, false requires one.'),
        projectDirectory: tool.schema.string().optional().describe('Query scope: absolute registered-project path; must agree with projectID if both are supplied.'),
        revision: tool.schema.number().int().positive().optional().describe('Memory revision for read/judgment-evidence/query-evidence; omitted reads latest. Facts use record hashes.'),
        sourceIdentity: tool.schema.string().optional().describe('evidence: copy originalSourceRef.sourceIdentity from the file hit.'),
        revisionIdentity: tool.schema.string().optional().describe('evidence: copy originalSourceRef.revisionIdentity from the same file hit.'),
        locator: tool.schema.string().optional().describe('evidence: exact originalSourceRef.locator from that retained file unit.'),
        unitHash: tool.schema.string().optional().describe('evidence: copy originalSourceRef.unitSha256 from the same file hit.'),
        limit: tool.schema.number().int().min(1).max(200).optional().describe('Returned rows; defaults vary by operation. read-graph caps each category at 100. Inspect truncation and continuation.'),
        cursor: tool.schema.string().max(1024).optional().describe('nextCursor from a query page; repeat the same domain, query, filters, project scope and limit. Pages reflect a moving index, not a stable snapshot.'),
        kind: tool.schema.string().optional().describe('memories query/search only: retained memory kind filter.'),
        id: tool.schema.string().optional().describe('Returned memory/claim/entity ID for the operation, not display resultID. judgment-evidence/query-evidence require an existing memory/claim record.'),
        ids: tool.schema.array(tool.schema.string()).max(100).optional().describe('Entity IDs for open-nodes; combined with names, at most 100 values.'),
        names: tool.schema.array(tool.schema.string()).max(100).optional().describe('Exact canonical names or aliases for open-nodes; combined with IDs, at most 100 values.'),
        entityOffset: tool.schema.number().int().min(0).max(100000).optional().describe('read-graph: returned nextEntityOffset; independent moving entity page.'),
        relationOffset: tool.schema.number().int().min(0).max(100000).optional().describe('read-graph: returned nextRelationOffset; independent moving relation page.'),
        observationOffset: tool.schema.number().int().min(0).max(100000).optional().describe('read-graph: returned nextObservationOffset; independent current-observation page.'),
        relationID: tool.schema.string().optional().describe('Exact relation ID for revise-relation, relation-history or delete-relation.'),
        subjectEntityID: tool.schema.string().optional(),
        objectEntityID: tool.schema.string().optional(),
        valueJson: tool.schema.string().optional().describe('claim/correct-claim: JSON-encoded value; preserve actual data types.'),
        validFrom: tool.schema.number().int().optional(),
        validTo: tool.schema.number().int().optional(),
        asOf: tool.schema.number().int().optional().describe('relations only: effective-time lookup in epoch milliseconds.'),
        type: tool.schema.string().optional().describe('Entity/relation type or remember note kind, according to operation.'),
        name: tool.schema.string().optional(),
        alias: tool.schema.string().optional(),
        aliases: tool.schema.array(tool.schema.string()).optional(),
        sourceRef: tool.schema.string().optional(),
        title: tool.schema.string().optional().describe('remember requires a note title. claim ignores title and instead requires predicate; do not substitute one for the other.'),
        body: tool.schema.string().optional().describe('remember requires ordinary retained note text; no claim, entity or judgment setup is needed. revise uses body and current memory revision.'),
        reason: tool.schema.string().optional(),
        expectedRevision: tool.schema.number().int().min(0).optional().describe('Required current counter: revise=read.revision.revision, pin=pinRevision, archive/restore=archiveRevision, revise-relation=relation revision. Re-read conflicts; counters differ.'),
        expectedEpistemicState: tool.schema.enum(['unverified','supported','disputed']).optional().describe('correct-claim: expected current status for conflict detection.'),
        method: tool.schema.string().optional(),
        scopeJson: tool.schema.string().optional().describe('claim/correct-claim: supply the intended scope as a JSON object; use projectID inside it for project claims. A new claim defaults to an empty scope; a correction preserves prior scope when omitted. remember instead uses the separate projectID argument.'),
        provenanceJson: tool.schema.string().optional().describe('revise-relation: JSON source provenance; caller identity remains native-stamped.'),
        from: tool.schema.string().optional(),
        to: tool.schema.string().optional(),
        predicate: tool.schema.string().optional().describe('claim requires the structured assertion/relation name, at most 1000 characters. For prose notes use operation remember with title/body instead.'),
        origin: tool.schema.enum(['human-authored','user-stated','source-reported','directly-observed','deterministically-extracted','model-inferred']).optional().describe('Required for claim; otherwise facts-query filter. Distinguish source reporting, user statements and model inference.'),
        epistemicState: tool.schema.enum(['unverified','supported','disputed','superseded']).optional().describe('Required claim status. correct-claim accepts unverified, supported or disputed. Also a facts-query filter; saved status is not independent source verification.'),
        evidenceJson: tool.schema.string().optional().describe('Required for claim/correct-claim: JSON {items:[{id, relation?, ...sourceReference}]}, 1-1000 entries from actual evidence. Opaque citation labels are recorded provenance, not resolved warehouse IDs or verified source evidence. Never invent typed source pointers; use real returned references.'),
        sql: tool.schema.string().optional().describe('analyze queries Freelancer warehouse only: one SELECT/WITH, at most 20000 characters; no semicolons/comments/PRAGMA. Inspect current schema first. Limits: 200 rows, 400 KB, 1500 ms; report partial/truncated results.'),
        paramsJson: tool.schema.string().optional().describe('analyze only: JSON named-parameter object, e.g. {":project":"actual-id"}; keys include the SQLite placeholder prefix. Omit for no parameters.'),
        definitionID: tool.schema.string().optional().describe('Stored judgment definition ID for evaluate/history/cache; judgment-definition creates it. Reuse existing definitions.'),
        definitionVersion: tool.schema.number().int().positive().optional().describe('Exact stored version for evaluate/cache. Definitions start at 1; changes create consecutive immutable versions.'),
        questionID: tool.schema.string().optional(),
        primitive: tool.schema.enum(['check','classify','score']).optional().describe('judgment-definition: check=yes/no, classify=unordered options, score=ordered levels. Evaluation uses the stored definition.'),
        questionJson: tool.schema.string().optional().describe('judgment-definition: JSON.stringify(questionText) or JSON.stringify(questionObject); maximum 20000 characters.'),
        criteriaJson: tool.schema.string().optional().describe('judgment-definition JSON: check {yes,no}; classify {options:{label:criterion}}; score {levels:[lowest,...,highest]}, 2-10 levels; maximum 20000 characters.'),
        stateJson: tool.schema.string().optional().describe('judgment-evaluate/batch: JSON.stringify(packet.state), not packet wrapper. Preserve returned evidence unchanged; canonical state limit 120 KB.'),
        definitionsJson: tool.schema.string().optional().describe('judgment-evaluate-batch: JSON.stringify([{id,version},...]) for 1-20 existing definitions with unique question IDs; no inline questions.'),
        runJson: tool.schema.string().optional().describe('judgment-record JSON: observed definitionID/definitionVersion, real SHA-256 stateHash, requestedProvider/status, candidateIDs/evidenceRefs, results [{questionID,answer,probabilities?,confidence?,derived?}], reportedProvider/reportedModel, latencyMs/usage. Never invent receipts. Evaluate/batch already record runs; this is not evaluation input.'),
        stateHash: tool.schema.string().optional(),
        candidateIDsJson: tool.schema.string().optional().describe('evaluate/cache: JSON.stringify(packet.candidateIDs) from the same packet; 1-500 unchanged unique stable IDs.'),
        evidenceRefsJson: tool.schema.string().optional().describe('evaluate/cache: JSON.stringify(packet.evidenceRefs) from the same packet; 1-1000 unchanged retained kind/identity/revision/hash references.'),
        requestedProvider: tool.schema.string().optional(),
        requestedModel: tool.schema.string().optional(),
        reportedProvider: tool.schema.string().optional(),
        reportedModel: tool.schema.string().optional(),
        projectID: tool.schema.string().optional().describe('Registered query/backfill scope or remember source project. Required with sessionID for opencode-read.'),
        sessionID: tool.schema.string().optional().describe('opencode-read: originalSourceRef.sessionID; reads retained source independent of the caller, not live execution.'),
        snapshotRevisionSha256: tool.schema.string().optional().describe('opencode-read: conversation hit sourceRevision.hash plus sourceSystemID selects that exact retained snapshot.'),
        sourceSystemID: tool.schema.string().optional().describe('Retained OpenCode source identity from the hit; used for exact opencode-read or warehouse-status scope.'),
        runID: tool.schema.string().optional().describe('warehouse-status: existing ingest run ID for failure details.'),
        resume: tool.schema.boolean().optional().describe('warehouse-backfill: resume ingestion by default, never chat execution.'),
        pageSize: tool.schema.number().int().min(1).max(500).optional().describe('warehouse-backfill only: native ingestion page size, not query pagination.'),
      },
      async execute(args, context) {
        requireKnowledgeSelectors(args);
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
