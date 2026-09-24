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
    "opencode-go",
  ]);
  assert.equal(methods["github-copilot"][0], method);
  assert.equal(methods["opencode-go"][0].type, "api");
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
