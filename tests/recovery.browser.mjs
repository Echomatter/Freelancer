import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLocalDataStore } from '../server/data/store.mjs';
import { FRESH_RUNTIME_ID } from '../server/runtime-config.mjs';
import { LOCAL_DATA_APPLICATION_ID, LOCAL_DATA_SCHEMA_VERSION } from '../shared/data-contract.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

async function recoveryFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'freelancer-browser-recovery-'));
  const store = createLocalDataStore(root);
  store.initializeFreshRuntime(FRESH_RUNTIME_ID);
  store.close();
  let sequence = 0;
  return {
    root,
    restore() {
      const order = ++sequence;
      const id = `explicit-restore:browser-${order}`;
      const now = Date.now() + order;
      const db = new DatabaseSync(path.join(root, 'freelancer.sqlite'));
      try {
        db.prepare(`INSERT INTO data_migration_runs
          (migration_id,source_path,source_app_id,source_schema_version,source_sha256,status,manifest_json,started_at,completed_at)
          VALUES(?,?,?,?,?,'explicit-restore',?,?,?)`).run(id, root, LOCAL_DATA_APPLICATION_ID,
          LOCAL_DATA_SCHEMA_VERSION, String(order).repeat(64), JSON.stringify({ mode: 'explicit-restore',
            automaticReplay: false, uncertainOperationsPreserved: true, restoredRuntime: { runtimeID: FRESH_RUNTIME_ID } }), now, now);
      } finally { db.close(); }
      return id;
    },
    close: () => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }),
  };
}

test('restored work requires review of the current restore and stays released after reload', { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
  const recovery = await own(recoveryFixture());
  const firstRestore = recovery.restore();
  const f = await own(localDataFixture({ timers: false, recoveryDataHome: recovery.root }));
  await f.api('sender?project=history_project', { id: 'browser-recovery-delivery-0001', kind: 'queue',
    text: 'Continue only after explicit recovery review.', model: 'opencode/free', session: 'ses_history' });

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const confirmations = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/data/recovery')
      confirmations.push(request.postDataJSON());
  });
  await page.goto(f.url);
  async function openStorage() {
    const settings = page.getByRole('button', { name: 'Application settings', exact: true });
    if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
    await page.getByRole('button', { name: 'Content & Storage', exact: true }).click();
  }
  await openStorage();
  const warning = page.getByRole('heading', { name: 'Restored work is paused', exact: true });
  await expect(warning).toBeVisible();
  assert.equal((await f.api('data/recovery')).restoreID, firstRestore);
  const dialog = page.getByRole('dialog', { name: 'Confirm restored work recovery', exact: true });
  await page.getByRole('button', { name: 'Review automatic work', exact: true }).click();
  await expect(dialog).toContainText('Uncertain deliveries and Git actions still require their normal review.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(warning).toBeVisible();
  assert.deepEqual(confirmations, []);
  assert.equal(f.calls.filter(call => call.route === '/session/ses_history/prompt_async').length, 0);

  await page.getByRole('button', { name: 'Review automatic work', exact: true }).click();
  const currentRestore = recovery.restore();
  const staleResponse = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/data/recovery');
  await dialog.getByRole('button', { name: 'Allow automatic work', exact: true }).click();
  assert.equal((await staleResponse).status(), 409);
  await expect(dialog.getByRole('alert')).toContainText('This restore was superseded');
  await expect(warning).toBeVisible();
  assert.deepEqual(confirmations, [{ restoreID: firstRestore, confirm: true }]);
  assert.equal((await f.api('data/recovery')).automaticWorkBlocked, true);
  assert.equal(f.calls.filter(call => call.route === '/session/ses_history/prompt_async').length, 0);

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Retry storage data', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry storage data', exact: true })).toHaveCount(0);
  await expect(warning).toBeVisible();
  await page.getByRole('button', { name: 'Review automatic work', exact: true }).click();
  await dialog.getByRole('button', { name: 'Allow automatic work', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(warning).toHaveCount(0);
  assert.deepEqual(confirmations, [{ restoreID: firstRestore, confirm: true }, { restoreID: currentRestore, confirm: true }]);
  const reviewed = await f.api('data/recovery');
  assert.equal(reviewed.restoreID, currentRestore);
  assert.equal(reviewed.reviewed, true);
  await expect.poll(() => f.calls.filter(call => call.route === '/session/ses_history/prompt_async').length).toBe(1);

  await page.reload();
  await openStorage();
  await expect(page.getByRole('heading', { name: 'Content & Storage', exact: true })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review automatic work', exact: true })).toHaveCount(0);
  assert.equal((await f.api('storage')).recovery.automaticWorkBlocked, false);
  assert.equal(f.calls.filter(call => call.route === '/session/ses_history/prompt_async').length, 1);
});
