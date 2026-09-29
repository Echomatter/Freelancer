// Native SSE notifications invalidate server-owned snapshots. Heartbeats and
// transport chunk boundaries are not changes to a conversation.
export function createEventInvalidator(onChange, maxBuffer = 1024 * 1024) {
  let buffer = '', discarding = false;
  return chunk => {
    buffer += chunk;
    let changed = false, separator;
    const events = [];
    while ((separator = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      if (discarding) { discarding = false; continue; }
      if (frame.length > maxBuffer) { changed = true; events.push(null); continue; }
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try {
        const event = JSON.parse(data);
        const payload = event?.payload ?? event;
        if (payload?.type !== 'server.heartbeat') { changed = true; events.push(payload); }
      } catch { changed = true; events.push(null); } // Unknown notification formats still refresh.
    }
    if (buffer.length > maxBuffer) {
      if (!discarding) { changed = true; events.push(null); }
      discarding = true;
      buffer = buffer.slice(-3); // Keep enough to recognize a split separator.
    }
    if (changed) onChange(events);
  };
}

// Text traffic from unrelated chats must not reread the selected transcript,
// model catalog, usage ledger and Git status. Unknown events remain fail-safe.
export function eventRefreshScope(events = [null], sessions = new Set()) {
  let chat = false, bootstrap = false;
  for (const event of events) {
    if (event?.type?.startsWith('message.')) {
      const props = event.properties;
      const session = props?.sessionID ?? props?.info?.sessionID ?? props?.part?.sessionID;
      if (!session || sessions.has(session)) chat = true;
    } else { chat = true; bootstrap = true; }
  }
  return { chat, bootstrap };
}
