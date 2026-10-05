import { test, expect } from './support/browser-test.mjs';
import { localDataFixture } from './fixtures/local-data-app.mjs';

test('computer operation evidence appears in the existing request tool card', { tag: ['@app', '@chat'] }, async ({ appBrowser, own }) => {
  const f = await own(localDataFixture({ timers: false }));
  f.state.messages.ses_history = [
    { info: { id: 'request', role: 'user' }, parts: [{ type: 'text', text: 'Inspect the local page.' }] },
    { info: { id: 'reply', parentID: 'request', role: 'assistant' }, parts: [{
      id: 'computer-call', type: 'tool', tool: 'computer', state: {
        status: 'completed', title: 'Computer · click', input: { operation: 'execute', action: 'click' },
        output: JSON.stringify({ status: 'executed', verification: 'not_verified' }),
        metadata: { freelancer_computer: { provider: 'browser-harness', evidence: {
          action: { status: 'completed', name: 'click' },
          state: { status: 'not_observed' }, outcome: { status: 'not_verified' },
        } } },
      },
    }] },
  ];
  const page = await appBrowser.newPage({ viewport: { width: 1280, height: 850 } });
  try {
    await page.goto(f.url);
    await page.getByRole('button', { name: 'Chats', exact: true }).click();
    await page.locator('.nav-chat-select').filter({ hasText: 'Important conversation' }).click();
    await page.getByRole('button', { name: /^Commands / }).click();
    const card = page.getByRole('region', { name: 'Commands view', exact: true }).locator('.tool-card').filter({ hasText: 'Computer · click' });
    await expect(card).toHaveCount(1);
    await card.locator('summary').click();
    const evidence = card.locator('[aria-label="Computer evidence"]');
    await expect(evidence).toContainText('Provider Browser Harness');
    await expect(evidence).toContainText('Action click completed');
    await expect(evidence).toContainText('State not observed');
    await expect(evidence).toContainText('Outcome not verified');
  } finally { await appBrowser.close(); }
});
