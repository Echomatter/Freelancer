// Capture the production UI against a disposable workspace, without changing
// the user's saved appearance or exposing their conversations.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { palettes } from '../domain/theme.mjs';
import { colorFixture } from '../tests/fixtures/color-app.mjs';

const output = path.resolve('artifacts/theme-gallery');
await mkdir(output, { recursive: true });
const fixture = await colorFixture();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(15000);
const fresh = palettes.slice(-8);

async function appearance() {
  const group = page.getByRole('button', { name: 'Application settings', exact: true });
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Use Porcelain palette', exact: true }).waitFor();
}

try {
  await page.goto(fixture.url);
  await appearance();
  for (const palette of fresh) {
    await page.getByRole('button', { name: `Use ${palette.name} palette`, exact: true }).click();
    await page.waitForFunction(id => document.documentElement.dataset.theme === id, palette.id);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    const chats = page.locator('.chat-navigation');
    const trigger = chats.getByRole('button', { name: 'Chats', exact: true });
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    await chats.locator('.nav-chat-select').filter({ hasText: 'Color test chat' }).click();
    await page.getByText('Normal message text stays neutral.').waitFor();
    const dismissIndex = page.getByRole('button', { name: 'Dismiss index status' });
    if (await dismissIndex.isVisible()) await dismissIndex.click();
    const hideAvailability = page.getByRole('button', { name: /Hide provider availability/ });
    if (await hideAvailability.isVisible()) await hideAvailability.click();
    if (await page.locator('.work-details').count() === 0)
      await page.getByRole('button', { name: 'Details', exact: true }).click();
    await page.screenshot({ path: path.join(output, `${palette.id}.png`), animations: 'disabled' });
    await appearance();
  }
  await page.screenshot({ path: path.join(output, 'all-cards.png'), fullPage: true, animations: 'disabled' });
  console.log(`Captured ${fresh.length} themes in ${output}`);
} finally {
  await browser.close();
  await fixture.close();
}
