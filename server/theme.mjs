import { resolveTheme, themeColors, themeMode, themeStyle } from "../domain/theme.mjs";
export async function savedTheme(store) {
  // Read the existing app store, not origin/port-scoped browser storage.
  const settings = store ? await store.read("settings") : {};
  return resolveTheme(settings.appearance?.theme);
}
export function themeDocument(html, value) {
  const theme = resolveTheme(value);
  // Only allowlisted constants enter HTML. No inline script or relaxed CSP.
  return html.replace(/<html\b([^>]*)>/i, (_, attributes) =>
    `<html${attributes} data-theme="${theme}" style="background-color:${themeColors[theme]};color-scheme:${themeMode(theme)};${Object.entries(themeStyle(theme)).map(([key, color]) => `${key}:${color}`).join(";")}">`);
}
