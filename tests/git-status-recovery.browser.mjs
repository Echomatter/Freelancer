import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { gitProjectFixture } from './fixtures/git-project-app.mjs';
import { test, expect } from './support/browser-test.mjs';

const gitOptions = {
  // These are presentation/recovery tests, not a Git or authentication fixture.
  resolveExecutable: async () => { throw Error('Tools unavailable in presentation fixture'); },
  runner: async () => { throw Error('Presentation tests must not run external commands'); },
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function openGit(page) {
  const settings = page.getByRole('button', { name: 'Project settings', exact: true });
  if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
  await page.locator('.settings-drawer-links:not([hidden])').getByRole('button', { name: 'GitHub', exact: true }).click();
}
const heading = page => page.locator('.git-project-page .page-title');
const refresh = page => page.getByRole('button', { name: 'Refresh Git status', exact: true });
const loaded = page => page.getByRole('heading', { name: 'Local history', exact: true });
const abortCalls = fixture => fixture.calls.filter(call => /\/abort$/.test(call.route)).length;

test('Git approval waits for fresh status and a completed checkpoint survives a failed follow-up read', { tag: ['@app'] }, async ({ appBrowser, own }) => {
  const fixture = await own(gitProjectFixture());
  await fixture.app.gitProjects.initialize(fixture.project.id, { confirm: true, name: 'Browser Tester', email: 'browser@example.invalid' });
  const page = await appBrowser.newPage({ viewport: { width: 390, height: 844 } });
  let fail = false, executions = 0;
  await page.route('**/api/git?**', route => fail
    ? route.fulfill({ status: 503, json: { error: 'Status temporarily unavailable' } })
    : route.continue());
  await page.route('**/api/git/execute', async route => { executions++; await route.continue(); });
  try {
    await page.goto(fixture.url);
    await openGit(page);
    await expect(loaded(page)).toBeVisible();
    fail = true;
    await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Review this action', exact: true });
    await expect(dialog.getByRole('alert')).toContainText('Refresh before approving this action.');
    await expect(dialog.getByRole('button', { name: 'Approve this action', exact: true })).toBeDisabled();
    assert.equal(executions, 0, 'failed preview refresh does not execute Git');
    fail = false;
    await dialog.getByRole('button', { name: 'Refresh Git status', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Approve this action', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    fail = true;
    const execution = page.waitForResponse(response => response.url().endsWith('/api/git/execute') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Approve this action', exact: true }).click();
    assert.equal((await (await execution).json()).status, 'completed', 'the real Git checkpoint completes before checking its follow-up UI');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('Showing the last loaded Git status.');
    assert.equal(executions, 1);
    const completed = await fixture.app.gitProjects.inspect(fixture.project.id);
    assert.equal(completed.local.history.length, 1, 'checkpoint really completed despite follow-up read failure');
    fail = false;
    await refresh(page).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('No changed files.', { exact: true })).toBeVisible();
    assert.equal(executions, 1, 'status recovery never repeats the checkpoint');
  } finally { await appBrowser.close(); }
});

test('Git panel keeps its frame while loading and can close without stopping work', { tag: ['@app'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ gitOptions }));
  fixture.state.status.ses_history = { type: 'busy' };
  const page = await appBrowser.newPage({ viewport: { width: 390, height: 844 } });
  const gate = deferred();
  let reads = 0;
  await page.route('**/api/git?**', async route => {
    reads++;
    if (reads === 1) await gate.promise;
    await route.continue().catch(() => {}); // The first request is deliberately aborted by closing.
  });
  try {
    await page.goto(fixture.url);
    await openGit(page);
    await expect(heading(page).getByRole('heading', { name: 'GitHub', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Checking project history…', exact: true })).toBeVisible();
    await expect(refresh(page)).toBeDisabled();
    await expect(heading(page).getByRole('button', { name: 'Close settings', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await mkdir('artifacts/git-recovery', { recursive: true });
    await page.screenshot({ path: 'artifacts/git-recovery/loading-phone.png' });
    await heading(page).getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.locator('.git-project-page')).toHaveCount(0);
    assert.equal(abortCalls(fixture), 0, 'closing settings does not abort a native session');
    // Reopen before the obsolete read is released. Its response cannot replace
    // this panel or restore the closed panel's loading state.
    await openGit(page);
    await expect(loaded(page)).toBeVisible();
    gate.resolve();
    await expect(loaded(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Checking project history…', exact: true })).toHaveCount(0);
    assert.equal(fixture.state.status.ses_history.type, 'busy');
  } finally {
    gate.resolve();
    await appBrowser.close();
  }
});

test('Git status failure retries explicitly and restores actual content', { tag: ['@app'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ gitOptions }));
  const page = await appBrowser.newPage({ viewport: { width: 1365, height: 960 } });
  let fail = true, reads = 0;
  await page.route('**/api/git?**', async route => {
    reads++;
    if (fail) return route.fulfill({ status: 503, json: { error: 'Fixture status unavailable' } });
    await route.continue();
  });
  try {
    await page.goto(fixture.url);
    await openGit(page);
    await expect(page.getByRole('alert')).toContainText('Fixture status unavailable');
    await expect(heading(page).getByRole('button', { name: 'Close settings', exact: true })).toBeVisible();
    await expect(refresh(page)).toBeEnabled();
    await expect(loaded(page)).toHaveCount(0);
    // Observe a full poll interval: failure must not silently start another read.
    const failedReads = reads;
    await page.waitForTimeout(3800);
    assert.equal(reads, failedReads, 'failed reads remain paused until explicit retry');
    fail = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(loaded(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cloud sync', exact: true })).toBeVisible();
    await expect(page.getByText('Fixture status unavailable', { exact: true })).toHaveCount(0);
    assert.equal(abortCalls(fixture), 0);
  } finally {
    await appBrowser.close();
  }
});

test('Git refresh is single-flight and preserves forms and last loaded data on failure', { tag: ['@app'] }, async ({ appBrowser, own }) => {
  const fixture = await own(localDataFixture({ gitOptions }));
  const page = await appBrowser.newPage({ viewport: { width: 1365, height: 960 } });
  const gate = deferred();
  let hold = false, heldReads = 0;
  await page.route('**/api/git?**', async route => {
    if (!hold) return route.continue();
    heldReads++;
    await gate.promise;
    await route.fulfill({ status: 503, json: { error: 'Fixture refresh failed' } }).catch(() => {});
  });
  try {
    await page.goto(fixture.url);
    await openGit(page);
    await expect(loaded(page)).toBeVisible();
    const message = page.getByRole('textbox', { name: 'Describe this checkpoint', exact: true });
    await message.fill('Keep my unsaved checkpoint description');
    await page.locator('.git-presets input[value="inspect"]').check();
    hold = true;
    await refresh(page).click();
    await expect(refresh(page)).toBeDisabled();
    await page.waitForTimeout(3800);
    assert.equal(heldReads, 1, 'polling does not overlap a manual refresh');
    gate.resolve();
    await expect(page.getByRole('alert')).toContainText('Showing the last loaded Git status.');
    await expect(loaded(page)).toBeVisible();
    await expect(message).toHaveValue('Keep my unsaved checkpoint description');
    await expect(page.locator('.git-presets input[value="inspect"]')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Save agreement', exact: true })).toBeDisabled();
    await mkdir('artifacts/git-recovery', { recursive: true });
    await page.screenshot({ path: 'artifacts/git-recovery/stale-status.png' });
    hold = false;
    await refresh(page).click();
    await expect(refresh(page)).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(message).toHaveValue('Keep my unsaved checkpoint description');
    await expect(page.locator('.git-presets input[value="inspect"]')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Save agreement', exact: true })).toBeEnabled();
  } finally {
    gate.resolve();
    await appBrowser.close();
  }
});

test('Git read deadline releases loading and permits recovery without replaying work', { tag: ['@app'] }, async ({ appBrowser, own }) => {
  // This test observes the existing production 30-second GET deadline. It does
  // not lengthen production timeouts, alter browser clocks, or retry the test.
  test.setTimeout(60000);
  const fixture = await own(localDataFixture({ gitOptions }));
  const page = await appBrowser.newPage({ viewport: { width: 1365, height: 960 } });
  const gate = deferred();
  let stall = true, reads = 0;
  await page.route('**/api/git?**', async route => {
    reads++;
    if (stall) await gate.promise;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto(fixture.url);
    await openGit(page);
    await expect(heading(page).getByRole('heading', { name: 'GitHub', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Loading took too long.', { timeout: 35000 });
    await expect(page.getByRole('heading', { name: 'Project history could not be loaded', exact: true })).toBeVisible();
    await expect(refresh(page)).toBeEnabled();
    assert.equal(reads, 1, 'a stalled read does not launch overlapping status requests');
    stall = false;
    gate.resolve();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(loaded(page)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    assert.equal(abortCalls(fixture), 0, 'GET deadline does not cancel native work');
    assert.equal(fixture.calls.filter(call => /\/prompt_async$/.test(call.route)).length, 0, 'status recovery never dispatches a request');
  } finally {
    gate.resolve();
    await appBrowser.close();
  }
});
