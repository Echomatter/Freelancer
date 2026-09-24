export const historyContract = 1;
export const idPattern = /^ses_[\w-]{1,180}$/;
export function sessionKey(value = "") {
  if (value === "" || value === "new") return "new";
  if (typeof value !== "string" || !idPattern.test(value))
    throw Error("Choose a chat.");
  return value;
}
export function draftInput(body) {
  if (!body || typeof body.text !== "string" || body.text.length > 200000)
    throw Error("Drafts must contain at most 200,000 characters.");
  if (!Number.isSafeInteger(body.revision) || body.revision < 0)
    throw Error("Reload the draft before saving.");
  return { text: body.text, revision: body.revision };
}
export function organizedSessions(
  sessions,
  annotations = {},
  projectArchived = false,
  systemSessions = new Set(),
) {
  const byID = new Map(sessions.map((s) => [s.id, s]));
  return sessions
    .filter(s => {
      let current = s;
      const seen = new Set();
      while (current && !seen.has(current.id)) {
        if (systemSessions.has(current.id)) return false;
        seen.add(current.id);
        current = byID.get(current.parentID);
      }
      return true;
    })
    .map((s) => {
      const own = annotations[s.id] ?? { revision: 0 };
      let current = s,
        hiddenByParent = false;
      const seen = new Set([s.id]);
      while (current?.parentID && !seen.has(current.parentID)) {
        seen.add(current.parentID);
        const parent = byID.get(current.parentID);
        if (annotations[current.parentID]?.hiddenAt || parent?.time?.archived)
          hiddenByParent = true;
        current = parent;
      }
      return {
        ...s,
        organization: {
          ...own,
          projectArchived,
          hiddenByParent,
          archived: !!(
            projectArchived ||
            own.hiddenAt ||
            hiddenByParent ||
            s.time?.archived
          ),
          nativeArchived: !!s.time?.archived,
          archiveScope: s.time?.archived
            ? "opencode"
            : own.hiddenAt || hiddenByParent
              ? "freelancer"
              : null,
        },
      };
    })
    .sort(
      (a, b) =>
        Number(!!b.organization.pinnedAt) - Number(!!a.organization.pinnedAt) ||
        (b.time?.updated || 0) - (a.time?.updated || 0) ||
        a.id.localeCompare(b.id),
    );
}
// Only use native archive when the installed API explicitly accepts null for
// clearing it. Numeric timestamp support alone does not establish restorability.
export function nativeArchiveSupported(doc) {
  const resolve = (s, seen = new Set()) => {
    if (!s || typeof s !== "object" || seen.has(s)) return {};
    seen.add(s);
    if (s.$ref?.startsWith("#/"))
      return resolve(
        s.$ref
          .slice(2)
          .split("/")
          .reduce((v, k) => v?.[k], doc),
        seen,
      );
    return s;
  };
  const operation = doc?.paths?.["/session/{sessionID}"]?.patch;
  const schema = resolve(
    operation?.requestBody?.content?.["application/json"]?.schema,
  );
  const time = resolve(schema.properties?.time);
  const archived = resolve(time.properties?.archived);
  return !!(
    archived.nullable ||
    archived.type?.includes?.("null") ||
    archived.anyOf?.some((v) => resolve(v).type === "null")
  );
}
export function conversationMarkdown(bundle) {
  const safeTitle = (text) =>
    String(text || "Untitled").replace(/[\r\n]/g, " ");
  const sections = [
    `# ${safeTitle(bundle.title)}\n\nConversation export · ${bundle.exportedAt}\n\n${bundle.notice}`,
  ];
  for (const session of bundle.sessions) {
    sections.push(
      `## ${safeTitle(session.info.title)}\n\nSession: \`${session.info.id}\`${session.info.parentID ? ` · Parent: \`${session.info.parentID}\`` : ""}`,
    );
    for (const message of session.messages) {
      const role = safeTitle(message.info?.role || "Message");
      sections.push(`### ${role}`);
      for (const part of message.parts ?? []) {
        if (part.type === "text") sections.push(String(part.text ?? ""));
        else if (part.type === "file")
          sections.push(
            `Attachment reference: ${safeTitle(part.filename || part.mime || "file")} (file bytes are not included)`,
          );
        else if (part.type === "tool") {
          const text = JSON.stringify(
            { tool: part.tool, state: part.state },
            null,
            2,
          );
          const fence = "`".repeat(
            Math.max(
              3,
              ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1),
            ),
          );
          sections.push(`${fence}json\n${text}\n${fence}`);
        }
      }
    }
  }
  return sections.join("\n\n") + "\n";
}
