// Optional browser gate: install playwright without changing package.json/lock,
// build, then run node tests/panels-theme.browser.mjs. Native data is stubbed.
// PANEL_OFFLINE=1 runs the same bundle with a loopback API bridge in restricted
// sandboxes; the default navigates normally, including the response CSP.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { panelFixture } from "./fixtures/panel-app.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const fixture = await panelFixture();
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const offline = process.env.PANEL_OFFLINE === "1";
let saves = 0, fault, responseGate, releaseResponse;
if (offline) {
  await page.exposeBinding("panelFetch", async (_, route, options) => {
    if (route === "/api/appearance") { saves++; if (fault) { if (responseGate) await responseGate; return fault; } }
    const response = await fetch(fixture.url + route, options);
    return { status: response.status, body: await response.text() };
  });
  await page.addInitScript(() => {
    window.fetch = async (route, options = {}) => {
      if (String(route).startsWith("/api/events")) return new Response(new ReadableStream({ start(controller) {
        const timer = setInterval(() => controller.enqueue(new TextEncoder().encode("data: {}\n\n")), 1000);
        options.signal?.addEventListener("abort", () => { clearInterval(timer); controller.close(); }, { once: true });
      } }));
      const { status, body } = await window.panelFetch(String(route), { method: options.method, headers: options.headers, body: options.body });
      return new Response(body, { status, headers: { "Content-Type": "application/json" } });
    };
  });
} else page.on("request", (r) => { if (r.url().endsWith("/api/appearance")) saves++; });
async function load() {
  if (!offline) return page.goto(fixture.url);
  await page.goto("about:blank");
  const html = await (await fetch(fixture.url)).text();
  await page.setContent(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<link\b[^>]*>/gi, ""));
  assert.equal(await page.locator("html").evaluate((e) => getComputedStyle(e).backgroundColor), "rgb(23, 28, 25)");
  const assets = new URL("../dist/assets/", import.meta.url), files = await readdir(assets);
  await page.addStyleTag({ content: await readFile(new URL(files.find((f) => f.endsWith(".css")), assets), "utf8") });
  await page.addScriptTag({ type: "module", content: await readFile(new URL(files.find((f) => f.startsWith("index-") && f.endsWith(".js")), assets), "utf8") });
}
async function failSave(body, status = 400) {
  if (offline) { fault = { status, body: JSON.stringify(body) }; return; }
  await page.route("**/api/appearance", async (r) => { if (responseGate) await responseGate; return r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }); });
}
async function restore() { fault = undefined; responseGate = undefined; await page.unroute("**/api/appearance"); }
const nav = page.getByRole("separator", { name: "Navigation width" }), detail = page.getByRole("separator", { name: "Details width" });
const width = (selector) => page.locator(selector).evaluate((e) => Math.round(e.getBoundingClientRect().width));
async function settled() { await page.waitForFunction(() => [...document.querySelectorAll('.panel-resizer')].every((e) => e.getAttribute('aria-disabled') === 'false')); }
async function drag(handle, dx) {
  const b = await handle.boundingBox();
  await page.mouse.move(b.x + 5, b.y + 120); await page.mouse.down();
  await page.mouse.move(b.x + 5 + dx, b.y + 120, { steps: 10 }); await page.mouse.up(); await settled();
}
const report = (s) => console.log("PASS " + s);
async function openResizeChat() {
  const chats = page.getByRole('button', { name: 'Chats', exact: true });
  if (await chats.getAttribute('aria-expanded') !== 'true') await chats.click();
  await page.locator('.nav-chat-select').filter({ hasText: 'Resize test chat' }).click();
}
try {
  if (!offline) {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const blank = await context.newPage(); await blank.goto(fixture.url);
    assert.equal(await blank.locator("html").getAttribute("data-theme"), "dark");
    assert.equal(await blank.locator("html").evaluate((e) => getComputedStyle(e).backgroundColor), "rgb(23, 28, 25)");
    await context.close();
  }
  await load();
  await openResizeChat();
  await page.getByRole("button", { name: "Details", exact: true }).click(); await settled();
  await page.locator(".details-chat-title").filter({ hasText: "Resize test chat" }).waitFor();
  assert.equal(await width(".sidebar"), 244); assert.equal(await width(".work-details"), 330);
  assert.equal(await page.locator(".details-chat-title").textContent(), "Resize test chat");
  const workerCard = page.locator(".activity-summary-button").first();
  assert.match(await workerCard.getAttribute("aria-label"), /Engineer.*opencode\/free.*Working.*1 actions.*Open conversation/);
  assert.equal(await workerCard.getAttribute("aria-expanded"), null);
  assert.match(await workerCard.innerText(), /Engineer/);
  assert.match(await workerCard.innerText(), /Working/);
  assert.match(await workerCard.innerText(), /1 actions/);
  assert.equal(await page.getByText("Browser worker job", { exact: true }).count(), 0);
  await workerCard.click();
  await page.getByRole("heading", { name: "Browser worker job" }).waitFor();
  report("compact activity card opens its child conversation");
  report("saved dark background before React; defaults and resize handles");
  await page.locator(".composer textarea").fill("Keep my draft");
  let before = saves;
  await drag(nav, 80); assert.equal(await width(".sidebar"), 324); assert.equal(saves - before, 1);
  before = saves;
  await drag(detail, -100); assert.equal(await width(".work-details"), 430); assert.equal(saves - before, 1);
  assert.equal(await page.locator(".composer textarea").inputValue(), "Keep my draft");
  report("independent drag directions and one save per release; composer preserved");
  await page.waitForTimeout(1200); assert.equal(await width(".sidebar"), 324);
  await load(); await openResizeChat();
  await page.getByRole("button", { name: "Details", exact: true }).click(); await settled();
  assert.equal(await width(".sidebar"), 324); assert.equal(await width(".work-details"), 430);
  report("reload and bootstrap updates retain saved widths");
  await nav.focus(); await page.keyboard.press("ArrowRight"); await settled(); assert.equal(await width(".sidebar"), 334);
  await detail.focus(); await page.keyboard.press("ArrowRight"); await settled(); assert.equal(await width(".work-details"), 420);
  await page.keyboard.press("Home"); await settled(); assert.equal(await width(".work-details"), 260);
  await page.keyboard.press("End"); await settled(); assert.equal(await width(".work-details"), 640);
  await detail.dblclick(); await settled(); await nav.dblclick(); await settled();
  assert.equal(await width(".sidebar"), 244); assert.equal(await width(".work-details"), 330);
  report("keyboard limits and independent double-click reset");
  before = saves; const box = await nav.boundingBox();
  await page.mouse.move(box.x + 5, 200); await page.mouse.down(); await page.mouse.move(box.x + 105, 200);
  await page.keyboard.press("Escape"); await page.mouse.up();
  assert.equal(await width(".sidebar"), 244); assert.equal(saves, before);
  assert.equal(await page.locator("html").evaluate((e) => e.classList.contains("panel-resizing")), false);
  // A new drag after cancellation must still work.
  await failSave({ error: "Simulated save failure" }); await drag(nav, 80);
  await page.getByRole("alert").filter({ hasText: "Simulated save failure" }).waitFor();
  assert.equal(await width(".sidebar"), 244); await restore();
  report("Escape cancellation and subsequent failed-save rollback");
  await failSave({ saved: true }, 200); await drag(detail, -60);
  await page.getByRole("alert").filter({ hasText: "Restart Freelancer" }).waitFor();
  assert.equal(await width(".work-details"), 330); await restore();
  report("old server cannot silently claim a width was saved");
  await drag(nav, 1000); await drag(detail, -1000); assert.ok(await width(".chat-view") >= 320);
  const saved = (await fixture.store.read("settings")).appearance.panelWidths;
  await page.setViewportSize({ width: 850, height: 700 });
  await page.waitForFunction(() => document.querySelector(".chat-view").getBoundingClientRect().width >= 320);
  assert.deepEqual((await fixture.store.read("settings")).appearance.panelWidths, saved);
  await page.setViewportSize({ width: 680, height: 700 });
  await page.waitForFunction(() => document.querySelectorAll(".panel-resizer").length === 0);
  assert.equal(await nav.count(), 0); assert.equal(await detail.count(), 0); assert.equal(await width(".sidebar"), 68);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.querySelectorAll(".panel-resizer").length === 2);
  assert.equal(await width(".sidebar"), saved.navigation); assert.equal(await width(".work-details"), saved.details);
  report("clamping, compact layout, and restoration after window resize");
  await page.getByRole("button", { name: "Application settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  assert.equal(await page.locator(".palette-picker select").count(), 0);
  const lightPalette = page.getByRole("button", { name: "Use Sage Daybreak palette", exact: true });
  const darkPalette = page.getByRole("button", { name: "Use Forest Night palette", exact: true });
  const darkCategory = page.getByRole("button", { name: "Dark themes (60)" });
  assert.equal(await darkCategory.getAttribute("aria-expanded"), "true");
  await darkCategory.click(); assert.equal(await darkCategory.getAttribute("aria-expanded"), "false");
  assert.equal(await darkPalette.count(), 0); await darkCategory.click();
  assert.equal(await darkPalette.count(), 1);
  await failSave({ error: "Theme save failed" });
  responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  const failedSave = lightPalette.click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  releaseResponse(); await failedSave;
  await page.getByRole("alert").filter({ hasText: "Theme save failed" }).waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark"); await restore();
  await lightPalette.click(); await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  assert.equal((await fixture.store.read("settings")).appearance.theme, "light");
  await darkPalette.click(); await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await load();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.deepEqual((await fixture.store.read("settings")).appearance.panelWidths, saved);
  assert.deepEqual(errors, []);
  report("theme picker persistence, failure safety, and dark relaunch without losing widths");
} finally { await browser.close(); await fixture.close(); }
