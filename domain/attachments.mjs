// Browser attachments are forwarded as native OpenCode file parts. Keep this
// boundary small: no remote URLs, filesystem paths, or unbounded JSON payloads.
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 6 * 1024 * 1024;

export function normalizeAttachments(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_ATTACHMENTS)
    throw Error(`Attach at most ${MAX_ATTACHMENTS} files.`);
  let total = 0;
  return input.map((item) => {
    if (!item || typeof item !== "object" ||
      typeof item.filename !== "string" || !item.filename.trim() ||
      item.filename.length > 160 || /[\\/\x00-\x1f]/.test(item.filename) ||
      typeof item.mime !== "string" || !/^[\w.+-]+\/[\w.+-]+$/.test(item.mime) ||
      typeof item.url !== "string")
      throw Error("Choose a valid local attachment.");
    const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.url);
    if (!match || match[1].toLowerCase() !== item.mime.toLowerCase() || match[2].length % 4)
      throw Error("Attachment data could not be read. Add the file again.");
    const bytes = match[2].length / 4 * 3 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
    total += bytes;
    if (!bytes || bytes > MAX_ATTACHMENT_BYTES || total > MAX_TOTAL_ATTACHMENT_BYTES)
      throw Error("Attachments are too large. Use files up to 4 MB and 6 MB total.");
    return { type: "file", mime: item.mime, filename: item.filename, url: item.url };
  });
}
