const wordPattern = /[\p{L}\p{N}_]+/gu;

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
