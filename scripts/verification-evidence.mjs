import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// Do not serialize the environment, step outputs, provider responses or secrets.
// This records which checkout/checks ran, not a claim of successful live work.
export function verificationEvidence({ commit, steps, env = process.env, now = new Date() }) {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw Error('A verified checkout SHA is required.');
  if (!steps || typeof steps !== 'object' || Array.isArray(steps)) throw Error('Step outcomes are required.');
  const status = value => ['success', 'failure', 'cancelled', 'skipped'].includes(value) ? value : 'unknown';
  return {
    schemaVersion: 1,
    recordedAt: now.toISOString(),
    checkoutCommit: commit,
    pullRequestHead: /^[a-f0-9]{40,64}$/.test(env.PR_HEAD_SHA ?? '') ? env.PR_HEAD_SHA : null,
    run: { id: env.GITHUB_RUN_ID ?? null, attempt: env.GITHUB_RUN_ATTEMPT ?? null, job: env.VERIFICATION_JOB ?? 'local' },
    runtime: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release() },
    checks: Object.entries(steps).map(([id, step]) => ({ id, outcome: status(step?.outcome), conclusion: status(step?.conclusion) })),
    liveProviderInference: 'not-run',
    coverage: 'Automated contracts, simulated-service browser journeys, and/or installed-runtime startup only; see each check outcome.',
  };
}

async function main() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10000 }).trim();
  const evidence = verificationEvidence({ commit, steps: JSON.parse(process.env.VERIFICATION_STEPS ?? '{}') });
  const name = `${evidence.run.job}-${process.platform}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const directory = path.resolve('artifacts', 'verification');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${name}.json`), JSON.stringify(evidence, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `\n### ${name}\n\nCheckout: ${commit}\n\n` +
      evidence.checks.map(check => `- ${check.id}: ${check.outcome}`).join('\n') +
      '\n\nNo live provider inference was performed.\n');
  }
  console.log(`Verification evidence: artifacts/verification/${name}.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
