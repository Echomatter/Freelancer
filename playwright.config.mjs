import { defineConfig } from '@playwright/test';
import { applyTestEnvironment, createTestEnvironment } from './scripts/test-environment.mjs';

// Also protect direct `npx playwright test` invocations that bypass our runner.
const testEnvironment = createTestEnvironment();
applyTestEnvironment(testEnvironment);
process.once('exit', () => testEnvironment.cleanup());

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.browser.mjs',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: process.env.FREELANCER_ALL_PALETTES === '1' ? 600_000 : 90_000,
  expect: { timeout: 10_000 },
  outputDir: process.env.FREELANCER_TEST_UI === '1' ? 'test-results/interactive'
    : process.env.FREELANCER_ALL_PALETTES === '1' ? 'test-results/themes' : 'test-results/journeys',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/browser-report', open: 'never' }],
    ['./scripts/browser-reporter.mjs'],
  ],
  use: {
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Hundreds of theme transitions create huge DOM archives. Keep the action
    // and source trace plus failure screenshot; full snapshots remain available
    // in normal and interactive journeys.
    trace: process.env.FREELANCER_ALL_PALETTES === '1' && process.env.FREELANCER_TEST_UI !== '1'
      ? { mode: 'retain-on-failure', snapshots: false, screenshots: false, sources: true }
      : 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
