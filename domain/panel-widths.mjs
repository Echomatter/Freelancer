// UI dimensions only; the existing appearance store remains authoritative.
export const panelLimits = Object.freeze({
  navigation: Object.freeze({ min: 180, max: 480, default: 244 }),
  details: Object.freeze({ min: 260, max: 640, default: 330 }),
});
export const clampWidth = (value, min, max) => Math.round(Math.max(min, Math.min(max, value)));
export function readPanelWidths(appearance) {
  return Object.fromEntries(Object.entries(panelLimits).map(([name, limit]) => {
    const value = appearance?.panelWidths?.[name];
    return [name, typeof value === "number" && Number.isFinite(value)
      ? clampWidth(value, limit.min, limit.max) : limit.default];
  }));
}
export function validatePanelWidths(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || !Object.keys(patch).length)
    throw Error("Choose a panel width");
  for (const [name, value] of Object.entries(patch)) {
    const limit = panelLimits[name];
    if (!Object.hasOwn(panelLimits, name) || !Number.isInteger(value) || value < limit.min || value > limit.max)
      throw Error("Choose a supported panel width");
  }
  return { ...patch };
}
// Clamp the display, not the preference, when resizing the window. Retain the
// existing compact navigation / Details overlay; reserve 320px for the chat.
export function fitPanelWidths(preferences, viewport, detailsOpen) {
  const width = Math.max(68, Number.isFinite(viewport) ? viewport : 1280);
  const overlay = width <= 800, compact = width <= 720;
  const navigation = compact ? 68 : clampWidth(preferences.navigation, 180,
    Math.min(480, width - 320 - (detailsOpen && !overlay ? 260 : 0)));
  const details = overlay ? Math.min(330, Math.round((width - navigation) * 0.9))
    : clampWidth(preferences.details, 260, Math.min(640, width - navigation - 320));
  return { navigation, details,
    navigationMax: Math.max(180, Math.min(480, width - 320 - (detailsOpen && !overlay ? details : 0))),
    detailsMax: Math.max(260, Math.min(640, width - navigation - 320)),
    navigationResizable: !compact, detailsResizable: detailsOpen && !overlay };
}
export async function savePanelWidth(name, value, write) {
  const result = await write({ panelWidths: validatePanelWidths({ [name]: value }) });
  // An older server silently ignores unknown appearance fields; demand an echo.
  if (result?.saved !== true || result.panelWidths?.[name] !== value)
    throw Error("Panel width was not confirmed. Restart Freelancer and try again.");
}
