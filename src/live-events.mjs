// Native SSE notifications invalidate server-owned snapshots. Heartbeats and
// transport chunk boundaries are not changes to a conversation.
export function createEventInvalidator(onChange, maxBuffer = 1024 * 1024) {
  let buffer = '', discarding = false;
  return chunk => {
    buffer += chunk;
    let changed = false, separator;
    while ((separator = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      if (discarding) { discarding = false; continue; }
      if (frame.length > maxBuffer) { changed = true; continue; }
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try {
        const event = JSON.parse(data);
        if ((event?.payload?.type ?? event?.type) !== 'server.heartbeat') changed = true;
      } catch { changed = true; } // Unknown notification formats still refresh.
    }
    if (buffer.length > maxBuffer) {
      if (!discarding) changed = true;
      discarding = true;
      buffer = buffer.slice(-3); // Keep enough to recognize a split separator.
    }
    if (changed) onChange();
  };
}
