import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  command,
  executable,
  cleanGitEnv,
  installation,
} from "../server/git-command.mjs";
import { createGitProjects } from "../server/git-project.mjs";
import { createStore } from "../server/store.mjs";
import {
  projectAgreement,
  agreementText,
  repositoryName,
  safeRelative,
  parseGitStatus,
  validBranch,
  excludedFile,
  containsCredential,
} from "../domain/git-project.mjs";

async function fixture(t, preset = "review") {
  const root = await mkdtemp(path.join(os.tmpdir(), "freelancer-git-"));
  const directory = path.join(root, "project"),
    remote = path.join(root, "remote.git"),
    config = path.join(root, "empty-config");
  await mkdir(directory);
  await mkdir(config);
  const gitPath = await executable("git");
  const env = {
    HOME: config,
    USERPROFILE: config,
    XDG_CONFIG_HOME: config,
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const runGit = async (...args) => {
    const r = await command(gitPath, args, { cwd: directory, env });
    assert.equal(r.code, 0, `${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  await runGit("init", "--bare", "-b", "main", remote);
  const p = { id: "project", directory, name: "Git fixture" };
  const store = createStore(root);
  await store.update("settings", (s) => ({
    ...s,
    projects: [p],
    gitDefaults: { preset },
  }));
  let status = {},
    connected = true,
    source = "keyring",
    account = "tester",
    visibility = true,
    pushes = 0,
    creates = 0,
    fault = null;
  const reviews = [],
    calls = [];
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    if (file === "fixture-gh") {
      if (args[0] === "auth")
        return {
          code: 0,
          stdout: JSON.stringify({
            hosts: {
              "github.com": connected
                ? [
                    {
                      active: true,
                      state: "success",
                      login: account,
                      tokenSource: source,
                    },
                  ]
                : [],
            },
          }),
          stderr: "",
        };
      if (args[0] === "api")
        return {
          code: 0,
          stdout: JSON.stringify({
            id: 123,
            full_name: "tester/project",
            default_branch: "main",
            private: visibility,
            archived: false,
            permissions: { push: true },
          }),
          stderr: "",
        };
      if (args[0] === "pr" && args[1] === "list")
        return { code: 0, stdout: JSON.stringify(reviews), stderr: "" };
      if (args[0] === "pr" && args[1] === "create") {
        creates++;
        reviews.push({ url: "https://github.com/tester/project/pull/1" });
        return { code: 0, stdout: reviews[0].url, stderr: "" };
      }
      throw Error(`Unexpected gh call: ${args}`);
    }
    if (args.includes("push")) {
      pushes++;
      if (fault) throw Error(fault);
    }
    const isTransport = ["push", "fetch", "ls-remote"].some((x) =>
      args.includes(x),
    );
    const safeArgs = args.map((x) =>
      isTransport && x === "https://github.com/tester/project.git" ? remote : x,
    );
    return command(gitPath, safeArgs, {
      ...options,
      env: { ...options?.env, ...env },
    });
  };
  const service = createGitProjects({
    store,
    project: async (id) => {
      assert.equal(id, p.id);
      return p;
    },
    host: {
      async request(route) {
        return route === "/session/status" ? status : [];
      },
    },
    runner,
    resolveExecutable: async (name) =>
      name === "git" ? gitPath : "fixture-gh",
  });
  t.after(async () => {
    await service.close();
    await store.flush();
    await rm(root, { recursive: true, force: true });
  });
  const initialize = () =>
    service.initialize(p.id, {
      name: "Test User",
      email: "test@example.invalid",
      confirm: true,
    });
  const save = async (
    files,
    kind = "checkpoint",
    message = "Test checkpoint",
    actor = { origin: "panel" },
  ) => {
    const plan = await service.preview(p.id, { files, kind, message }, actor);
    return service.execute(p.id, { planID: plan.id, confirm: true }, actor);
  };
  const bind = () =>
    service.bind(p.id, { repository: "tester/project", confirm: true });
  return {
    root,
    directory,
    remote,
    store,
    p,
    service,
    runGit,
    initialize,
    save,
    bind,
    calls,
    write: (file, text) => writeFile(path.join(directory, file), text),
    busy: (value) => {
      status = value;
    },
    credentials: (yes, storage = "keyring") => {
      connected = yes;
      source = storage;
    },
    visibility: (value) => {
      visibility = value;
    },
    account: (value) => {
      account = value;
    },
    fault: (value) => {
      fault = value;
    },
    get pushes() {
      return pushes;
    },
    get creates() {
      return creates;
    },
  };
}

test("agreement is structured, defaults to local-off, and describes every preset", () => {
  const p = projectAgreement();
  assert.equal(p.tracking, false);
  assert.equal(p.github, false);
  assert.match(agreementText(p), /off/);
  for (const preset of ["main", "branch", "review", "confirm", "inspect"])
    assert.ok(
      agreementText(projectAgreement({ tracking: true, github: true, preset }))
        .length > 40,
    );
  assert.throws(() => projectAgreement({ preset: "force-push" }));
  assert.throws(() => projectAgreement({ github: "true" }));
});
test("repository, branch and path inputs never become commands or escape the project", () => {
  assert.equal(
    repositoryName("https://github.com/tester/project.git"),
    "tester/project",
  );
  for (const x of [
    "https://evil.example/x/y",
    "me/repo;whoami",
    "../secret",
    "-x/repo",
  ])
    assert.throws(() => repositoryName(x));
  for (const x of [
    "../file",
    "/etc/passwd",
    "C:\\x",
    ":!private",
    "a\nfile",
    ".git/../x",
  ])
    assert.throws(() => safeRelative(x));
  for (const x of ["--all", "a..b", "x.lock", "refs//evil", "hello world"])
    assert.throws(() => validBranch(x));
});
test("porcelain parsing retains rename identity, partial staging and conflicts", () => {
  const rows = parseGitStatus(
    " M file with spaces.txt\0R  new.txt\0old.txt\0MM partial.txt\0UU conflict.txt\0?? .env\0",
  );
  assert.equal(rows[0].file, "file with spaces.txt");
  assert.equal(rows[1].original, "old.txt");
  assert.equal(rows[2].partial, true);
  assert.equal(rows[3].conflicted, true);
  assert.ok(rows[4].excluded);
});
test("credentials and generated/private paths are excluded even when already tracked", () => {
  for (const p of [
    ".env",
    ".env.production",
    "backend/.state/auth.json",
    "node_modules/x.js",
    "id_rsa",
    "x.key",
  ])
    assert.ok(excludedFile(p));
  assert.equal(excludedFile(".env.example"), null);
  assert.ok(containsCredential("ghp_" + "a".repeat(40)));
  assert.ok(containsCredential("-----BEGIN " + "PRIVATE KEY-----"));
});
test("command environment removes alternate repositories, credentials and debug channels", () => {
  const env = cleanGitEnv({
    PATH: "/bin",
    GIT_DIR: "/private",
    GH_TOKEN: "secret",
    GITHUB_TOKEN: "secret",
    GH_HOST: "evil",
    GIT_TRACE: "1",
    FREELANCER_GIT_BRIDGE: "secret",
  });
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.FREELANCER_GIT_BRIDGE, undefined);
  assert.equal(env.GH_HOST, "github.com");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(installation("git").package, "Git.Git");
  assert.throws(() => installation("arbitrary"));
});
// Each fixture owns an isolated repository and bare remote. Run the real-Git
// scenarios concurrently so process startup on Windows does not dominate the suite.
describe("Git project integration", { concurrency: 4 }, () => {
test("first-time setup uses project-local identity and preserves existing ignore rules", async (t) => {
  const f = await fixture(t);
  await f.write(".gitignore", "keep-me\n");
  await f.write("file.txt", "hello\n");
  await f.initialize();
  const state = await f.service.inspect(f.p.id);
  assert.equal(state.agreement.tracking, true);
  assert.equal(state.local.head, "");
  assert.equal(f.pushes, 0);
  assert.match(
    await readFile(path.join(f.directory, ".gitignore"), "utf8"),
    /^keep-me/,
  );
  assert.equal(await f.runGit("config", "--local", "user.name"), "Test User");
  const r = await f.save([".gitignore", "file.txt"]);
  assert.equal(r.status, "completed");
  assert.match(r.result, /Nothing was uploaded/);
  assert.equal(await f.runGit("status", "--porcelain"), "");
});
test("tracking off keeps .git/history and future-project style never copies credentials", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.save([".gitignore"]);
  const old = await f.service.policy(f.p.id);
  await f.service.updatePolicy(f.p.id, {
    revision: old.revision,
    tracking: false,
    github: false,
    preset: "branch",
    useForNewProjects: true,
  });
  assert.ok(await f.runGit("rev-parse", "HEAD"));
  assert.deepEqual((await f.store.read("settings")).gitDefaults, {
    preset: "branch",
  });
  await assert.rejects(f.save([".gitignore"]), /Turn on/);
});
test("global Git defaults are saved separately from a project's agreement", async (t) => {
  const f = await fixture(t);
  await f.service.updateDefaults({ preset: "confirm" });
  assert.deepEqual((await f.store.read("settings")).gitDefaults, {
    preset: "confirm",
  });
  assert.equal((await f.service.policy("a-new-project")).preset, "confirm");
  assert.equal((await f.service.policy("a-new-project")).tracking, false);
});
test("existing repository identity, branch names and staged files are preserved by setup", async (t) => {
  const f = await fixture(t);
  await f.runGit("init", "-b", "trunk");
  await f.runGit("config", "user.name", "Existing");
  await f.runGit("config", "user.email", "existing@example.invalid");
  await f.write("staged.txt", "important");
  await f.runGit("add", "staged.txt");
  await f.initialize();
  assert.equal((await f.service.policy(f.p.id)).mainBranch, "trunk");
  assert.equal(await f.runGit("config", "user.name"), "Existing");
  assert.match(await f.runGit("status", "--porcelain"), /A  staged.txt/);
});
test("partial staging blocks selected checkpoint without overwriting the index", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.write("a.txt", "a\n");
  await f.save([".gitignore", "a.txt"]);
  await f.write("a.txt", "staged\n");
  await f.runGit("add", "a.txt");
  await f.write("a.txt", "unstaged\n");
  await assert.rejects(f.save(["a.txt"]), /already staged/);
  assert.equal(await f.runGit("show", ":a.txt"), "staged");
});
test("checkpoint only includes selected files and preserves unrelated staging", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.write("a.txt", "a\n");
  await f.write("b.txt", "b\n");
  await f.save([".gitignore", "a.txt", "b.txt"]);
  await f.write("a.txt", "changed a\n");
  await f.write("b.txt", "changed b\n");
  await f.runGit("add", "b.txt");
  assert.equal((await f.save(["a.txt"])).status, "completed");
  assert.equal(await f.runGit("show", "HEAD:b.txt"), "b");
  assert.equal(await f.runGit("show", ":b.txt"), "changed b");
});
test("changed file content and policy revision invalidate a preview", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.write("a.txt", "one");
  const p = await f.service.preview(f.p.id, {
    kind: "checkpoint",
    files: ["a.txt"],
    message: "one",
  });
  await f.write("a.txt", "two");
  await assert.rejects(
    f.service.execute(f.p.id, { planID: p.id, confirm: true }),
    /changed/,
  );
  assert.equal((await f.service.inspect(f.p.id)).local.head, "");
});
test("private material is blocked before checkpoint creation", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.write("innocent.txt", "ghp_" + "x".repeat(40));
  await assert.rejects(f.save(["innocent.txt"]), /Possible credential/);
  assert.equal(f.pushes, 0);
});
test("GitHub binding never uploads or changes an unrelated origin", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.bind();
  assert.equal(f.pushes, 0);
  await f.runGit(
    "remote",
    "set-url",
    "origin",
    "https://github.com/other/project.git",
  );
  await assert.rejects(f.bind(), /points somewhere else/);
  assert.equal(
    await f.runGit("remote", "get-url", "origin"),
    "https://github.com/other/project.git",
  );
});
test("insecure/unknown credential storage cannot be used for publishing", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  for (const source of ["oauth_token", "plaintext", undefined]) {
    f.credentials(true, source);
    if (source === undefined) continue;
    await assert.rejects(f.bind(), /credential store/);
  }
  assert.equal(f.pushes, 0);
});
test("main agreement sync publishes only the verified branch and completed plan is idempotent", async (t) => {
  const f = await fixture(t, "main");
  await f.initialize();
  await f.write("a.txt", "a\n");
  await f.bind();
  const p = await f.service.preview(f.p.id, {
    kind: "sync",
    files: [".gitignore", "a.txt"],
    message: "First checkpoint",
  });
  const result = await f.service.execute(
    f.p.id,
    { planID: p.id, confirm: true },
    { origin: "panel" },
  );
  assert.equal(result.status, "completed", result.result);
  assert.equal(f.pushes, 1);
  assert.equal(f.creates, 0);
  await f.service.execute(f.p.id, { planID: p.id, confirm: true });
  assert.equal(f.pushes, 1);
  assert.equal(
    await f.runGit("--git-dir", f.remote, "rev-parse", "refs/heads/main"),
    await f.runGit("rev-parse", "HEAD"),
  );
});
test("branch/review presets prepare a task before Build and never upload main", async (t) => {
  for (const preset of ["branch", "review"]) {
    const f = await fixture(t, preset);
    await f.initialize();
    await f.save([".gitignore"]);
    await f.bind();
    await f.runGit("push", f.remote, "main");
    const base = await f.runGit("rev-parse", "main");
    await f.service.beforeBuild(f.p.id, "ses_task", {
      mode: "build",
      id: "build",
    });
    f.service.finishDispatch(f.p.id, "ses_task");
    assert.equal(await f.runGit("branch", "--show-current"), "freelancer/task");
    await f.write("task.txt", "task work");
    const result = await f.save(["task.txt"], "sync");
    assert.equal(result.status, "completed", result.result);
    assert.equal(
      await f.runGit("--git-dir", f.remote, "rev-parse", "refs/heads/main"),
      base,
    );
    assert.equal(f.creates, preset === "review" ? 1 : 0);
  }
});
test("confirm preset permits preview but prevents the agent from approving an upload", async (t) => {
  const f = await fixture(t, "confirm");
  await f.initialize();
  await f.save([".gitignore"]);
  await f.bind();
  await f.service.beforeBuild(f.p.id, "ses_task", {
    mode: "build",
    id: "build",
  });
  f.service.finishDispatch(f.p.id, "ses_task");
  await f.write("file.txt", "ok");
  const preview = await f.service.preview(f.p.id, {
    kind: "sync",
    files: ["file.txt"],
    message: "Work",
  });
  await assert.rejects(
    f.service.execute(
      f.p.id,
      { planID: preview.id, confirm: true },
      { origin: "agent" },
    ),
    /requires upload approval/,
  );
  assert.equal(f.pushes, 0);
  assert.equal(
    (
      await f.service.execute(
        f.p.id,
        { planID: preview.id, confirm: true },
        { origin: "panel" },
      )
    ).status,
    "completed",
  );
});
test("inspect-only permits conversation setup but rejects checkpoints and publish", async (t) => {
  const f = await fixture(t, "inspect");
  await f.initialize();
  await f.service.beforeBuild(f.p.id, "ses_task", { mode: "build", id: "build" });
  await assert.rejects(f.save([".gitignore"]), /inspect-only/);
  assert.ok(await f.service.inspect(f.p.id));
});
test("other running chats block branch switches and saves; dirty work is not moved to a different task", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.save([".gitignore"]);
  f.busy({ ses_other: { type: "busy" } });
  await assert.rejects(
    f.service.beforeBuild(f.p.id, "ses_task", { mode: "build", id: "build" }),
    /other chats/,
  );
  f.busy({});
  await f.write("pending.txt", "keep");
  await assert.rejects(
    f.service.beforeBuild(f.p.id, "ses_task", { mode: "build", id: "build" }),
    /Save the current changes/,
  );
});
test("deleted secret in earlier outgoing history still blocks upload", async (t) => {
  const f = await fixture(t, "main");
  await f.initialize();
  await f.save([".gitignore"]);
  await f.bind();
  await f.write("secret.txt", "ghp_" + "x".repeat(40));
  await f.runGit("add", "secret.txt");
  await f.runGit("commit", "-m", "unsafe older history");
  await f.runGit("rm", "secret.txt");
  await f.runGit("commit", "-m", "delete from latest");
  await assert.rejects(f.save([], "sync"), /outgoing history/);
  assert.equal(f.pushes, 0);
});
test("remote failures preserve local checkpoint and never auto-retry", async (t) => {
  const f = await fixture(t, "main");
  await f.initialize();
  await f.bind();
  await f.write("file.txt", "hello");
  f.fault("Simulated network timeout");
  const r = await f.save([".gitignore", "file.txt"], "sync");
  assert.equal(r.status, "needs_attention");
  assert.ok(r.checkpoint);
  assert.equal(f.pushes, 1);
  await assert.rejects(
    f.service.execute(f.p.id, { planID: r.id, confirm: true }),
    /already have run/,
  );
  assert.equal(f.pushes, 1);
});
test("repository account or visibility changes invalidate publishing", async (t) => {
  const f = await fixture(t, "main");
  await f.initialize();
  await f.save([".gitignore"]);
  await f.bind();
  f.visibility(false);
  await assert.rejects(f.save([], "sync"), /visibility changed/);
  assert.equal(f.pushes, 0);
});
test("restart recovery marks unfinished operations for inspection, never replays them", async (t) => {
  const f = await fixture(t);
  await f.store.update("gitOperations", (s) => ({
    ...s,
    records: { old: { id: "old", projectID: f.p.id, status: "running" } },
  }));
  await f.service.recover();
  assert.equal(
    (await f.store.read("gitOperations")).records.old.status,
    "needs_attention",
  );
  assert.equal(f.pushes, 0);
});
test("linked files fail closed and paths with spaces remain supported", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.write("file with spaces.txt", "data");
  assert.equal(
    (await f.save([".gitignore", "file with spaces.txt"])).status,
    "completed",
  );
  if (process.platform !== "win32") {
    await symlink(
      path.join(f.root, "elsewhere"),
      path.join(f.directory, "link"),
    );
    await assert.rejects(f.save(["link"]), /Linked files/);
  }
});

test("new review projects can explicitly upload a starting main version, only to an empty destination", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.save([".gitignore"]);
  await f.bind();
  const p = await f.service.preview(f.p.id, {
    kind: "start",
    files: [],
    message: "Starting version",
  });
  await assert.rejects(
    f.service.execute(
      f.p.id,
      { planID: p.id, confirm: true },
      { origin: "agent" },
    ),
    /first main upload/,
  );
  const result = await f.service.execute(
    f.p.id,
    { planID: p.id, confirm: true },
    { origin: "panel" },
  );
  assert.equal(result.status, "completed", result.result);
  assert.equal(f.pushes, 1);
  await assert.rejects(
    f.service.preview(f.p.id, {
      kind: "start",
      files: [],
      message: "Starting version",
    }),
    /already has a starting/,
  );
});
test("compatible incoming changes fast-forward, while divergent history never gets overwritten", async (t) => {
  const f = await fixture(t, "main");
  await f.initialize();
  await f.bind();
  await f.save([".gitignore"], "sync");
  const peer = path.join(f.root, "peer");
  await f.runGit("clone", f.remote, peer);
  await f.runGit("-C", peer, "config", "user.name", "Peer");
  await f.runGit("-C", peer, "config", "user.email", "peer@example.invalid");
  await writeFile(path.join(peer, "remote.txt"), "incoming");
  await f.runGit("-C", peer, "add", "remote.txt");
  await f.runGit("-C", peer, "commit", "-m", "incoming");
  await f.runGit("-C", peer, "push");
  assert.equal((await f.save([], "download")).status, "completed");
  assert.equal(
    await readFile(path.join(f.directory, "remote.txt"), "utf8"),
    "incoming",
  );
  await f.write("local.txt", "local work");
  await f.save(["local.txt"]);
  await writeFile(path.join(peer, "remote.txt"), "changed incoming");
  await f.runGit("-C", peer, "add", "remote.txt");
  await f.runGit("-C", peer, "commit", "-m", "new incoming");
  await f.runGit("-C", peer, "push");
  await assert.rejects(f.save([], "sync"), /GitHub has changes/);
  await assert.rejects(f.save([], "download"), /Both copies changed/);
  assert.equal(
    await readFile(path.join(f.directory, "local.txt"), "utf8"),
    "local work",
  );
});
test("reservation fences the gap between branch selection and native prompt acceptance", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.save([".gitignore"]);
  await f.service.beforeBuild(f.p.id, "ses_one", {
    mode: "build",
    id: "build",
  });
  await assert.rejects(
    f.service.beforeBuild(f.p.id, "ses_two", { mode: "build", id: "build" }),
    /chat is starting/,
  );
  assert.equal(await f.runGit("branch", "--show-current"), "freelancer/one");
  f.service.finishDispatch(f.p.id, "ses_one");
  await f.service.beforeBuild(f.p.id, "ses_two", {
    mode: "build",
    id: "build",
  });
  assert.equal(await f.runGit("branch", "--show-current"), "freelancer/two");
});
test("selected deletions are checkpointed without touching other files", async (t) => {
  const f = await fixture(t);
  await f.initialize();
  await f.write("remove.txt", "remove me");
  await f.save([".gitignore", "remove.txt"]);
  await rm(path.join(f.directory, "remove.txt"));
  const r = await f.save(["remove.txt"]);
  assert.equal(r.status, "completed", r.result);
  assert.doesNotMatch(
    await f.runGit("ls-tree", "-r", "--name-only", "HEAD"),
    /remove.txt/,
  );
});
test("invalid identity does not partially initialize the project", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.service.initialize(f.p.id, { confirm: true, name: "", email: "" }),
    /Enter the name/,
  );
  assert.equal((await f.service.inspect(f.p.id)).local, null);
});

test("adoption detects an existing main while a task branch is checked out", async (t) => {
  const f = await fixture(t);
  await f.runGit("init", "-b", "trunk");
  await f.runGit("config", "user.name", "Local User");
  await f.runGit("config", "user.email", "local@example.invalid");
  await f.runGit("commit", "--allow-empty", "-m", "Initial");
  await f.runGit("switch", "-c", "feature/current-work");
  await f.initialize();
  const state = await f.service.inspect(f.p.id);
  assert.equal(state.agreement.mainBranch, "trunk");
  assert.equal(state.local.branch, "feature/current-work");
});
test("ambiguous main selection is explicit and changing it never switches or renames", async (t) => {
  const f = await fixture(t);
  await f.runGit("init", "-b", "release");
  await f.runGit("config", "user.name", "Local User");
  await f.runGit("config", "user.email", "local@example.invalid");
  await f.runGit("commit", "--allow-empty", "-m", "Initial");
  await f.runGit("switch", "-c", "feature/task");
  await assert.rejects(f.initialize(), /Choose the main version/);
  assert.equal((await f.service.policy(f.p.id)).tracking, false);
  await f.service.initialize(f.p.id, { confirm: true, mainBranch: "release" });
  const policy = await f.service.policy(f.p.id);
  await f.service.updatePolicy(f.p.id, {
    ...policy,
    mainBranch: "feature/task",
  });
  assert.equal(await f.runGit("branch", "--show-current"), "feature/task");
  const next = await f.service.policy(f.p.id);
  await assert.rejects(
    f.service.updatePolicy(f.p.id, { ...next, mainBranch: "missing" }),
    /Choose the main version/,
  );
});
test("unknown native activity blocks history mutations", async (t) => {
  const f = await fixture(t);
  f.busy({ ses_unknown: { type: "disconnected" } });
  await assert.rejects(f.initialize(), /activity is unknown/);
  assert.equal((await f.service.policy(f.p.id)).tracking, false);
});
test("branch merges fast-forward into main, stay local, and completed plans are idempotent", async (t) => {
  const f = await fixture(t, "main");
  await f.initialize();
  await f.save([".gitignore"]);
  await f.write("a.txt", "a\n");
  await f.save(["a.txt"]);
  await f.runGit("switch", "-c", "feature");
  await f.write("b.txt", "b\n");
  await f.save(["b.txt"]);
  await f.runGit("switch", "main");
  const plan = await f.service.merge(
    f.p.id,
    { branch: "feature" },
    { origin: "panel" },
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.plan.action, "merge");
  assert.equal(plan.plan.branch, "feature");
  assert.equal(plan.plan.stale, false);
  const done = await f.service.merge(
    f.p.id,
    { planID: plan.id, confirm: true },
    { origin: "panel" },
  );
  assert.equal(done.status, "completed");
  assert.match(done.result, /Merged feature into main/);
  assert.equal(
    await f.runGit("rev-parse", "main"),
    await f.runGit("rev-parse", "feature"),
  );
  const again = await f.service.merge(
    f.p.id,
    { planID: plan.id, confirm: true },
    { origin: "panel" },
  );
  assert.equal(again.status, "completed");
  assert.equal(
    await f.runGit("rev-parse", "main"),
    await f.runGit("rev-parse", "feature"),
  );
  await assert.rejects(
    f.service.merge(f.p.id, { branch: "feature" }, { origin: "panel" }),
    /already contained/,
  );
  assert.equal(f.pushes, 0);
  assert.equal(f.creates, 0);
});
test("merge refuses missing setup, self-merge, unknown branches and dirty trees", async (t) => {
  const off = await fixture(t, "main");
  await assert.rejects(
    off.service.merge(off.p.id, { branch: "feature" }, { origin: "panel" }),
    /Turn on project history/,
  );
  const locked = await fixture(t, "inspect");
  await locked.initialize();
  await assert.rejects(
    locked.service.merge(
      locked.p.id,
      { branch: "feature" },
      { origin: "panel" },
    ),
    /inspect-only/,
  );
  const f = await fixture(t, "main");
  await f.initialize();
  await f.save([".gitignore"]);
  await f.write("a.txt", "a\n");
  await f.save(["a.txt"]);
  await assert.rejects(
    f.service.merge(f.p.id, { branch: "main" }, { origin: "panel" }),
    /into itself/,
  );
  await assert.rejects(
    f.service.merge(f.p.id, { branch: "missing" }, { origin: "panel" }),
    /was not found/,
  );
  await f.runGit("switch", "-c", "feature");
  await f.write("b.txt", "b\n");
  await f.save(["b.txt"]);
  await f.runGit("switch", "main");
  const plan = await f.service.merge(
    f.p.id,
    { branch: "feature" },
    { origin: "panel" },
  );
  await f.write("dirty.txt", "uncommitted\n");
  await assert.rejects(
    f.service.merge(
      f.p.id,
      { planID: plan.id, confirm: true },
      { origin: "panel" },
    ),
    /Save or commit the current changes/,
  );
  await rm(path.join(f.directory, "dirty.txt"));
  const done = await f.service.merge(
    f.p.id,
    { planID: plan.id, confirm: true },
    { origin: "panel" },
  );
  assert.equal(done.status, "completed");
  assert.equal(
    await f.runGit("rev-parse", "main"),
    await f.runGit("rev-parse", "feature"),
  );
});
test("divergent branches fail closed and restore the starting branch", async (t) => {
  const f = await fixture(t, "main");
  await f.initialize();
  await f.save([".gitignore"]);
  await f.write("a.txt", "base\n");
  await f.save(["a.txt"]);
  await f.runGit("switch", "-c", "feature");
  await f.write("a.txt", "feature\n");
  await f.save(["a.txt"]);
  await f.runGit("switch", "main");
  await f.write("a.txt", "main\n");
  await f.save(["a.txt"]);
  const before = await f.runGit("rev-parse", "main");
  const featureTip = await f.runGit("rev-parse", "feature");
  await f.runGit("switch", "feature");
  const plan = await f.service.merge(
    f.p.id,
    { branch: "feature" },
    { origin: "panel" },
  );
  await assert.rejects(
    f.service.merge(
      f.p.id,
      { planID: plan.id, confirm: true },
      { origin: "panel" },
    ),
    /Nothing was changed/,
  );
  assert.equal(await f.runGit("branch", "--show-current"), "feature");
  assert.equal(await f.runGit("status", "--porcelain"), "");
  assert.equal(await f.runGit("rev-parse", "main"), before);
  assert.equal(await f.runGit("rev-parse", "feature"), featureTip);
  assert.equal(await f.runGit("show", "main:a.txt"), "main");
  assert.equal(await f.runGit("show", "feature:a.txt"), "feature");
});
test("merge previews go stale when either branch moves and must be rebuilt", async (t) => {
  const f = await fixture(t, "main");
  await f.initialize();
  await f.save([".gitignore"]);
  await f.write("a.txt", "a\n");
  await f.save(["a.txt"]);
  await f.runGit("switch", "-c", "feature");
  await f.write("b.txt", "b\n");
  await f.save(["b.txt"]);
  await f.runGit("switch", "main");
  const mainTip = await f.runGit("rev-parse", "main");
  const plan = await f.service.merge(
    f.p.id,
    { branch: "feature" },
    { origin: "panel" },
  );
  await f.runGit("switch", "feature");
  await f.write("c.txt", "c\n");
  await f.save(["c.txt"]);
  await f.runGit("switch", "main");
  await assert.rejects(
    f.service.merge(
      f.p.id,
      { planID: plan.id, confirm: true },
      { origin: "panel" },
    ),
    /changed since the preview/,
  );
  assert.equal(await f.runGit("rev-parse", "main"), mainTip);
  const fresh = await f.service.merge(
    f.p.id,
    { branch: "feature" },
    { origin: "panel" },
  );
  const done = await f.service.merge(
    f.p.id,
    { planID: fresh.id, confirm: true },
    { origin: "panel" },
  );
  assert.equal(done.status, "completed");
  assert.equal(
    await f.runGit("rev-parse", "main"),
    await f.runGit("rev-parse", "feature"),
  );
});
test("branch preset merges a task branch into the saved main branch", async (t) => {
  const f = await fixture(t, "branch");
  await f.initialize();
  await f.save([".gitignore"]);
  await f.write("a.txt", "a\n");
  await f.save(["a.txt"]);
  await f.runGit("switch", "-c", "work");
  await f.write("w.txt", "w\n");
  await f.save(["w.txt"]);
  await f.runGit("switch", "main");
  const plan = await f.service.merge(
    f.p.id,
    { branch: "work" },
    { origin: "panel" },
  );
  const done = await f.service.merge(
    f.p.id,
    { planID: plan.id, confirm: true },
    { origin: "panel" },
  );
  assert.equal(done.status, "completed");
  assert.equal(
    await f.runGit("rev-parse", "main"),
    await f.runGit("rev-parse", "work"),
  );
  assert.equal(f.pushes, 0);
});


test("chat file status includes staged and untracked files without changing the index", async t => {
  const f = await fixture(t, "main");
  assert.deepEqual(await f.service.changedFiles(f.p.id), []);
  await f.initialize();
  await f.write("visible.txt", "hello");
  await f.write(".env", "EXAMPLE=private");
  await f.runGit("add", "visible.txt");
  const before = await f.runGit("diff", "--cached", "--name-only");
  const rows = await f.service.changedFiles(f.p.id);
  assert.ok(rows.some(row => row.file === "visible.txt"));
  assert.ok(rows.some(row => row.file === ".gitignore"));
  assert.ok(!rows.some(row => row.file === ".env"));
  assert.equal(await f.runGit("diff", "--cached", "--name-only"), before);
});
});

test('initial source can be staged from an exact managed preview without a commit or remote', async t => {
  const f = await fixture(t, 'main');
  await f.initialize();
  await f.write('source.js', 'export const answer = 42;\n');
  const plan = await f.service.preview(f.p.id, { kind: 'checkpoint', files: ['source.js'], message: 'Prepare initial source' });
  await assert.rejects(f.service.stageInitialSource(f.p.id, { planID: plan.id }), /Confirm/);
  const result = await f.service.stageInitialSource(f.p.id, { planID: plan.id, confirm: true });
  assert.deepEqual(result.files, ['source.js']);
  assert.equal(await f.runGit('diff', '--cached', '--name-only'), 'source.js');
  assert.equal(await f.runGit('remote'), '');
  const next = await f.service.preview(f.p.id, { kind: 'checkpoint', files: ['.gitignore'], message: 'Another source preview' });
  await assert.rejects(f.service.stageInitialSource(f.p.id, { planID: next.id, confirm: true }), /empty local repository/);
});

test('initial source staging rejects changed content and secret files', async t => {
  const f = await fixture(t, 'main');
  await f.initialize();
  await f.write('source.js', 'first\n');
  const plan = await f.service.preview(f.p.id, { kind: 'checkpoint', files: ['source.js'], message: 'Prepare source' });
  await f.write('source.js', 'changed\n');
  await assert.rejects(f.service.stageInitialSource(f.p.id, { planID: plan.id, confirm: true }), /changed/);
  assert.equal(await f.runGit('ls-files', '--stage'), '');
  await f.write('secret.txt', 'ghp_' + 'x'.repeat(40));
  await assert.rejects(f.service.preview(f.p.id, { kind: 'checkpoint', files: ['secret.txt'], message: 'Prepare source' }), /credential/);
});
