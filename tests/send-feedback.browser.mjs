import assert from "node:assert/strict";
import { chromium } from "playwright";
import { localDataFixture } from "./fixtures/local-data-app.mjs";
const f = await localDataFixture();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let releaseCreate, releaseSend, releaseAcknowledgement;
let notifyCreate, notifySend;
const createGate = new Promise((resolve) => (releaseCreate = resolve));
const sendGate = new Promise((resolve) => (releaseSend = resolve));
const acknowledgementGate = new Promise((resolve) => (releaseAcknowledgement = resolve));
const creationStarted = new Promise((resolve) => (notifyCreate = resolve));
const dispatchStarted = new Promise((resolve) => (notifySend = resolve));
let createCalls = 0,
  sendCalls = 0;
try {
  await page.route("**/api/chats", async (route) => {
    createCalls++;
    notifyCreate();
    await createGate;
    await route.continue();
  });
  await page.route("**/api/send", async (route) => {
    sendCalls++;
    notifySend();
    await sendGate;
    const response = await route.fetch();
    await acknowledgementGate;
    await route.fulfill({ response });
  });
  await page.goto(f.url);
  const box = page.getByRole("textbox", { name: "Message", exact: true });
  await page.locator('input[type="file"]').setInputFiles({
    name: "brief.txt", mimeType: "text/plain", buffer: Buffer.from("Attached brief"),
  });
  await box.fill("Show this immediately while the new chat opens");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .locator(".pending-message")
    .getByText("Show this immediately while the new chat opens", {
      exact: true,
    })
    .waitFor({ timeout: 1000 });
  // Showing the preview does not depend on draft flushing reaching HTTP yet.
  await creationStarted;
  assert.equal(createCalls, 1);
  assert.equal(sendCalls, 0);
  assert.equal(await page.locator('.pending-message').getByText('brief.txt', { exact: true }).count(), 1);
  assert.equal(await page.locator(".chat-loading-stage").count(), 0);
  await page.screenshot({
    path: "artifacts/send-pending.png",
    animations: "disabled",
  });
  releaseCreate();
  await dispatchStarted;
  // Creation completes but native dispatch stays held. No empty/loading flash.
  assert.equal(await page.locator(".pending-message").count(), 1);
  releaseSend();
  // Native events can win the race with the send response. Keep the real
  // transcript mounted instead of flashing the full-screen loading stage.
  await page.locator('.message.user:not(.pending-message)').getByText(
    'Show this immediately while the new chat opens', { exact: true },
  ).waitFor();
  assert.equal(await page.locator('.chat-loading-stage').count(), 0);
  releaseAcknowledgement();
  await page.waitForFunction(() => !document.querySelector(".pending-message"));
  assert.equal(
    await page
      .locator(".message.user")
      .filter({ hasText: "Show this immediately while the new chat opens" })
      .count(),
    1,
  );
  assert.equal(createCalls, 1);
  assert.equal(sendCalls, 1);
  // Failed delivery preserves the draft, identifies uncertainty, and is scoped to this chat.
  for (const key of Object.keys(f.state.status)) delete f.state.status[key];
  const user =
    f.state.messages[
      Object.keys(f.state.messages).find((key) => key.startsWith("ses_created"))
    ]?.[0];
  const id = Object.keys(f.state.messages).find((key) =>
    key.startsWith("ses_created"),
  );
  f.state.messages[id].push({
    info: {
      id: "done",
      role: "assistant",
      parentID: user.info.id,
      finish: "stop",
      time: { completed: Date.now() },
    },
    parts: [{ type: "text", text: "Ready for a follow-up" }],
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("Ready for a follow-up", { exact: true }).waitFor();
  await page.unroute("**/api/send");
  await page.route("**/api/send", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Delivery fixture unavailable" }),
    }),
  );
  await box.fill("Preserve this draft on failure");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText(
      "Delivery unconfirmed · Check the conversation before sending again.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await box.inputValue(), "Preserve this draft on failure");
  const nav = page.locator(".chat-navigation");
  const trigger = nav.getByRole("button", { name: "Chats", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  await nav
    .locator(".nav-chat-select")
    .filter({ hasText: "Important conversation" })
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".chat-loading-stage"),
  );
  assert.equal(await page.locator(".pending-message").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS immediate send feedback before session creation and dispatch; one native bubble after acknowledgement; failed draft and navigation isolation",
  );
} finally {
  releaseCreate();
  releaseSend();
  releaseAcknowledgement();
  await browser.close();
  await f.close();
}
