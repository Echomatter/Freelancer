import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const f = await localDataFixture();
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(15000);
  await page.goto(f.url);
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('heading', { name: 'Models', exact: true }).waitFor();
  const modelCard = page.locator('.provider-model-card');
  assert.equal(await modelCard.count(), 1);
  assert.equal(await modelCard.locator('details').count(), 0, 'model details are directly presented, not hidden behind a disclosure');
  await modelCard.getByLabel('Model status: Not tested (connected / unverified)').waitFor();
  await modelCard.getByText('Context 64K').waitFor();
  await modelCard.getByText('Output 8.2K').waitFor();
  await modelCard.getByText('Tool use').waitFor();
  await modelCard.getByText('Variant low').waitFor();
  assert.equal(await modelCard.getByText(/coding:|reasoning:|research:|tool use:.*estimate/i).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: 'Search models' }).count(), 1);
  await page.getByRole('button', { name: 'Free', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Free', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'All', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Update Model Ratings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Update Model Ratings' });
  await dialog.getByRole('combobox', { name: 'Configuration model' }).selectOption('opencode/free');
  await dialog.getByRole('button', { name: 'Go', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const status = page.locator('.model-rating-job');
  await status.getByText(/Researching models/).waitFor();
  assert.equal(f.calls.filter((entry) => entry.route.endsWith('/prompt_async')).length, 1);
  const job = (await f.api('models/ratings')).job;
  assert.equal(job.model, 'opencode/free');
  assert.equal(await dialog.getByRole('button', { name: 'Open task' }).count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Models', exact: true }).count(), 1, 'stays on Models');
  const bootstrap = await f.api('bootstrap?project=' + f.project.id);
  assert.ok(!bootstrap.sessions.some(row => row.id === job.session), 'configuration session is hidden while running');
  const scores = { coding: 60, reasoning: 65, research: 50, tool_use: 80, instruction_following: 75 };
  f.state.messages[job.session].push({ info: { role: 'assistant', parentID: f.state.messages[job.session][0].info.id, finish: 'stop', time: { completed: Date.now() } },
    parts: [{ type: 'text', text: JSON.stringify({ models: job.targets.map((id) => ({ id, scores, confidence: 'low',
      summary: 'Estimated from nearby models', sources: [] })) }) }] });
  f.state.status[job.session] = { type: 'idle' };
  await page.getByText(/Updated \d+ model rating/).waitFor();
  await status.getByRole('button', { name: 'OK', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await f.api('models/ratings')).job, null);
  await page.reload();
  await page.getByRole('button', { name: 'Application settings', exact: true }).waitFor();
  assert.equal(await page.locator('.model-rating-job').count(), 0, 'dismissal survives reload');
  assert.ok(!(await f.api('history?project=' + f.project.id + '&scope=all')).sessions.some(row => row.id === job.session));
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  assert.equal(await page.locator('.provider-model-card .badge').filter({ hasText: 'Updated' }).count(), 0,
    'researched ratings do not displace native characteristics on cards');
  await page.getByRole('button', { name: 'Update Model Ratings' }).click();
  await dialog.getByRole('combobox', { name: 'Configuration model' }).selectOption('opencode/free');
  await dialog.getByRole('button', { name: 'Go', exact: true }).click();
  await status.getByText(/Researching models/).waitFor();
  const partial = (await f.api('models/ratings')).job;
  f.state.messages[partial.session].push({ info: { role: 'assistant', parentID: f.state.messages[partial.session][0].info.id,
    finish: 'stop', time: { completed: Date.now() } }, parts: [{ type: 'text', text: '{"models":[]}' }] });
  f.state.status[partial.session] = { type: 'idle' };
  await status.getByText(/1 models still missing details/).waitFor();
  await status.getByRole('button', { name: 'Retry', exact: true }).click();
  await status.getByText(/Researching models/).waitFor();
  const retry = (await f.api('models/ratings')).job;
  assert.notEqual(retry.id, partial.id);
  f.state.messages[retry.session].push({ info: { role: 'assistant', parentID: f.state.messages[retry.session][0].info.id,
    finish: 'stop', time: { completed: Date.now() } }, parts: [{ type: 'text', text: '{"models":[]}' }] });
  f.state.status[retry.session] = { type: 'idle' };
  await status.getByRole('button', { name: 'Dismiss model update', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  console.log('PASS model filters, status-only dialog, hidden sessions, saved ratings, retry and durable dismissal');
} finally { await browser.close(); await f.close(); }
