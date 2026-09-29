import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { gitProjectFixture } from './fixtures/git-project-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('local and cloud cards expose themed identities and independent edits', { tag: ['@app'] }, async ({ appBrowser, own }) => {
  const fixture = await own(gitProjectFixture());
  await fixture.app.gitProjects.initialize(fixture.project.id, { name: 'Project Author', email: 'author@example.invalid', confirm: true });
  const page = await appBrowser.newPage({ viewport: { width: 1365, height: 960 } });
  const data = await fixture.app.gitProjects.inspect(fixture.project.id);
  try {
  let enabled = true, revision = 10, saved;
  // Simulate a connected GitHub account; no test signs in or publishes remotely.
  await page.route('**/api/git?**', async route => {
    await route.fulfill({ json: { ...data,
      tools: { ...data.tools, gh: true }, auth: { connected: true, login: 'CloudAccount' },
      agreement: { ...data.agreement, revision, github: enabled,
        repository: { name: 'CloudAccount/example', url: 'https://github.com/CloudAccount/example', private: true } },
    } });
  });
  await page.route('**/api/git/policy', async route => {
    saved = route.request().postDataJSON();
    enabled = saved.github; revision++;
    await route.fulfill({ json: { message: 'Cloud preference saved' } });
  });
  await page.goto(fixture.url);
  await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  await page.getByRole('button', { name: 'GitHub', exact: true }).click();
  const cards = page.locator('.git-setup-card');
  await expect(page.getByRole('button', { name: 'Edit local history', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit cloud sync', exact: true })).toBeVisible();
  await expect(cards.nth(0)).toContainText('Make changes as');
  await expect(cards.nth(1)).toContainText('CloudAccount');
  for (const card of await cards.all()) {
    assert.equal(await card.locator('.git-local-identity strong').evaluate(el => getComputedStyle(el).color === getComputedStyle(el.closest('section').querySelector('h2')).color), true);
    const help = await card.locator('.card-help').boundingBox(), bounds = await card.boundingBox();
    assert.ok(help.x + help.width > bounds.x + bounds.width - 40);
  }
  await page.getByRole('button', { name: 'Edit cloud sync', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Allow uploads to GitHub', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Close cloud sync edit', exact: true }).click();
  assert.equal(saved, undefined, 'Cancel does not save the cloud preference');
  await page.getByRole('button', { name: 'Edit cloud sync', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Allow uploads to GitHub', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Allow uploads to GitHub', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save cloud sync', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit cloud sync', exact: true })).toBeVisible();
  assert.equal(saved.github, false);
  assert.equal(saved.tracking, true, 'Cloud preference preserves local history');
  await mkdir('artifacts/git-project', { recursive: true });
  await page.screenshot({ path: 'artifacts/git-project/connected.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await expect(page.getByRole('button', { name: 'Edit cloud sync', exact: true })).toBeVisible();
  for (const card of await cards.all()) {
    const title = await card.locator('h2').boundingBox(), badge = await card.locator('.git-card-heading > .badge').boundingBox();
    assert.ok(badge.y >= title.y + title.height, 'Phone status sits below the heading without covering it');
  }
  await page.screenshot({ path: 'artifacts/git-project/connected-phone.png' });
  } finally {
    await appBrowser.close();
    await fixture.close();
  }
});
