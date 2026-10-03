import { updateOpenCodeProjectSettings } from './opencode-project-config.mjs';

export function createContextSettings({ host, project, canRefresh, setRefreshing }) {
  async function effective(p) {
    // Agent initialization runs the native plugin config hook before /config.
    await host.request('/agent', { directory: p.directory });
    const config = await host.request('/config', { directory: p.directory });
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('OpenCode context settings are unavailable.');
    return config.compaction?.auto !== false;
  }
  async function refresh(p) {
    await host.request('/instance/dispose', { directory: p.directory, method: 'POST' });
    return effective(p);
  }
  return {
    async read(id) {
      const p = await project(id);
      return { autoCompact: await effective(p) };
    },
    async save(id, payload) {
      if (typeof payload.autoCompact !== 'boolean') throw Error('Choose automatic context compaction on or off.');
      if (!canRefresh()) throw Error('Wait for the current setup or send to finish, then save context settings again.');
      setRefreshing(true);
      try {
        const p = await project(id);
        const [status, questions, permissions] = await Promise.all([
          host.request('/session/status', { directory: p.directory }),
          host.request('/question', { directory: p.directory }),
          host.request('/permission', { directory: p.directory }),
        ]);
        if (!status || typeof status !== 'object' || Array.isArray(status) || !Array.isArray(questions) || !Array.isArray(permissions) ||
            Object.values(status).some(s => s?.type !== 'idle') || questions.length || permissions.length)
          throw Error('Let this project’s running chats and pending decisions finish before saving context settings.');
        const autoCompact = payload.autoCompact;
        const saved = await updateOpenCodeProjectSettings(p.directory, { compaction: { auto: autoCompact } });
        try {
          if (await refresh(p) !== autoCompact) throw Error('OpenCode did not confirm the automatic compaction setting.');
        } catch (error) {
          // A failed confirmation must not leave an unverified native default.
          await saved.rollback();
          await refresh(p).catch(() => {});
          throw Error(`${error.message} The previous OpenCode project config was restored; retry when OpenCode is available.`);
        }
        return { saved: true, autoCompact };
      } finally { setRefreshing(false); }
    },
  };
}
