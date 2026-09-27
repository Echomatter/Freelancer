// LAN HTTP origins are not secure contexts. getRandomValues is available there,
// while randomUUID and the asynchronous Clipboard API may be absent.
export function clientID(crypto = globalThis.crypto) {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') throw Error('This browser cannot generate a secure request ID.');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function copyText(text) {
  if (globalThis.navigator?.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; }
    catch { /* Some mobile browsers expose the API but deny HTTP access. */ }
  }
  const active = document.activeElement;
  const selection = active && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.cssText = 'position:fixed;left:0;top:0;opacity:0;font-size:16px;pointer-events:none';
  document.body.append(input);
  try {
    input.select();
    input.setSelectionRange(0, input.value.length);
    if (!document.execCommand('copy')) throw Error('Copy is unavailable in this browser.');
  } finally {
    input.remove();
    active?.focus?.({ preventScroll: true });
    if (selection) active.setSelectionRange(...selection);
  }
}
