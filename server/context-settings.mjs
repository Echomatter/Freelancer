export function createContextSettings({ store, host, project, canRefresh, setRefreshing }) {
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
        const previous = (await store.read('settings')).contextSettings?.[id];
        const autoCompact = payload.autoCompact;
        await store.update('settings', s => ({ ...s, revision: s.revision + 1,
          contextSettings: { ...s.contextSettings, [id]: { ...s.contextSettings?.[id], autoCompact } } }));
        try {
          if (await refresh(p) !== autoCompact) throw Error('OpenCode did not confirm the automatic compaction setting.');
        } catch (error) {
          // A failed refresh is not a successful save. Restore the authored
          // preference, including absence, and reload it before unlocking sends.
          await store.update('settings', s => {
            const contextSettings = { ...s.contextSettings };
            if (previous === undefined) delete contextSettings[id]; else contextSettings[id] = previous;
            return { ...s, revision: s.revision + 1, contextSettings };
          });
          await refresh(p).catch(() => {});
          throw Error(`${error.message} The previous preference was restored; retry when OpenCode is available.`);
        }
        return { saved: true, autoCompact };
      } finally { setRefreshing(false); }
    },
  };
}
