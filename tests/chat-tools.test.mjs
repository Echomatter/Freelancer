import assert from 'node:assert/strict';
import test from 'node:test';
import { agentTurnEntries, goalEventsByTurn, turnTools, turnWorking } from '../domain/chat-tools.mjs';
import { isInternalMessage, queuePrompt, userInitiatedRequest } from '../domain/sender.mjs';

test('user Queue, Delegate and Steer handoffs retain clean request text for transcript cards', () => {
  const requests = [
    ['queue', queuePrompt('Follow up after the current turn.', 'queue_card_0001')],
    ['delegate', '[Freelancer Delegate handoff delegate_card_0001]\nOriginal parent request:\nKeep context.\n\nUser concern:\nInspect this focused issue.'],
    ['steer', '[Freelancer Steer handoff steer_card_0001]\nInstruction wrapper.\n\nUser correction:\nChange direction slightly.'],
  ];
  for (const [kind, text] of requests) {
    const message = { info: { role: 'user' }, parts: [{ type: 'text', text }] };
    assert.equal(isInternalMessage(message), true);
    assert.deepEqual(userInitiatedRequest(text), {
      kind,
      text: kind === 'queue' ? 'Follow up after the current turn.'
        : kind === 'delegate' ? 'Inspect this focused issue.' : 'Change direction slightly.',
    });
  }
});

test('turn details match native child or request identity and exclude other turns', () => {
  const request = { requestID: 'request-1', allMessages: [
    { info: { id: 'user-1', role: 'user', modelID: 'requested-only', providerID: 'provider' }, parts: [] },
    { info: { id: 'reply-1', role: 'assistant', modelID: 'observed', providerID: 'provider' }, parts: [{ type: 'tool', id: 'delegate-1', tool: 'delegate', state: { status: 'completed', metadata: { sessionId: 'child-1' } } }] },
  ] };
  const result = turnTools(request, [
    { id: 'matched-child', child: 'child-1' }, { id: 'matched-request', requestID: 'request-1' },
    { id: 'native-owner', raw: { user_task_id: 'session-1/reply-1' } },
    { id: 'unrelated', child: 'child-2', requestID: 'request-2' },
  ]);
  assert.deepEqual(result.agents.map(row => row.id).sort(), ['matched-child', 'matched-request', 'native-owner']);
  assert.deepEqual(result.models, ['provider/observed']);
  assert.equal(result.handoffs.length, 1);
});

test('agent turn entries retain distinct handoffs and reports without later worker contamination', () => {
  const part = (id, task) => ({ id, callID: id, type: 'tool', tool: 'delegate', state: { status: 'completed', input: { worker: 'child', task }, output: `${id} report` } });
  const request = { requestID: 'turn-1', allMessages: [
    { parts: [part('dispatch', 'Concern handoff-1'), part('continue', 'Follow up')] },
    { info: { role: 'user' }, parts: [{ type: 'text', text: '[Freelancer Delegate handoff handoff-1]\nUser concern' }] },
  ] };
  const details = turnTools(request, [{ id: 'old', child: 'child', requestID: 'turn-1' }, { id: 'later', child: 'child', requestID: 'turn-2', phase: 'working' }]);
  const { entries, unmatched } = agentTurnEntries(details);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].activity.id, 'old');
  assert.deepEqual(entries[0].parts.map(p => p.state.output), ['dispatch report', 'continue report']);
  assert.equal(entries[0].messages.length, 1);
  assert.equal(unmatched.length, 0);
  assert.equal(details.commands.length, 0);
});

test('tab animation tracks scoped work, not waiting, stale records or the goal running label', () => {
  const details = { commands: [], agentTools: [], agents: [] };
  assert.deepEqual(turnWorking(details, { current: true, goalStatus: 'running' }), { commands: false, agents: false, models: false, goals: false });
  assert.equal(turnWorking(details, { current: true, busy: true }).models, true);
  details.commands.push({ state: { status: 'running' } });
  assert.deepEqual(turnWorking(details, { current: true, busy: true, goalStatus: 'running' }), { commands: true, agents: false, models: false, goals: true });
  assert.deepEqual(turnWorking(details, { current: false, busy: true, goalStatus: 'running' }), { commands: false, agents: false, models: false, goals: false });
  assert.equal(turnWorking(details, { current: true, busy: true, blocked: true }).commands, false);
  details.agents = [{ phase: 'tool' }];
  assert.equal(turnWorking(details).agents, true);
  for (const row of [{ phase: 'working', stale: true }, { phase: 'selection_required' }, { phase: 'waiting_input' }, { phase: 'completed' }]) {
    details.agents = [row];
    assert.equal(turnWorking(details).agents, false);
  }
});

test('an assignment that never starts a child retains its card and handoff together', () => {
  const part = { id: 'native-call', type: 'tool', tool: 'delegate', state: { metadata: { task_id: 'assignment', freelancer_status: 'delegation_unavailable' } } };
  const details = turnTools({ allMessages: [{ parts: [part] }] }, [{ id: 'assignment', phase: 'delegation_unavailable', raw: { user_task_id: 'custom-task-id' } }]);
  const { entries } = agentTurnEntries(details);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].activity.id, 'assignment');
  assert.deepEqual(entries[0].parts, [part]);
});

test('goal events belong to exactly one turn at the native request boundary', () => {
  const groups = [100, 200].map(created => ({ userMessages: [{ info: { time: { created } } }], allMessages: [] }));
  const events = [50, 199, 200, 300].map(at => ({ at, kind: 'model' }));
  assert.deepEqual(goalEventsByTurn(groups, events), [events.slice(0, 2), events.slice(2)]);
  assert.deepEqual(goalEventsByTurn([], events), []);
});
