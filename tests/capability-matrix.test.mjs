import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { unifiedFixture } from './fixtures/unified-agents.mjs';
import { checkedCatalog, configureAgentProfiles } from '../backend/tools/runtime/agent-catalog.mjs';

const custom = { id: 'capability-specialist', name: 'Capability specialist',
  prompt: 'Use the shared toolkit to complete the assigned task.', model: 'auto',
  response: 'concise', approach: 'thorough', variant: 'inherit' };
const shared = ['bash', 'read', 'glob', 'grep', 'edit', 'write', 'apply_patch',
  'webfetch', 'websearch', 'browser_navigate', 'service_custom_action', 'skill', 'todowrite', 'question', 'content_index',
  'playwright_browser_snapshot', 'fetch_fetch', 'memory_search_nodes',
  'sequential-thinking_sequentialthinking', 'context7_query-docs', 'jev_jev_triage'];

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

test('capability-use hints reach main and worker prompts across agents, models and projects without changing native access', async t => {
  const f = await unifiedFixture(t);
  const { id, ...definition } = custom;
  const saved = await f.app.saveAgent(definition);
  const secondDirectory = path.join(f.root, 'second-project');
  await mkdir(secondDirectory);
  const second = await f.app.addProject(secondDirectory);
  const nativeConfig = await f.host.request('/config');
  // Simulated shared native connections; this test does not contact MCP servers.
  nativeConfig.mcp = Object.fromEntries(['playwright', 'fetch', 'memory', 'sequential-thinking', 'context7', 'jev']
    .map(name => [name, { type: 'local', command: ['fixture-mcp'], enabled: true }]));
  const before = structuredClone(nativeConfig);
  const sessionCountBefore = f.rows.size;
  let expectedHints;
  function checkHints(body) {
    const hints = body.system.split(/\r?\n\r?\n/).filter(paragraph =>
      paragraph.startsWith('Capability-use hints are') || paragraph.startsWith('Consider Playwright'));
    assert.equal(hints.length, 2, 'one shared hint contract and capability meanings');
    expectedHints ??= hints;
    assert.deepEqual(hints, expectedHints);
    assert.match(hints[0], /across all agents, models and projects/);
    assert.match(hints[0], /called directly through native OpenCode without loading a skill/);
    assert.match(hints[0], /not as required calls, routing rules, triggers, stages or prerequisites/);
    for (const name of ['Playwright', 'Fetch', 'Context7', 'Memory', 'Sequential Thinking', 'JEV'])
      assert.ok(hints[1].includes(name), name);
    assert.equal(body.tools, undefined, 'guidance must not introduce a request allowlist');
    assert.equal(body.permission, undefined, 'guidance must not change native permission');
  }
  for (const project of [f.project, second]) {
    const directory = project === f.project ? f.directory : secondDirectory;
    for (const agent of ['engineer', 'researcher', 'designer', saved.id]) {
      for (const model of ['opencode/free-a', 'opencode/free-b']) {
        const session = await f.app.createChat(project.id, `${agent} shared hints`);
        await f.app.send(project.id, session.id, { text: 'Inspect the existing implementation.', agentID: agent, model });
        const main = f.prompts.at(-1).body;
        checkHints(main);
        assert.equal(`${main.model.providerID}/${main.model.modelID}`, model, 'explicit main model is honored');
        const ctx = { ...f.context(session.id), directory };
        const receipt = await f.delegator.execute({ agent, task: 'Inspect one bounded question.', model }, ctx);
        assert.equal(receipt.status, 'completed');
        const child = f.prompts.at(-1).body;
        checkHints(child);
        assert.equal(`${child.model.providerID}/${child.model.modelID}`, model, 'JEV hints do not replace explicit worker choice');
        const sessionID = receipt.attempts[0].child_session;
        for (const tool of shared.slice(-6)) {
          await f.delegator.checkTool({ sessionID: session.id, directory, tool }, { args: {} });
          await f.delegator.checkTool({ sessionID, directory, tool }, { args: {} });
        }
      }
    }
  }
  assert.deepEqual(await f.host.request('/config'), before, 'hints leave native connection configuration unchanged');
  assert.equal(f.calls.some(call => call.route.startsWith('/mcp')), false,
    'guidance composition does not connect services or call JEV/Memory');
  assert.equal(f.rows.size - sessionCountBefore, 32, 'only the requested main/worker sessions are created');
  assert.equal([...f.rows.values()].flatMap(rows => rows.flatMap(row => row.parts ?? []))
    .some(part => part.type === 'tool' && part.tool === 'skill'), false,
    'direct shared-tool guard access needs no prior skill load');
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
