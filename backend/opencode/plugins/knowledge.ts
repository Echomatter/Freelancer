import { tool, type Plugin } from '@opencode-ai/plugin';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireMemorySelectors } from '../../../domain/knowledge-input.mjs';

const Memory: Plugin = async ({ directory }) => {
  const root = process.env.FREELANCER_RUNTIME_ROOT;
  if (!root) throw Error('Start this plugin through Freelancer.');
  const runtime = await import(pathToFileURL(path.join(root, 'tools/runtime/state-database.mjs')).href);
  const diagnostics = await import(pathToFileURL(path.join(root, 'tools/runtime/storage-diagnostics.mjs')).href);
  await diagnostics.observeStorageDriver(root);
  return { tool: {
    memory: tool({
      description: 'Read, retain and revise one memory object with text, optional structured data, evidence and source provenance. remember with sourceRefJson copied from a chat/file result derives title/content without a form; optional summary/data adds enrichment. Same source revision retries reuse its memory; different indexed file revisions retain history. Custom memories use title and optional body/dataJson. Existing enrichment requires current expectedRevision; read/revise first. Archive is an independent property. Query domain="memories" covers retained content. Read exact revisions and capture limits; retention does not verify current truth. Mutations retain native permission. Ordinary retention needs no external Memory MCP or Jev inference.',
      args: {
        operation: tool.schema.enum(['query','search','read','status','refresh','archive','restore','evidence','judgment-evidence','query-evidence','entity','entity-search','entity-read','open-nodes','read-graph','search-nodes','delete-entity','relate','relations','revise-relation','relation-history','delete-relation','remember','revise','forget','analyze','judgment-provider-status','judgment-definition','judgment-evaluate','judgment-evaluate-batch','judgment-record','judgment-history','judgment-cache','opencode-read','warehouse-status','warehouse-backfill']).describe('Required on every call. remember creates a memory; revise updates its supplied fields with a new revision. query requires domain; search browses memories. archive/restore change memory properties. Graph reads use nodes or independent offsets. analyze is read-only SQL. refresh/backfill ingest sources, never execute chats. Judgments use stored definitions and evidence packets.'),
        domain: tool.schema.enum(['files','conversations','memories']).optional().describe('query requires files (indexed units), conversations (chat text), or memories (all retained text, structured data and snapshots). judgment-evidence/query-evidence use memories.'),
        query: tool.schema.string().optional().describe('query/search: at most 200 characters; empty browses memories. entity-search: exact name/alias. search-nodes: substring.'),
        phrase: tool.schema.boolean().optional().describe('Exact phrase for query/search; otherwise up to 12 terms match with AND.'),
        model: tool.schema.string().optional().describe('conversations/memories: provider/model filter; memory metadata also accepts model ID with modelProvider. Unsupported for files.'),
        modelProvider: tool.schema.string().optional().describe('Memory model-provider metadata filter; must agree with provider/model.'),
        source: tool.schema.string().optional().describe('files query only: path substring filter.'),
        role: tool.schema.string().optional().describe('files query only: exact inferred source role.'),
        status: tool.schema.string().optional().describe('files: exact inferred source status. memories: organization status; archived matches also require includeArchived.'),
        includeArchived: tool.schema.boolean().optional().describe('memories query/search only: include archived retained records.'),
        includeHistorical: tool.schema.boolean().optional().describe('Memories: include retained superseded structured observations; exact revisions remain readable independently.'),
        global: tool.schema.boolean().optional().describe('query/search: default global; true rejects project selectors, false requires one.'),
        projectDirectory: tool.schema.string().optional().describe('Query scope: absolute registered-project path; must agree with projectID if both are supplied.'),
        revision: tool.schema.number().int().positive().optional().describe('Exact memory revision for read/judgment-evidence/query-evidence; omitted reads latest.'),
        sourceIdentity: tool.schema.string().optional().describe('evidence: copy originalSourceRef.sourceIdentity from the file hit.'),
        revisionIdentity: tool.schema.string().optional().describe('evidence: copy originalSourceRef.revisionIdentity from the same file hit.'),
        locator: tool.schema.string().optional().describe('evidence: exact originalSourceRef.locator from that retained file unit.'),
        unitHash: tool.schema.string().optional().describe('evidence: copy originalSourceRef.unitSha256 from the same file hit.'),
        limit: tool.schema.number().int().min(1).max(200).optional().describe('Returned rows; defaults vary by operation. read-graph caps each category at 100. Inspect truncation and continuation.'),
        cursor: tool.schema.string().max(1024).optional().describe('nextCursor from a query page; repeat the same domain, query, filters, project scope and limit. Pages reflect a moving index, not a stable snapshot.'),
        kind: tool.schema.string().optional().describe('memories query/search only: retained memory kind filter.'),
        id: tool.schema.string().optional().describe('Returned memory/entity ID for the operation, not display resultID. judgment-evidence/query-evidence require an existing memory.'),
        ids: tool.schema.array(tool.schema.string()).max(100).optional().describe('Entity IDs for open-nodes; combined with names, at most 100 values.'),
        names: tool.schema.array(tool.schema.string()).max(100).optional().describe('Exact canonical names or aliases for open-nodes; combined with IDs, at most 100 values.'),
        entityOffset: tool.schema.number().int().min(0).max(100000).optional().describe('read-graph: returned nextEntityOffset; independent moving entity page.'),
        relationOffset: tool.schema.number().int().min(0).max(100000).optional().describe('read-graph: returned nextRelationOffset; independent moving relation page.'),
        observationOffset: tool.schema.number().int().min(0).max(100000).optional().describe('read-graph: returned nextObservationOffset; independent current-observation page.'),
        relationID: tool.schema.string().optional().describe('Exact relation ID for revise-relation, relation-history or delete-relation.'),
        validFrom: tool.schema.number().int().optional(),
        validTo: tool.schema.number().int().optional(),
        asOf: tool.schema.number().int().optional().describe('relations only: effective-time lookup in epoch milliseconds.'),
        type: tool.schema.string().optional().describe('Entity/relation type or optional descriptive memory kind, according to operation.'),
        name: tool.schema.string().optional(),
        alias: tool.schema.string().optional(),
        aliases: tool.schema.array(tool.schema.string()).optional(),
        sourceRef: tool.schema.string().optional(),
        sourceRefJson: tool.schema.string().max(20000).optional().describe('remember only: JSON.stringify(originalSourceRef) copied from a chat or indexed-file result. Chat kinds conversation/opencode-conversation require projectID+sessionID; exact snapshots also require returned sourceSystemID+snapshotRevisionSha256. File kinds file/content-unit require exact sourceIdentity+revisionIdentity; locator+unitSha256 validate the selected hit while saving bounded whole-file extracted text. No guessed references, file paths or raw filesystem reads. Source capture derives title/content.'),
        title: tool.schema.string().optional().describe('Custom remember requires a concise title; source remember derives it and accepts an optional override. Existing source enrichment requires current expectedRevision. revise may change it; prior revisions retain their titles.'),
        body: tool.schema.string().optional().describe('Optional retained text, up to 1 MB. A memory may instead contain structured dataJson. revise preserves omitted text.'),
        summary: tool.schema.string().optional().describe('remember source capture: optional authored/model summary instead of body. Exact captured source stays separate in retained members; existing summary changes require current expectedRevision. Supply summary or body, not both.'),
        dataJson: tool.schema.string().optional().describe('remember/revise: JSON object of structured values, such as decisions, preferences, repository locations, observations, scope, status, dates or entity links. Optional; no required assertion fields. Explicit revise replaces the object; omission preserves it. Up to 1 MB.'),
        reason: tool.schema.string().optional(),
        expectedRevision: tool.schema.number().int().min(0).optional().describe('Required current counter for existing source remember enrichment and revise=read.revision.revision, archive/restore=archiveRevision, revise-relation=relation revision. Bare source remember is idempotent without this counter. Re-read conflicts; counters differ.'),
        provenanceJson: tool.schema.string().optional().describe('Optional remember/revise or relation source provenance as JSON object. Revisions retain capture metadata; actual caller identity remains native-stamped.'),
        from: tool.schema.string().optional(),
        to: tool.schema.string().optional(),
        origin: tool.schema.enum(['human-authored','user-stated','source-reported','directly-observed','deterministically-extracted','model-inferred']).optional().describe('Optional memory query/search filter over saved origin metadata. Save origin inside dataJson when useful.'),
        epistemicState: tool.schema.enum(['unverified','supported','disputed','superseded']).optional().describe('Optional memory query/search filter over saved validation status. Save this metadata inside dataJson when useful; it does not independently verify a source.'),
        evidenceJson: tool.schema.string().optional().describe('Optional remember/revise JSON {items:[{id, relation?, ...sourceReference}]}, up to 1000 actual evidence references. Opaque citations retain provenance. Use returned source IDs/revisions/hashes for resolving pointers. Explicit revise replaces the list; omission preserves it.'),
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
        requireMemorySelectors(args);
        if (['judgment-evaluate','judgment-evaluate-batch'].includes(args.operation)) {
          await context.ask({ permission: 'edit', patterns: ['shared knowledge'], always: [],
            metadata: { operation: args.operation, provider: 'TypeSafe', sends: 'bounded caller supplied evidence' } });
        } else if (['entity','delete-entity','relate','revise-relation','delete-relation','remember','revise','forget','refresh','archive','restore','judgment-definition','judgment-record','warehouse-backfill'].includes(args.operation)) {
          await context.ask({ permission: 'edit', patterns: ['shared knowledge'], always: [], metadata: { operation: args.operation } });
        }
        const launch = runtime.readState(path.join(root, '.state/webpage/launch.json'));
        const url = new URL(launch.url);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Local memory service required.');
        const response = await fetch(new URL('/api/memory/agent', url), {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': process.env.FREELANCER_GIT_BRIDGE || '' },
          // The selected source is independent of the native caller identity.
          // Stamp provenance after caller input so it cannot impersonate a session.
          body: JSON.stringify({ ...args, directory, actorSessionID: context.sessionID, messageID: context.messageID }), signal: context.abort,
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || 'Memory operation failed.');
        return { title: `Memory · ${args.operation}`, output: JSON.stringify(result, null, 2) };
      },
    }),
  }};
};

export default Memory;
