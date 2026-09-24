import { excludedFile } from './git-project.mjs';

// Session history and the current working tree are different evidence. Keep
// their provenance visible; never infer a successful edit from a tool input.
export function chatChanges(diff = [], messages = [], files = [], directory = '') {
  const rows = new Map();
  const root = directory.replaceAll('\\', '/').replace(/\/$/, '') + '/';
  const key = value => {
    const file = String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
    return directory && file.toLowerCase().startsWith(root.toLowerCase()) ? file.slice(root.length) : file;
  };
  const add = (row, scope) => {
    const file = key(row.file ?? row.path);
    if (!file || excludedFile(file)) return;
    rows.set(`${scope}:${file}`, { ...row, file, scope });
  };
  for (const row of diff ?? []) add(row, 'session');
  for (const message of messages ?? []) {
    for (const part of message.parts ?? []) {
      if (part.type !== 'tool' || part.state?.status !== 'completed') continue;
      const meta = part.state.metadata ?? {};
      const recorded = meta.filediff ? [meta.filediff] : [];
      for (const row of recorded) {
        if (!rows.has(`session:${key(row.file ?? row.path)}`)) add(row, 'session');
      }
    }
  }
  for (const row of files ?? []) add({ ...row, additions: row.added, deletions: row.removed }, 'workspace');
  return [...rows.values()];
}
