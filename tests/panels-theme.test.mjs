import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPanelWidths, validatePanelWidths, fitPanelWidths, savePanelWidth } from "../domain/panel-widths.mjs";
import { applyTheme, resolveTheme } from "../domain/theme.mjs";
import { themeDocument, savedTheme } from "../server/theme.mjs";
import { createApplication } from "../server/application.mjs";
import { createStore } from "../server/store.mjs";
import { startServer } from "../server/http.mjs";

test("panel defaults and corrupted preferences are bounded", () => {
  assert.deepEqual(readPanelWidths(), { navigation: 244, details: 330 });
  assert.deepEqual(readPanelWidths({ panelWidths: { navigation: -10, details: 9999 } }), { navigation: 180, details: 640 });
  assert.deepEqual(readPanelWidths({ panelWidths: { navigation: NaN, details: "400" } }), { navigation: 244, details: 330 });
});
test("width patches reject invalid fields, values and types", () => {
  for (const patch of [null, {}, [], { theme: 244 }, { navigation: "320" }, { navigation: Infinity },
    { navigation: 179 }, { navigation: 320.5 }, { details: 641 }, { constructor: 300 }])
    assert.throws(() => validatePanelWidths(patch), /panel width/);
  assert.deepEqual(validatePanelWidths({ details: 420 }), { details: 420 });
});
test("desktop resizing always leaves space for the chat without rewriting preferences", () => {
  const preferred = { navigation: 480, details: 640 };
  for (const viewport of [801, 850, 1024, 1280, 1600, 1920]) {
    const f = fitPanelWidths(preferred, viewport, true);
    assert.ok(viewport - f.navigation - f.details >= 320);
    assert.ok(f.navigation >= 180 && f.navigation <= f.navigationMax);
    assert.ok(f.details >= 260 && f.details <= f.detailsMax);
  }
  assert.deepEqual(preferred, { navigation: 480, details: 640 });
});
test("compact nav and overlay Details disable their resize handles", () => {
  const p = readPanelWidths();
  assert.equal(fitPanelWidths(p, 720, true).navigation, 68);
  assert.equal(fitPanelWidths(p, 720, true).navigationResizable, false);
  assert.equal(fitPanelWidths(p, 800, true).detailsResizable, false);
  assert.equal(fitPanelWidths(p, 801, true).detailsResizable, true);
  assert.equal(fitPanelWidths(p, 1440, false).detailsResizable, false);
});
test("width persistence requires an exact server acknowledgement", async () => {
  let sent;
  await savePanelWidth("navigation", 320, async (body) => {
    sent = body; return { saved: true, panelWidths: { navigation: 320 } };
  });
  assert.deepEqual(sent, { panelWidths: { navigation: 320 } });
  for (const response of [{ saved: true }, { saved: true, panelWidths: { navigation: 321 } }, { saved: false }])
    await assert.rejects(savePanelWidth("navigation", 320, async () => response), /Restart Freelancer/);
});
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "freelancer-panels-theme-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createStore(root), app = createApplication({ backendRoot: root, store, host: {} });
  return { root, store, app };
}
test("widths and theme persist through the real handler and a reopened store", async (t) => {
  const { root, app } = await fixture(t);
  await app.saveAppearance({ theme: "dark", todoLayout: "inline", showDepletedModels: false });
  await savePanelWidth("navigation", 320, (body) => app.saveAppearance(body));
  await savePanelWidth("details", 460, (body) => app.saveAppearance(body));
  assert.deepEqual((await createStore(root).read("settings")).appearance,
    { theme: "dark", todoLayout: "inline", showDepletedModels: false, panelWidths: { navigation: 320, details: 460 } });
  assert.equal(await savedTheme(createStore(root)), "dark");
});
test("invalid combined saves leave all prior settings intact", async (t) => {
  const { app, store } = await fixture(t);
  await app.saveAppearance({ theme: "dark", panelWidths: { navigation: 300 } });
  const before = await store.read("settings");
  await assert.rejects(app.saveAppearance({ theme: "light", panelWidths: { details: 1 } }));
  await assert.rejects(app.saveAppearance({ theme: "invalid" }));
  assert.deepEqual(await store.read("settings"), before);
});
test("concurrent width, theme and todo patches preserve each other", async (t) => {
  const { app, store } = await fixture(t);
  await Promise.all([app.saveAppearance({ panelWidths: { navigation: 280 } }),
    app.saveAppearance({ panelWidths: { details: 420 } }), app.saveAppearance({ theme: "dark", todoLayout: "docked" })]);
  assert.deepEqual((await store.read("settings")).appearance,
    { panelWidths: { navigation: 280, details: 420 }, theme: "dark", todoLayout: "docked" });
});
test("initial HTML contains the saved palette before any script, without user-controlled injection", () => {
  const html = '<!doctype html><html lang="en"><head></head><body><script src="/app.js"></script></body></html>';
  assert.match(themeDocument(html, "dark"), /<html[^>]*data-theme="dark"[^>]*background-color:#171c19;color-scheme:dark/);
  assert.match(themeDocument(html, "light"), /background-color:#f8f9f6;color-scheme:light/);
  assert.doesNotMatch(themeDocument(html, '\"><script>attack</script>'), /attack/);
});
test("applying a theme updates critical background as well as CSS theme selectors", () => {
  const properties = {};
  const root = { dataset: {}, style: { setProperty(key, value) { properties[key] = value; } } };
  applyTheme("dark", root);
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.style.backgroundColor, "#171c19");
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(properties["--bg"], "#171c19");
  assert.ok(properties["--accent-contrast"]);
  applyTheme("light", root);
  assert.equal(root.style.backgroundColor, "#f8f9f6");
  assert.equal(resolveTheme("broken"), "light");
});
test("fresh servers on different ports both serve the persisted dark initial page", async (t) => {
  const { root, app } = await fixture(t);
  await app.saveAppearance({ theme: "dark" });
  const assets = new URL("../", import.meta.url).pathname;
  const servers = [];
  t.after(() => { for (const { server } of servers) { server.closeAllConnections(); server.close(); } });
  for (let i = 0; i < 2; i++) {
    const runtime = await startServer({ assets: process.cwd(), application:
      createApplication({ backendRoot: root, store: createStore(root), host: {} }) });
    servers.push(runtime);
    for (const suffix of ["/", "/index.html"]) {
      const response = await fetch(runtime.url + suffix);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /data-theme="dark"[^>]*#171c19/);
      assert.match(response.headers.get("content-security-policy"), /script-src 'self';/);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  assert.notEqual(servers[0].url, servers[1].url);
});
test("appearance HTTP retains its local-only guards and echoes a saved theme", async (t) => {
  const { app } = await fixture(t);
  const { server, url } = await startServer({ application: app, assets: "." });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const body = JSON.stringify({ theme: "dark", panelWidths: { details: 420 } });
  assert.equal((await fetch(url + "/api/appearance", { method: "PUT", body })).status, 403);
  const result = await fetch(url + "/api/appearance", { method: "PUT", body,
    headers: { "X-Freelancer-Client": "webpage", "Content-Type": "application/json" } });
  assert.deepEqual(await result.json(), { saved: true, theme: "dark", panelWidths: { details: 420 } });
});
test("startup and picker no longer override the persisted palette with per-origin localStorage", async () => {
  for (const file of ["../src/main.tsx", "../src/Settings.tsx", "../src/ThemePicker.tsx"])
    assert.doesNotMatch(await readFile(new URL(file, import.meta.url), "utf8"), /localStorage/);

});
