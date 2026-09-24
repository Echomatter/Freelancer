import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startServer } from "../server/http.mjs";

test("loopback API and asset boundaries reject foreign origins and forged hosts", async (t) => {
  const assets = await mkdtemp(path.join(os.tmpdir(), "freelancer-http-"));
  await writeFile(path.join(assets, "index.html"), "<main>Freelancer</main>");
  const { server, url } = await startServer({
    application: { bootstrap: async () => ({ ready: true }) },
    assets,
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
    return rm(assets, { recursive: true, force: true });
  });
  assert.equal((await fetch(url + "/api/bootstrap")).status, 403);
  assert.equal(
    (
      await fetch(url + "/api/bootstrap", {
        headers: {
          "X-Freelancer-Client": "webpage",
          Origin: "https://foreign.example",
        },
      })
    ).status,
    403,
  );
  const forgedStatus = await new Promise((resolve, reject) => {
    const request = http.get(
      url + "/api/bootstrap",
      {
        headers: { "X-Freelancer-Client": "webpage", Host: "foreign.example" },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on("error", reject);
  });
  assert.equal(forgedStatus, 403);
  assert.deepEqual(
    await (
      await fetch(url + "/api/bootstrap", {
        headers: { "X-Freelancer-Client": "webpage" },
      })
    ).json(),
    { ready: true },
  );
  const page = await fetch(url);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(page.status, 200);
  // Encoded forward-slash traversal escapes the asset root on every platform.
  assert.equal((await fetch(url + "/%2e%2e%2foutside.txt")).status, 403);
  // Backslash is a separator on Windows, but an ordinary filename on POSIX.
  assert.equal((await fetch(url + "/%2e%2e%5coutside.txt")).status,
    process.platform === "win32" ? 403 : 404);
});

test("HTTP errors preserve upstream status and expose a stable code", async (t) => {
  const assets = await mkdtemp(path.join(os.tmpdir(), "freelancer-http-error-"));
  await writeFile(path.join(assets, "index.html"), "<main>Freelancer</main>");
  const error = Object.assign(new Error("Provider rate limit reached"), {
    status: 429,
  });
  const { server, url } = await startServer({
    application: { bootstrap: async () => { throw error; } },
    assets,
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
    return rm(assets, { recursive: true, force: true });
  });
  const response = await fetch(url + "/api/bootstrap", {
    headers: { "X-Freelancer-Client": "webpage" },
  });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), {
    error: "Provider rate limit reached",
    code: "RATE_LIMITED",
  });
  error.message = "The request conflicts with a newer revision";
  error.status = 409;
  const conflict = await fetch(url + "/api/bootstrap", {
    headers: { "X-Freelancer-Client": "webpage" },
  });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), {
    error: "The request conflicts with a newer revision",
    code: "CONFLICT",
  });
});
