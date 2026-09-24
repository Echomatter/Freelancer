import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createChatGPTImport } from '../../server/chatgpt-import.mjs';

export async function codexHistoryFixture(f) {
  const home = path.join(f.root, 'codex');
  await mkdir(path.join(home, 'sessions'), { recursive: true });
  await mkdir(path.join(home, 'archived_sessions'));
  const database = path.join(home, 'state_5.sqlite'), db = new DatabaseSync(database);
  db.exec('CREATE TABLE threads(id TEXT,cwd TEXT,rollout_path TEXT,title TEXT,created_at INTEGER,updated_at INTEGER,archived INTEGER,model TEXT)');
  const source = path.join(home, 'sessions', 'matching.jsonl');
  const records = [
    { type: 'session_meta', payload: { id: 'codex-exact', cwd: f.directory, timestamp: '2026-09-20T10:00:00Z', base_instructions: 'PRIVATE SYSTEM INSTRUCTIONS' } },
    { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'DO NOT IMPORT DEVELOPER' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Fix the turquoise widget' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the turquoise widget' }] } },
    { type: 'response_item', payload: { type: 'reasoning', summary: [{ text: 'DO NOT IMPORT REASONING' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'read', call_id: 'call_read', arguments: '{"path":"widget.ts"}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_read', output: 'Recorded widget source' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: 'The turquoise widget needs a color fix.' }] } },
  ].map(record => ({ timestamp: '2026-09-20T10:00:00Z', ...record }));
  await writeFile(source, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  const insert = db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)');
  insert.run('codex-exact', f.directory, source, 'Turquoise widget', 100, 200, 1, 'test-model');
  insert.run('codex-other', f.directory + '-other', source, 'Other repository', 100, 200, 0, 'test-model');
  insert.run('codex-nested', path.join(f.directory, 'nested'), source, 'Nested directory', 100, 200, 0, 'test-model');
  db.close();
  await writeFile(path.join(home, 'auth.json'), 'AUTH MUST NOT BE READ');
  f.app.chatgpt = createChatGPTImport({ app: f.app, backendRoot: f.root, dataRoot: path.join(f.root, 'user-data'), codexHome: home });
  await f.store.update('settings', settings => ({ ...settings, projects: [], lastProjectID: undefined }));
  return { home, source, database, records };
}
