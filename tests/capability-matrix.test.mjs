import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedFixture } from './fixtures/unified-agents.mjs';
import { checkedCatalog, configureAgentProfiles } from '../backend/tools/runtime/agent-catalog.mjs';

const custom = { id: 'capability-specialist', name: 'Capability specialist',
  prompt: 'Use the shared toolkit to complete the assigned task.', model: 'auto',
  response: 'concise', approach: 'thorough', variant: 'inherit' };
const shared = ['bash', 'read', 'glob', 'grep', 'edit', 'write', 'apply_patch',
  'webfetch', 'websearch', 'lsp', 'skill', 'todowrite', 'question', 'content_index'];

test('named profiles share native defaults; persona introduces no capability deny', () => {
  const catalog = checkedCatalog({ agents: [custom] });
  const config = configureAgentProfiles({}, catalog);
  const expected = config.agent.engineer;
  for (const agent of catalog.agents) {
    assert.deepEqual(config.agent[agent.id].tools, expected.tools, agent.id);
    assert.deepEqual(config.agent[agent.id].permission, expected.permission, agent.id);
    for (const tool of shared) {
      assert.notEqual(config.agent[agent.id].tools?.[tool], false, `${agent.id}/${tool}`);
      assert.notEqual(config.agent[agent.id].permission?.[tool], 'deny', `${agent.id}/${tool}`);
    }
  }
});

test('application guard allows the same shared tool calls for built-in and custom assignments', async t => {
  const fixture = await unifiedFixture(t);
  const { id, ...definition } = custom;
  const saved = await fixture.app.saveAgent(definition);
  const ctx = await fixture.send();
  for (const agent of ['engineer', 'researcher', 'designer', saved.id]) {
    const receipt = await fixture.delegator.execute({ agent, task: `Exercise shared guard for ${agent}`,
      model: 'opencode/free-b' }, ctx);
    assert.equal(receipt.status, 'completed');
    const sessionID = receipt.attempts[0].child_session;
    for (const tool of shared) {
      await fixture.delegator.checkTool({ sessionID, tool }, { args: {} });
    }
    await assert.rejects(fixture.delegator.checkTool({ sessionID, tool: 'task' }, { args: {} }),
      /delegate\(\{agent, task\}\)/);
  }
});

// These fixtures prove application/profile parity, not provider tool exposure,
// dependency availability, model inference or native permission approval.

test('diagnostic inspection resolves captured context and rejects foreign session/agent choices', async t => {
  const fixture = await unifiedFixture(t);
  const ctx = await fixture.send();
  const result = await fixture.app.capabilities(fixture.project.id, { sessionID: ctx.sessionID, agent: 'engineer' });
  assert.equal(result.context.projectID, fixture.project.id);
  assert.equal(result.boundaries.inspectionOnly, false);
  assert.ok(result.instructions.requestID);
  assert.equal(result.instructions.sources.find(row => row.id === 'execution').state, 'captured');
  await assert.rejects(fixture.app.capabilities('foreign-project'), /Choose a project/);
  await assert.rejects(fixture.app.capabilities(fixture.project.id, { agent: 'nonexistent-agent' }), /Choose a named agent/);
  await assert.rejects(fixture.app.capabilities(fixture.project.id, { sessionID: 'ses_missing' }), /Unknown native session/);
});
