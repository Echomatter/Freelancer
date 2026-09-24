import test from "node:test";
import assert from "node:assert/strict";
import { publicCatalog } from "../server/catalog.mjs";

test("provider and nested model credentials never reach the browser", () => {
  const secret = "secret-that-must-stay-server-side";
  const result = publicCatalog({
    key: secret,
    default: { secret },
    connected: ["opencode-go", "external"],
    all: [
      {
        id: "opencode-go",
        key: secret,
        options: { apiKey: secret },
        env: [secret],
        models: {
          test: {
            name: "Test",
            key: secret,
            options: { secret },
            variants: {
              high: { options: { apiKey: secret } },
              hidden: { disabled: true },
            },
            limit: { context: 128000, secret },
            capabilities: { toolcall: true, secret },
            cost: { input: 1 },
          },
        },
      },
      { id: "external", name: secret, models: { secret } },
    ],
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(result.connected, ["opencode-go"]);
  assert.deepEqual(Object.keys(result.all[0]), ["id", "name", "models"]);
  assert.equal(result.all[0].models.test.limit.context, 128000);
  assert.deepEqual(result.all[0].models.test.variants, ["high"]);
});

test("OpenCode Free cannot expose metered or unpriced routes", () => {
  const models = {
    free: { cost: { input: 0, output: 0 } },
    paid: { cost: { input: 0, output: 1 } },
    unknown: {},
  };
  assert.deepEqual(
    Object.keys(
      publicCatalog({ all: [{ id: "opencode", models }] }).all[0].models,
    ),
    ["free"],
  );
});
