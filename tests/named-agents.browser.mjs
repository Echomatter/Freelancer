// Production React/HTTP/store/dispatcher, with a simulated native model engine.
// NAMED_OFFLINE=1 is an explicit restricted-environment bridge, not CSP evidence.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { unifiedFixture } from "./fixtures/unified-agents.mjs";
import { startServer } from "../server/http.mjs";
import { completionMetadata } from "../backend/tools/runtime/presentation.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await unifiedFixture();
const web = await startServer({
  application: f.app,
  assets: fileURLToPath(new URL("../dist", import.meta.url)),
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const offline = process.env.NAMED_OFFLINE === "1";
if (offline) {
  await page.exposeBinding("namedFetch", async (_, route, options) => {
    const response = await fetch(web.url + route, options);
    return { status: response.status, body: await response.text() };
  });
  await page.addInitScript(() => {
    if (!crypto.randomUUID)
      crypto.randomUUID = () => {
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 15) | 64;
        b[8] = (b[8] & 63) | 128;
        const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      };
    window.fetch = async (route, options = {}) => {
      if (String(route).startsWith("/api/events"))
        return new Response(
          new ReadableStream({
            start(c) {
              const timer = setInterval(
                () => c.enqueue(new TextEncoder().encode("data: {}\n\n")),
                600,
              );
              options.signal?.addEventListener(
                "abort",
                () => {
                  clearInterval(timer);
                  c.close();
                },
                { once: true },
              );
            },
          }),
        );
      const r = await window.namedFetch(String(route), {
        method: options.method,
        headers: options.headers,
        body: options.body,
      });
      return new Response(r.body, {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      });
    };
  });
}
async function load() {
  if (!offline) return page.goto(web.url);
  await page.goto("about:blank");
  const html = await (await fetch(web.url)).text();
  await page.setContent(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<link\b[^>]*>/gi, ""),
  );
  const dir = new URL("../dist/assets/", import.meta.url),
    files = await readdir(dir);
  await page.addStyleTag({
    content: await readFile(
      new URL(
        files.find((n) => n.endsWith(".css")),
        dir,
      ),
      "utf8",
    ),
  });
  await page.addScriptTag({
    type: "module",
    content: await readFile(
      new URL(
        files.find((n) => n.startsWith("index-") && n.endsWith(".js")),
        dir,
      ),
      "utf8",
    ),
  });
}
const report = (text) => console.log("PASS " + text);
async function openAgents() {
  await openProjectTab("Agents");
}
async function openProjectTab(tab) {
  const projectSettings = page.getByRole("button", { name: "Project settings", exact: true });
  if (await projectSettings.getAttribute("aria-expanded") !== "true") await projectSettings.click();
  await page.getByRole("button", { name: tab, exact: true }).click();
}
try {
  await load();
  await openAgents();
  for (const name of ["Engineer", "Researcher", "Designer", "Git"])
    await page.getByRole("heading", { name, exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: /^(Worker|Architect|Reviewer)$/ })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  const editor = page.getByRole("region", { name: "Agent editor" });
  await editor
    .getByLabel("Name", { exact: true })
    .fill("Accessibility specialist");
  await editor
    .getByLabel("Prompt", { exact: true })
    .fill(
      "BROWSER_AGENT_SENTINEL. Inspect keyboard focus with supported findings.",
    );
  assert.equal(
    await editor
      .getByRole("combobox", { name: "Default model", exact: true })
      .inputValue(),
    "auto",
  );
  await editor.getByRole("button", { name: "Save agent", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  const card = page
    .locator(".catalog-card")
    .filter({
      has: page.getByRole("heading", {
        name: "Accessibility specialist",
        exact: true,
      }),
    });
  await card.waitFor();
  await card.getByRole("button", { name: "Use agent", exact: true }).click();
  const agent = (await f.store.read("settings")).agents.find(
    (a) => a.name === "Accessibility specialist",
  );
  assert.ok(agent);
  assert.equal(
    await page
      .getByRole("combobox", { name: "Agent", exact: true })
      .inputValue(),
    agent.id,
  );
  await page
    .getByRole("combobox", { name: "Parent model", exact: true })
    .selectOption("opencode/free-a");
  await page
    .locator(".composer textarea")
    .fill("Inspect this project without editing it.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const sentBy = Date.now() + 12000;
  while (!f.prompts.length && Date.now() < sentBy)
    await new Promise((r) => setTimeout(r, 50));
  assert.ok(
    f.prompts.length,
    "The real send endpoint must accept the main request",
  );
  assert.equal(f.prompts.at(-1).body.agent, agent.id);
  assert.match(f.prompts.at(-1).body.system, /BROWSER_AGENT_SENTINEL/);
  report(
    "One catalog: create a custom agent and execute a main request with its saved definition",
  );
  const parentID = f.prompts.at(-1).sessionID,
    ctx = f.context(parentID);
  const args = {
    agentID: agent.id,
    workflowID: "review",
    task: "Check the focus order in this bounded assignment.",
    selectedModel: "opencode/free-b",
  };
  const parent = f.rows.get(parentID).at(-1);
  parent.parts.push({
    id: "prt_named",
    messageID: parent.info.id,
    sessionID: parentID,
    type: "tool",
    tool: "delegate",
    callID: ctx.callID,
    state: { status: "running", input: args, time: { start: Date.now() } },
  });
  const receipt = await f.delegator.execute(args, ctx);
  assert.equal(receipt.status, "completed");
  assert.match(f.prompts.at(-1).body.system, /BROWSER_AGENT_SENTINEL/);
  parent.parts[0].state = {
    ...parent.parts[0].state,
    status: "completed",
    output: JSON.stringify(receipt),
    metadata: completionMetadata(receipt, args),
    time: { start: Date.now() - 20, end: Date.now() },
  };
  parent.info.time.completed = Date.now();
  parent.info.finish = "stop";
  delete f.status[parentID];
  await page.locator(".request-working > summary").last().click();
  const childButton = page.getByRole("button", {
    name: /Agent finished: Accessibility specialist/,
  });
  await childButton.waitFor();
  assert.match(await childButton.textContent(), /Accessibility specialist/);
  await mkdir("artifacts/named-agents", { recursive: true });
  await page.screenshot({ path: "artifacts/named-agents/named-child.png" });
  await childButton.click();
  await page
    .getByText("Simulated native result; no inference.", { exact: true })
    .waitFor();
  report(
    "Same custom definition in delegated Review, captured name on the card, and real child navigation",
  );
  await openAgents();
  await page
    .getByRole("button", { name: "Edit Accessibility specialist", exact: true })
    .click();
  await editor.getByLabel("Name", { exact: true }).fill("Renamed specialist");
  await editor.getByRole("button", { name: "Save agent", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(receipt.agent.name, "Accessibility specialist");
  await load();
  await openAgents();
  await page
    .getByRole("heading", { name: "Renamed specialist", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 620, height: 900 });
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  await editor.waitFor();
  await editor.getByRole("button", { name: "Close editor" }).click();
  await editor.waitFor({ state: "hidden" });
  await page.screenshot({ path: "artifacts/named-agents/catalog-narrow.png" });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await openProjectTab("Delegation");
  const budgetHeading = page.getByRole("heading", { name: "Delegation budget", exact: true });
  await budgetHeading.waitFor();
  await page.getByRole("main").getByLabel("Delegation", { exact: true }).selectOption("automatic");
  await page.getByLabel("Subscription capacity", { exact: true }).selectOption("automatic");
  await page.getByLabel("Simultaneous delegated agents", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save delegation budget", exact: true }).click();
  await page.getByText("Delegation budget saved.", { exact: true }).waitFor();
  const savedBudget = await f.app.readPreferences(f.project.id);
  assert.equal(savedBudget.defaults.maxParallel, 4);
  assert.equal(savedBudget.defaults.subscriptionDelegation, "automatic");
  const originalSave = f.app.savePreferences;
  f.app.savePreferences = async () => { throw Error("Simulated save unavailable"); };
  await page.getByLabel("Simultaneous delegated agents", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save delegation budget", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Simulated save unavailable" }).waitFor();
  assert.equal(await page.getByLabel("Simultaneous delegated agents", { exact: true }).inputValue(), "2");
  assert.equal((await f.app.readPreferences(f.project.id)).defaults.maxParallel, 4);
  f.app.savePreferences = originalSave;
  await page.getByRole("button", { name: "Save delegation budget", exact: true }).click();
  await page.getByText("Delegation budget saved.", { exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/named-agents/delegation-budget.png" });
  await load();
  await openProjectTab("Delegation");
  await page.getByLabel("Simultaneous delegated agents", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Simultaneous delegated agents", { exact: true }).inputValue(), "2");
  assert.equal(await page.getByLabel("Subscription capacity", { exact: true }).inputValue(), "automatic");
  await page.setViewportSize({ width: 620, height: 1000 });
  await page.getByRole("main").getByLabel("Delegation", { exact: true }).selectOption("manual");
  await page.getByRole("button", { name: "Save delegation budget", exact: true }).click();
  await page.getByText("Delegation budget saved.", { exact: true }).waitFor();
  assert.equal((await f.app.readPreferences(f.project.id)).defaults.delegation, "manual");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no narrow-page horizontal overflow");
  await page.screenshot({ path: "artifacts/named-agents/delegation-budget-narrow.png" });
  report("Delegation settings save/reload, failed-save preservation, retry, native-permission notice and narrow controls");
  assert.deepEqual(errors, []);
  report(
    "Saved agent rename survives reload; narrow editor opens and closes without native-shell APIs",
  );
} catch (error) {
  await mkdir("artifacts/named-agents", { recursive: true });
  await page
    .screenshot({ path: "artifacts/named-agents/failure.png" })
    .catch(() => {});
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
  await web.sender.close();
  web.server.closeAllConnections();
  await new Promise((r) => web.server.close(r));
  await f.close();
}
