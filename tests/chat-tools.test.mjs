import assert from 'node:assert/strict';
import test from 'node:test';
import { agentTurnEntries, chatAgentDetails, commandMessages, goalEventsByTurn, turnTools, turnWorking } from '../domain/chat-tools.mjs';
import { isInternalMessage, queuePrompt, userInitiatedRequest } from '../domain/sender.mjs';
import { nativeWorkerActivity } from '../server/worker-activity.mjs';

test('Commands retains actual tool receipts and excludes native recaps and response prose', () => {
  const command = { id: 'read', type: 'tool', tool: 'read', state: { status: 'completed', output: 'Retained file receipt' } };
  const worker = { id: 'worker', type: 'tool', tool: 'delegate', state: { status: 'completed' } };
  const recap = { info: { id: 'recap', role: 'assistant', summary: true }, parts: [{ type: 'text', text: '## Objective\nReview the Alpha Packer project.' }] };
  const mixed = { info: { id: 'reply', role: 'assistant' }, parts: [{ type: 'reasoning', text: 'Thinking' }, command, { type: 'text', text: 'Review completed.' }, worker] };
  const messages = [recap, mixed, { info: { id: 'text-only', role: 'assistant' }, parts: [{ type: 'text', text: 'Summary without commands.' }] }];
  const before = structuredClone(messages);
  assert.deepEqual(commandMessages(messages), [{ ...mixed, parts: [command] }]);
  assert.deepEqual(messages, before, 'the transcript and native recap remain unchanged');
  assert.deepEqual(turnTools({ allMessages: messages }).commands, [command]);
});

test('worker cards separate turn ownership and sort by latest summon rather than progress', () => {
  const old = { id: 'old', child: 'old-child', requestID: 'turn-1', updatedAt: '2026-10-01T10:00:00Z', raw: { created_at: '2026-10-01T01:00:00Z' } };
  const recent = { id: 'recent', child: 'recent-child', requestID: 'turn-2', raw: { created_at: '2026-10-01T02:00:00Z' } };
  const requests = [{ requestID: 'turn-1', allMessages: [] }, { requestID: 'turn-2', allMessages: [] }];
  assert.deepEqual(agentTurnEntries(turnTools(requests[1], [old, recent])).entries.map(e => e.key), ['recent-child']);
  requests[1].allMessages = [{ parts: [{ type: 'tool', tool: 'delegate', state: { status: 'completed', input: { worker: 'old-child', limit: 1 }, metadata: { sessionId: 'old-child', freelancer_status: 'running', task_id: 'old' } } }] }];
  assert.deepEqual(agentTurnEntries(turnTools(requests[1], [old, recent])).entries.map(e => e.key), ['recent-child']);
  assert.deepEqual(agentTurnEntries(chatAgentDetails(requests, [old, recent])).entries.map(e => e.key), ['recent-child', 'old-child']);
  old.attempt = { started_at: '2026-10-01T03:00:00Z' };
  assert.deepEqual(agentTurnEntries(chatAgentDetails(requests, [old, recent])).entries.map(e => e.key), ['old-child', 'recent-child']);
  const reused = { ...old, id: 'reused', phase: 'working', attempt: { started_at: '2026-10-01T04:00:00Z' }, updatedAt: '2026-10-01T04:01:00Z' };
  assert.equal(agentTurnEntries(chatAgentDetails(requests, [reused, old, recent])).entries[0].activity.id, 'reused');
});

test('native worker projection distinguishes terminal execution, idle recovery and unrelated workers', () => {
  const row = { child: 'child', phase: 'working', selected: 'provider/model', raw: { parent_session: 'parent', agent: { id: 'engineer' } } };
  const child = { id: 'child', parentID: 'parent' };
  const messages = [{ info: { id: 'user', role: 'user' } }, { info: { parentID: 'user', role: 'assistant', agent: 'engineer', providerID: 'provider', modelID: 'model', finish: 'stop', time: { completed: 100 } } }];
  assert.equal(nativeWorkerActivity(row, child, messages, 'parent').phase, 'completed');
  messages[0].info.time = { created: 1 };
  messages[0].info.summary = { title: 'Native user summary' };
  messages[1].info.time.created = 2;
  assert.equal(nativeWorkerActivity(row, child, [...messages].reverse(), 'parent').phase, 'completed');
  assert.equal(nativeWorkerActivity(row, child, messages, 'parent', { type: 'busy' }).phase, 'working');
  assert.equal(nativeWorkerActivity(row, child, messages.slice(0, 1), 'parent').phase, 'idle');
  assert.equal(nativeWorkerActivity(row, { ...child, parentID: 'other' }, messages, 'parent'), row);
  messages[1].parts = [{ type: 'tool', state: { status: 'running' } }];
  assert.equal(nativeWorkerActivity(row, child, messages, 'parent').phase, 'idle');
});

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
