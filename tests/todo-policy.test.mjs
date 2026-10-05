import { checkedCatalog, configureAgentProfiles } from '../backend/tools/runtime/agent-catalog.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { enableSessionTodos } from '../backend/tools/runtime/todo-policy.mjs';
import { executionPrompt } from '../server/execution.mjs';

test('native todos default on in every mode/helper and custom agent', () => {
  const config = { agent: { custom: { permission: { edit: 'deny' } } } };
  const catalog = checkedCatalog();
  configureAgentProfiles(config, catalog);
  enableSessionTodos(config);
  for (const name of [...catalog.agents.map(agent => agent.id), 'custom'])
    assert.equal(config.agent[name].permission.todowrite, 'allow', name);
  assert.equal(config.agent.git.disable, true, 'the retired Git agent stays disabled');
  assert.equal(config.agent.custom.permission.edit, 'deny');
  const before = structuredClone(config);
  configureAgentProfiles(config, checkedCatalog());
  enableSessionTodos(config);
  assert.deepEqual(config, before);
});

test('explicit native todo and whole-agent actions remain authoritative', () => {
  for (const action of ['deny', 'ask', 'allow']) {
    const config = { agent: { engineer: { permission: { todowrite: action, edit: 'deny' } }, custom: { permission: action } } };
    configureAgentProfiles(config, checkedCatalog());
  enableSessionTodos(config);
    assert.equal(config.agent.engineer.permission.todowrite, action);
    assert.equal(config.agent.engineer.permission.edit, 'deny');
    assert.equal(config.agent.custom.permission, action);
    const global = { permission: { todowrite: action } };
    configureAgentProfiles(global, checkedCatalog());
    enableSessionTodos(global);
    assert.equal(global.agent.researcher.permission.todowrite, action);
    const broad = { permission: action };
    configureAgentProfiles(broad, checkedCatalog());
    enableSessionTodos(broad);
    assert.equal(broad.agent.engineer.permission, action);
    const wildcard = { permission: { '*': action }, agent: { engineer: { permission: { '*': action, edit: 'deny' } } } };
    configureAgentProfiles(wildcard, checkedCatalog());
    enableSessionTodos(wildcard);
    assert.equal(wildcard.agent.researcher.permission.todowrite, action);
    assert.equal(wildcard.agent.engineer.permission.todowrite, action);
  }
});

test('fixed Build prompt keeps native todos separate from source-write authority', () => {
  const text = executionPrompt(null, {}, { agents: [] });
  assert.match(text, /Work mode: build/);
  assert.match(text, /Every agent may read and update native session todos/);
  assert.match(text, /Todos track work; they do not authorize source writes/);
  assert.match(text, /All named agents share the available toolkit/);
  assert.match(text, /native `question` tool/);
  assert.match(text, /An inspectionOnly assignment forbids source edits/);
  assert.match(text, /`delegate\(\)` discovery returns current agent IDs and eligible budget.modelPool/);
  assert.match(text, /Ordinary chats do not call goal_checkpoint/);
  assert.match(text, /steer to correct active work/);
  assert.match(text, /switch the parent model/);
});
