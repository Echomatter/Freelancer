// Production React/HTTP/SQLite journey. Only native OpenCode/provider transport
// is stubbed. PANEL_OFFLINE=1 is an explicit sandbox fallback, not CSP evidence.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from 'node:timers/promises';
import { localDataFixture } from "./fixtures/local-data-app.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
await mkdir("test-results", { recursive: true });
const f = await localDataFixture();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const offline = process.env.PANEL_OFFLINE === "1";
let draftFault = false;
if (offline) {
  await page.exposeBinding("dataFetch", async (_, route, options) => {
    if (route === "/api/drafts" && options.method === "PUT" && draftFault)
      return {
        status: 400,
        body: JSON.stringify({ error: "Draft disk fixture unavailable" }),
      };
    const response = await fetch(f.url + route, options);
    return { status: response.status, body: await response.text() };
  });
  await page.addInitScript(() => {
    // about:blank lacks secure-context randomUUID; only the offline fixture
    // installs a standards-shaped UUID using Chromium's cryptographic RNG.
    crypto.randomUUID ??= () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    window.fetch = async (route, options = {}) => {
      if (String(route).startsWith("/api/events"))
        return new Response(
          new ReadableStream({
            start(controller) {
              const timer = setInterval(
                () =>
                  controller.enqueue(new TextEncoder().encode("data: {}\n\n")),
                1000,
              );
              options.signal?.addEventListener(
                "abort",
                () => {
                  clearInterval(timer);
                  controller.close();
                },
                { once: true },
              );
            },
          }),
        );
      const { status, body } = await window.dataFetch(String(route), {
        method: options.method,
        headers: options.headers,
        body: options.body,
      });
      return new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      });
    };
  });
}
async function load() {
  if (!offline) return page.goto(f.url);
  await page.goto("about:blank");
  const html = await (await fetch(f.url)).text();
  await page.setContent(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<link\b[^>]*>/gi, ""),
  );
  const assets = new URL("../dist/assets/", import.meta.url),
    files = await readdir(assets);
  await page.addStyleTag({
    content: await readFile(
      new URL(
        files.find((s) => s.endsWith(".css")),
        assets,
      ),
      "utf8",
    ),
  });
  await page.addScriptTag({
    type: "module",
    content: await readFile(
      new URL(
        files.find((s) => s.endsWith(".js")),
        assets,
      ),
      "utf8",
    ),
  });
}
const box = page.locator(".composer textarea");
const history = page.locator(".history-page");
const report = (text) => console.log("PASS " + text);
async function openChat(name = "Important conversation") {
  const chats = page.locator(".chat-navigation");
  const trigger = chats.getByRole("button", { name: "Chats", exact: true });
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await chats.locator(".nav-chat-select").filter({ hasText: name }).click();
  await page.waitForFunction(() => {
    const e = document.querySelector(".composer textarea");
    return e && !e.disabled;
  });
}
async function openHistory() {
  await openApplicationTab("History");
  await history
    .getByRole("checkbox", {
      name: "Select Important conversation",
      exact: true,
    })
    .waitFor();
}
async function openApplicationTab(tab) {
  const appSettings = page.getByRole("button", { name: "Application settings", exact: true });
  if (await appSettings.getAttribute("aria-expanded") !== "true") await appSettings.click();
  await page.getByRole("button", { name: tab, exact: true }).click();
}
async function assertSaved(text) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const saved = (
      await f.api("drafts?project=history_project&session=ses_history")
    ).text;
    if (saved === text) break;
    if (attempt === 199) assert.equal(saved, text);
    await delay(50);
  }
  // SQLite commits before the browser receives the save acknowledgement. Wait
  // for the actual UI recovery too; an immediate count races that response.
  await page.locator(".draft-status").waitFor({ state: "detached" });
  assert.equal(await page.locator(".draft-status").count(), 0);
  await page.waitForFunction(() => !document.querySelector('.topbar-right [aria-label="Saving draft"]'));
}
try {
  await load();
  await openChat();
  await box.fill("Recover this draft after restart");
  await assertSaved("Recover this draft after restart");
  await load();
  await openChat();
  assert.equal(await box.inputValue(), "Recover this draft after restart");
  report("draft save and production UI reload recovery");

  if (offline) draftFault = true;
  else
    await page.route("**/api/drafts", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "Draft disk fixture unavailable" }),
          })
        : route.continue(),
    );
  await box.fill("Keep text through a failed save");
  await page
    .getByRole("alert")
    .filter({ hasText: "Draft disk fixture unavailable" })
    .waitFor();
  assert.equal(await box.inputValue(), "Keep text through a failed save");
  if (offline) draftFault = false;
  else await page.unroute("**/api/drafts");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await assertSaved("Keep text through a failed save");
  report("failed autosave preserves text and retry recovers");

  // Dispatch is held after native acceptance begins while typing continues.
  let release;
  f.state.holdPrompt = new Promise((resolve) => {
    release = resolve;
  });
  await page
    .getByRole("combobox", { name: "Parent model", exact: true })
    .selectOption("opencode/free");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Choose Delegate, Queue, or Interrupt"]'),
  );
  await box.fill("Typed while the earlier request was being accepted");
  release();
  f.state.holdPrompt = null;
  // Draft persistence and native dispatch are independent; wait for the actual
  // native receipt before inspecting it, including under concurrent Git tests.
  for (let attempt = 0; attempt < 300 && !f.state.messages.ses_history?.length; attempt++) await delay(50);
  assert.ok(f.state.messages.ses_history?.length, 'native dispatch must finish');
  await assertSaved("Typed while the earlier request was being accepted");
  assert.equal(
    f.state.messages.ses_history[0].parts[0].text,
    "Keep text through a failed save",
  );
  report("send acknowledgment preserves newer typing");

  await page
    .getByRole("button", { name: "Choose Delegate, Queue, or Interrupt", exact: true })
    .click();
  const sender = page.getByRole("dialog").filter({ hasText: "Queue" });
  // The exact dialog choices come from the existing Queue/Clarify component.
  await sender
    .getByRole("button", { name: /^Queue Send automatically/ })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".composer textarea")?.value === "",
  );
  await openHistory();
  await history
    .getByRole("checkbox", {
      name: "Select Important conversation",
      exact: true,
    })
    .check();
  await history.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm archive change" }).getByRole("button", { name: "Confirm", exact: true }).click();
  await history
    .getByRole("alert")
    .filter({ hasText: /queued|running/ })
    .waitFor();
  assert.equal(f.exports.length, 0);
  await history.getByRole("button", { name: "Close history" }).click();
  await page
    .getByRole("button", { name: "Stop response", exact: true })
    .click();
  await page.waitForFunction(
    () => !!document.querySelector('[aria-label="Send message"]'),
  );
  report(
    "Queue handoff and archive refusal retain the running/queued contract",
  );

  await openHistory();
  await history
    .getByRole("button", { name: "Pin Important conversation", exact: true })
    .click();
  await history
    .getByRole("button", { name: "Unpin Important conversation", exact: true })
    .waitFor();
  await history
    .getByRole("checkbox", {
      name: "Select Important conversation",
      exact: true,
    })
    .check();
  await history.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm archive change" }).getByRole("button", { name: "Confirm", exact: true }).click();
  await history.getByRole("button", { name: "Undo", exact: true }).waitFor();
  assert.equal(
    await history
      .getByRole("checkbox", {
        name: "Select Important conversation",
        exact: true,
      })
      .count(),
    0,
  );
  await history.getByRole("button", { name: "Undo", exact: true }).click();
  await history
    .getByRole("checkbox", {
      name: "Select Important conversation",
      exact: true,
    })
    .waitFor();
  report("pins, archive, and Undo in the production history dialog");

  await history
    .getByRole("checkbox", {
      name: "Select Important conversation",
      exact: true,
    })
    .check();
  await history.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm archive change" }).getByRole("button", { name: "Confirm", exact: true }).click();
  await history.getByRole("button", { name: "Archived", exact: true }).click();
  await history
    .getByRole("checkbox", {
      name: "Select Important conversation",
      exact: true,
    })
    .waitFor();
  await history
    .getByText(/Hidden in Freelancer/)
    .first()
    .waitFor();
  await history
    .getByRole("checkbox", {
      name: "Select Important conversation",
      exact: true,
    })
    .check();
  await history
    .getByRole("combobox", { name: "Export format" })
    .selectOption("json");
  const downloadPromise = page.waitForEvent("download");
  await history
    .getByRole("button", { name: "Export selected", exact: true })
    .click();
  const download = await downloadPromise;
  const bundle = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(bundle.sessions.length, 2);
  assert.equal(bundle.source, "native-opencode-export");
  assert.equal(f.exports.length, 2);
  assert.ok(!JSON.stringify(bundle).includes("Typed while the earlier"));
  report("explicit native-data export includes linked workers but not drafts");

  await page.setViewportSize({ width: 420, height: 820 });
  await page.screenshot({
    path: "test-results/local-data-history-narrow.png",
    fullPage: true,
  });
  const bounds = await history.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.width <= 420);
  await history.getByRole("button", { name: "Close history" }).click();
  await history.waitFor({ state: 'detached' });
  assert.equal(await history.count(), 0);
  await page.setViewportSize({ width: 1440, height: 960 });
  await openApplicationTab("Data & Storage");
  await page
    .getByRole("heading", {
      name: "Freelancer organization & drafts",
      exact: true,
    })
    .waitFor();
  await page.getByText(f.nativeFile, { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Put project away", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm project change", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm project change", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Put project away", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Data & Storage", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/local-data-storage.png",
    fullPage: true,
  });
  assert.equal(
    await readFile(f.directory + "/source.txt", "utf8"),
    "DO NOT MODIFY PROJECT FILES",
  );
  assert.deepEqual((await f.store.read("settings")).github, {
    preserved: true,
  });
  assert.equal(
    await readFile(f.nativeFile, "utf8"),
    "Native ownership sentinel",
  );
  report(
    "narrow history page, navigation, storage locations and project archive/restore",
  );
  assert.deepEqual(errors, []);
  console.log(
    `Browser journey passed (${offline ? "offline bridge; not normal-navigation CSP evidence" : "normal navigation with application CSP"}).`,
  );
} catch (error) {
  console.error("PAGE ERRORS", errors);
  console.error("PAGE TEXT", await page.locator("body").innerText());
  await page.screenshot({
    path: "test-results/local-data-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
  await f.close();
}
