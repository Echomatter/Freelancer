import { tool, type Plugin } from '@opencode-ai/plugin';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ModelCatalog: Plugin = async ({ directory }) => {
  const root = process.env.FREELANCER_RUNTIME_ROOT;
  if (!root) throw Error('Start this plugin through Freelancer.');
  const runtime = await import(pathToFileURL(path.join(root, 'tools/runtime/state-database.mjs')).href);
  return { tool: { model_catalog: tool({
    description: 'Read stored published specifications, prices and benchmarks for configured models. schema gives canonical observation keys and source coverage; list/search locate exact records[].id; detail returns records[].observations. Model, deployment and tested configuration are separate records: preserve identity, dates, units, missingness and provenance. Pages fit 40 KB; follow nextCursor with unchanged filters and requested limit. Unknown is not zero. Reads do not refresh sources or judge models. An explicitly requested refresh downloads configured source data with native permission and tier-dependent coverage; it runs no model inference. Published prices are not account costs or consent. Use evidence_evaluation for optional one-off judgments.',
    args: {
      operation: tool.schema.enum(['schema','search','list','detail','refresh','status']).describe('schema: keys/coverage; list/search: records; detail: observations; status: source/job state; refresh: requested download.'),
      query: tool.schema.string().max(300).optional().describe('List/search text filter; use exact names or source identifiers first.'),
      id: tool.schema.string().max(512).optional().describe('Detail: exact source record ID or native provider/model ID. Native IDs may match several source records.'),
      source: tool.schema.enum(['modelsdev','artificial-analysis']).optional().describe('List/search/detail: filter one published source.'),
      sources: tool.schema.array(tool.schema.enum(['modelsdev','artificial-analysis'])).min(1).max(2).optional().describe('Refresh only: requested sources; omitted uses configured sources. Artificial Analysis requires its existing key.'),
      kind: tool.schema.enum(['model','deployment','configuration']).optional().describe('List/search record kind; a benchmark configuration is not a deployment limit.'),
      attributes: tool.schema.array(tool.schema.string().min(1).max(300)).max(30).optional().describe('Detail only: canonical keys from schema or exact original source attributes. Selection precedes pagination.'),
      limit: tool.schema.number().int().min(1).max(200).optional().describe('List/search allow 1–100 records; detail allows 1–200 facts.'),
      cursor: tool.schema.string().max(1024).optional().describe('Use nextCursor with the same filters and limit. Continue detail with the exact source records[].id, not a native ID.'),
    },
    async execute(args, context) {
      if (args.operation === 'refresh') await context.ask({ permission: 'edit',
        patterns: ['shared model catalog'], always: [], metadata: { operation: 'refresh', sources: args.sources ?? ['configured free sources'] } });
      const launch = runtime.readState(path.join(root, '.state/webpage/launch.json'));
      const url = new URL(launch.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw Error('Local model catalog service required.');
      const response = await fetch(new URL('/api/models/data/agent', url), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Freelancer-Git-Bridge': process.env.FREELANCER_GIT_BRIDGE || '' },
        body: JSON.stringify({ ...args, directory, sessionID: context.sessionID, messageID: context.messageID }), signal: context.abort,
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Model catalog operation failed.');
      return { title: 'Model catalog · ' + args.operation, output: JSON.stringify(result) };
    },
  }) } };
};
export default ModelCatalog;
