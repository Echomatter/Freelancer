import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Forward native filtering, UI, headed, debug and worker controls. Unknown
// filters fail instead of silently reporting an empty passing suite.
const args = process.argv.slice(2);
// Discovery must not replace evidence or HTML reports from an executed suite.
if (args.includes('--list') && !args.some(arg => /^--reporter(?:=|$)/.test(arg))) args.push('--reporter=list');
if (args.some(arg => /^--ui(?:=|-|$)/.test(arg))) {
  process.env.FREELANCER_TEST_UI = '1';
  process.env.PLAYWRIGHT_HTML_OUTPUT_DIR = 'artifacts/browser-interactive-report';
}
const all = args.indexOf('--all-palettes');
if (all >= 0) {
  args.splice(all, 1);
  process.env.FREELANCER_ALL_PALETTES = '1';
  process.env.PLAYWRIGHT_HTML_OUTPUT_DIR = 'artifacts/browser-theme-report';
}
// State the exhaustive cost up front: every palette is applied through the
// browser UI, so the sweep grows linearly with the palette count. Import the
// catalog only here to keep normal runs free of its startup cost.
if (process.env.FREELANCER_ALL_PALETTES === '1') {
  const { palettes } = await import('../domain/theme.mjs');
  const targets = args.filter(arg => !arg.startsWith('-'));
  console.log(`Exhaustive palette sweep: ${palettes.length} palettes x ${targets.length ? targets.join(' ') : 'all browser journeys'} (timeout 600s, traces without DOM snapshots).`);
}
const require = createRequire(import.meta.url);
const env = { ...process.env };
// Playwright sets FORCE_COLOR for workers. Preserve a monochrome preference
// without Node warning about two conflicting color controls on every worker.
if (env.NO_COLOR !== undefined) { delete env.NO_COLOR; env.FORCE_COLOR = '0'; }
const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...args], { stdio: 'inherit', env });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
