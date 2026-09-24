import { checkedCatalog, configureAgentProfiles } from '../backend/tools/runtime/agent-catalog.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { enableSessionTodos } from '../backend/tools/runtime/todo-policy.mjs';
import { executionPrompt } from '../server/execution.mjs';

test('native todos default on in every mode/helper and custom agent', () => {
  const config = { agent: { custom: { permission: { edit: 'deny' } } } };
  configureAgentProfiles(config, checkedCatalog());
  enableSessionTodos(config);
  for (const name of ['engineer', 'researcher', 'designer', 'git', 'custom'])
    assert.equal(config.agent[name].permission.todowrite, 'allow', name);
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

test('work-mode prompts allow session tracking without changing tool authority', () => {
  for (const mode of ['build', 'plan', 'explore', 'review']) {
    const text = executionPrompt(null, { name: mode, mode, prompt: '' }, {});
    assert.match(text, /Every workflow and agent may read and update native session todos/);
    assert.match(text, /does not authorize source writes/);
    assert.match(text, /They do not grant or remove tool authority/);
  }
});
