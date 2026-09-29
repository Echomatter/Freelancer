import { resolveTheme, themePalette, paletteStyle, customThemePalette } from "../domain/theme.mjs";
export async function savedTheme(store) {
  // Read the existing app store, not origin/port-scoped browser storage.
  const settings = store ? await store.read("settings") : {};
  const appearance = settings.appearance ?? {};
  const theme = resolveTheme(appearance.theme, appearance.customThemes);
  return appearance.customThemes?.find(p => p.id === theme) ?? theme;
}
export function themeDocument(html, value) {
  let p;
  try { p = value && typeof value === 'object' ? customThemePalette(value) : themePalette(value); }
  catch { p = themePalette('light'); }
  // Only validated IDs, modes and derived hex tokens enter HTML, never names.
  return html.replace(/<html\b([^>]*)>/i, (_, attributes) =>
    `<html${attributes} data-theme="${p.id}" style="background-color:${p.tokens.bg};color-scheme:${p.mode};${Object.entries(paletteStyle(p)).map(([key, color]) => `${key}:${color}`).join(";")}">`);
}
