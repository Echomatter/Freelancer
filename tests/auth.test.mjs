import test from "node:test";
import assert from "node:assert/strict";
import {
  connectionMethods,
  authInputs,
  initialInputs,
} from "../domain/auth.mjs";
const method = {
  type: "oauth",
  prompts: [
    {
      key: "deployment",
      type: "select",
      message: "Deployment",
      options: [{ value: "public" }, { value: "enterprise" }],
    },
    {
      key: "domain",
      type: "text",
      message: "Domain",
      when: { key: "deployment", op: "eq", value: "enterprise" },
    },
  ],
};
test("native auth methods retain conditional prompts and Go has a native key entry", () => {
  const methods = connectionMethods({
    openai: [{ type: "oauth" }],
    "github-copilot": [method],
    unrelated: [{ type: "api" }],
  });
  assert.deepEqual(Object.keys(methods), [
    "openai",
    "github-copilot",
    "unrelated",
    "opencode-go",
  ]);
  assert.equal(methods["github-copilot"][0], method);
  assert.equal(methods["opencode-go"][0].type, "api");
  const emptyMethods = [];
  const pluginMethods = [{ type: 'api', label: 'Plugin API key' }];
  const catalogMethods = connectionMethods({
    openai: methods.openai,
    'github-copilot': [method],
    'empty-native': emptyMethods,
    'plugin-native': pluginMethods,
    'invalid-native': null,
    'opencode-go': emptyMethods,
  }, [
    { id: 'anthropic' }, { id: 'custom-provider' }, { id: 'empty-native' },
    { id: 'openai' }, { id: 'github-copilot' }, { id: 'plugin-native' },
    { id: 'invalid-native' }, { id: '../unknown' }, { id: '' }, {},
  ]);
  assert.deepEqual(catalogMethods.anthropic, [{ type: 'api', label: 'API key' }]);
  assert.deepEqual(catalogMethods['custom-provider'], [{ type: 'api', label: 'API key' }]);
  assert.equal(catalogMethods.openai, methods.openai);
  assert.equal(catalogMethods['github-copilot'][0], method);
  assert.equal(catalogMethods['empty-native'], emptyMethods, 'An explicit empty native entry is not a missing method.');
  assert.equal(catalogMethods['plugin-native'], pluginMethods);
  assert.equal(catalogMethods['opencode-go'], emptyMethods, 'Go also preserves an explicit empty native entry.');
  for (const id of ['missing-provider', '../unknown', '', 'invalid-native'])
    assert.equal(Object.hasOwn(catalogMethods, id), false, `No generic key fallback for ${id || 'an empty ID'}.`);
});
test("auth forwards only visible declared fields and rejects invalid select values", () => {
  assert.deepEqual(initialInputs(method), { deployment: "public" });
  assert.deepEqual(
    authInputs(method, {
      deployment: "public",
      domain: "hidden",
      unexpected: "ignored",
    }),
    { deployment: "public" },
  );
  assert.throws(
    () => authInputs(method, { deployment: "enterprise" }),
    /Domain/,
  );
  assert.throws(
    () => authInputs(method, { deployment: "made-up" }),
    /Deployment/,
  );
  assert.deepEqual(
    authInputs(method, { deployment: "enterprise", domain: " example.com " }),
    { deployment: "enterprise", domain: "example.com" },
  );
});
