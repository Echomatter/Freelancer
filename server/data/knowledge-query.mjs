import path from 'node:path';
import { contentMatch, contentFilters } from '../../domain/content-query.mjs';

const domains = new Set(['files', 'conversations', 'memories', 'facts']);
const filterNames = ['model', 'source', 'role', 'status', 'kind', 'pinnedOnly', 'includeArchived', 'epistemicState', 'origin', 'includeHistorical'];
const supported = {
  files: new Set(['source', 'role', 'status']),
  conversations: new Set(['model']),
  memories: new Set(['model', 'kind', 'pinnedOnly', 'includeArchived']),
  facts: new Set(['model', 'epistemicState', 'origin', 'includeHistorical']),
};
const error = message => Object.assign(Error(message), { status: 400 });
const text = (value, name, max = 500) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) throw error(`${name} must be text under ${max + 1} characters.`);
  return value;
};

/** One read contract for browser, native tools and the offline CLI. */
export function createKnowledgeQuery({ data, getProjects, platform = process.platform }) {
  const key = directory => {
    const resolved = path.resolve(directory);
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return {
    async query(input = {}) {
      const { domain } = input;
      if (!domains.has(domain)) throw error('Choose files, conversations, memories or facts.');
      const query = text(input.query ?? '', 'Query', 200);
      const phrase = input.phrase ?? false;
      if (typeof phrase !== 'boolean') throw error('Phrase must be a boolean.');
      const match = contentMatch(query, { phrase });
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw error('Limit must be an integer from 1 to 200.');
      const filters = {};
      for (const name of filterNames) {
        const value = input[name];
        if (value === undefined || value === null || value === '' || value === false) continue;
        if (!supported[domain].has(name)) throw error(`${name} is not supported for ${domain}.`);
        if (['pinnedOnly', 'includeHistorical', 'includeArchived'].includes(name)) {
          if (typeof value !== 'boolean') throw error(`${name} must be a boolean.`);
          filters[name] = value;
        } else filters[name] = text(value, name, name === 'source' ? 500 : 200);
      }
      if (filters.epistemicState && !['unverified', 'supported', 'disputed', 'superseded'].includes(filters.epistemicState))
        throw error('Choose a known epistemic state.');
      contentFilters(filters);
      const projectID = text(input.projectID, 'Project ID', 128);
      const projectDirectory = text(input.projectDirectory, 'Project directory', 4000);
      if (projectDirectory && !path.isAbsolute(projectDirectory)) throw error('Project directory must be absolute.');
      if (input.global !== undefined && typeof input.global !== 'boolean') throw error('Global must be a boolean.');
      if (input.global === true && (projectID || projectDirectory)) throw error('Global search cannot also select a project.');
      if (input.global === false && !projectID && !projectDirectory) throw error('A project-scoped search requires a project ID or directory.');
      const registry = await getProjects();
      const projects = (Array.isArray(registry) ? registry : []).filter(p => p && typeof p.id === 'string' && p.id
        && typeof p.directory === 'string' && path.isAbsolute(p.directory)).sort((a, b) => a.id.localeCompare(b.id, 'en'));
      let selected;
      if (projectID) {
        selected = projects.find(p => p.id === projectID);
        if (!selected) throw error('Project is not registered in the current runtime.');
      }
      if (projectDirectory) {
        const matches = projects.filter(p => key(p.directory) === key(projectDirectory));
        if (matches.length !== 1) throw error('Project directory must identify one registered project in the current runtime.');
        if (selected && selected.id !== matches[0].id) throw error('Project ID and directory identify different projects.');
        selected = matches[0];
      }
      const scoped = selected ? [selected] : projects;
      const byKey = new Map(scoped.map(p => [key(p.directory), p.id]));
      const db = typeof data === 'function' ? data() : data;
      let results, truncated = false, coverage;
      if (domain === 'files') {
        const rows = match ? db.searchFiles(match, [...byKey.keys()], contentFilters(filters), limit + 1) : [];
        truncated = rows.length > limit;
        results = rows.slice(0, limit).map(row => ({ ...row, projectID: byKey.get(key(row.projectKey)), project: byKey.get(key(row.projectKey)) }));
        coverage = 'Indexed file units from projects registered in the current runtime. Results are locators, not verified claims.';
      } else if (domain === 'conversations') {
        const rows = match ? db.searchChats(query, { projectIDs: scoped.map(p => p.id), model: filters.model ?? '', phrase, limit: limit + 1 }) : [];
        truncated = rows.length > limit;
        results = rows.slice(0, limit).map(row => ({ ...row, projectID: row.project }));
        coverage = 'Indexed native conversation text from projects registered in the current runtime. Refresh coverage before relying on absence.';
      } else if (domain === 'memories') {
        const found = db.searchMemory(query, { kind: filters.kind, projectID: selected?.id, model: filters.model,
          phrase, pinned: filters.pinnedOnly === true, includeArchived: filters.includeArchived === true, limit });
        truncated = found.truncated === true;
        results = found.items.map(row => ({ ...row, id: row.id ?? row.memory_id,
          projectID: row.projectID ?? row.source_project_id ?? null }));
        coverage = 'Retained nonforgotten memory revisions. Captured boundaries and source availability are reported on each memory.';
      } else {
        const separator = filters.model?.indexOf('/') ?? -1;
        const model = separator >= 0 ? filters.model.slice(separator + 1) : filters.model;
        const modelProvider = separator >= 0 ? filters.model.slice(0, separator) : undefined;
        const found = db.searchClaims({ query, projectID: selected?.id, model, modelProvider, phrase,
          epistemicState: filters.epistemicState, origin: filters.origin, includeHistorical: filters.includeHistorical === true, limit });
        truncated = found.truncated === true;
        results = found.results.map(row => ({ ...row, projectID: row.scope?.projectID ?? row.scope?.project ?? null }));
        coverage = found.coverage;
      }
      return { domain, query, results, truncated, coverage,
        filters: { ...filters, phrase, limit, ...(selected ? { projectID: selected.id } : { global: true }) } };
    },
  };
}
