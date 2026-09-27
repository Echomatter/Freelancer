import os from "node:os";

export function privateIPv4(address = "") {
  const normalized = address.replace(/^::ffff:/, "");
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return false;
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254);
}

export function localLanAddresses() {
  const rows = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const row of entries ?? []) {
      if (row.family === "IPv4" && !row.internal && privateIPv4(row.address)) rows.push(row.address);
    }
  }
  return [...new Set(rows)].sort();
}
