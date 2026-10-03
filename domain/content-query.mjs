const wordPattern = /[\p{L}\p{N}_]+/gu;
export const CONTENT_OFFSET_LIMIT = 100000;

export function contentOffset(offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > CONTENT_OFFSET_LIMIT)
    throw Object.assign(Error(`Search offset must be an integer from 0 to ${CONTENT_OFFSET_LIMIT}.`), { status: 400 });
  return offset;
}

export function contentMatch(query, { phrase = false } = {}) {
  if (typeof query !== 'string' || query.length > 200) throw Error('Search is limited to 200 characters.');
  if (phrase) {
    const value = query.trim();
    return value ? `"${value.replaceAll('"', '""')}"` : '';
  }
  return (query.match(wordPattern) ?? []).slice(0, 12).map(term => `"${term.replaceAll('"', '""')}"`).join(' AND ');
}

export function contentFilters({ source = '', role = '', status = '' } = {}) {
  for (const [label, value, limit] of [['Source', source, 500], ['Role', role, 100], ['Status', status, 100]]) {
    if (typeof value !== 'string' || value.length > limit) throw Error(`${label} filter is invalid or too long.`);
  }
  return { source, role, status };
}

export function contentSubstring(value) {
  return `%${value.replace(/[\\%_]/g, character => `\\${character}`)}%`;
}
