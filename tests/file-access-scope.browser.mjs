import assert from "node:assert/strict";
import { localDataFixture } from "./fixtures/local-data-app.mjs";
import { test, expect } from "./support/browser-test.mjs";

// File access persists through the existing PUT /api/appearance save call
// (top-level fileAccessScope in saved settings) and is composed into the
// existing Content & Storage application tab. Both journeys below exercise
// the real API; the failure journey only injects one rejected save to prove
// the draft survives and the same control retries.
async function openFileAccess(page) {
  const trigger = page.getByRole("button", { name: "Application settings", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await page.locator(".settings-drawer-links:not([hidden])").getByRole("button", { name: "Content & Storage", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Content & Storage", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "File access", exact: true })).toBeVisible();
}

test("file access scope saves a confirmed choice and persists it", { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  const fixture = await own(localDataFixture());
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  try {
    await page.goto(fixture.url);
    await openFileAccess(page);
    // Exact user-facing labels, defaulting to current capability-first behavior.
    await expect(page.getByRole("radio", { name: /Files in this project/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Files in all projects/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Files on my computer/ })).toBeChecked();
    await expect(page.getByText("every named agent", { exact: false })).toBeVisible();
    await expect(page.getByText("not a terminal or custom-tool filesystem sandbox", { exact: false })).toBeVisible();
    // Narrow viewport: no clipped horizontal content.
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.setViewportSize({ width: 1280, height: 850 });

    await page.getByRole("radio", { name: /Files in all projects/ }).check();
    await page.getByRole("button", { name: /Save file access/, exact: false }).click();
    await expect(page.getByText("File access saved.", { exact: true })).toBeVisible();
    assert.equal((await fixture.store.read("settings")).fileAccessScope, "projects");
    await page.reload();
    await openFileAccess(page);
    await expect(page.getByRole("radio", { name: /Files in all projects/ })).toBeChecked();
    console.log("PASS file access scope saves and persists the confirmed choice");
  } finally {
    await browser.close();
  }
});

test("file access failure preserves the draft and retries", { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  const fixture = await own(localDataFixture());
  const page = await browser.newPage({ viewport: { width: 320, height: 740 } });
  try {
    let saves = 0;
    await page.route("**/api/appearance", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      saves++;
      if (saves === 1) {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fixture save unavailable" }),
        });
      }
      return route.continue();
    });
    await page.goto(fixture.url);
    await openFileAccess(page);
    await page.getByRole("radio", { name: /Files in this project/ }).check();
    await page.getByRole("button", { name: /Save file access/, exact: false }).click();
    await expect(page.getByRole("alert")).toContainText("Fixture save unavailable");
    // The failed save preserves the draft for retry.
    await expect(page.getByRole("radio", { name: /Files in this project/ })).toBeChecked();
    await expect(page.getByRole("button", { name: /Retry save/ })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.getByRole("button", { name: /Retry save/ }).click();
    await expect(page.getByText("File access saved.", { exact: true })).toBeVisible();
    assert.equal((await fixture.store.read("settings")).fileAccessScope, "project");
    console.log("PASS file access failure preserves draft and retries");
  } finally {
    await browser.close();
  }
});
