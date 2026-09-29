import assert from 'node:assert/strict';
import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

test('history-search', { tag: ["@app"] }, async ({ appBrowser: browser, own }) => {
  // Production UI with the native transport stubbed by the local-data fixture.

  const f = await own(localDataFixture());

  try {
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(12000);
    await page.goto(f.url);
    await test.step('Native activity agrees in Chats and History', async () => {
      await page.getByRole('button', { name: 'Chats', exact: true }).click();
      f.state.status.ses_worker = { type: 'busy' };
      const chat = page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' });
      await expect(chat.getByRole('img', { name: 'Helper working', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Application settings', exact: true }).click();
      await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
      await expect(page.locator('.history-page').getByRole('img', { name: 'Helper working', exact: true })).toBeVisible();
      delete f.state.status.ses_worker;
      await expect(chat.getByRole('img', { name: 'Helper working', exact: true })).toHaveCount(0);
      await expect(page.locator('.history-page').getByRole('img', { name: 'Helper working', exact: true })).toHaveCount(0);
    });
    await page.getByRole('heading', { name: 'Conversation history' }).waitFor();
    await page.getByRole('checkbox', { name: 'Select Important conversation' }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Select Important conversation' }).count(), 1);
    await page.getByRole('button', { name: 'Pin Important conversation' }).click();
    await page.getByRole('button', { name: 'Unpin Important conversation' }).waitFor();
    await page.getByRole('checkbox', { name: 'Select Important conversation' }).check();
    assert.equal(await page.getByRole('button', { name: 'Export selected' }).isEnabled(), true);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export selected' }).click();
    assert.match((await download).suggestedFilename(), /\.md$/);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select Important conversation' }).waitFor();
    assert.equal((await f.api('history?project=history_project&scope=archived')).sessions[0].id, 'ses_history');
    console.log('PASS settings navigation opens conversation history with activity, pin, archive, and export controls');
  } finally {
    await browser.close();
    await f.close();
  }
});
