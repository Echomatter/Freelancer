// Draft identity is project + native session (or the project's new-chat draft).
// Acknowledgements clear only the captured edit generation, never newer typing.
export function createDraftCache(request, { delay = 350 } = {}) {
  const entries = new Map(),
    listeners = new Set();
  const keyOf = (project, session = "") => JSON.stringify([project, session]);
  const emit = () => {
    for (const fn of listeners) fn();
  };
  function entry(project, session = "") {
    const key = keyOf(project, session);
    if (!entries.has(key))
      entries.set(key, {
        key,
        project,
        session,
        text: "",
        revision: 0,
        generation: 0,
        saved: 0,
        ready: false,
        status: "loading",
        error: "",
        timer: null,
        flight: null,
        loading: null,
        moving: false,
      });
    return entries.get(key);
  }
  const route = (e) =>
    "drafts?" + new URLSearchParams({ project: e.project, session: e.session });
  async function load(e, replace = false) {
    if (e.loading) return e.loading;
    const generation = e.generation;
    const work = (async () => {
      try {
        const saved = await request(route(e));
        if (
          !Number.isSafeInteger(saved.revision) ||
          typeof saved.text !== "string"
        )
          throw Error("Restart Freelancer to load saved drafts.");
        if (replace && e.generation !== generation)
          throw Error(
            "Draft changed while loading. Your current text was preserved. Try loading again.",
          );
        if (!replace && e.generation && saved.text && saved.text !== e.text)
          throw Error(
            "A saved draft exists. Copy your current text before loading it.",
          );
        e.revision = saved.revision;
        e.ready = true;
        e.error = "";
        if (replace || !e.generation) {
          e.text = saved.text;
          e.generation++;
          e.saved = e.generation;
        }
        e.status = saved.text ? "Draft restored" : "";
        emit();
        if (e.saved !== e.generation) schedule(e);
      } catch (error) {
        e.error = error.message;
        e.status = "Draft not saved";
        emit();
        throw error;
      }
    })();
    e.loading = work;
    try {
      return await work;
    } finally {
      e.loading = null;
    }
  }
  function schedule(e) {
    clearTimeout(e.timer);
    if (!e.moving)
      e.timer = setTimeout(() => {
        void flush(e).catch(() => {});
      }, delay);
  }
  async function flush(e) {
    clearTimeout(e.timer);
    if (!e.ready) await load(e);
    if (e.flight) {
      await e.flight;
      if (e.saved !== e.generation) return flush(e);
      return;
    }
    if (e.saved === e.generation) return;
    const work = (async () => {
      while (e.saved !== e.generation) {
        const generation = e.generation,
          text = e.text;
        e.status = "Saving draft…";
        emit();
        try {
          const saved = await request(
            "drafts",
            {
              project: e.project,
              session: e.session,
              text,
              revision: e.revision,
            },
            "PUT",
          );
          if (saved.revision !== e.revision + 1 || saved.text !== text)
            throw Error(
              "Draft saving was not confirmed. Your text remains here.",
            );
          e.revision = saved.revision;
          e.saved = generation;
          e.error = "";
          e.status = text ? "Draft saved on this computer" : "";
        } catch (error) {
          e.error = error.message;
          e.status = "Draft not saved";
          emit();
          throw error;
        }
      }
      emit();
    })();
    e.flight = work;
    try {
      return await work;
    } finally {
      e.flight = null;
    }
  }
  function set(e, text) {
    if (e.text === text) return;
    e.text = text;
    e.generation++;
    e.status = "Saving draft…";
    emit();
    schedule(e);
  }
  return {
    get: entry,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async load(project, session) {
      const e = entry(project, session);
      if (!e.ready) await load(e);
    },
    async reload(project, session) {
      const e = entry(project, session);
      clearTimeout(e.timer);
      if (e.flight) await e.flight.catch(() => {});
      await load(e, true);
    },
    set(project, session, text) {
      set(entry(project, session), text);
    },
    capture(project, session) {
      const e = entry(project, session);
      return { key: e.key, text: e.text, generation: e.generation };
    },
    async flush(project, session) {
      return flush(entry(project, session));
    },
    accept(token) {
      const e = entries.get(token?.key);
      if (e && e.generation === token.generation && e.text === token.text)
        set(e, "");
    },
    // Move the new-chat draft atomically after native chat creation, before send.
    // New typing during the move follows the created chat and is never cleared
    // by the older send's acknowledgement.
    async rebind(token, session) {
      const source = entries.get(token.key);
      if (!source || source.session) return token;
      source.moving = true;
      clearTimeout(source.timer);
      const target = entry(source.project, session);
      try {
        await flush(source);
        await load(target);
        const moved = await request("drafts/rebind", {
          project: source.project,
          to: session,
          revision: source.revision,
        });
        if (!moved.origin || !moved.destination)
          throw Error(
            "Draft move was not confirmed. Check saved drafts before retrying.",
          );
        target.text = source.text;
        target.generation = source.generation;
        target.revision = moved.destination.revision;
        target.saved =
          moved.destination.text === source.text ? target.generation : -1;
        target.ready = true;
        target.error = "";
        target.status = "Draft saved on this computer";
        source.text = "";
        source.revision = moved.origin.revision;
        source.generation++;
        source.saved = source.generation;
        source.status = "";
        if (target.saved !== target.generation) schedule(target);
        emit();
        return { ...token, key: target.key };
      } finally {
        source.moving = false;
      }
    },
    async flushAll() {
      await Promise.all(
        [...entries.values()]
          .filter((e) => e.ready && e.saved !== e.generation)
          .map(flush),
      );
    },
    hasUnsaved() {
      return [...entries.values()].some((e) => e.saved !== e.generation);
    },
    dispose() {
      for (const e of entries.values()) clearTimeout(e.timer);
      listeners.clear();
    },
  };
}
