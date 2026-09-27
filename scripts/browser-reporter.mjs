import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function journeyResult(test, result) {
  return { name: test.title, outcome: result.status === 'passed' ? 'success' : result.status === 'skipped' ? 'skipped' : 'failure',
    status: result.status, durationMs: result.duration, retry: result.retry,
    errors: result.errors?.map(error => error.message) ?? [] };
}

export function journeyRunStatus(status, results, notRun) {
  const complete = !notRun.length && results.every(result => result.outcome === 'success');
  return status === 'passed' && !complete ? 'incomplete' : status;
}

export default class BrowserReporter {
  constructor() { this.results = new Map(); this.errors = []; }
  onBegin(config, suite) {
    this.started = Date.now();
    this.expected = suite.allTests().map(test => ({ id: test.id, name: test.title }));
    this.save('running');
  }
  onTestEnd(test, result) {
    this.results.set(test.id, journeyResult(test, result));
    this.save('running');
  }
  onError(error) { this.errors.push(error.message); }
  onEnd(result) { this.save(result.status); }
  save(status) {
    if (process.argv.includes('--list')) return;
    mkdirSync('artifacts/verification', { recursive: true });
    const allPalettes = process.env.FREELANCER_ALL_PALETTES === '1';
    const mode = process.env.FREELANCER_TEST_UI === '1' ? 'interactive' : allPalettes ? 'themes' : 'journeys';
    const notRun = this.expected?.filter(test => !this.results.has(test.id)).map(test => test.name) ?? [];
    writeFileSync(path.resolve(`artifacts/verification/browser-${mode}.json`), JSON.stringify({
      status: journeyRunStatus(status, [...this.results.values()], notRun), durationMs: Date.now() - this.started,
      expected: this.expected?.map(test => test.name) ?? [],
      results: [...this.results.values()],
      notRun,
      errors: this.errors,
      palettes: allPalettes ? 'all' : 'representative',
      liveProviderInference: 'not-run',
    }, null, 2) + '\n');
  }
}
