import { checkedCatalog } from '../../backend/tools/runtime/agent-catalog.mjs';
// Production React + actual app/HTTP/store; only OpenCode transport is stubbed.
// No credentials, provider inference, or user project files are used.
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createApplication } from '../../server/application.mjs';
import { createStore } from '../../server/store.mjs';
import { startServer } from '../../server/http.mjs';
import { createActivityReader } from '../../server/activity.mjs';
import { defaults } from '../../shared/strategy.mjs';

export async function colorFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'freelancer-color-ui-'));
  const directory = path.join(root, 'project'); await mkdir(directory);
  const project = { id: 'color_project', name: 'Palette checks', directory };
  const sessions = [{ id: 'ses_colors', title: 'Color test chat', directory }, { id: 'ses_child', title: 'Worker color check', parentID: 'ses_colors', directory }];
  const store = createStore(root);
  await store.update('settings', s => ({ ...s, projects: [project], appearance: { theme: 'light' } }));
  const nativeProviders = [
    ['openai', 'atlas', 'Atlas'], ['github-copilot', 'forge', 'Forge'],
    ['opencode-go', 'mimo', 'MiMo'], ['opencode', 'free', 'Free model'],
  ];
  let busy = false, questions = [];
  const now = Date.now();
  const messages = id => id === 'ses_child' ? [{ info: { id: 'msg_c', sessionID: id, parentID: 'msg_cu', role: 'assistant', providerID: 'opencode', modelID: 'free', agent: 'worker', time: { created: now, completed: now }, finish: 'stop', tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } } }, parts: [{ id: 'prt_c', type: 'text', text: 'Worker result stays neutral.' }] }] : [
    { info: { id: 'msg_u', role: 'user', sessionID: id, model: { providerID: 'openai', modelID: 'atlas' }, time: { created: now } }, parts: [{ id: 'prt_u', type: 'text', text: 'Inspect the colors without changing the text.' }] },
    { info: { id: 'msg_a', parentID: 'msg_u', role: 'assistant', sessionID: id, providerID: 'openai', modelID: 'atlas', agent: 'build', time: { created: now, completed: now }, finish: 'stop', tokens: { input: 2, output: 2, cache: { read: 0, write: 0 } } }, parts: [
      { id: 'prt_a', type: 'text', text: 'Normal message text stays neutral.\n\n```js\nconst palette = "midnight";\n```\n\n[Example link](https://example.com)' },
      { id: 'prt_tool', type: 'tool', tool: 'task', state: { status: 'completed', input: { role: 'worker' }, metadata: { selected_model: 'opencode/free', sessionId: 'ses_child', freelancer_activity: { schema_version: 1, role: 'worker', phase: 'completed', selected_model: 'opencode/free', dispatched_model: 'opencode/free', observed_model: 'opencode/free', child_session: 'ses_child', subject: 'Check provider shades', completed_tools: 2, updated_at: new Date(now).toISOString() } } } },
    ] },
  ];
  const host = {
    async request(route) {
      if (route === "/agent") return checkedCatalog(await store.read("settings")).agents.map(a=>({name:a.id,mode:"all",permission:[]}));
      if (route === '/provider') return { connected: nativeProviders.map(p => p[0]), all: nativeProviders.map(([id, model, name]) => ({ id, models: { [model]: { name, cost: { input: 0, output: 0 }, limit: { context: 32768, output: 2048 }, toolcall: true } } })) };
      if (route === '/provider/auth') return { openai: [{ type: 'oauth', label: 'Sign in with browser' }] };
      if (route === '/agent') return [{ name: 'build', model: { providerID: 'openai', modelID: 'atlas' } }];
      if (route === '/config') return { model: 'openai/atlas' };
      if (route === '/session?limit=1000') return sessions;
      if (route === '/session/status') return busy ? { ses_colors: { type: 'busy' } } : {};
      if (route === '/permission') return [];
      if (route === '/question') return questions;
      for (const session of sessions) {
        if (route === '/session/' + session.id) return session;
        if (route === '/session/' + session.id + '/message') return messages(session.id);
      }
      if (route.endsWith('/todo')) return [{ content: 'Check every palette', status: 'pending' }];
      if (route.endsWith('/diff')) return [];
      return [];
    },
    async *events(_, signal) {
      while (!signal.aborted) {
        try { await delay(700, undefined, { signal }); } catch { return; }
        yield 'data: {}\n\n';
      }
    },
  };
  const snapshot = { preferences: { scope: 'default', revision: 0, preferences: { ...defaults, parentModel: 'openai/atlas' } }, usage: { providers: [] }, receipts: [], history: { entries: [] } };
  const app = createApplication({ backendRoot: root, host, store, backendFactory: () => ({ snapshot: async () => snapshot, save: async () => {} }) });
  const runtime = await startServer({ application: app, assets: fileURLToPath(new URL('../../dist/', import.meta.url)), readActivity: createActivityReader({ project: app.project, host }) });
  return { ...runtime, store, setBusy(value) { busy = value; },
    setQuestion(value) { questions = value ? [{ id: 'que_colors', sessionID: 'ses_colors', questions: [{ header: 'Color review', question: 'Does this palette look readable?', options: [{ label: 'Yes', description: 'Keep the current palette.' }, { label: 'Review', description: 'Inspect the controls again.' }] }] }] : []; },
    async close() { await runtime.sender.close(); runtime.server.closeAllConnections(); await new Promise(r => runtime.server.close(r)); await store.flush(); await rm(root, { recursive: true, force: true }); },
  };
}
