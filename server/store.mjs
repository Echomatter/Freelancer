import { createExecutionContextReader } from '../backend/tools/runtime/execution-context.mjs';
import { normalizePlans } from '../domain/costs.mjs';
import { isDeepStrictEqual } from 'node:util';
import { createDocumentStore } from './document-store.mjs';
import { createRecordStore, recordCollections } from './record-store.mjs';

// One application writer serializes mutations. Native tools only read receipts.
export function createStore(root) {
  const documents = createDocumentStore(root), records = createRecordStore(root);
  const executionContext = createExecutionContextReader();
  let queue = Promise.resolve();
  const enqueue = action => {
    const work = queue.then(action);
    queue = work.catch(() => {});
    return work;
  };
  const read = name => recordCollections.has(name) ? records.read(name) : documents.read(name);
  function update(name, change) {
    return enqueue(async () => {
      const previous = await read(name), next = await change(structuredClone(previous));
      if (!isDeepStrictEqual(previous, next)) {
        if (recordCollections.has(name)) await records.replace(name, previous, next);
        else await documents.write(name, structuredClone(next));
      }
      return next;
    });
  }
  return {
    read, update, directory: documents.directory, flush: () => queue,
    requestSummaries: (project, session) => records.summaries(project, session),
    async savePlans(input, month = new Date().toISOString().slice(0, 7)) {
      const plans = normalizePlans(input);
      return update('settings', s => ({ ...s, revision: s.revision + 1,
        plans, monthlyPlans: { ...s.monthlyPlans, [month]: plans } }));
    },
    observe(input, { session } = {}) {
      const rows = structuredClone(input).filter(Boolean);
      return enqueue(async () => {
        const receipts = await records.mutate('requests', rows.filter(row => row.parentMessageID).map(row => [row.parentMessageID, receipt => {
          if (!receipt || receipt.sessionID !== row.sessionID) return receipt;
          return { ...receipt, status: 'observed', responses: { ...receipt.responses,
            [row.id]: { model: `${row.providerID}/${row.modelID}`, completed: row.completed } } };
        }]));
        // Resolve all authority before committing usage, so a bad native identity
        // never leaves a partially attributed batch behind.
        const changes = [];
        for (const row of rows) {
          let receipt = receipts[row.parentMessageID];
          if (!receipt && session?.id === row.sessionID && session?.metadata?.freelancer?.taskID)
            receipt = await executionContext(root, row.directory, session, { info: {
              role: 'assistant', agent: row.nativeAgent, parentID: row.parentMessageID,
            } });
          const attribution = receipt && receipt.sessionID === row.sessionID ? {
            agentID: receipt.agent.id, agentName: receipt.agent.name, requestID: receipt.id,
          } : {};
          changes.push([row.id, previous => ({ ...previous, ...row, ...attribution })]);
        }
        await records.mutate('usage', changes);
      });
    },
    recordRequest(input) {
      const captured = structuredClone(input);
      return enqueue(async () => {
        const changed = await records.mutate('requests', [[captured.id, previous => ({
          ...previous, ...captured, ...(previous?.status === 'observed' ? { status: 'observed' } : {}),
        })]]);
        // Only the touched receipt is returned; callers do not need the ledger.
        return { version: 1, records: changed };
      });
    },
  };
}
