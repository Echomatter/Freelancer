import { localDataFixture } from './fixtures/local-data-app.mjs';
import { test, expect } from './support/browser-test.mjs';

for (const missing of ['timeout', 'any']) {
  test(`workspace and chat load without AbortSignal.${missing}`, { tag: ['@app', '@chat', '@capability'] }, async ({ appBrowser: browser, own }) => {
    const fixture = await own(localDataFixture());
    fixture.state.messages.ses_history = [
      { info: { id: 'compatibility-user', role: 'user' }, parts: [{ type: 'text', text: 'Keep my conversation available.' }] },
      { info: { id: 'compatibility-answer', role: 'assistant', parentID: 'compatibility-user' }, parts: [{ type: 'text', text: 'Your saved conversation is available.' }] },
    ];
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await page.addInitScript(method => {
      Object.defineProperty(AbortSignal, method, { configurable: true, value: undefined });
    }, missing);

    await page.goto(fixture.url);
    await expect(page.getByRole('button', { name: 'History project', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    const senderLoaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sender'
      && new URL(response.url()).searchParams.get('session') === 'ses_history' && response.ok(), { timeout: 10_000 });
    await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
    await expect(page.getByText('Your saved conversation is available.', { exact: true })).toBeVisible();
    await senderLoaded;
    await expect(page.locator('.sender-error')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeEnabled();
  });
}
