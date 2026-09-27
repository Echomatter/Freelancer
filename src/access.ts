export function accessCapabilityFlags() {
  const host = typeof window === "undefined" ? "" : window.location.hostname;
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const lanHttp = typeof window !== "undefined" && window.location.protocol === "http:" && !loopback;
  return {
    lanHttp,
    randomUUIDUnavailable: lanHttp && !globalThis.crypto?.randomUUID,
    clipboardUnavailable: lanHttp && !navigator.clipboard,
  };
}
