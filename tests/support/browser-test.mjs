import { test as base, expect } from '@playwright/test';

// Reuse a browser process per worker, but never a context, server or database.
// Register resources before navigation so setup failures also clean up.
export const test = base.extend({
  own: async ({}, use) => {
    const resources = [];
    await use(async promise => {
      const resource = await promise;
      if (typeof resource.close !== 'function') return resource;
      const close = resource.close.bind(resource);
      let closing;
      resource.close = () => closing ??= Promise.resolve().then(close);
      resources.push(resource);
      return resource;
    });
    const errors = [];
    for (const resource of resources.reverse()) {
      try { await resource.close(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Browser fixture cleanup failed');
  },
  appBrowser: async ({ browser }, use, info) => {
    const contexts = [], errors = [];
    async function newContext(options = {}) {
      const context = await browser.newContext(options);
      contexts.push(context);
      context.setDefaultTimeout(info.project.use.actionTimeout);
      context.setDefaultNavigationTimeout(info.project.use.navigationTimeout);
      context.on('page', page => page.on('pageerror', error => errors.push(error.stack ?? error.message)));
      return context;
    }
    const close = async () => {
      const results = await Promise.allSettled(contexts.splice(0).map(context => context.close()));
      const failed = results.filter(row => row.status === 'rejected').map(row => row.reason);
      if (failed.length) throw new AggregateError(failed, 'Browser context cleanup failed');
    };
    // Playwright itself records traces/screenshots for these contexts, including
    // explicit closes in the journey's finally block. Do not start a second trace.
    await use({ newContext, newPage: async options => (await newContext(options)).newPage(), close });
    await close();
    if (errors.length) await info.attach('browser-errors', { body: errors.join('\n\n'), contentType: 'text/plain' });
    expect(errors, 'No uncaught browser errors in any journey page').toEqual([]);
  },
});

export { expect };
