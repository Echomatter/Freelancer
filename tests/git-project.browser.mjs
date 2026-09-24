// npm run build && node tests/git-project.browser.mjs. No provider inference.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { gitProjectFixture } from "./fixtures/git-project-app.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const fixture = await gitProjectFixture();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1365, height: 960 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const offline = process.env.PANEL_OFFLINE === "1";
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
    .getByRole("heading", { name: "Project history & GitHub" })
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
  await page
    .getByRole("button", { name: "Turn on project history", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Stop tracking automation", exact: true })
    .waitFor();
  await page.getByLabel("Select eligible changed files").check();
  await page
    .getByRole("button", { name: "Save checkpoint", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  assert.match(
    await page.getByRole("dialog").textContent(),
    /This computer only/,
  );
  await page
    .getByRole("button", { name: "Approve this action", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector("dialog[open]"));
  assert.ok(
    (await fixture.app.gitProjects.inspect(fixture.project.id)).local.head,
  );
  await page.getByRole("radio", { name: /Keep each task separate/ }).check();
  await page
    .getByRole("button", { name: "Save agreement", exact: true })
    .click();
  for (
    let attempt = 0;
    attempt < 40 &&
    (await fixture.app.gitProjects.policy(fixture.project.id)).preset !==
      "branch";
    attempt++
  )
    await new Promise((r) => setTimeout(r, 50));
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
  await page
    .getByRole("button", { name: "Stop tracking automation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Turn on project history", exact: true })
    .waitFor();
  assert.ok(
    (await fixture.app.gitProjects.inspect(fixture.project.id)).local.head,
    "disabling keeps history",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS GitHub navigation, setup/cancel, real checkpoint, agreement persistence, narrow layout, tracking-off preserves history",
  );
} finally {
  await browser.close();
  await fixture.close();
}
