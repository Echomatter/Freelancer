import { test, expect } from './support/browser-test.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

for (const variants of [true, false]) {
  test(`model-defaults: ${variants ? 'supported intelligence and saved defaults' : 'model without intelligence controls'}`, { tag: ['@app'] }, async ({ appBrowser: browser, own }) => {
    const f = await own(localDataFixture());
    const native = f.host.request.bind(f.host);
    f.host.request = async (route, options) => {
      const value = await native(route, options);
      if (route === '/provider') value.all[0].models.free.variants = variants ? { high: {} } : {};
      return value;
    };
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
    await page.goto(f.url);
    await test.step('Choose a concrete model in the chat composer', async () => {
      await page.getByRole('button', { name: 'Chats', exact: true }).click();
      await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
      await page.getByRole('button', { name: 'Message options', exact: true }).click();
      const model = page.getByRole('combobox', { name: 'Parent model', exact: true });
      await expect(model).toBeEnabled();
      await model.selectOption('opencode/free');
      await expect(model).toHaveValue('opencode/free');
      await expect(model).not.toContainText(/OpenCode default|Agent default|Session default/);
      const intelligence = page.getByRole('combobox', { name: 'Intelligence', exact: true });
      if (variants) {
        await expect(intelligence.locator('option')).toHaveText(['Default', 'High']);
        await intelligence.selectOption('high');
      } else await expect(intelligence).toHaveCount(0);
    });
    await test.step('Save defaults and verify them after reopening settings', async () => {
      await page.getByRole('button', { name: 'Project settings', exact: true }).click();
      await page.getByRole('button', { name: 'Session defaults', exact: true }).click();
      const panel = page.locator('.session-defaults');
      await panel.getByRole('button', { name: 'Help: Session defaults', exact: true }).focus();
      await expect(page.getByRole('tooltip')).toContainText('Existing chats keep their choices.');
      await page.keyboard.press('Escape');
      await expect(panel).not.toContainText(/Maximum parallel|Spending preference|Excluded models/);
      await panel.getByRole('combobox', { name: 'Parent model', exact: true }).selectOption('opencode/free');
      const intelligence = panel.getByRole('combobox', { name: 'Intelligence', exact: true });
      if (variants) await intelligence.selectOption('high');
      else await expect(intelligence).toHaveCount(0);
      await panel.getByRole('button', { name: 'Save defaults', exact: true }).click();
      await expect(panel.locator('.session-start').getByRole('status')).toHaveText('Saved for new chats');
      await page.reload();
      await page.getByRole('button', { name: 'Project settings', exact: true }).click();
      await page.getByRole('button', { name: 'Session defaults', exact: true }).click();
      await expect(panel.getByRole('combobox', { name: 'Parent model', exact: true })).toHaveValue('opencode/free');
      if (variants) await expect(intelligence).toHaveValue('high');
    });
    await test.step('Agent-owned choices are shown as the source of the default', async () => {
      await page.locator('.settings-drawer-links').getByRole('button', { name: 'Agents', exact: true }).click();
      await page.locator('.catalog-card').filter({ has: page.getByRole('heading', { name: 'Engineer', exact: true }) }).getByRole('button', { name: 'Edit Engineer', exact: true }).click();
      const editor = page.getByRole('region', { name: 'Agent editor' });
      await editor.getByRole('combobox', { name: 'Default model', exact: true }).selectOption('opencode/free');
      if (variants) await editor.getByRole('combobox', { name: 'Intelligence', exact: true }).selectOption('high');
      await editor.getByRole('button', { name: 'Save agent', exact: true }).click();
      await expect(editor).not.toBeVisible();
      await page.getByRole('button', { name: 'Session defaults', exact: true }).click();
      const panel = page.locator('.session-defaults');
      await panel.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('engineer');
      await expect(panel).toContainText('Set by Engineer');
      await expect(panel.getByRole('combobox', { name: 'Parent model', exact: true })).toHaveCount(0);
      await expect(panel.getByRole('combobox', { name: 'Intelligence', exact: true })).toHaveCount(0);
    });
  });
}
