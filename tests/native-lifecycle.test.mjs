import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { retainOwnershipUntilClosed } from '../server/native-lifecycle.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

test('unconfirmed native closure keeps ownership pending until the actual close promise resolves', async t => {
  const closed = deferred(), error = Error('Native shutdown was not confirmed.'), reports = [];
  let settled = false;
  t.after(() => closed.resolve());
  const pending = retainOwnershipUntilClosed(error, closed.promise, { report: (...args) => reports.push(args) })
    .then(() => { settled = true; });
  await delay(20);
  assert.equal(settled, false);
  assert.equal(reports.length, 1); assert.match(reports[0][0], /retaining Freelancer ownership/);
  assert.equal(reports[0][1], error);
  closed.resolve(); await pending;
  assert.equal(settled, true);
});

test('already confirmed native closure returns and clears its ownership reference', async t => {
  const report = t.mock.fn();
  await retainOwnershipUntilClosed(Error('Prior shutdown timeout.'), Promise.resolve(), { report });
  assert.equal(report.mock.calls.length, 1);
});

test('missing native close confirmation throws the original error without pretending closure', async () => {
  const error = Error('Native shutdown is still unconfirmed.'), reports = [];
  for (const absent of [undefined, null, false, {}, true])
    await assert.rejects(retainOwnershipUntilClosed(error, absent, { report: (...args) => reports.push(args) }), caught => caught === error);
  assert.deepEqual(reports, []);
});

test('a throwing lifecycle reporter cannot break the ownership hold', async t => {
  const closed = deferred(); let settled = false;
  t.after(() => closed.resolve());
  const pending = retainOwnershipUntilClosed(Error('Unconfirmed native close.'), closed.promise,
    { report: () => { throw Error('Fixture reporting failed.'); } }).then(() => { settled = true; });
  await delay(20); assert.equal(settled, false);
  closed.resolve(); await pending; assert.equal(settled, true);
});

test('lifecycle reporting defaults to console.error', async t => {
  const error = Error('Prior native close timeout.'), report = t.mock.method(console, 'error', () => {});
  await retainOwnershipUntilClosed(error, Promise.resolve());
  assert.equal(report.mock.calls.length, 1); assert.equal(report.mock.calls[0].arguments[1], error);
});

test('a referenced ownership hold keeps a Node owner alive until its unreferenced child actually closes', { timeout: 10_000 }, async t => {
  const helper = new URL('../server/native-lifecycle.mjs', import.meta.url).href;
  const source = `
    import { spawn } from 'node:child_process';
    import { retainOwnershipUntilClosed } from ${JSON.stringify(helper)};
    const worker=spawn(process.execPath,['-e','setTimeout(()=>{},1500)'],{stdio:'ignore',windowsHide:true});
    const whenClosed=new Promise(resolve=>worker.once('close',resolve));
    worker.unref();
    console.log(JSON.stringify({stage:'holding',owner:process.pid,child:worker.pid}));
    await retainOwnershipUntilClosed(Error('Fixture close is pending.'),whenClosed,{report:()=>{}});
    console.log(JSON.stringify({stage:'closed'}));
  `;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const holding = deferred(), closed = deferred(), receipts = [];
  let output = '', stderr = '', childPID, childConfirmedClosed = false;
  const finished = new Promise((resolve, reject) => { owner.once('error', reject); owner.once('close', (code, signal) => resolve({ code, signal })); });
  t.after(async () => {
    if (owner.exitCode === null && owner.signalCode === null) owner.kill();
    if (childPID && !childConfirmedClosed) {
      try { process.kill(childPID); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await finished;
  });
  owner.stderr.on('data', chunk => { stderr += chunk; });
  owner.stdout.on('data', chunk => {
    output += chunk;
    while (output.includes('\n')) {
      const end = output.indexOf('\n'), line = output.slice(0, end); output = output.slice(end + 1);
      if (!line.trim()) continue;
      const receipt = JSON.parse(line); receipts.push(receipt);
      if (receipt.stage === 'holding') { childPID = receipt.child; holding.resolve(receipt); }
      if (receipt.stage === 'closed') { childConfirmedClosed = true; closed.resolve(receipt); }
    }
  });
  const earlyExit = finished.then(result => { throw Error(`Node owner exited before closure: ${JSON.stringify(result)} ${stderr}`); });
  const receipt = await Promise.race([holding.promise, earlyExit]);
  assert.equal(receipt.owner, owner.pid); assert.ok(Number.isInteger(receipt.child));
  await delay(75);
  assert.equal(owner.exitCode, null); assert.equal(owner.signalCode, null);
  assert.doesNotThrow(() => process.kill(owner.pid, 0), 'The owner PID must remain live while child closure is pending.');
  assert.doesNotThrow(() => process.kill(receipt.child, 0), 'The owned Node child is still running.');
  await Promise.race([closed.promise, earlyExit]);
  assert.deepEqual(await finished, { code: 0, signal: null });
  assert.deepEqual(receipts.map(row => row.stage), ['holding', 'closed']);
});
