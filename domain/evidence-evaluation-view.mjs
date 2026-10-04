import { createHash } from 'node:crypto';

// OpenCode limits each native tool response to 50 KB. This is a presentation
// projection; the service keeps the complete receipt used by evaluation.
export const NATIVE_EVIDENCE_OUTPUT_BYTES = 48000;
const json = value => JSON.stringify(value);
const bytes = value => Buffer.byteLength(json(value), 'utf8');

// Recomposition changes only the advisory presentation. Bind retained output
// pages to the unchanged service receipt, not to another caller's view.
export function evidenceReceiptStateHash(result) {
  const { compositions, recombined, reused, ...state } = result;
  return createHash('sha256').update(json(state)).digest('hex');
}

export function evidenceEvaluationView(result) {
  const view = structuredClone(result);
  if (!Array.isArray(view.packet)) return view;
  const references = new Map(view.packet.map((entry, index) => [entry.id, { entry, ref: `/packet/${index}` }]));
  for (const [index, entry] of (view.derived ?? []).entries()) references.set(entry.id, { entry, ref: `/derived/${index}` });
  for (const scenario of view.scenarios ?? []) {
    const entryRefs = {}, entries = {};
    for (const [id, entry] of Object.entries(scenario.entries ?? {})) {
      const original = references.get(id);
      if (original && json(entry) === json(original.entry)) entryRefs[id] = original.ref;
      else entries[id] = entry;
    }
    scenario.entries = entries;
    scenario.entryRefs = entryRefs;
  }
  for (const stage of view.stages ?? []) if (stage.state !== undefined) {
    delete stage.state;
    stage.stateOmitted = 'Repeated provider state; reconstruct from packet, scenario entries/entryRefs and prior answers. The complete state remains in the service receipt and recorded judgment run.';
    stage.runIDs ??= (view.answers ?? []).filter(answer => stage.questionIDs?.includes(answer.questionID)).map(answer => answer.runID).filter(Boolean);
  }
  // Reuse is delivery metadata; omitting it keeps inspect cursors stable.
  delete view.reused;
  view.presentation = { schema: 'freelancer.evidence-view', version: 1, partial: false,
    references: 'scenario.entryRefs are JSON pointers into this response; entries contains only changed values. No facts or answers omitted.' };
  return view;
}

/** Lossless pagination for receipts too large to fit in one native response. */
export function nativeEvidenceOutput(result, { outputCursor, maxBytes = NATIVE_EVIDENCE_OUTPUT_BYTES } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 2000 || maxBytes > NATIVE_EVIDENCE_OUTPUT_BYTES) throw Error('Invalid native evidence response limit.');
  const view = evidenceEvaluationView(result), serialized = json(view);
  if (outputCursor === undefined && Buffer.byteLength(serialized, 'utf8') <= maxBytes) return serialized;
  const digest = createHash('sha256').update(serialized).digest('hex');
  let offset = 0;
  if (outputCursor !== undefined) {
    const match = /^([a-f0-9]{64}):(0|[1-9][0-9]{0,7})$/.exec(outputCursor);
    if (!match || match[1] !== digest) throw Error('Evidence output cursor is invalid or the receipt changed. Inspect the current receipt without a cursor; do not repeat evaluation.');
    offset = Number(match[2]);
    if (offset >= serialized.length || (offset > 0 && /[\uDC00-\uDFFF]/.test(serialized[offset]))) throw Error('Evidence output cursor is outside this receipt.');
  }
  const envelope = end => ({ receiptID: view.receiptID, status: view.status, requiresInference: view.requiresInference,
    evidenceHash: view.evidenceHash, advisory: view.advisory, consequencesExecuted: view.consequencesExecuted,
    presentation: { schema: 'freelancer.evidence-output', version: 1, partial: true, encoding: 'json-string-chunks',
      outputSha256: digest, offset, totalCharacters: serialized.length,
      nextCursor: end < serialized.length ? `${digest}:${end}` : null,
      instructions: 'Read remaining chunks with inspect, the same receiptID and nextCursor as outputCursor. Concatenate data in offset order and parse as JSON. This reads the captured receipt without inference or replay; partial is transport coverage, not evaluation status.' },
    data: serialized.slice(offset, end) });
  let low = offset, high = serialized.length;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (bytes(envelope(middle)) <= maxBytes) low = middle; else high = middle - 1; }
  if (low < serialized.length && /[\uD800-\uDBFF]/.test(serialized[low - 1])) low--;
  if (low <= offset) throw Error('Evidence response metadata exceeds its transport limit.');
  return json(envelope(low));
}
