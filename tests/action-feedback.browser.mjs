import assert from "node:assert/strict";
import { localDataFixture } from "./fixtures/local-data-app.mjs";
import { test, expect } from './support/browser-test.mjs';

test('action-feedback', { tag: ["@app","@chat"] }, async ({ appBrowser: browser, own }) => {
  const f = await own(localDataFixture());
  f.state.messages.ses_history = [
    {
      info: {
        id: "busy_user",
        role: "user",
        model: { providerID: "opencode", modelID: "free" },
        time: { created: Date.now() },
      },
      parts: [{ type: "text", text: "Original running request" }],
    },
  ];
  f.state.status.ses_history = { type: "busy" };

  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  // Plain HTTP phone origins do not expose crypto.randomUUID.
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined }));
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  let releaseSender, releaseStop, notifySender, notifyStop;
  const senderGate = new Promise((resolve) => (releaseSender = resolve));
  const stopGate = new Promise((resolve) => (releaseStop = resolve));
  const senderStarted = new Promise((resolve) => (notifySender = resolve));
  const stopStarted = new Promise((resolve) => (notifyStop = resolve));
  let senderCalls = 0;
  let stopCalls = 0;

  try {
    await page.route("**/api/sender", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      senderCalls++;
      notifySender();
      await senderGate;
      await route.continue();
    });
    await page.route("**/api/stop", async (route) => {
      stopCalls++;
      notifyStop();
      await stopGate;
      await route.continue();
    });

    await page.goto(f.url);
    const nav = page.locator(".chat-navigation");
    const trigger = nav.getByRole("button", { name: "Chats", exact: true });
    if ((await trigger.getAttribute("aria-expanded")) !== "true")
      await trigger.click();
    await page.locator(".nav-chat-select").filter({ hasText: "Important conversation" }).click();
    await page.getByText("Original running request", { exact: true }).waitFor();

    const box = page.getByRole("textbox", { name: "Message", exact: true });
    await box.fill("Queue this while the parent is still running");
    await page.getByRole("button", { name: "Choose Delegate, Queue, or Interrupt", exact: true }).click();
    await page.getByRole("button", { name: /^Queue/ }).click();
    await senderStarted;

    await page.getByText("Queue · Submitting…", { exact: true }).waitFor({ timeout: 1000 });
    await page.locator('.work-card-label').getByText("Queue this while the parent is still running", { exact: true }).waitFor({ timeout: 1000 });
    assert.equal(senderCalls, 1);
    assert.equal(await page.getByRole("button", { name: "Submitting message", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Submitting message", exact: true }).evaluate(el => el.click());
    assert.equal(senderCalls, 1);

    await box.fill("Newer typing must stay visible");
    releaseSender();
    await page.getByText("Queue · Waiting", { exact: true }).waitFor();
    assert.equal(await box.inputValue(), "Newer typing must stay visible");

    await box.fill("");
    await page.getByRole("button", { name: "Stop response", exact: true }).click();
    await stopStarted;
    assert.equal(await page.getByRole("button", { name: "Stopping response", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Stopping response", exact: true }).evaluate(el => el.click());
    assert.equal(stopCalls, 1);
    releaseStop();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Stopping response"]'));
    assert.equal(stopCalls, 1);

    // An accepted POST with a lost response must retry the same delivery, not
    // manufacture a second queued message from the still-visible draft.
    f.state.status.ses_history = { type: 'busy' };
    f.state.messages.ses_history.push({ info: { id: 'retry-parent', role: 'user',
      time: { created: Date.now() } }, parts: [{ type: 'text', text: 'Still working' }] });
    await page.reload();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
    await page.getByText('Still working', { exact: true }).waitFor();
    await page.unroute('**/api/sender');
    const retryIDs = [];
    await page.route('**/api/sender', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      retryIDs.push(route.request().postDataJSON().id);
      const response = await route.fetch();
      if (retryIDs.length === 1) await route.abort('failed');
      else await route.fulfill({ response });
    });
    await box.fill('Retry this delivery once');
    await page.getByRole('button', { name: 'Choose Delegate, Queue, or Interrupt', exact: true }).click();
    await page.getByRole('button', { name: /^Queue/ }).click();
    await page.getByRole('dialog').getByText(/Delivery unconfirmed/).waitFor();
    assert.equal(await box.inputValue(), 'Retry this delivery once');
    await page.getByRole('dialog').getByRole('button', { name: /^Queue/ }).click();
    await page.waitForFunction(() => document.querySelector('.composer textarea')?.value === '');
    assert.equal(retryIDs.length, 2);
    assert.equal(retryIDs[0], retryIDs[1]);
    await page.unroute('**/api/sender');
    await box.fill('Steer toward the concrete fix');
    await page.getByRole('button', { name: 'Choose Delegate, Queue, or Interrupt', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Interrupt/ }).click();
    await page.waitForFunction(() => document.querySelector('.composer textarea')?.value === '');
    // Assert native transport eventually receives the message, not just a stop.
    await page.locator('.message.user').filter({ hasText: 'Steer toward the concrete fix' }).waitFor();
    assert.equal(f.state.messages.ses_history.filter(message => message.parts?.some(part => part.text === 'Steer toward the concrete fix')).length, 1);
    assert.deepEqual(errors, []);
    console.log("PASS immediate Queue/Interrupt feedback, duplicate guard, and newer draft preservation");
  } finally {
    releaseSender();
    releaseStop();
    await browser.close();
    await f.close();
  }
});
