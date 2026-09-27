import { localDataFixture } from './local-data-app.mjs';
import { createLocalDataStore } from '../../server/data/store.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function composerFixture() {
  const f = await localDataFixture();
  const library = createLocalDataStore(path.join(f.root, 'user-data'));
  library.markProjectIndexesReady(f.project.id); library.close();
  f.state.todos.ses_history = [
    { id: 'review', content: 'Review the input and tool interactions', status: 'completed' },
    { id: 'polish', content: 'Polish the composer for desktop and mobile', status: 'in_progress' },
    { id: 'verify', content: 'Verify keyboard controls and draft preservation', status: 'pending' },
  ];
  f.state.messages.ses_history = [
    { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'Make the chat feel calmer and easier to use.' }] },
    { info: { id: 'a1', parentID: 'u1', role: 'assistant', providerID: 'opencode', modelID: 'free', finish: 'stop' }, parts: [
      { id: 'tool1', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'src/Chat.tsx' }, output: 'Read the current chat implementation.' } },
      { type: 'text', text: 'I’ve reviewed the conversation layout. The next step is to bring the message controls and supporting cards together.' },
    ] },
    { info: { id: 'u2', role: 'user' }, parts: [{ type: 'text', text: 'Keep every option accessible, and make the tools easy to inspect.' }] },
    { info: { id: 'a2', parentID: 'u2', role: 'assistant', providerID: 'opencode', modelID: 'free' }, parts: [
      { id: 'tool2', type: 'tool', tool: 'read', state: { status: 'completed', input: { filePath: 'src/composer.css' }, output: 'The composer uses matching controls and a shared outline.\n'.repeat(35) } },
      { type: 'text', text: 'The message stays central. Settings are one click away; tasks, files, and queued messages collapse when you don’t need their details.' },
    ] },
  ];
  return f;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const f = await composerFixture();
  console.log(JSON.stringify({ url: f.url, project: f.project.id, session: 'ses_history', simulated: true }));
  process.on('SIGINT', async () => { await f.close(); process.exit(); });
}
