import { defaults } from '../shared/strategy.mjs';
import { checkedCatalog } from '../backend/tools/runtime/agent-catalog.mjs';
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

await f.store.recordRequest({ id: 'busy_user', sessionID: 'ses_history', projectID: f.project.id, status: 'accepted', policyVersion: 6, agent: checkedCatalog(await f.store.read('settings')).agents[0], catalog: checkedCatalog(await f.store.read('settings')), model: { providerID: 'opencode', modelID: 'free' }, preferences: defaults });
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
    await page.getByRole("button", { name: "Choose Delegate, Queue, or Steer", exact: true }).click();
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
    await page.getByText("Queue · Saved for delivery", { exact: true }).waitFor();
    assert.equal(await box.inputValue(), "Newer typing must stay visible");
    const pendingCard = page.locator('.work-card').filter({ hasText: 'Queue · Saved for delivery' });
    await pendingCard.locator('.work-card-toggle').click();
    await pendingCard.getByRole('button', { name: 'Edit pending message' }).click();
    const pendingEditor = page.getByRole('dialog', { name: 'Edit pending message' });
    await pendingEditor.getByRole('textbox', { name: 'Pending message' }).fill('Edited queued concern');
    await pendingEditor.getByRole('button', { name: 'Save message' }).click();
    await expect(pendingEditor).not.toBeVisible();
    await expect(pendingCard).toContainText('Edited queued concern');
    assert.equal(await box.inputValue(), 'Newer typing must stay visible');

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
    await page.getByRole('button', { name: 'Choose Delegate, Queue, or Steer', exact: true }).click();
    await page.getByRole('button', { name: /^Queue/ }).click();
    await page.getByRole('dialog').getByText(/Delivery unconfirmed/).waitFor();
    assert.equal(await box.inputValue(), 'Retry this delivery once');
    await page.getByRole('dialog').getByRole('button', { name: /^Queue/ }).click();
    await page.waitForFunction(() => document.querySelector('.composer textarea')?.value === '');
    assert.equal(retryIDs.length, 2);
    assert.equal(retryIDs[0], retryIDs[1]);
    await page.unroute('**/api/sender');
    f.state.messages.ses_history.push({ info: { id: 'retry-parent-reply', role: 'assistant', parentID: 'retry-parent', finish: 'stop', time: { completed: Date.now() } }, parts: [{ type: 'text', text: 'The current response finished.' }] });
    f.state.status.ses_history = { type: 'idle' };
    const queuedCard = page.locator('.handoff-card').filter({ hasText: 'Retry this delivery once' });
    await queuedCard.waitFor();
    await expect(queuedCard.locator('summary')).toContainText('Queued request');
    await expect(page.locator('.composer-cards .work-card').filter({ hasText: 'Queue ·' })).toHaveCount(0);
    await box.fill('Steer toward the concrete fix');
    await page.getByRole('button', { name: 'Choose Delegate, Queue, or Steer', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Steer/ }).click();
    await page.waitForFunction(() => document.querySelector('.composer textarea')?.value === '');
    // Assert native transport eventually receives the message, not just a stop.
    const steerCard = page.locator('.handoff-card').filter({ hasText: 'Steer toward the concrete fix' });
    await steerCard.waitFor();
    await expect(steerCard.locator('summary')).toContainText('Steer request');
    await expect(steerCard).not.toContainText('Adjust the ongoing work at the next supported boundary');
    await expect(page.locator('.composer-cards .work-card').filter({ hasText: 'Steer ·' })).toHaveCount(0);
    assert.equal(f.state.messages.ses_history.filter(message => message.parts?.some(part => part.text?.includes('Steer toward the concrete fix'))).length, 1);

    await box.fill('Delegate just this focused analysis');
    await page.getByRole('button', { name: 'Choose Delegate, Queue, or Steer', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^Delegate/ }).click();
    await page.waitForFunction(() => document.querySelector('.composer textarea')?.value === '');
    const delegateCard = page.locator('.handoff-card').filter({ hasText: 'Delegate just this focused analysis' });
    await delegateCard.waitFor();
    await expect(delegateCard.locator('summary')).toContainText('Delegate request');
    await expect(delegateCard).not.toContainText('The user submitted a bounded concern');
    await expect(page.locator('.composer-cards .work-card').filter({ hasText: 'Delegate ·' })).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log("PASS immediate Queue/Steer feedback, duplicate guard, and newer draft preservation");
  } finally {
    releaseSender();
    releaseStop();
    await browser.close();
    await f.close();
  }
});
