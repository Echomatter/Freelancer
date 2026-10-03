import path from 'node:path';
import { resolveRuntimeConfig } from '../server/runtime-config.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';
import { createKnowledgeQuery } from '../server/data/knowledge-query.mjs';
import { withUnifiedDatabase } from '../backend/tools/runtime/unified-database.mjs';

const usage = 'Usage: node scripts/knowledge.mjs query <files|conversations|memories|facts> [text] [--project-id ID | --project-directory PATH | --global] [--model PROVIDER/MODEL] [--phrase] [--source TEXT] [--role ROLE] [--status STATUS] [--kind KIND] [--pinned-only] [--include-archived] [--epistemic-state STATE] [--origin ORIGIN] [--include-historical] [--limit 50] [--data-home PATH] [--runtime-id ID]';

function parse(args) {
  if (args.shift() !== 'query') throw Error(usage);
  const input = { domain: args.shift(), query: '' }, config = resolveRuntimeConfig();
  if (args[0] !== undefined && !args[0].startsWith('--')) input.query = args.shift();
  const names = { '--project-id': 'projectID', '--project-directory': 'projectDirectory', '--model': 'model', '--source': 'source',
    '--role': 'role', '--status': 'status', '--kind': 'kind', '--epistemic-state': 'epistemicState', '--origin': 'origin', '--limit': 'limit' };
  const booleans = { '--phrase': 'phrase', '--pinned-only': 'pinnedOnly', '--include-archived': 'includeArchived', '--include-historical': 'includeHistorical', '--global': 'global' };
  const seen = new Set();
  while (args.length) {
    const flag = args.shift();
    if (seen.has(flag)) throw Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (booleans[flag]) { input[booleans[flag]] = true; continue; }
    if (!names[flag] && !['--data-home', '--runtime-id'].includes(flag)) throw Error(`Unknown option: ${flag}\n${usage}`);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw Error(`A value is required for ${flag}.`);
    if (flag === '--data-home') {
      if (!path.isAbsolute(value)) throw Error('Data home must be absolute.');
      config.dataRoot = path.resolve(value);
    } else if (flag === '--runtime-id') config.runtimeID = value;
    else input[names[flag]] = flag === '--limit' ? Number(value) : value;
  }
  return { input, config };
}

try {
  const { input, config } = parse(process.argv.slice(2));
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(config.runtimeID)) throw Error('Choose a valid registered runtime ID.');
  // Verify the selected runtime before opening the query service. No bootstrap,
  // migrations, execution, or replay occurs in this CLI.
  const projects = withUnifiedDatabase({ dataHome: config.dataRoot, runtimeID: config.runtimeID }, false,
    (db, runtimeID) => db.prepare('SELECT data FROM project_registrations WHERE runtime_id=? ORDER BY project_id').all(runtimeID).map(row => JSON.parse(row.data)));
  const store = createLocalDataStore(config.dataRoot, { readOnly: true });
  try {
    const service = createKnowledgeQuery({ data: store, getProjects: () => projects });
    console.log(JSON.stringify(await service.query(input), null, 2));
  } finally { store.close(); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
