import { browserPalettes, capturePalette, isRepresentativePalette, paletteArtifacts } from './support/palettes.mjs';
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { usageFixture } from "./fixtures/usage-app.mjs";
import { quotaFixture } from "./fixtures/usage-data.mjs";
import {
  checkCompoundMeter,
  checkCompoundContrast,
} from "./support/usage-meter.mjs";
import { palettes } from "../domain/theme.mjs";
import {
  providerTokens,
  providerDefaults,
} from "../domain/provider-colors.mjs";
import { contrast, colorChannels } from "../domain/color.mjs";
import { test, expect } from './support/browser-test.mjs';

test('usage', { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  // npm run build first. USAGE_OFFLINE=1 bridges real HTTP in restricted editing
  // sandboxes only; CI uses normal browser navigation and the application's CSP.

  const f = await own(usageFixture());

  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    hasTouch: true,
  });
  page.setDefaultTimeout(10000);
  await page.clock.install({ time: new Date() });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failAppearance = false,
    holdNextBootstrap = false,
    releaseBootstrap,
    capturedBootstrap,
    offlineEvents = true;
  const offline = process.env.USAGE_OFFLINE === "1";
  const report = (text) => console.log("PASS " + text);
  const rgb = (hex) => `rgb(${colorChannels(hex).join(", ")})`;
  let captured, hold;
  async function intercept(route, forward) {
    if (route === "/api/appearance" && failAppearance)
      return {
        status: 400,
        body: JSON.stringify({ error: "Deliberate appearance failure" }),
      };
    const waiting = route.startsWith("/api/bootstrap") && holdNextBootstrap;
    if (waiting) holdNextBootstrap = false;
    const response = await forward();
    if (waiting) {
      capturedBootstrap?.();
      await hold;
    }
    return response;
  }
  if (offline) {
    await page.exposeBinding("usageTestFetch", (_, route, options) =>
      intercept(route, async () => {
        const response = await fetch(f.url + route, options);
        return { status: response.status, body: await response.text() };
      }),
    );
    await page.exposeBinding("usageTestEvents", () => offlineEvents);
    await page.addInitScript(() => {
      if (!crypto.randomUUID)
        crypto.randomUUID = () => {
          const b = crypto.getRandomValues(new Uint8Array(16));
          b[6] = (b[6] & 15) | 64;
          b[8] = (b[8] & 63) | 128;
          const h = [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
          return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
        };
      window.fetch = async (route, options = {}) => {
        if (String(route).startsWith("/api/events"))
          return new Response(
            new ReadableStream({
              start(controller) {
                const timer = setInterval(async () => {
                  if (
                    !options.signal?.aborted &&
                    (await window.usageTestEvents())
                  )
                    controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
                }, 700);
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
        const response = await window.usageTestFetch(String(route), {
          method: options.method,
          body: options.body,
          headers: options.headers,
        });
        return new Response(response.body, {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        });
      };
    });
  } else {
    await page.route("**/api/{appearance,bootstrap*}", async (route) => {
      const result = await intercept(
        new URL(route.request().url()).pathname +
          new URL(route.request().url()).search,
        async () => {
          const response = await route.fetch();
          return { status: response.status(), body: await response.text() };
        },
      );
      await route.fulfill({
        status: result.status,
        body: result.body,
        contentType: "application/json",
      });
    });
  }
  async function load() {
    if (!offline) {
      await page.goto(f.url);
      return;
    }
    await page.goto("about:blank");
    const html = await (await fetch(f.url)).text();
    await page.setContent(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<link\b[^>]*>/gi, ""),
    );
    const dir = new URL("../dist/assets/", import.meta.url),
      names = await readdir(dir);
    await page.addStyleTag({
      content: await readFile(
        new URL(
          names.find((n) => n.endsWith(".css")),
          dir,
        ),
        "utf8",
      ),
    });
    await page.addScriptTag({
      type: "module",
      content: await readFile(
        new URL(
          names.find((n) => n.startsWith("index-") && n.endsWith(".js")),
          dir,
        ),
        "utf8",
      ),
    });
  }
  async function shot(name) {
    const directory = paletteArtifacts('usage');
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: `${directory}/${name}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  const toggle = () => page.locator(".usage-disclosure");
  const sideValue = () => page.locator(".usage-sidebar .usage-headline");
  const heroValue = () => page.locator(".usage-hero .usage-headline");
  const settingsButton = () =>
    page.getByRole("button", { name: "Application settings", exact: true });
  async function expanded(value) {
    if ((await toggle().getAttribute("aria-expanded")) !== String(value))
      await toggle().click();
  }
  async function overview() {
    await expanded(true);
    await page
      .getByRole("button", { name: "Open Available Usage", exact: true })
      .click();
    await heroValue().waitFor();
  }
  async function settings(tab) {
    if (await settingsButton().getAttribute("aria-expanded") !== "true") await settingsButton().click();
    await page.getByRole("button", { name: tab, exact: true }).click();
  }
  async function refreshBootstrap() {
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
  }
  async function text(locator, value) {
    await page.waitForFunction(
      ({ selector, value }) =>
        document.querySelector(selector)?.textContent === value,
      {
        selector: await locator.evaluate((el) => {
          el.dataset.usageTextProbe = "current";
          return '[data-usage-text-probe="current"]';
        }),
        value,
      },
    );
    await locator.evaluate((el) => delete el.dataset.usageTextProbe);
  }
  const hex = (value) =>
    "#" +
    value
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((c) => Math.round(Number(c)).toString(16).padStart(2, "0"))
      .join("");
  async function contrastCheck() {
    await checkCompoundMeter(page, 60);
    await checkCompoundContrast(page);
    const pairs = await page
      .locator(
        ".usage-label, .usage-headline, .usage-provider-value, .usage-provider-heading .provider-identity, .usage-legend .provider-identity, .usage-reset time",
      )
      .evaluateAll((elements) =>
        elements
          .filter((e) => e.getClientRects().length)
          .map((e) => {
            let background = "rgba(0, 0, 0, 0)",
              p = e;
            while (p) {
              const color = getComputedStyle(p).backgroundColor;
              if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
                background = color;
                break;
              }
              p = p.parentElement;
            }
            return {
              foreground: getComputedStyle(e).color,
              background,
              label: e.textContent,
            };
          }),
      );
    for (const pair of pairs)
      assert.ok(
        contrast(hex(pair.foreground), hex(pair.background)) >= 4.5,
        JSON.stringify(pair),
      );
    const rails = await page
      .locator(".usage-fill")
      .evaluateAll((elements) =>
        elements
          .filter((e) => e.getClientRects().length)
          .map((e) => [
            getComputedStyle(e).backgroundColor,
            getComputedStyle(e.parentElement).backgroundColor,
          ]),
      );
    for (const [fill, rail] of rails)
      assert.ok(contrast(hex(fill), hex(rail)) >= 3, `${fill} on ${rail}`);
    await page.keyboard.press("Tab");
    await toggle().focus();
    assert.equal(
      await toggle().evaluate((e) => getComputedStyle(e).outlineStyle),
      "solid",
    );
  }
  async function noOverflow() {
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "no page horizontal overflow",
    );
    assert.ok(
      await page
        .locator(".usage")
        .evaluateAll((es) =>
          es
            .filter((e) => e.getClientRects().length)
            .every((e) => e.scrollWidth <= e.clientWidth + 1),
        ),
      "no usage overflow",
    );
  }
  async function paletteSmoke(palette) {
    // Exhaustive sweep for non-representative palettes: the palette is
    // applied with the exact tokens the settings UI would apply (this test
    // imports the same domain/theme.mjs module the browser bundle uses),
    // then rendered on the already-open dashboard and checked for meter
    // geometry, provider contrast, overflow and matching surfaces. Saving,
    // persistence and the DOM-wide text-contrast scan stay on the
    // representative subset below; every palette still runs through the
    // numerical contrast contracts on every contract run.
    await checkCompoundMeter(page, 60);
    await checkCompoundContrast(page);
    await noOverflow();
    assert.equal(
      await sideValue().textContent(),
      await heroValue().textContent(),
    );
    assert.equal(
      await page
        .locator(".usage-hero")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
      rgb(palette.tokens.paper),
    );
  }
  async function applyPaletteFast(palette) {
    // Mirrors applyTheme() from domain/theme.mjs in a single round-trip:
    // same dataset id, same inline tokens. Skips only the settings
    // navigation, the appearance save round-trip and the dashboard
    // navigation that theme()/overview() perform per palette.
    await page.evaluate(
      ({ id, mode, tokens }) => {
        const root = document.documentElement;
        root.dataset.theme = id;
        root.style.backgroundColor = tokens.bg;
        root.style.colorScheme = mode;
        for (const [key, color] of Object.entries(tokens))
          root.style.setProperty(`--${key}`, color);
      },
      { id: palette.id, mode: palette.mode, tokens: { ...palette.tokens } },
    );
    await page.waitForFunction(
      (id) => document.documentElement.dataset.theme === id,
      palette.id,
    );
  }
  async function theme(id) {
    await settings("Appearance");
    const palette = palettes.find((palette) => palette.id === id), name = palette.name;
    const group = page.getByRole('button', { name: palette.mode === 'light' ? /^Light themes/ : /^Dark themes/ });
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
    await page
      .getByRole("button", { name: `Use ${name} palette`, exact: true })
      .click();
    await page.waitForFunction(
      (id) =>
        document.documentElement.dataset.theme === id &&
        [...document.querySelectorAll(".palette-option")].every(
          (button) => !button.disabled,
        ),
      id,
    );
  }
  async function color(id, value) {
    const region = page.getByRole("region", {
      name: `${id === "openai" ? "OpenAI" : "GitHub Copilot"} settings`,
    });
    await region
      .getByLabel(`${id === "openai" ? "OpenAI" : "GitHub Copilot"} hex color`)
      .fill(value);
    await region.getByRole("button", { name: "Save color", exact: true }).click();
    await region.getByText("Provider color saved.", { exact: true }).waitFor();
  }
  function pauseBootstrap() {
    captured = new Promise((r) => {
      capturedBootstrap = r;
    });
    hold = new Promise((r) => {
      releaseBootstrap = r;
    });
    holdNextBootstrap = true;
  }
  try {
    await load();
    await text(sideValue(), "60%");
    await page.getByRole("button", { name: "Chats", exact: true }).click();
    await page
      .locator(".nav-chat-select")
      .filter({ hasText: "Availability test chat" })
      .click();
    const draft = page.getByRole("textbox", { name: "Message", exact: true });
    await draft.fill("Keep this unsent draft.");
    await page.locator(".chat-scroll").evaluate((e) => {
      e.scrollTop = 130;
    });
    const scroll = await page
        .locator(".chat-scroll")
        .evaluate((e) => e.scrollTop),
      selection = await page
        .getByRole('button', { name: 'Message options', exact: true })
        .getAttribute('title');
    const requests = f.refreshCount();
    await toggle().focus();
    assert.equal(await toggle().getAttribute("aria-expanded"), "false");
    await page.keyboard.press("Enter");
    assert.equal(await toggle().getAttribute("aria-expanded"), "true");
    assert.deepEqual(
      await page
        .locator(".usage-breakout .usage-provider-value")
        .allTextContents(),
      ["90%", "60%", "30%", "Variable"],
    );
    assert.equal(await draft.inputValue(), "Keep this unsent draft.");
    assert.equal(
      await page.locator(".chat-scroll").evaluate((e) => e.scrollTop),
      scroll,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Message options', exact: true }).getAttribute('title'),
      selection,
    );
    await page.locator(".usage-open").focus();
    await page.keyboard.press("Escape");
    assert.equal(await toggle().getAttribute("aria-expanded"), "false");
    assert.equal(
      await toggle().evaluate((e) => e === document.activeElement),
      true,
    );
    await page.keyboard.press("Space");
    assert.equal(await toggle().getAttribute("aria-expanded"), "true");
    assert.equal(f.refreshCount(), requests);
    assert.equal(f.mutations.length, 0);
    await page.locator(".usage-open").click();
    await text(heroValue(), "60%");
    assert.equal(await page.locator(".stats").count(), 0);
    assert.equal(await page.locator(".usage-hero").count(), 1);
    report(
      "click and keyboard disclosure, separate dashboard action, shared values, unchanged draft/scroll/model, no provider actions",
    );

    for (const palette of browserPalettes) {
      const full = isRepresentativePalette(palette.id);
      await test.step(`${palette.name}: compact and expanded usage`, async () => {
        if (!full) {
          await applyPaletteFast(palette);
          await paletteSmoke(palette);
          return;
        }
        await theme(palette.id);
        await overview();
        await expanded(false);
        await contrastCheck();
        if (capturePalette(palette.id)) await shot(`${palette.id}-compact`);
        await expanded(true);
        await contrastCheck();
        await noOverflow();
        if (capturePalette(palette.id)) await shot(`${palette.id}-expanded-dashboard`);
        assert.equal(
          await sideValue().textContent(),
          await heroValue().textContent(),
        );
        assert.equal(
          await page
            .locator(".usage-hero")
            .evaluate((e) => getComputedStyle(e).backgroundColor),
          rgb(palette.tokens.paper),
        );
        assert.doesNotMatch(
          await page.locator(".usage-hero").innerText(),
          /\$|tokens|Monthly subscriptions|Estimated remaining/,
        );
      });
    }
    report(
      `palette rendering: touching remaining/used portions, single endpoint, rendered contrast, no provider model dropdown, matching surfaces (${browserPalettes.length} rendered; representative subset saved through the settings UI with full compact and expanded contrast, remainder applied with identical tokens and checked for geometry, provider contrast, overflow and matching surfaces)`,
    );

    await settings("Providers");
    const openai = page.getByRole("region", { name: "OpenAI settings" });
    const billing = openai.getByLabel("Monthly cost (USD)");
    await billing.fill("999");
    const before = await page
      .locator('.usage-breakout [data-provider="openai"] .provider-identity')
      .first()
      .evaluate((e) => getComputedStyle(e).color);
    await openai.getByLabel("OpenAI hex color").fill("#ffffff");
    assert.equal(
      await page
        .locator('.usage-breakout [data-provider="openai"] .provider-identity')
        .first()
        .evaluate((e) => getComputedStyle(e).color),
      before,
      "preview does not leak",
    );
    failAppearance = true;
    await openai.getByRole("button", { name: "Save color", exact: true }).click();
    await openai.getByRole("alert").waitFor();
    failAppearance = false;
    assert.equal(
      await page
        .locator('.usage-breakout [data-provider="openai"] .provider-identity')
        .first()
        .evaluate((e) => getComputedStyle(e).color),
      before,
    );
    await color("openai", "#ffffff");
    assert.equal(await billing.inputValue(), "999");
    await text(sideValue(), "60%");
    for (const swatch of ["#000000", "#ffff00", "#ff00ff", "#ffffff"]) {
      await color("openai", swatch);
      await overview();
      await contrastCheck();
      const base = await page
        .locator('.usage-hero [data-provider="openai"]')
        .first()
        .evaluate((e) => getComputedStyle(e).getPropertyValue("--provider-base"));
      assert.equal(base.trim(), swatch);
      await settings("Providers");
    }
    await color("github-copilot", "#ffffff");
    await overview();
    await contrastCheck();
    await shot("identical-custom-colors");
    assert.equal(
      await page.locator('.usage-hero [data-portion="remaining"]').count(),
      3,
    );
    assert.match(await page.locator(".usage-legend").innerText(), /OpenAI/);
    assert.match(
      await page.locator(".usage-legend").innerText(),
      /GitHub Copilot/,
    );
    report(
      "preview isolation, failed-save rollback, extreme and identical saved colors, unsaved billing preserved, readable derived shades",
    );

    await theme("midnight");
    await settings("Providers");
    pauseBootstrap();
    const refreshClick = refreshBootstrap();
    await captured;
    await refreshClick;
    await color("openai", "#3379cc");
    releaseBootstrap();
    hold = undefined;
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".topbar .icon-button svg")
          ?.classList.contains("spin"),
    );
    const expected = rgb(
      providerTokens("openai", {
        theme: "midnight",
        providerColors: { openai: "#3379cc" },
      })["--provider-fg"],
    );
    assert.equal(
      await page
        .locator('.usage-breakout [data-provider="openai"] .provider-identity')
        .first()
        .evaluate((e) => getComputedStyle(e).color),
      expected,
    );
    await load();
    await text(sideValue(), "60%");
    await expanded(true);
    await settings("Providers");
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "midnight",
    );
    assert.equal(
      await openai.getByLabel("OpenAI hex color").inputValue(),
      "#3379cc",
    );
    await openai
      .getByRole("button", { name: "Use default", exact: true })
      .click();
    await openai.getByText("Default color restored.", { exact: true }).waitFor();
    assert.equal(
      await openai.getByLabel("OpenAI hex color").inputValue(),
      providerDefaults.openai,
    );
    await overview();
    await expanded(true);
    report(
      "delayed bootstrap cannot undo a confirmed color save; saved palette and colors survive reload; scoped default reset",
    );

    const nav = page.getByRole("separator", { name: "Navigation width" });
    for (const key of ["Home", "End"]) {
      await nav.focus();
      await page.keyboard.press(key);
      await page.waitForFunction(
        () =>
          document
            .querySelector(".panel-resizer-navigation")
            .getAttribute("aria-disabled") === "false",
      );
      await noOverflow();
      await shot(`navigation-${key.toLowerCase()}`);
    }
    await nav.dblclick();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".panel-resizer-navigation")
          .getAttribute("aria-disabled") === "false",
    );
    await page.setViewportSize({ width: 560, height: 700 });
    await expanded(false);
    await toggle().tap();
    assert.equal(await toggle().getAttribute("aria-expanded"), "true");
    await noOverflow();
    await settingsButton().scrollIntoViewIfNeeded();
    assert.equal(await settingsButton().isVisible(), true);
    await checkCompoundMeter(page, 60);
    await shot("compact-navigation-breakout");
    await page.keyboard.press("Escape"); // Focus remains on the summary after touch.
    await page.setViewportSize({ width: 1000, height: 480 });
    await expanded(true);
    await noOverflow();
    await settingsButton().scrollIntoViewIfNeeded();
    await shot("short-window");
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await noOverflow();
    await shot("zoom-200");
    await page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await toggle().focus();
    await checkCompoundMeter(page, 60);
    await shot("forced-colors");
    assert.equal(
      await toggle().evaluate((e) => getComputedStyle(e).outlineStyle),
      "solid",
    );
    assert.ok(
      (
        await page
          .locator(".usage-fill")
          .first()
          .evaluate((e) => getComputedStyle(e).transitionDuration)
      )
        .split(",")
        .every((v) => parseFloat(v) === 0),
    );
    await page.emulateMedia({
      reducedMotion: "no-preference",
      forcedColors: "none",
    });
    report(
      "real panel width limits, narrow touch disclosure, short windows, zoom, forced colors and reduced motion",
    );

    await overview();
    await expanded(true);
    await page
      .locator(".usage-breakout .usage-provider-row")
      .first()
      .evaluate((e) => {
        e.dataset.identityProbe = "retained";
      });
    f.pauseRefresh();
    const count = f.refreshCount();
    await page
      .locator(".usage-hero")
      .getByRole("button", { name: "Refresh usage" })
      .click();
    await page
      .locator(".usage-hero")
      .getByText("Refreshing…", { exact: true })
      .first()
      .waitFor();
    assert.equal(
      await page
        .locator(".usage-breakout")
        .getByRole("button", { name: "Refresh usage" })
        .isDisabled(),
      true,
    );
    assert.equal(f.refreshCount(), count + 1);
    assert.equal(await heroValue().textContent(), "60%");
    f.failRefresh(true);
    f.resumeRefresh();
    await page
      .locator(".usage-hero-footer")
      .getByText("Refresh failed", { exact: true })
      .waitFor();
    assert.equal(await heroValue().textContent(), "60%");
    assert.equal(
      await page.locator('[data-identity-probe="retained"]').count(),
      1,
    );
    assert.equal(await toggle().getAttribute("aria-expanded"), "true");
    f.failRefresh(false);
    report(
      "one in-flight refresh, shared pending state, retained usable values and row identity, explicit failure without closing disclosure",
    );

    // Fake clock exercises idle transitions without waiting for a real quota reset.
    const start = await page.evaluate(() => Date.now());
    f.setEvents(false);
    offlineEvents = false;
    f.setNow(start);
    const resetState = quotaFixture(start);
    resetState.surfaces["opencode-go"].windows.rolling.resets_at = new Date(
      start + 20000,
    ).toISOString();
    f.replace(resetState);
    await refreshBootstrap();
    await text(heroValue(), "60%");
    f.pauseRefresh();
    f.setNow(start + 21000);
    // The previous attempt has a cooldown; a reset remains unknown during that
    // bound, and can never grant an automatic refill in the meantime.
    await page.clock.fastForward(61000);
    await page.waitForFunction(
      () =>
        document.querySelector(".usage-hero .usage-headline").textContent !==
        "60%",
    );
    assert.notEqual(await heroValue().textContent(), "100%");
    assert.ok((await page.locator(".usage-hero .usage-unknown").count()) >= 1);
    await checkCompoundMeter(page, 50, 100 / 3);
    await shot("partial-continuous-rail");
    const fresh = quotaFixture(start + 61000);
    fresh.surfaces["opencode-go"].windows.rolling.used_percent = 60;
    f.setNow(start + 61000);
    f.replace(fresh);
    f.resumeRefresh();
    // Explicit retry bypasses cooldown but joins a request already in flight.
    await page.waitForFunction(
      () => !document.querySelector(".usage-hero .usage-refresh").disabled,
    );
    await page
      .locator(".usage-hero")
      .getByRole("button", { name: "Refresh usage" })
      .click();
    await text(heroValue(), "63%");
    await checkCompoundMeter(page, 190 / 3);
    f.pauseRefresh();
    f.setNow(start + 661001);
    await page.clock.fastForward(600001);
    await page.waitForFunction(
      () => document.querySelectorAll(".usage-hero .usage-unknown").length === 3,
    );
    assert.notEqual(await heroValue().textContent(), "0%");
    assert.notEqual(await heroValue().textContent(), "100%");
    f.failRefresh(true);
    f.resumeRefresh();
    await page
      .locator(".usage-hero-footer")
      .getByText("Refresh failed", { exact: true })
      .waitFor();
    assert.equal(await heroValue().textContent(), "Unknown");
    await checkCompoundMeter(page, 0, 100);
    await shot("idle-expiry-unknown");
    assert.equal(f.mutations.length, 0);
    assert.deepEqual(errors, []);
    report(
      "reset crossing and idle expiry invalidate cached values; only confirmed observations restore estimates, never a fabricated full refill",
    );
  } catch (error) {
    console.error(error);
    console.error("Browser errors:", errors);
    await shot("failure").catch(() => {});
    throw error;
  } finally {
    releaseBootstrap?.();
    f.resumeRefresh();
    await browser.close();
    await f.close();
  }
});

test('usage model visibility preserves saved settings, handles failures and filters the workspace picker', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const f = await own(usageFixture());
  await f.store.update('settings', settings => ({ ...settings, appearance: {
    ...settings.appearance, theme: 'midnight', showDepletedModels: false, providerColors: { openai: '#3379cc' },
  } }));
  const quotas = quotaFixture();
  quotas.surfaces['github-copilot-oauth'].buckets.premium_interactions.percent_remaining = 0;
  f.replace(quotas);
  const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
  async function settings(tab) {
    const menu = page.getByRole('button', { name: 'Application settings', exact: true });
    if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
    await page.getByRole('button', { name: tab, exact: true }).click();
  }
  async function preferences() {
    await settings('Available Usage');
    await expect(page.locator('.usage-preferences details')).not.toHaveAttribute('open');
    await expect(page.locator('.usage-method')).not.toHaveAttribute('open');
    await page.locator('.usage-preferences summary').click();
  }
  async function modelOptions() {
    const chats = page.getByRole('button', { name: 'Chats', exact: true });
    if (await chats.getAttribute('aria-expanded') !== 'true') await chats.click();
    await page.locator('.nav-chat-select').filter({ hasText: 'Availability test chat' }).click();
    await page.getByRole('button', { name: 'Message options', exact: true }).click();
    return page.getByRole('combobox', { name: 'Parent model', exact: true });
  }
  await page.goto(f.url);
  await settings('Appearance');
  await expect(page.getByRole('checkbox', { name: /exhausted|depleted/ })).toHaveCount(0);
  await preferences();
  const checkbox = page.getByRole('checkbox', { name: 'Show exhausted models in the workspace picker', exact: true });
  await expect(checkbox).not.toBeChecked();
  await page.locator('.usage-preferences summary').focus();
  await page.keyboard.press('Space');
  await expect(checkbox).not.toBeVisible();
  await page.keyboard.press('Enter');
  await expect(checkbox).toBeVisible();
  await expect((await modelOptions()).locator('option[value="github-copilot/forge"]')).toHaveCount(0);
  await preferences();

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/appearance', async route => {
    await gate;
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Visibility save failed for this test.' }) });
  });
  try {
    await checkbox.click();
    await expect(checkbox).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('alert').filter({ hasText: 'Visibility save failed' })).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  assert.equal((await f.store.read('settings')).appearance.showDepletedModels, false);
  await page.unroute('**/api/appearance');
  // This setting adopts the confirmed server value after the save completes.
  // Playwright check()/uncheck() require a synchronous checked-state change.
  await checkbox.click();
  await expect(page.getByRole('status').filter({ hasText: 'Model visibility saved.' })).toBeVisible();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeEnabled();
  const saved = (await f.store.read('settings')).appearance;
  assert.equal(saved.showDepletedModels, true);
  assert.equal(saved.theme, 'midnight');
  assert.deepEqual(saved.providerColors, { openai: '#3379cc' });
  await page.reload();
  await preferences();
  await expect(checkbox).toBeChecked();
  await expect((await modelOptions()).locator('option[value="github-copilot/forge"]')).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await preferences();
  assert.ok(await page.locator('.usage-preferences').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await checkbox.click();
  await expect(page.getByRole('status').filter({ hasText: 'Model visibility saved.' })).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeEnabled();
  assert.equal((await f.store.read('settings')).appearance.showDepletedModels, false);
  await page.reload();
  await preferences();
  await expect(checkbox).not.toBeChecked();
});
