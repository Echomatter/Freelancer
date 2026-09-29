import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localDataFixture } from "./fixtures/local-data-app.mjs";
import { test, expect } from './support/browser-test.mjs';

test('scheduled-prompts', { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  // Production UI + real scheduler HTTP/persistence. Native transport is stubbed;
  // the timer dispatches to a fixture chat without provider inference.

  const fixture = await own(localDataFixture());
  await fixture.store.update("settings", s => ({ ...s, appearance: { ...s.appearance, theme: "light" } }));

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  async function openSettings() {
    const drawer = page.getByRole("button", { name: "Application settings", exact: true });
    if (await drawer.getAttribute("aria-expanded") !== "true") await drawer.click();
    await page.getByRole("button", { name: "Scheduled prompts", exact: true }).click();
    await page.getByRole("heading", { name: "Scheduled prompts", exact: true }).waitFor();
  }
  const saved = () => page.getByText("Schedule saved.", { exact: true }).waitFor();
  try {
    await page.goto(fixture.url);
    await openSettings();
    await page.getByRole("heading", { name: "No scheduled prompts" }).waitFor();
    await page.getByRole("button", { name: "New schedule", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Workflow", exact: true })).toHaveCount(0);
    await page.getByLabel("Name", { exact: true }).fill("Morning project review");
    await page.getByLabel("Prompt", { exact: true }).fill("Review the recent changes and summarize any follow-ups.");
    await page.getByLabel("Model", { exact: true }).selectOption("opencode/free");
    await page.getByLabel("Repeat", { exact: true }).selectOption("daily");
    await page.getByRole("button", { name: "Save schedule", exact: true }).click();
    await saved();
    const card = page.getByRole("region", { name: "Morning project review", exact: true });
    await card.waitFor();
    assert.match(await card.innerText(), /Every 24 hours/);
    await expect(card.getByText("Engineer", { exact: true })).toBeVisible();
    assert.doesNotMatch(await card.innerText(), /Engineer · Build/);
    await card.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByText("Schedule paused.", { exact: true }).waitFor();
    await page.reload();
    await openSettings();
    await card.getByText("Paused", { exact: true }).waitFor();
    await card.getByRole("button", { name: "Resume", exact: true }).click();
    await page.getByText("Schedule resumed.", { exact: true }).waitFor();
    await card.getByText("Enabled", { exact: true }).waitFor();
    console.log("PASS create, persist across reload, pause and resume through real scheduler HTTP");

    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Prompt", { exact: true }).fill("Keep this edit when saving fails.");
    await page.route("**/api/schedules", route => route.request().method() === "PUT"
      ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Fixture save rejected" }) }) : route.continue());
    await page.getByRole("button", { name: "Save schedule", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Fixture save rejected" }).waitFor();
    assert.equal(await page.getByLabel("Prompt", { exact: true }).inputValue(), "Keep this edit when saving fails.");
    await page.unroute("**/api/schedules");
    await page.getByRole("button", { name: "Save schedule", exact: true }).click();
    await saved();
    assert.match(await card.innerText(), /Keep this edit when saving fails/);
    console.log("PASS failed save preserves editor and can be retried");

    await mkdir("artifacts/scheduled-prompts", { recursive: true });
    await page.screenshot({ path: "artifacts/scheduled-prompts/desktop.png", fullPage: true });
    await page.setViewportSize({ width: 640, height: 900 });
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: "artifacts/scheduled-prompts/compact-editor.png", fullPage: true });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await card.getByRole("button", { name: "Delete Morning project review", exact: true }).click();
    await card.getByRole("button", { name: "Keep", exact: true }).click();
    await card.getByRole("button", { name: "Delete Morning project review", exact: true }).click();
    await card.getByRole("button", { name: "Delete schedule", exact: true }).click();
    await page.getByRole("heading", { name: "No scheduled prompts" }).waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await fixture.api("schedules", { title: "Scheduled native dispatch", prompt: "Summarize this project.",
      project: fixture.project.id, agent: "engineer", model: "opencode/free",
      frequency: "once", firstRunAt: new Date(Date.now() + 1500).toISOString(), enabled: true });
    const runCard = page.getByRole("region", { name: "Scheduled native dispatch", exact: true });
    await runCard.getByRole("button", { name: "Open run", exact: true }).click();
    await page.locator(".message.user").getByText("Summarize this project.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Scheduled prompts", exact: true }).count(), 0);
    assert.equal(fixture.calls.filter(call => call.route.endsWith("/prompt_async")).length, 1);
    console.log("PASS server timer creates a native fixture chat, sends once, and Open run navigates to it");
    assert.deepEqual(errors, []);
    console.log("PASS compact layout and explicit delete confirmation; no browser errors");
  } finally {
    await browser.close();
    await fixture.close();
  }
});
