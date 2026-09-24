import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { createLocalDataStore } from '../server/data/store.mjs';

const f = await localDataFixture();
const db = createLocalDataStore(path.join(f.root, 'user-data'));
db.markProjectIndexesReady(f.project.id); db.close();
const native = f.host.request.bind(f.host), replies = [];
let failAnswer = true;
f.host.request = async (route, options) => {
  if (/^\/(question|permission)\/[^/]+\/(reply|reject)$/.test(route)) {
    replies.push({ route, body: options.body });
    if (route === '/question/question_worker/reply' && failAnswer) { failAnswer = false; throw Error('Temporary answer failure'); }
    const [, kind, id] = route.split('/');
    f.state[kind === 'question' ? 'questions' : 'permissions'] = f.state[kind === 'question' ? 'questions' : 'permissions'].filter(row => row.id !== id);
    return true;
  }
  return native(route, options);
};
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => { errors.push(`Unexpected browser dialog: ${dialog.type()}`); void dialog.dismiss(); });
const question = (id, sessionID, text) => ({ id, sessionID, questions: [{ question: text, options: [{ label: 'Yes' }], custom: true }] });
const shots = process.env.FREELANCER_QA_SHOTS;
async function screenshot(name) { if (shots) { await mkdir(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, name + '.png') }); } }
try {
  await page.goto(f.url);
  await page.locator('.sidebar .sessions').getByRole('button', { name: /Important conversation/ }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Application settings', exact: true }).click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  await page.getByRole('button', { name: 'Update Model Ratings', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Update Model Ratings', exact: true });
  await picker.waitFor();
  assert.equal(await picker.getByRole('combobox', { name: 'Configuration model' }).evaluate(node => node === document.activeElement), true, 'initial focus goes to the model choice');
  await picker.getByRole('combobox', { name: 'Configuration model' }).selectOption('opencode/free');
  f.state.questions = [question('question_other', 'ses_other', 'Unrelated request must stay hidden'), question('question_worker', 'ses_worker', 'Worker clarification')];
  const worker = page.getByRole('dialog', { name: 'Subagent question', exact: true });
  await worker.waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal(await picker.count(), 0, 'the native stack hides the ordinary dialog');
  assert.equal(await page.getByText('Unrelated request must stay hidden').count(), 0);
  await worker.getByRole('textbox', { name: 'Custom answer: Worker clarification' }).fill('Keep this worker answer');
  await worker.getByRole('button', { name: 'Continue', exact: true }).click();
  await worker.getByRole('alert').getByText('Temporary answer failure').waitFor();
  assert.equal(await worker.getByRole('textbox').inputValue(), 'Keep this worker answer');
  await screenshot('subagent-priority');
  await worker.getByRole('button', { name: 'Continue', exact: true }).click();
  await picker.waitFor();
  assert.equal(await picker.getByRole('combobox').inputValue(), 'opencode/free', 'covered content survives worker replies');
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Update Model Ratings', exact: true }).evaluate(node => node === document.activeElement), true);

  await page.locator('.sidebar .sessions').getByRole('button', { name: /Important conversation/ }).click();
  f.state.questions = [question('question_parent', 'ses_history', 'Parent answer')];
  const parent = page.getByRole('dialog', { name: 'A quick question', exact: true });
  await parent.getByRole('textbox').fill('Preserve the parent draft');
  f.state.permissions = [{ id: 'permission_worker', sessionID: 'ses_worker', permission: 'edit', patterns: ['src/example.ts'] }];
  const permission = page.getByRole('dialog', { name: 'Subagent permission', exact: true });
  await permission.waitFor();
  await page.keyboard.press('Escape');
  await parent.waitFor();
  assert.equal(await parent.getByRole('textbox').inputValue(), 'Preserve the parent draft');
  assert.equal(replies.some(row => row.route.includes('permission')), false, 'Escape is Later, never consent or denial');
  await parent.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Review permission', exact: true }).click();
  await permission.getByRole('button', { name: 'Deny', exact: true }).click();
  await permission.waitFor({ state: 'hidden' });
  assert.equal(replies.find(row => row.route.includes('permission')).body.reply, 'reject');

  await page.getByRole('button', { name: 'Project picker', exact: true }).click();
  await page.getByRole('button', { name: 'Open a project…', exact: true }).click();
  const openProject = page.getByRole('dialog', { name: 'Open project', exact: true });
  await openProject.waitFor();
  assert.equal(await openProject.locator('.ef-dialog-body').getAttribute('data-layout'), 'split');
  await screenshot('project-dialog-wide');
  await page.setViewportSize({ width: 390, height: 700 });
  assert.equal((await openProject.locator('.ef-dialog-body').evaluate(node => getComputedStyle(node).gridTemplateColumns)).split(' ').length, 1);
  await page.keyboard.press('Escape');
  assert.equal(await openProject.count(), 0);
  f.state.questions = [{ id: 'question_long', sessionID: 'ses_worker', questions: [{ question: 'A long dynamic choice list',
    options: Array.from({ length: 60 }, (_, i) => ({ label: `Choice ${i}`, description: 'A useful description that wraps in a narrow window.' })) }] }];
  await worker.waitFor();
  await worker.getByRole('radio', { name: 'Choice 0 A useful description that wraps in a narrow window.', exact: true }).check();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const metrics = await worker.evaluate(node => {
    const body = node.querySelector('.ef-dialog-body'), footer = node.querySelector('.ef-dialog-footer');
    return { width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
      scrolling: body.scrollHeight > body.clientHeight, footerBottom: footer.getBoundingClientRect().bottom };
  });
  assert.ok(metrics.width <= 390 && metrics.height <= 700 && metrics.scrolling && metrics.footerBottom <= 700);
  await worker.getByRole('button', { name: 'Continue', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(await worker.getByRole('button', { name: 'Answer later', exact: true }).evaluate(node => node === document.activeElement), true);
  await screenshot('question-dialog-narrow');
  await page.keyboard.press('Escape');
  assert.equal(replies.some(row => row.route.includes('question_long')), false);
  assert.deepEqual(errors, []);
  console.log('PASS shared dialogs, worker priority, native replies/errors, preserved covered drafts, focus return, split layout and narrow scrolling');
} catch (error) { console.error('Browser errors:', errors); await screenshot('failure'); throw error; }
finally { await browser.close(); await f.close(); }
