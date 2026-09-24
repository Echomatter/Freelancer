import test from "node:test";
import assert from "node:assert/strict";
import { gitProjectFixture } from "./fixtures/git-project-app.mjs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

test("project-scoped HTTP setup, preview and checkpoint use real Git without model inference", async (t) => {
  const f = await gitProjectFixture();
  t.after(() => f.close());
  const request = async (route, body, method = "POST") => {
    const response = await fetch(f.url + "/api/" + route, {
      method,
      headers: {
        "X-Freelancer-Client": "webpage",
        "Content-Type": "application/json",
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
    return { response, data: await response.json() };
  };
  const first = await request("git?project=git_project", undefined, "GET");
  assert.equal(first.data.agreement.tracking, false);
  assert.equal(
    (
      await request("git/initialize", {
        project: f.project.id,
        name: "Tester",
        email: "test@example.invalid",
        confirm: true,
      })
    ).response.status,
    200,
  );
  const preview = await request("git/preview", {
    project: f.project.id,
    kind: "checkpoint",
    files: [".gitignore", "hello.txt"],
    message: "First checkpoint",
  });
  assert.equal(preview.data.status, "preview");
  assert.equal(
    (await request("git?project=git_project", undefined, "GET")).data.local
      .head,
    "",
  );
  const run = await request("git/execute", {
    project: f.project.id,
    planID: preview.data.id,
    confirm: true,
  });
  assert.equal(run.data.status, "completed");
  assert.match(run.data.result, /Nothing was uploaded/);
  assert.ok(
    (await request("git?project=git_project", undefined, "GET")).data.local
      .head,
  );
  assert.equal(
    (await request("git/agent", { action: "execute" })).response.status,
    403,
  );
  assert.equal(
    (await request("git?project=foreign", undefined, "GET")).response.status,
    400,
  );
});
test("HTTP rejects changed previews and forged cross-origin project mutations", async (t) => {
  const f = await gitProjectFixture();
  t.after(() => f.close());
  await f.app.gitProjects.initialize(f.project.id, {
    name: "Tester",
    email: "test@example.invalid",
    confirm: true,
  });
  const p = await f.app.gitProjects.preview(f.project.id, {
    kind: "checkpoint",
    files: ["hello.txt"],
    message: "Initial work",
  });
  await writeFile(
    path.join(f.directory, "hello.txt"),
    "Changed after approval",
  );
  const response = await fetch(f.url + "/api/git/execute", {
    method: "POST",
    headers: {
      "X-Freelancer-Client": "webpage",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project: f.project.id,
      planID: p.id,
      confirm: true,
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /changed/);
  const forged = await fetch(f.url + "/api/git/initialize", {
    method: "POST",
    headers: {
      "X-Freelancer-Client": "webpage",
      Origin: "https://foreign.example",
    },
    body: "{}",
  });
  assert.equal(forged.status, 403);
});
