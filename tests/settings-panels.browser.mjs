import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { localDataFixture } from "./fixtures/local-data-app.mjs";
import { test, expect } from "./support/browser-test.mjs";

test('settings headings, provider controls and empty states fit compact screens', { tag: ['@app'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ gitOptions: {
    resolveExecutable: async () => { throw Error('Tools unavailable in presentation fixture'); },
    runner: async () => { throw Error('Unexpected external Git command'); },
  } }));
  const page = await appBrowser.newPage({ viewport: { width: 320, height: 740 } });
  try {
    await page.goto(fixture.url);
    for (const width of [320, 760]) {
      await page.setViewportSize({ width, height: 740 });
      for (const [scope, title] of [
        ['Application settings', 'Providers'], ['Application settings', 'Content & Storage'],
        ['Application settings', 'Conversation history'], ['Project settings', 'Session defaults'],
        ['Project settings', 'GitHub'],
      ]) {
        await test.step(`${width}px ${title}`, async () => {
          const trigger = page.getByRole('button', { name: scope, exact: true });
          if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
          await page.locator('.settings-drawer-links:not([hidden])').getByRole('button', { name: title, exact: true }).click();
          await expect(page.locator('.page-title').getByRole('heading', { name: title, exact: true })).toBeVisible();
          if (title === 'GitHub') await expect(page.getByRole('heading', { name: 'Local history', exact: true })).toBeVisible();
          const overflow = await page.locator('.page, .page-title, .provider-card, .empty').evaluateAll(nodes => nodes.filter(node => node.clientWidth && node.scrollWidth > node.clientWidth + 1).map(node => ({ className: node.className, width: node.clientWidth, content: node.scrollWidth })));
          assert.deepEqual(overflow, [], `${title} has no clipped horizontal content at ${width}px`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        });
      }
    }
  } finally { await appBrowser.close(); }
});

test("settings panels share framing, aligned forms, help placement and clickable directory paths", { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  let gitCommands = 0;
  // Layout must not depend on installed tools, a runner's sign-in, or network.
  // Real Git behavior remains covered by git-project.browser.mjs and contracts.
  const fixture = await own(localDataFixture({ persistPreferences: true, gitOptions: {
    resolveExecutable: async () => { throw Error("Tools unavailable in presentation fixture"); },
    runner: async () => { gitCommands++; throw Error("Unexpected external Git command"); },
  } }));
  await mkdir(path.join(fixture.project.directory, "docs", "nested"), { recursive: true });
  await writeFile(path.join(fixture.project.directory, "docs", "nested", "guide.txt"), "Nested guide");
  const nativeRequest = fixture.host.request.bind(fixture.host);
  fixture.host.request = async (route, options) => {
    const url = new URL(route, "http://native");
    if (url.pathname === "/file") {
      const folder = url.searchParams.get("path");
      return folder === "" ? [{ name: "docs", path: "docs", type: "directory" }]
        : folder === "docs" ? [{ name: "nested", path: "docs/nested", type: "directory" }]
        : [{ name: "guide.txt", path: "docs/nested/guide.txt", type: "file" }];
    }
    if (url.pathname === "/file/content") return { content: "Nested guide", type: "text" };
    return nativeRequest(route, options);
  };
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(15000);

  const select = async (scope, item) => {
    const trigger = page.getByRole("button", { name: scope, exact: true });
    if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
    await page.locator(".settings-drawer-links:not([hidden])").getByRole("button", { name: item, exact: true }).click();
  };
  const inspectPanel = async (title, scope, item, help = true, closeLabel = "Close settings") => {
    await select(scope, item);
    const heading = page.locator(".page-title");
    await expect(heading.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(heading.locator(".page-title-icon svg")).toBeVisible();
    await expect(heading.getByRole("button", { name: closeLabel, exact: true })).toBeVisible();
    await expect(heading.locator(".help-hint-trigger")).toHaveCount(0);
    if (help) await expect(page.locator(".page-help .help-hint-trigger")).toBeVisible();
    expect(await page.locator('.panel').evaluateAll(cards => cards.every(card =>
      card.querySelectorAll(':scope > .card-help .help-hint-trigger').length <= 1))).toBe(true);
    const helpNames = await page.locator(".help-hint-trigger").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
    assert.equal(helpNames.length, new Set(helpNames).size, `${title} help buttons have distinct accessible names`);
    const frame = await page.locator(".page").boundingBox();
    assert.ok(frame && frame.width > 900 && frame.x >= 0, `${title} uses the shared full-width page frame`);
    assert.equal(await page.getByRole("button", { name: "More actions", exact: true }).count(), 0);
  };

  try {
    await page.goto(fixture.url);
    const chats = page.locator(".chat-navigation");
    const chatsTrigger = chats.getByRole("button", { name: "Chats", exact: true });
    if (await chatsTrigger.getAttribute("aria-expanded") !== "true") await chatsTrigger.click();
    const manageChat = chats.getByRole("button", { name: "Manage Important conversation", exact: true });
    await manageChat.click();
    await page.getByRole("textbox", { name: "Chat name", exact: true }).fill("Renamed from navigation");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(chats.getByRole("button", { name: "Manage Renamed from navigation", exact: true })).toBeVisible();
    await chats.getByRole("button", { name: "Manage Renamed from navigation", exact: true }).click();
    await page.getByRole("textbox", { name: "Chat name", exact: true }).fill("Important conversation");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(chats.getByRole("button", { name: "Manage Important conversation", exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Project settings', exact: true }).click();
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(page.getByRole("heading", { name: "Files", exact: true })).toBeVisible();
    await page.locator(".file-row").filter({ hasText: "docs" }).click();
    await page.locator(".file-row").filter({ hasText: "nested" }).click();
    await page.locator(".file-row").filter({ hasText: "guide.txt" }).click();
    await expect(page.locator(".file-preview")).toHaveText("Nested guide");
    await expect(page.locator('.files-location')).toHaveText('docs/nested/guide.txt');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('.file-row')).toContainText('docs');

    await inspectPanel("Session defaults", "Project settings", "Session defaults");
    await inspectPanel("Delegation", "Project settings", "Delegation");
    const delegation = page.getByRole('combobox', { name: 'Delegation', exact: true });
    await expect(delegation.locator('option')).toHaveText(['Agent decides', 'Encourage delegation', 'No delegation']);
    await delegation.selectOption({ label: 'Encourage delegation' });
    await page.getByRole('button', { name: 'Save delegation budget', exact: true }).click();
    await expect(page.getByText('Delegation budget saved.', { exact: true })).toBeVisible();
    assert.equal((await fixture.app.readPreferences(fixture.project.id)).defaults.delegation, 'encouraged');
    const delegationFields = page.locator(".delegation-settings .field-grid .field");
    await expect(delegationFields).toHaveCount(4);
    const fieldRects = await delegationFields.evaluateAll(fields => fields.map(field => {
      const rect = field.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width };
    }));
    assert.equal(fieldRects.length, 4);
    assert.ok(Math.abs(fieldRects[0].y - fieldRects[1].y) < 2, "first settings row aligns at the top");
    assert.ok(Math.abs(fieldRects[2].y - fieldRects[3].y) < 2, "second settings row aligns at the top");
    assert.ok(Math.abs(fieldRects[0].width - fieldRects[1].width) < 2, "settings columns share a width");

    await inspectPanel("Agents", "Application settings", "Agents");
    await page.screenshot({ path: "artifacts/settings-panels/agents.png", fullPage: false });
    await inspectPanel("GitHub", "Project settings", "GitHub", false);
    // The persistent heading alone is not evidence that status loaded.
    await expect(page.getByRole("heading", { name: "Local history", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cloud sync", exact: true })).toBeVisible();
    assert.equal(gitCommands, 0, "layout inspection never invokes machine Git/GitHub tools");
    await page.screenshot({ path: "artifacts/settings-panels/github.png", fullPage: false });
    await inspectPanel("Providers", "Application settings", "Providers");
    await page.screenshot({ path: "artifacts/settings-panels/providers.png", fullPage: false });
    await inspectPanel("Appearance", "Application settings", "Appearance", false);
    await inspectPanel("Scheduled prompts", "Application settings", "Scheduled prompts");
    await page.getByRole("button", { name: "New schedule", exact: true }).click();
    const agentModel = await page.locator(".schedule-fields").first().locator(".field").evaluateAll(fields => fields.map(field => {
      const rect = field.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width };
    }));
    assert.equal(agentModel.length, 2);
    assert.ok(Math.abs(agentModel[0].y - agentModel[1].y) < 2, "schedule agent and model fields share a row");
    assert.ok(Math.abs(agentModel[0].width - agentModel[1].width) < 2, "schedule agent and model fields share a width");
    await page.getByRole("button", { name: "Close settings", exact: true }).click();

    await inspectPanel("Remote access", "Application settings", "Remote access");
    await inspectPanel("Search all content", "Application settings", "Search all content");
    await inspectPanel("Content & Storage", "Application settings", "Content & Storage");
    await inspectPanel("Git defaults", "Application settings", "Git defaults");
    await page.getByRole("radio", { name: /Work directly on the main version/ }).check();
    await page.getByRole("button", { name: "Save default", exact: true }).click();
    await expect(page.getByText("Default saved for new projects.")).toBeVisible();
    assert.equal((await fixture.store.read("settings")).gitDefaults.preset, "main");
    await inspectPanel("Conversation history", "Application settings", "Conversation history", false, "Close history");
    await inspectPanel("Models", "Application settings", "Models");
    await inspectPanel("Available Usage", "Application settings", "Available Usage", false);

    await page.screenshot({ path: "artifacts/settings-panels/panels.png", fullPage: false });
    console.log("PASS consistent page headers, close controls, contextual help, field grids, history navigation and directory breadcrumbs");
  } finally {
    await browser.close();
  }
});
