// Required selectors shared by the native plugin and HTTP bridge. Never infer
// a write operation from title/body or silently change a note into a claim.
export function requireKnowledgeSelectors(input) {
  if (typeof input?.operation !== 'string' || !input.operation.trim()) {
    throw Error('knowledge requires an explicit operation. To save an ordinary note use operation: "remember" with title and body. To retrieve it use operation: "query" with domain: "memories". This is a missing argument, not an unavailable memory feature.');
  }
  if (input.operation === 'query' && (typeof input.domain !== 'string' || !input.domain.trim())) {
    throw Error('knowledge query requires an explicit domain: memories for retained notes/snapshots, facts for structured claims, files for indexed passages, or conversations for chat text.');
  }
}
