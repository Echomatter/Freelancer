import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../tools/runtime/bridge.mjs';

test('auxiliary process honors cancellation and timeout', async () => {
  const aborted = AbortSignal.abort();
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(0)'], { signal: aborted }), /Cancelled before/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 }), /timed out/);
  const controller = new AbortController();
  const pending = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
});

test('auxiliary output is bounded and stderr diagnostics are opt-in', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(5*1024*1024))']), /output limit/);
  const script = 'process.stderr.write("x".repeat(100000) + "index failure"); process.exitCode = 2';
  await assert.rejects(runProcess(process.execPath, ['-e', script]), /^Error: Auxiliary process exited 2$/);
  await assert.rejects(runProcess(process.execPath, ['-e', script], { errorOutput: true }), error => {
    assert.ok(error.message.endsWith('index failure'));
    assert.ok(error.message.length <= 16384);
    return true;
  });
});
