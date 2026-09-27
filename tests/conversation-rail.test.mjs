import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportedContext, turnStatistics } from '../domain/conversation-rail.mjs';
import { buildRequestGroups } from '../domain/chat-view.mjs';
import { railOffset, railPosition } from '../src/echoflex/rail-geometry.mjs';
import { sessionSummary } from '../shared/view.mjs';

const models = [{ id: 'p/m', name: 'Example', context: 100000 }, { id: 'p/small', context: 10000 }];
const response = (id, tokens, modelID = 'm') => ({ info: { id, role: 'assistant', providerID: 'p', modelID, tokens }, parts: [] });
test('context reflects the latest reported call, its actual model and post-compaction drop', () => {
  const old = response('old', { input: 65000, output: 10000, reasoning: 5000, cache: { read: 10000, write: 5000 } });
  assert.equal(reportedContext([old], models).used, 90000);
  assert.equal(reportedContext([old, response('recap', { input: 10000, output: 5000 })], models).ratio, .15);
  assert.equal(reportedContext([old, response('new-model', { total: 5000, input: 1000, output: 1000 }, 'small')], models).ratio, .5);
  assert.equal(reportedContext([old, response('stream', {})], models).ratio, .9);
  assert.equal(reportedContext([response('over', { total: 150000 })], models).ratio, 1);
  assert.equal(reportedContext([], models).ratio, null);
  assert.equal(reportedContext([old], []).ratio, null);
  assert.equal(reportedContext([response('zero-total', { total: 0, input: 12000, cache: { write: 5000 } })], models).used, 17000);
  assert.equal(reportedContext([response('cache-only', { cache: { write: 5000 } })], models).used, 5000);
  const details = sessionSummary([old.info], [{ id: 'p', models: { m: { limit: { context: 100000 } } } }]);
  assert.equal(details.contextPercent, reportedContext([old], models).ratio * 100);
});
test('turn statistics retain native counts without inventing unavailable usage or completion', () => {
  const group = buildRequestGroups([
    { info: { id: 'u', role: 'user', time: { created: 1000 } }, parts: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'PRIVATE ORIENTATION', synthetic: true }] },
    { ...response('a', { input: 1000, output: 200, cache: { read: 500 } }), parts: [{ id: 't', type: 'tool', tool: 'read', state: { status: 'completed' } }] },
  ])[0];
  const stats = turnStatistics(group, models);
  assert.equal(stats.preview, 'Hello'); assert.equal(stats.status, 'Recorded');
  assert.equal(stats.stats.find(s => s.label === 'Input + cache').value, '1,500');
  assert.equal(stats.stats.find(s => s.label === 'Actions').value, '1');
  assert.ok(!stats.stats.some(s => s.label === 'Elapsed'));
  assert.equal(turnStatistics(group, models, true).status, 'Working');
  group.responseMessages[0].info.tokens = undefined;
  assert.equal(turnStatistics(group).stats.find(s => s.label === 'Output').value, 'Not reported');
});
test('turn rail interpolation is monotonic and reversible across unequal turns', () => {
  const anchors = [0, 25, 30, 900], maximum = 1300;
  let previous = -1;
  for (let offset = 0; offset <= maximum; offset += 5) {
    const position = railPosition(offset, anchors, maximum);
    assert.ok(position >= previous); previous = position;
    assert.ok(Math.abs(railOffset(position, anchors, maximum) - offset) < 1);
  }
  assert.equal(railOffset(-1, anchors, maximum), 0);
  assert.equal(railOffset(5, anchors, maximum), maximum);
  assert.equal(railPosition(20, [], 0), 0);
  assert.equal(railOffset(.5, [0, 0, 0], 0), 0);
  assert.equal(railPosition(300, [0, 300, 300], 300), 1);
});
