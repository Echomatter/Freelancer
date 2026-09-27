import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { localDataFixture } from "./fixtures/local-data-app.mjs";
import { test, expect } from './support/browser-test.mjs';

test('sidebar-layout', { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  // Verifies sidebar flex geometry in the production browser bundle.

  const f = await own(localDataFixture());
  for (let i = 0; i < 36; i++) {
    f.state.sessions.push({
      id: `ses_sidebar_${i}`,
      title: `Sidebar layout conversation ${String(i + 1).padStart(2, "0")}`,
      directory: f.directory,
      time: { created: 500 + i, updated: 500 + i },
    });
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 520 } });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(f.url);
    await page.getByRole('button', { name: 'History project', exact: true }).waitFor();
    const cards = page.locator('.nav-card-trigger');
    await expect(cards).toHaveCount(4);
    const cardGeometry = await cards.evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el), icon = el.querySelector('.nav-card-icon');
      return { width: box.width, height: box.height, left: box.left, border: style.border, radius: style.borderRadius,
        iconColor: getComputedStyle(icon).color, iconWidth: icon.getBoundingClientRect().width };
    }));
    assert.ok(cardGeometry.every(card => JSON.stringify(card) === JSON.stringify(cardGeometry[0])), 'all four collapsed cards have matching size, outline and colored icons');
    assert.ok(cardGeometry[0].height <= 42, 'desktop navigation headers stay slim');
    await mkdir('artifacts/sidebar-layout', { recursive: true });
    await page.screenshot({ path: 'artifacts/sidebar-layout/collapsed-dark.png' });
    await page.getByRole('button', { name: 'History project', exact: true }).click();
    const projectGear = page.getByRole('button', { name: 'Manage History project', exact: true });
    assert.equal(await projectGear.innerText(), '', 'management is an icon button with an accessible name');
    await projectGear.click();
    await expect(page.getByRole('dialog', { name: 'Manage project', exact: true })).toBeVisible();
    await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('History project');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    const width = async () =>
      Math.round(await page.locator(".sidebar").evaluate((el) => el.getBoundingClientRect().width));
    const chat = page.locator(".chat-navigation");
    await chat.getByRole("button", { name: "Chats", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".nav-chat-row").length > 20);
    const chatGear = chat.locator('.nav-chat-manage-trigger').first();
    assert.equal(await chatGear.innerText(), '');
    await chatGear.click();
    await expect(chat.getByRole('button', { name: 'Continue in new chat', exact: true })).toBeVisible();
    await chat.getByRole('button', { name: 'Export', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(chatGear).toBeFocused();
    await expect(chat.locator('.nav-chat-menu')).toHaveCount(0);

    const list = chat.locator(".nav-chat-list");
    const listBox = await list.boundingBox();
    const settingsBox = await page.locator(".settings-drawers").boundingBox();
    assert.ok(listBox && settingsBox, "chat list and settings drawers render");
    assert.ok(
      Math.abs(listBox.y + listBox.height - settingsBox.y) <= 2,
      "expanded chat list fills to the settings divider",
    );
    const scroll = await list.evaluate((el) => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
      overflow: getComputedStyle(el).overflowY,
    }));
    assert.ok(scroll.scroll > scroll.client, "chat rows scroll inside the list");
    assert.match(scroll.overflow, /auto|scroll/, "chat list owns vertical overflow");
    assert.equal(await page.locator(".sidebar").evaluate((el) => getComputedStyle(el).overflowY), "hidden");

    const before = await width();
    await mkdir('artifacts/sidebar-layout', { recursive: true });
    await page.screenshot({ path: 'artifacts/sidebar-layout/desktop.png' });
    await page.locator(".usage-disclosure").click();
    await page.getByRole("button", { name: "Open Available Usage", exact: true }).waitFor();
    assert.equal(await width(), before, "expanded usage does not change sidebar width");
    await page.getByRole("button", { name: "Application settings", exact: true }).click();
    await page.getByRole("button", { name: "Providers", exact: true }).waitFor();
    const colors = await page.locator('#application-settings-links').evaluate(el => ({
      line: getComputedStyle(el).borderLeftColor,
      outline: getComputedStyle(el.parentElement.querySelector('.nav-card-icon')).borderTopColor,
      child: getComputedStyle(el.querySelector('button')).color,
    }));
    assert.equal(colors.line, colors.outline, 'expanded hierarchy line follows the colored icon outline');
    assert.notEqual(colors.child, colors.outline, 'child settings icons retain their neutral hierarchy');
    assert.ok(await page.getByRole("button", { name: "Providers", exact: true }).isVisible(), "lower settings remain reachable");
    await page.screenshot({ path: 'artifacts/sidebar-layout/expanded-short.png' });

    await page.setViewportSize({ width: 680, height: 520 });
    await page.waitForFunction(() => Math.round(document.querySelector(".sidebar").getBoundingClientRect().width) === 68);
    const compactBefore = await width();
    if ((await page.locator(".usage-disclosure").getAttribute("aria-expanded")) !== "true") {
      await page.locator(".usage-disclosure").click();
    }
    await page.locator(".usage-breakout:not([hidden])").waitFor();
    assert.equal(await width(), compactBefore, "compact usage breakout does not widen the rail");
    assert.equal(await page.locator('.workspace').evaluate(el => el.scrollTop), 0, 'lower controls do not scroll the entire workspace');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'compact rail remains anchored to the viewport');
    await page.locator('.usage-disclosure').click();
    await expect(chat.getByRole('button', { name: 'Chats', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await chat.getByRole('button', { name: 'Chats', exact: true }).click();
    const compactList = chat.locator('.nav-chat-list');
    assert.ok(await compactList.evaluate(el => el.clientHeight <= window.innerHeight * .48 + 1), 'compact chat flyout stays bounded');
    await page.screenshot({ path: 'artifacts/sidebar-layout/compact.png' });
    await compactList.locator('.nav-chat-select').first().click();
    await expect(compactList).toHaveCount(0);
    assert.equal(await width(), compactBefore, 'compact chat selection is not clipped by the rail');

    await page.setViewportSize({ width: 1440, height: 900 });
    await f.app.saveAppearance({ theme: 'light' });
    await page.reload();
    await page.getByRole('button', { name: 'History project', exact: true }).waitFor();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: 'artifacts/sidebar-layout/collapsed-light.png' });

    assert.deepEqual(errors, []);
    console.log("PASS sidebar chat list fills remaining height and usage expansion preserves width");
  } finally {
    await browser.close();
    await f.close();
  }
});
