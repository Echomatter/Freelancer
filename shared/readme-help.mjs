// Shared by the build and browser types. The README is the authored copy source.
export const helpTopicIDs = /** @type {const} */ ([
  "schedules", "schedule-timing", "schedule-execution", "file-search", "index-coverage",
  "index-maintenance", "index-reset", "index-optimize", "index-check", "index-compact",
  "local-data", "local-backup", "storage-freelancer", "storage-runtime", "storage-opencode",
  "project-archive", "history-search", "history-export", "session-defaults", "parent-model",
  "delegation", "delegation-scope", "worker-models", "delegation-limits", "delegation-changes",
  "git-defaults", "git-history", "git-main", "git-identity", "git-connection", "git-agreement",
  "git-explicit-request", "git-sync", "git-first-upload", "git-receipts", "theme", "provider-color",
  "usage-estimate", "contributions", "project-import", "project-indexes", "project-name",
  "message-options", "message-delivery", "model-ratings", "workflows", "remote-access",
  "remote-address", "remote-pairing", "remote-devices", "remote-web",
  "turn-rail", "context-compaction",
]);

/** @typedef {typeof helpTopicIDs[number]} HelpTopic */
/** @typedef {{ title: string, paragraphs: string[] }} HelpExcerpt */

/** @param {string} markdown @returns {Record<HelpTopic, HelpExcerpt>} */
export function readmeHelp(markdown) {
  const excerpts = /** @type {Record<HelpTopic, HelpExcerpt>} */ ({});
  for (const match of markdown.matchAll(/<!-- help:([\w-]+) -->\s*### ([^\r\n]+)\s+([\s\S]*?)<!-- \/help -->/g)) {
    if (Object.hasOwn(excerpts, match[1])) throw new Error("Duplicate README help topic: " + match[1]);
    const body = match[3].trim();
    if (!body || body.includes("<!-- help:")) throw new Error("Malformed README help topic: " + match[1]);
    excerpts[match[1]] = { title: match[2].trim(), paragraphs: body.split(/\r?\n\s*\r?\n/).map(p => p.replace(/\s+/g, " ")) };
  }
  for (const topic of helpTopicIDs) {
    if (!excerpts[topic]?.paragraphs[0]) throw new Error("Missing README help topic: " + topic);
  }
  return excerpts;
}
