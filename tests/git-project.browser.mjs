import assert from "node:assert/strict";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { gitProjectFixture } from "./fixtures/git-project-app.mjs";
import { test, expect } from './support/browser-test.mjs';

test('git-project', { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  // Real HTTP and Git, simulated native transport.

  const fixture = await own(gitProjectFixture());

  const page = await browser.newPage({ viewport: { width: 1365, height: 960 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const offline = process.env.PANEL_OFFLINE === "1";
  let releaseInspection, releaseInitialize;
  if (offline) {
    await page.exposeBinding("testFetch", async (_, route, options) => {
      const response = await fetch(fixture.url + route, options);
      return { status: response.status, body: await response.text() };
    });
    await page.addInitScript(() => {
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
        const result = await window.testFetch(String(route), {
          method: options.method,
          headers: options.headers,
          body: options.body,
        });
        return new Response(result.body, {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      };
    });
  }
  async function load() {
    if (!offline) return page.goto(fixture.url);
    await page.goto("about:blank");
    const html = await (await fetch(fixture.url)).text();
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
          files.find((f) => f.endsWith(".css")),
          assets,
        ),
        "utf8",
      ),
    });
    await page.addScriptTag({
      type: "module",
      content: await readFile(
        new URL(
          files.find((f) => f.endsWith(".js")),
          assets,
        ),
        "utf8",
      ),
    });
  }
  try {
    await load();
    await page.getByRole("button", { name: "Project settings", exact: true }).click();
    await page.getByRole("button", { name: "GitHub", exact: true }).click();
    await page
      .getByRole("heading", { name: "GitHub", exact: true })
      .waitFor();
    // This fixture explicitly has no GitHub CLI or authenticated account.
    // Verify the local-only path, not a connection it cannot establish.
    await page.getByText("Not signed in", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Install GitHub CLI", exact: true }).waitFor();
    assert.equal((await fixture.app.gitProjects.inspect(fixture.project.id)).auth.connected, false);
    await page.getByLabel("Name on checkpoints").fill("Browser Tester");
    await page.getByLabel("Email on checkpoints").fill("browser@example.invalid");
    await page
      .getByRole("button", { name: "Turn on project history", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await page.getByLabel("Name on checkpoints").inputValue(),
      "Browser Tester",
    );
    let oldReadReady = false, initialized = false, oldResponse;
    if (!offline) {
      // Hold a real background read across setup, then deliver its stale failure.
      // A successful mutation must invalidate it, not show a false repair warning.
      const readGate = new Promise(resolve => { releaseInspection = resolve; });
      const initGate = new Promise(resolve => { releaseInitialize = resolve; });
      let holdRead = true;
      await page.route('**/api/git?**', async route => {
        if (!holdRead) return route.continue();
        holdRead = false;
        const response = await route.fetch();
        oldReadReady = true;
        await readGate;
        await route.fulfill({ response, json: { ...await response.json(), issue: 'Outdated inspection must not replace setup' } });
      });
      await expect.poll(() => oldReadReady, { message: 'Capture a background Git inspection' }).toBe(true);
      oldResponse = page.waitForResponse(response => response.url().includes('/api/git?'));
      await page.route('**/api/git/initialize', async route => {
        const response = await route.fetch();
        initialized = true;
        await initGate;
        await route.fulfill({ response });
      });
    }
    await page
      .getByRole("button", { name: "Turn on project history", exact: true })
      .click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    if (!offline) {
      await expect.poll(() => initialized, { message: 'Real Git initialization completes' }).toBe(true);
      releaseInspection();
      await (await oldResponse).finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.getByText('Outdated inspection must not replace setup')).toHaveCount(0);
      releaseInitialize();
    }
    await page
      .getByRole("button", { name: "Edit local history", exact: true })
      .waitFor();
    await expect(page.locator('.git-local-identity')).toContainText('Browser Tester');
    await expect(page.locator('.git-local-identity')).toContainText('browser@example.invalid');
    await page.getByRole('button', { name: 'Edit local history', exact: true }).click();
    await page.getByLabel('Name on checkpoints').fill('Updated Browser Tester');
    await page.getByRole('button', { name: 'Save checkpoint identity', exact: true }).click();
    await expect(page.locator('.git-local-identity')).toContainText('Updated Browser Tester');
    assert.equal((await fixture.app.gitProjects.inspect(fixture.project.id)).local.identity.name, 'Updated Browser Tester');
    const localCard = page.locator('.git-setup-card').filter({ has: page.getByRole('heading', { name: 'Local history', exact: true }) });
    const helpBox = await localCard.locator('.card-help').boundingBox(), cardBox = await localCard.boundingBox();
    assert.ok(helpBox.x + helpBox.width > cardBox.x + cardBox.width - 40, 'Help aligns with the card right edge');
    assert.equal(await localCard.locator('h2 .help-hint').count(), 0);
    await page.getByRole('button', { name: 'Refresh Git status', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh Git status', exact: true })).toBeEnabled();
    await expect(page.locator('.git-project-page .notice.error')).toHaveCount(0);
    await page.getByLabel("Select eligible changed files").check();
    await page
      .getByRole("button", { name: "Save checkpoint", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    assert.match(
      await page.getByRole("dialog").textContent(),
      /This computer only/,
    );
    // Real Git can outlast a UI transition. Bound transport separately, then
    // require the dialog to close promptly after the operation completes.
    const checkpointResponse = offline ? undefined : page.waitForResponse(
      response => response.url().endsWith('/api/git/execute') && response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await page
      .getByRole("button", { name: "Approve this action", exact: true })
      .click();
    if (checkpointResponse) {
      const response = await checkpointResponse;
      assert.equal(response.ok(), true, 'Checkpoint request completed successfully');
      await response.finished();
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    assert.ok(
      (await fixture.app.gitProjects.inspect(fixture.project.id)).local.head,
    );
    await page.getByRole("radio", { name: /Keep each task separate/ }).check();
    const agreementResponse = offline ? undefined : page.waitForResponse(
      response => response.url().endsWith('/api/git/policy') && response.request().method() === 'PUT',
      { timeout: 30_000 },
    );
    await page
      .getByRole("button", { name: "Save agreement", exact: true })
      .click();
    if (agreementResponse) {
      const response = await agreementResponse;
      assert.equal(response.ok(), true, 'Agreement save completed successfully');
      await response.finished();
    }
    await expect(page.getByRole('button', { name: 'Save agreement', exact: true })).toBeEnabled();
    await page.locator('.git-agreement > .card-help').getByRole('button').focus();
    await page.getByRole('combobox', { name: 'Help topic' }).selectOption('git-explicit-request');
    await expect(page.getByRole('dialog', { name: 'Card help' })).toContainText('You can explicitly request a different Git action in chat and confirm it there.');
    await expect(page.getByRole('dialog', { name: 'Card help' })).toContainText('A one-time request leaves the saved defaults unchanged.');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Ask in chat', exact: true })).toBeVisible();
    assert.equal(
      (await fixture.app.gitProjects.policy(fixture.project.id)).preset,
      "branch",
    );
    await mkdir("artifacts/git-project", { recursive: true });
    await page.locator(".git-project-page").evaluate((e) => {
      e.scrollTop = 0;
    });
    await page.screenshot({
      path: "artifacts/git-project/desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 600, height: 850 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: "artifacts/git-project/narrow.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Edit local history", exact: true }).click();
    await page
      .getByRole("button", { name: "Stop tracking automation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Turn on project history", exact: true })
      .waitFor({ timeout: 30000 });
    assert.ok(
      (await fixture.app.gitProjects.inspect(fixture.project.id)).local.head,
      "disabling keeps history",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS GitHub navigation, setup/cancel, real checkpoint, agreement persistence, narrow layout, tracking-off preserves history",
    );
  } finally {
    releaseInspection?.(); releaseInitialize?.();
    await browser.close();
    await fixture.close();
  }
});
