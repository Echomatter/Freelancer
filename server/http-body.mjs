const MiB = 1024 * 1024;
export const bodyLimit = route => (route === '/api/send' ? 9 : 1) * MiB;
const failure = (status, code, message) => Object.assign(Error(message), { status, code });

export async function readJsonBody(req, route) {
  if (['GET', 'HEAD'].includes(req.method)) return {};
  const limit = bodyLimit(route);
  const tooLarge = () => failure(413, 'BODY_TOO_LARGE', `Request exceeds the ${limit / MiB} MB JSON limit. Shorten it or remove attachments.`);
  if (Number(req.headers['content-length']) > limit) {
    req.resume();
    throw tooLarge();
  }
  // destroyOnReturn:false keeps the socket alive long enough to deliver JSON
  // errors when a chunked request exceeds the limit mid-stream.
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) { req.resume(); throw tooLarge(); }
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw failure(400, 'INVALID_JSON', 'Request contains invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw failure(400, 'INVALID_JSON', 'Request must contain a JSON object.');
  return body;
}
