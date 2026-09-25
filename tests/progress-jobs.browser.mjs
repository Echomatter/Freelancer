import assert from 'node:assert/strict';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { localDataFixture } from './fixtures/local-data-app.mjs';

const f = await localDataFixture();
await mkdir(path.join(f.root, 'tools'));
const indexerSource = await readFile('backend/tools/project-content-indexer.mjs', 'utf8');
assert.ok(indexerSource.includes('../../server/data/schema.sql'));
await writeFile(path.join(f.root, 'tools/project-content-indexer.mjs'),
  indexerSource.replace('../../server/data/schema.sql', '../server/data/schema.sql'));
await mkdir(path.join(f.root, 'server', 'data'), { recursive: true });
await copyFile('server/data/schema.sql', path.join(f.root, 'server', 'data', 'schema.sql'));
const request = f.host.request.bind(f.host);
f.host.request = (route, options) => route === '/session' && options?.method !== 'POST'
  ? Promise.resolve(structuredClone(f.state.sessions)) : request(route, options);
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
let files = gate(), chats = gate(), builds = 0;
const rebuild = f.app.rebuildContentIndex.bind(f.app), rebuildChats = f.app.history.rebuildChatSearch.bind(f.app.history);
f.app.rebuildContentIndex = async options => {
  builds++;
  await Promise.race([files.promise, new Promise(resolve => options.signal?.addEventListener('abort', resolve, { once: true }))]);
  options.signal?.throwIfAborted();
  return rebuild(options);
};
f.app.history.rebuildChatSearch = async options => { await chats.promise; return rebuildChats(options); };
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(f.url);
  const loading = page.getByRole('dialog', { name: 'Preparing your workspace' });
  await loading.waitFor();
  await loading.locator('[aria-current="step"]').getByText('Build the project file index').waitFor();
  assert.equal(await loading.getByRole('progressbar').getAttribute('aria-valuenow'), null, 'unknown durations do not invent a percentage');
  const shots = process.env.FREELANCER_QA_SHOTS;
  if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, 'project-loading.png') }); }
  files.release();
  await loading.locator('[aria-current="step"]').getByText('Build the conversation index').waitFor();
  chats.release();
  await loading.waitFor({ state: 'hidden' });
  const stats = await f.api('index/stats');
  assert.equal(stats.projects[0].files.sources, 1);
  assert.equal(stats.projects[0].chats.conversations, 3);
  await page.reload();
  await page.getByRole('button', { name: 'Application settings', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Content index', exact: true }).click();
  await page.getByRole('heading', { name: 'Content index', exact: true }).waitFor();
  assert.equal(builds, 1, 'first-open indexes are reused on reload');
  files = gate();
  await page.getByRole('button', { name: 'Refresh File Index', exact: true }).click();
  const status = page.locator('.index-job-progress');
  await status.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  assert.equal(await status.count(), 1, 'background index progress survives navigation');
  if (shots) await page.screenshot({ path: path.join(shots, 'background-progress.png') });
  await status.getByRole('button', { name: 'Stop', exact: true }).click();
  await status.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  files.release();
  await status.getByRole('button', { name: 'Retry', exact: true }).click();
  await status.getByRole('button', { name: 'Refresh again', exact: true }).waitFor();
  assert.equal(await status.getAttribute('data-state'), 'success');
  await status.getByRole('button', { name: 'Dismiss index status' }).click();
  await status.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Content index', exact: true }).click();
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await status.getByText('SQLite quick check passed.', { exact: true }).waitFor();
  await status.getByRole('button', { name: 'Dismiss index status' }).click();
  await page.getByRole('button', { name: 'Optimize', exact: true }).click();
  await status.getByText(/SQLite query plans and conversation search were optimized/).waitFor();
  await status.getByRole('button', { name: 'Dismiss index status' }).click();
  await page.getByRole('button', { name: 'Compact', exact: true }).click();
  await page.getByRole('button', { name: 'Compact now', exact: true }).click();
  await status.getByRole('button', { name: 'Dismiss index status' }).waitFor();
  assert.equal(await status.getByRole('button', { name: 'Run again' }).count(), 0, 'compaction keeps its explicit confirmation');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await status.locator('.ef-progress-track > span').evaluate(node => getComputedStyle(node).animationName), 'none');
  assert.deepEqual(errors, []);
  console.log('PASS first-open real indexes, phased loading, persisted readiness, background navigation, Stop/Retry, and SQLite status controls');
} finally { files.release(); chats.release(); await browser.close(); await f.close(); }
