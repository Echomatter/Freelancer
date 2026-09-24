import { delegatedGitGroup } from "./git-delegation.mjs";
import path from "node:path";
import os from "node:os";
import {
  readFile,
  writeFile,
  lstat,
  realpath,
  readdir,
  mkdir,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { command, executable, installation } from "./git-command.mjs";
import {
  projectAgreement,
  agreementText,
  repositoryName,
  remoteName,
  validBranch,
  safeRelative,
  excludedFile,
  containsCredential,
} from "../domain/git-project.mjs";
import { parseGitStatus } from "../domain/git-project.mjs";
import { senderState } from "../domain/sender.mjs";

const hash = (value) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
const samePath = (a, b) =>
  process.platform === "win32"
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
const maxFile = 5 * 1024 * 1024;
const placeholderIdentity = ({ name, email }) =>
  name?.trim().toLowerCase() === "your real name" ||
  email?.trim().toLowerCase() === "your-github-email@example.com";
const ignoreBlock =
  "\n# Freelancer: private state and generated files\nbackend/.state/\n.state/\n.runtime/\nnode_modules/\ndist/\ntarget/\n.venv/\n.env\n.env.*\n!.env.example\n!.env.sample\n!.env.template\n";
const messageText = (value) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 4000 ||
    value.includes("\0")
  )
    throw Error("Describe this checkpoint in a short sentence.");
  if (containsCredential(value))
    throw Error("Remove credentials from the checkpoint description.");
  return value.trim();
};

/** All mutation paths converge here; UI and native git_project share these operations. */
export function createGitProjects({
  store,
  backendRoot,
  project,
  host,
  runner = command,
  resolveExecutable = executable,
  platform = process.platform,
  now = () => Date.now(),
}) {
  const locks = new Map(),
    jobs = new Map(),
    leases = new Map();
  let setupBusy = false;
  function locked(id, action) {
    if (locks.has(id))
      throw Error("This project already has an action in progress.");
    const task = Promise.resolve().then(action);
    locks.set(id, task);
    task
      .finally(() => {
        if (locks.get(id) === task) locks.delete(id);
      })
      .catch(() => {});
    return task;
  }
  async function policy(id) {
    const s = await store.read("settings");
    return projectAgreement(s.gitProjects?.[id], s.gitDefaults);
  }
  async function git(directory, args, options = {}) {
    const result = await runner(
      await resolveExecutable("git"),
      ["--no-pager", "-c", "core.quotepath=false", ...args],
      { ...options, cwd: directory },
    );
    if (result.code !== 0 && !options.allowFailure) {
      // No raw Git output: remote errors may contain credential-bearing URLs.
      const task = {
        commit: "saving the checkpoint",
        push: "uploading",
        fetch: "checking GitHub",
        "ls-remote": "checking the GitHub copy",
        switch: "changing tasks",
        init: "turning on history",
        merge: "getting updates",
      };
      const verb = args.find((arg) => task[arg]);
      throw Error(
        `Git could not finish ${task[verb] || "the project action"}. Your files were not discarded. Check the project state and its Git permissions.`,
      );
    }
    return result;
  }
  async function gh(args, options = {}) {
    const r = await runner(await resolveExecutable("gh"), args, {
      ...options,
      cwd: os.homedir(),
    });
    if (r.code !== 0 && !options.allowFailure)
      throw Error(
        "GitHub did not accept that action. Check your connection, access and repository rules.",
      );
    return r;
  }
  async function idle(p, actor = {}) {
    if (typeof actor === "string") actor = { sessionID: actor };
    const exceptSession = actor.sessionID;
    const group = await delegatedGitGroup({ host, backendRoot, directory: p.directory, actor });
    if (setupBusy) throw Error("Finish the GitHub setup action first.");
    const status = await host.request("/session/status", {
      directory: p.directory,
    });
    if (!status || typeof status !== "object" || Array.isArray(status))
      throw Error("Chat activity is unavailable. Nothing was changed.");
    if (
      Object.values(status).some(
        (s) => !s || !["idle", "busy", "retry"].includes(s.type),
      )
    )
      throw Error("Chat activity is unknown. Nothing was changed.");
    if (
      Object.entries(status).some(
        ([id, s]) => !group.has(id) && ["busy", "retry"].includes(s.type),
      )
    )
      throw Error(
        "Let the other chats and workers in this project finish before changing its history.",
      );
    const [questions, permissions] = await Promise.all(
      ["/question", "/permission"].map((route) =>
        host.request(route, { directory: p.directory }),
      ),
    );
    if (!Array.isArray(questions) || !Array.isArray(permissions))
      throw Error(
        "Pending chat approvals could not be checked. Nothing was changed.",
      );
    if (
      [...questions, ...permissions].some(
        (row) => row.sessionID !== exceptSession,
      )
    )
      throw Error(
        "Answer the pending project questions or permissions before changing its history.",
      );
    const lease = leases.get(p.id);
    if (lease && !group.has(lease.sessionID)) {
      if (!lease.messageID)
        throw Error(
          "Another project chat is starting. Let it finish before switching work.",
        );
      const messages = await host.request(
        `/session/${encodeURIComponent(lease.sessionID)}/message`,
        { directory: p.directory },
      );
      const observed = senderState(
        {
          messages,
          status,
          permissions,
          questions,
          receipts: [{ id: lease.messageID, status: "accepted" }],
        },
        lease.sessionID,
      );
      if (!observed.ready)
        throw Error(
          "The previous project task has not finished. Its working branch was preserved.",
        );
      leases.delete(p.id);
    }
  }
  async function repository(p, allowMissing = false) {
    const folder = await realpath(p.directory);
    const r = await git(folder, ["rev-parse", "--show-toplevel"], {
      allowFailure: true,
    });
    if (r.code !== 0) {
      const bare = await git(folder, ["rev-parse", "--is-bare-repository"], {
        allowFailure: true,
      });
      if (bare.code === 0 && bare.stdout.trim() === "true")
        throw Error(
          "This is a bare Git repository, not a project working folder. Open a working copy instead.",
        );
      // Do not turn an ownership/configuration error into a fresh repository.
      let cursor = folder;
      for (;;) {
        try {
          await lstat(path.join(cursor, ".git"));
          throw Error(
            "Git cannot read the existing history. Repair its ownership or configuration first.",
          );
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
      if (allowMissing) return null;
      throw Error("Turn on project history first.");
    }
    const top = await realpath(r.stdout.trim());
    if (!samePath(top, folder))
      throw Error(
        "This folder is inside a larger tracked project. Open that project root instead.",
      );
    const common = await git(folder, ["rev-parse", "--git-common-dir"]);
    const gitDirectory = await realpath(
      path.resolve(folder, common.stdout.trim()),
    );
    return { root: top, gitDirectory };
  }
  async function configValue(p, name) {
    return (
      await git(p.directory, ["config", "--get", name], { allowFailure: true })
    ).stdout.trim();
  }
  async function local(p) {
    const identity = {
      name: await configValue(p, "user.name"),
      email: await configValue(p, "user.email"),
    };
    const statusRows = parseGitStatus(
      (
        await git(p.directory, [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ])
      ).stdout,
    );
    const state = [];
    for (let i = 0; i < statusRows.length; i += 32) {
      const rows = await Promise.all(statusRows.slice(i, i + 32).map(async (row) => {
        if (row.excluded || row.status.includes("D")) return row;
        try {
          safeRelative(row.file);
          const info = await lstat(path.join(p.directory, row.file));
          if (!info.isFile()) return { ...row, excluded: "Not a regular file" };
          if (info.size > maxFile)
            return { ...row, size: info.size, excluded: "Over the 5 MB managed checkpoint limit" };
          return { ...row, size: info.size };
        } catch (e) {
          if (e.code === "ENOENT") return row;
          return { ...row, excluded: "Cannot inspect this file safely" };
        }
      }));
      state.push(...rows);
    }
    const branch = (
      await git(p.directory, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
        allowFailure: true,
      })
    ).stdout.trim();
    const head = (
      await git(p.directory, ["rev-parse", "--verify", "HEAD"], {
        allowFailure: true,
      })
    ).stdout.trim();
    const branches = (
      await git(p.directory, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads/",
      ])
    ).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    if (branch && !branches.includes(branch)) branches.push(branch);
    const remoteHead = (
      await git(
        p.directory,
        ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        { allowFailure: true },
      )
    ).stdout
      .trim()
      .replace(/^origin\//, "");
    const conventional = branches.filter((b) =>
      ["main", "master", "trunk"].includes(b),
    );
    const suggestedMain = branches.includes(remoteHead)
      ? remoteHead
      : conventional.length === 1
        ? conventional[0]
        : branches.length === 1
          ? branches[0]
          : "";
    const history = head
      ? (
          await git(p.directory, ["log", "-8", "--format=%h%x00%s%x00%aI"])
        ).stdout
          .trim()
          .split("\n")
          .map((line) => {
            const [id, title, date] = line.split("\0");
            return { id, title, date };
          })
      : [];
    const remote = await git(
      p.directory,
      ["remote", "get-url", "--push", "--all", "origin"],
      { allowFailure: true },
    );
    return {
      branch,
      head,
      identity,
      branches,
      suggestedMain,
      files: state,
      history,
      remote: remoteName(remote.stdout.trim()),
      remotePresent: remote.code === 0,
    };
  }
  async function auth() {
    try {
      const r = await gh(
        ["auth", "status", "--hostname", "github.com", "--json", "hosts"],
        { allowFailure: true },
      );
      const rows = JSON.parse(r.stdout || "{}").hosts?.["github.com"] ?? [];
      const account = rows.find((x) => x.active && x.state === "success");
      // Unknown or plaintext credential storage is not silently treated as secure.
      if (!account)
        return {
          connected: false,
          message: "Sign in to GitHub in your browser.",
        };
      if (account.tokenSource !== "keyring")
        return {
          connected: false,
          login: account.login,
          message:
            "GitHub credentials are not in the system credential store. Repair secure storage and sign in again. Freelancer will not upload with plaintext credentials.",
        };
      return {
        connected: true,
        login: account.login,
        storage: "system credential store",
      };
    } catch {
      return {
        connected: false,
        message:
          "Install GitHub CLI, then sign in. Local project history still works.",
      };
    }
  }
  async function remoteMetadata(name) {
    const account = await auth();
    if (!account.connected) throw Error(account.message);
    const r = JSON.parse(
      (await gh(["api", `repos/${repositoryName(name)}`])).stdout,
    );
    if (
      !r.id ||
      !r.full_name ||
      !r.default_branch ||
      typeof r.private !== "boolean" ||
      r.archived
    )
      throw Error("This GitHub project is unavailable or archived.");
    if (!r.permissions?.push)
      throw Error(
        "Your account cannot upload to this GitHub project. Ask its owner for access.",
      );
    return {
      id: r.id,
      name: repositoryName(r.full_name),
      private: r.private,
      mainBranch: validBranch(r.default_branch),
      account: account.login,
      url: `https://github.com/${repositoryName(r.full_name)}`,
    };
  }
  async function inspect(id) {
    const p = await project(id),
      agreement = await policy(id);
    const tools = {};
    for (const name of [
      "git",
      "gh",
      ...(platform === "win32" ? ["winget"] : []),
    ])
      try {
        await resolveExecutable(name);
        tools[name] = true;
      } catch {
        tools[name] = false;
      }
    let state = null,
      issue = null;
    if (tools.git)
      try {
        const repo = await repository(p, true);
        if (repo) state = { ...(await local(p)), ...repo };
      } catch (e) {
        issue = e.message;
      }
    const operations = Object.values(
      (await store.read("gitOperations")).records,
    )
      .filter((r) => r.projectID === id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12)
      .map(publicOperation);
    return {
      project: p,
      agreement,
      agreementText: agreementText(agreement),
      tools,
      windows: platform === "win32",
      auth: tools.gh ? await auth() : { connected: false },
      local: state,
      issue,
      operations,
      setup: [...jobs.values()]
        .filter((j) => j.projectID === id)
        .map(({ controller, ...j }) => j),
      limitations:
        "Git actions are checked by Freelancer. Other programs and unrestricted shell commands are not an operating-system sandbox.",
    };
  }
  const publicOperation = (r) => {
    const { fingerprint, snapshot, ...visible } = r;
    return visible;
  };
  async function putOperation(r) {
    await store.update("gitOperations", (s) => {
      s.records[r.id] = { ...s.records[r.id], ...r };
      return s;
    });
  }
  async function assertAgreement(p, agreement) {
    const repo = await repository(p);
    if (!agreement.tracking) throw Error("Turn on project history first.");
    if (agreement.preset === "inspect")
      throw Error(
        "This project is inspect-only. Change its agreement in the GitHub panel to save or share work.",
      );
    if (!agreement.root || !samePath(agreement.root, repo.root))
      throw Error(
        "The project location changed. Re-enable tracking for this folder.",
      );
    // Do not mutate repositories already partway through another Git operation.
    for (const name of [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "rebase-merge",
      "rebase-apply",
    ]) {
      const location = (
        await git(p.directory, ["rev-parse", "--git-path", name])
      ).stdout.trim();
      try {
        await lstat(path.resolve(p.directory, location));
        throw Error(
          "This project has an unfinished Git operation. Finish or review it before syncing.",
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return repo;
  }
  async function updatePolicy(id, input) {
    return locked(id, async () => {
      const p = await project(id);
      await idle(p);
      const current = await policy(id);
      if (input.revision !== current.revision)
        throw Error("These settings changed elsewhere. Reload before saving.");
      const next = projectAgreement({
        ...current,
        preset: input.preset,
        tracking: input.tracking,
        github: input.github,
      });
      if (next.tracking) {
        const repo = await repository(p);
        next.root = repo.root;
        const state = await local(p);
        next.mainBranch = chooseMain(
          state,
          input.mainBranch || current.mainBranch,
        );
      }
      if (next.github && !current.repository)
        throw Error("Choose a GitHub project before enabling uploads.");
      next.revision++;
      await store.update("settings", (s) => {
        if ((s.gitProjects?.[id]?.revision ?? 0) !== current.revision)
          throw Error("These settings changed elsewhere.");
        s.gitProjects = { ...s.gitProjects, [id]: next };
        if (input.useForNewProjects === true)
          s.gitDefaults = { preset: next.preset };
        return s;
      });
      return next;
    });
  }
  async function updateDefaults(input) {
    const preset = projectAgreement({ preset: input.preset }).preset;
    return store.update("settings", (s) => ({
      ...s,
      revision: s.revision + 1,
      gitDefaults: { preset },
    }));
  }
  function chooseMain(state, requested) {
    const value = requested || state.suggestedMain;
    if (!value || !state.branches.includes(value))
      throw Error(
        "Choose the main version from this project's existing branches in the GitHub panel.",
      );
    return validBranch(value);
  }
  async function initialize(id, input) {
    return locked(id, async () => {
      const p = await project(id);
      await idle(p);
      if (input.confirm !== true)
        throw Error("Confirm turning on history for this project.");
      const existing = await repository(p, true);
      const prior = await policy(id);
      // Resolve the working agreement before modifying configuration or history.
      const mainBranch = existing
        ? chooseMain(await local(p), input.mainBranch || prior.mainBranch)
        : "main";
      for (const field of ["name", "email"]) {
        if (await configValue(p, `user.${field}`)) continue;
        const value = String(input[field] ?? "").trim();
        if (
          !value ||
          value.length > 200 ||
          /[\r\n\x00]/.test(value) ||
          (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        )
          throw Error(
            `Enter the ${field} to attach to this project's checkpoints.`,
          );
      }
      if (!existing) await git(p.directory, ["init", "-b", "main"]);
      const repo = await repository(p),
        current = await policy(id);
      for (const field of ["name", "email"]) {
        const old = await configValue(p, `user.${field}`);
        if (!old) {
          const value = String(input[field] ?? "").trim();
          if (
            !value ||
            value.length > 200 ||
            /[\r\n\x00]/.test(value) ||
            (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
          )
            throw Error(
              `Enter the ${field} to attach to this project's checkpoints.`,
            );
          await git(p.directory, ["config", "--local", `user.${field}`, value]);
        }
      }
      if (!existing) {
        const target = path.join(p.directory, ".gitignore");
        let previous = "";
        try {
          if ((await lstat(target)).isSymbolicLink())
            throw Error(
              "The ignore file is a link. Review it before setting up history.",
            );
          previous = await readFile(target, "utf8");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        if (
          !previous.includes("# Freelancer: private state and generated files")
        )
          await writeFile(target, previous + ignoreBlock);
      }
      const state = await local(p);
      const next = projectAgreement({
        ...current,
        tracking: true,
        root: repo.root,
        mainBranch,
        revision: current.revision + 1,
      });
      await store.update("settings", (s) => ({
        ...s,
        gitProjects: { ...s.gitProjects, [id]: next },
      }));
      return {
        message: existing
          ? "Using the existing project history. Nothing was uploaded."
          : "Project history is on. Review the files and save your first checkpoint. Nothing was uploaded.",
        agreement: next,
      };
    });
  }
  async function updateIdentity(id, input) {
    return locked(id, async () => {
      const p = await project(id);
      await idle(p);
      await repository(p);
      const name = String(input.name ?? "").trim();
      const email = String(input.email ?? "").trim();
      if (!name || name.length > 200 || /[\r\n\x00]/.test(name) ||
          !email || email.length > 200 || /[\r\n\x00]/.test(email) ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          placeholderIdentity({ name, email }))
        throw Error("Enter a real checkpoint name and email for this project.");
      await git(p.directory, ["config", "--local", "user.name", name]);
      await git(p.directory, ["config", "--local", "user.email", email]);
      return { message: "Checkpoint identity saved for this project only." };
    });
  }
  async function bind(id, input) {
    return locked(id, async () => {
      const p = await project(id);
      await idle(p);
      const current = await policy(id);
      await assertAgreement(p, current);
      if (input.confirm !== true)
        throw Error("Confirm the GitHub destination before connecting.");
      const requested = repositoryName(input.repository),
        info = await remoteMetadata(requested);
      if (info.name.toLowerCase() !== requested.toLowerCase())
        throw Error(
          `GitHub moved this project to ${info.name}. Confirm that exact destination instead.`,
        );
      const state = await local(p);
      const localMain = current.mainBranch;
      if (
        state.branches.includes(info.mainBranch) &&
        localMain !== info.mainBranch
      )
        throw Error(
          `GitHub's main version is ${info.mainBranch}. Choose that main version in this project's agreement before connecting. No branch was renamed.`,
        );
      if (
        state.remotePresent &&
        state.remote?.toLowerCase() !== info.name.toLowerCase()
      )
        throw Error(
          "This project already points somewhere else. Its existing connection was preserved. Review the origin remote before connecting.",
        );
      if (!state.remotePresent)
        await git(p.directory, [
          "remote",
          "add",
          "origin",
          `https://github.com/${info.name}.git`,
        ]);
      const next = {
        ...current,
        github: true,
        repository: info,
        revision: current.revision + 1,
      };
      // Existing local names are never silently renamed to GitHub's default.
      await store.update("settings", (s) => ({
        ...s,
        gitProjects: { ...s.gitProjects, [id]: next },
      }));
      return {
        message: "Connected. No files have been uploaded.",
        repository: info,
      };
    });
  }
  function launchJob(id, label, work) {
    if (setupBusy) throw Error("Another setup action is still running.");
    setupBusy = true;
    const j = {
      id: randomUUID(),
      projectID: id,
      label,
      status: "running",
      message: label,
      controller: new AbortController(),
    };
    jobs.set(j.id, j);
    Promise.resolve()
      .then(() => work(j))
      .then(
        () => {
          j.status = "completed";
          j.message = "Finished. The panel will recheck your setup.";
        },
        (e) => {
          j.status = j.controller.signal.aborted ? "cancelled" : "failed";
          j.message = e.message;
        },
      )
      .finally(() => {
        setupBusy = false;
      });
    return { id: j.id, status: j.status, message: j.message };
  }
  async function setup(id, input) {
    const p = await project(id);
    if (input.action === "cancel") {
      const j = jobs.get(input.id);
      if (!j || j.projectID !== id) throw Error("Setup action not found.");
      j.controller.abort();
      return {
        message:
          "Cancellation requested. An installer may still require closing its Windows window.",
      };
    }
    await idle(p);
    for (const other of (await store.read("settings")).projects.filter(
      (other) => other.id !== id,
    ))
      await idle(other);
    if (input.confirm !== true) throw Error("Confirm this setup action.");
    if (input.action === "install") {
      if (platform !== "win32")
        throw Error(
          "Automatic installation is currently supported on Windows only.",
        );
      const entry = installation(input.tool),
        winget = await resolveExecutable("winget");
      return launchJob(
        id,
        `Installing ${input.tool === "git" ? "Git" : "GitHub CLI"}…`,
        async (j) => {
          const r = await runner(
            winget,
            [
              "install",
              "--id",
              entry.package,
              "-e",
              "--source",
              "winget",
              "--accept-package-agreements",
              "--accept-source-agreements",
            ],
            { timeout: 600000, signal: j.controller.signal },
          );
          if (r.code !== 0)
            throw Error(
              "Windows did not finish installation. Use the official installer or retry after closing its approval window.",
            );
          await resolveExecutable(input.tool);
        },
      );
    }
    if (input.action === "login") {
      const cli = await resolveExecutable("gh");
      return launchJob(
        id,
        "Complete GitHub sign-in in your browser",
        async (j) => {
          let output = "";
          const r = await runner(
            cli,
            [
              "auth",
              "login",
              "--hostname",
              "github.com",
              "--git-protocol",
              "https",
              "--web",
            ],
            {
              timeout: 600000,
              signal: j.controller.signal,
              onOutput: (text) => {
                output = (output + text).slice(-4000);
                const code = output.match(
                  /(?:one.time code|code:)\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i,
                );
                if (code) {
                  j.deviceCode = code[1];
                  j.url = "https://github.com/login/device";
                }
              },
            },
          );
          if (r.code !== 0)
            throw Error(
              "GitHub sign-in was cancelled or failed. Your files were not uploaded.",
            );
          const account = await auth();
          if (!account.connected) throw Error(account.message);
          delete j.deviceCode;
        },
      );
    }
    if (input.action === "create") {
      const full = repositoryName(input.repository),
        account = await auth();
      if (!account.connected) throw Error(account.message);
      if (full.split("/")[0].toLowerCase() !== account.login.toLowerCase())
        throw Error(
          "Create a private project under the signed-in account, or connect an existing organization project.",
        );
      const exists = await gh(["api", `repos/${full}`], { allowFailure: true });
      if (exists.code === 0)
        throw Error("That GitHub project already exists. Connect it instead.");
      // Only confirmed 404 permits creation; an outage is not "not found".
      if (!/HTTP 404/.test(exists.stderr))
        throw Error("Could not check that GitHub name. Nothing was created.");
      await gh(["repo", "create", full, "--private"]);
      return {
        message:
          "Created a private GitHub project. Choose Connect to bind it; no files were uploaded.",
        repository: full,
      };
    }
    throw Error("Unknown setup action.");
  }
  async function fileDigest(p, file) {
    safeRelative(file);
    const pieces = file.split("/");
    let cursor = p.directory;
    for (const part of pieces) {
      cursor = path.join(cursor, part);
      try {
        if ((await lstat(cursor)).isSymbolicLink())
          throw Error(
            "Linked files and folders need manual review before saving.",
          );
      } catch (e) {
        if (e.code === "ENOENT") return { file, deleted: true };
        throw e;
      }
    }
    const info = await lstat(cursor);
    if (!info.isFile()) throw Error(`${file} is not a regular file. Review it separately.`);
    if (info.size > maxFile)
      throw Error(`${file} exceeds the 5 MB managed checkpoint limit. Leave it out of this checkpoint.`);
    const content = await readFile(cursor);
    if (containsCredential(content))
      throw Error(
        `Possible credential in ${file}. Remove it before saving or uploading.`,
      );
    return { file, hash: hash(content), size: content.length };
  }
  async function transport(p, name) {
    // Git URL rewriting or proxy commands must not redirect an approved upload.
    const rewrite = await git(
      p.directory,
      [
        "config",
        "--get-regexp",
        "^(url\..*\.(insteadof|pushinsteadof)|http\..*extraheader)$",
      ],
      { allowFailure: true },
    );
    if (rewrite.code === 0 && rewrite.stdout.trim())
      throw Error(
        "This Git setup rewrites remote addresses or injects HTTP headers. Review it before using managed sync.",
      );
    const cli = (await resolveExecutable("gh")).replaceAll("\\", "/");
    if (/["\n\r`$!]/.test(cli))
      throw Error(
        "The GitHub CLI path cannot safely be used for Git authentication.",
      );
    return {
      url: `https://github.com/${repositoryName(name)}.git`,
      prefix: [
        "-c",
        "credential.helper=",
        "-c",
        `credential.helper=!"${cli}" auth git-credential`,
        "-c",
        "http.followRedirects=false",
      ],
    };
  }
  async function remoteTip(p, tr, branch) {
    validBranch(branch);
    const r = await git(p.directory, [
      ...tr.prefix,
      "ls-remote",
      "--heads",
      tr.url,
      `refs/heads/${branch}`,
    ]);
    if (!r.stdout.trim()) return null;
    const [oid, ref] = r.stdout.trim().split(/\s+/);
    if (!/^[0-9a-f]{40,64}$/.test(oid) || ref !== `refs/heads/${branch}`)
      throw Error("GitHub returned an unexpected branch.");
    return oid;
  }
  async function inspectOutgoing(p, head, remote) {
    if (!head) return { commits: [], count: 0 };
    if (
      (
        await git(p.directory, ["rev-parse", "--is-shallow-repository"])
      ).stdout.trim() === "true"
    )
      throw Error(
        "This working copy has partial history. Fetch its full history before a managed upload.",
      );
    const range = [head, ...(remote ? ["--not", remote] : [])];
    const commits = (await git(p.directory, ["rev-list", ...range])).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    if (commits.length > 300)
      throw Error(
        "This upload contains more than 300 checkpoints. Review/import its history separately first.",
      );
    const objects = (
      await git(p.directory, ["rev-list", "--objects", ...range])
    ).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    if (objects.length > 10000)
      throw Error(
        "This upload is too large to inspect automatically. Review/import it separately first.",
      );
    let bytes = 0;
    for (const entry of objects) {
      const [oid, ...rest] = entry.split(" "),
        file = rest.join(" ");
      if (!/^[a-f0-9]{40,64}$/.test(oid))
        throw Error("Cannot inspect outgoing history.");
      if (file && excludedFile(file))
        throw Error(
          `Outgoing history includes ${file}, even if it was later deleted. Remove private/generated history manually before uploading.`,
        );
      const type = (
        await git(p.directory, ["cat-file", "-t", oid])
      ).stdout.trim();
      if (type !== "blob") continue;
      const size = Number(
        (await git(p.directory, ["cat-file", "-s", oid])).stdout.trim(),
      );
      bytes += size;
      if (!Number.isFinite(size) || size > maxFile || bytes > 30 * 1024 * 1024)
        throw Error(
          "Outgoing history exceeds the safe content-inspection limit. Review it separately.",
        );
      if (
        containsCredential(
          (await git(p.directory, ["cat-file", "blob", oid])).stdout,
        )
      )
        throw Error(
          "A possible credential exists in outgoing history. Removing it from the current file is not enough. Nothing was uploaded.",
        );
    }
    return { commits, count: commits.length };
  }
  async function snapshot(id, input, exceptSession) {
    const p = await project(id),
      agreement = await policy(id);
    await idle(p, exceptSession);
    await assertAgreement(p, agreement);
    const state = await local(p);
    if (!state.branch)
      throw Error(
        "This project is viewing an old checkpoint. Return to a branch before saving.",
      );
    validBranch(state.branch);
    if (state.files.some((f) => f.conflicted))
      throw Error(
        "Some files have conflicting changes. Resolve them before saving or syncing.",
      );
    const files = [...new Set(input.files ?? [])];
    if (!Array.isArray(input.files) || files.length > 500)
      throw Error("Select up to 500 files to save.");
    const fingerprints = [];
    for (const file of files) {
      safeRelative(file);
      const row = state.files.find((f) => f.file === file);
      if (!row)
        throw Error("The selected file list changed. Refresh the preview.");
      if (row.excluded) throw Error(`Do not include ${file}: ${row.excluded}.`);
      if (row.partial)
        throw Error(
          `Part of ${file} is already staged separately. Preserve that selection and checkpoint it manually first.`,
        );
      if (row.original)
        throw Error(
          "A rename is staged. Checkpoint the rename manually to preserve its staging, then sync.",
        );
      fingerprints.push(await fileDigest(p, file));
    }
    if (input.kind === "checkpoint" && !files.length)
      throw Error("Select files to save in this checkpoint.");
    if (!["checkpoint", "sync", "download", "start"].includes(input.kind))
      throw Error("Choose Save checkpoint, Sync or Get updates.");
    if (files.length && (!state.identity.name || !state.identity.email || placeholderIdentity(state.identity)))
      throw Error("Set your checkpoint name and email before saving.");
    let remote = null,
      remoteInfo = null,
      outgoing = { commits: [], count: 0 };
    if (input.kind !== "checkpoint") {
      if (!agreement.github || !agreement.repository)
        throw Error("GitHub uploads are off for this project.");
      remoteInfo = await remoteMetadata(agreement.repository.name);
      if (
        remoteInfo.id !== agreement.repository.id ||
        remoteInfo.name !== agreement.repository.name ||
        remoteInfo.account !== agreement.repository.account ||
        remoteInfo.private !== agreement.repository.private
      )
        throw Error(
          "The account, destination or visibility changed. Reconnect and confirm it before syncing.",
        );
      if (state.remote?.toLowerCase() !== remoteInfo.name.toLowerCase())
        throw Error(
          "The origin connection changed. Reconnect the intended GitHub project.",
        );
      if (agreement.preset === "main" && state.branch !== agreement.mainBranch)
        throw Error(
          "This agreement uploads the main version. Return to that branch or choose a task-branch agreement.",
        );
      if (
        agreement.preset !== "main" &&
        state.branch === agreement.mainBranch &&
        !["download", "start"].includes(input.kind)
      )
        throw Error(
          "Start a task chat first. This agreement leaves the main version unchanged.",
        );
      const tr = await transport(p, remoteInfo.name);
      if (input.kind === "start") {
        if (
          state.branch !== agreement.mainBranch ||
          state.files.length ||
          !state.head ||
          files.length
        )
          throw Error(
            "Save a clean starting checkpoint on the main version before its first upload.",
          );
        const heads = await git(p.directory, [
          ...tr.prefix,
          "ls-remote",
          "--heads",
          tr.url,
        ]);
        if (heads.stdout.trim())
          throw Error(
            "GitHub already has a starting version. Use a task branch and normal Sync.",
          );
      }
      remote = await remoteTip(p, tr, state.branch);
      if (remote) {
        await git(p.directory, [
          ...tr.prefix,
          "fetch",
          "--no-tags",
          "--no-write-fetch-head",
          "--recurse-submodules=no",
          tr.url,
          `refs/heads/${state.branch}`,
        ]);
        if (remote !== (await remoteTip(p, tr, state.branch)))
          throw Error("GitHub changed during the preview. Check again.");
        if (!state.head)
          throw Error(
            "The GitHub project already has history. Clone it into a separate folder rather than combining unrelated histories.",
          );
        const containsRemote =
          (
            await git(
              p.directory,
              ["merge-base", "--is-ancestor", remote, state.head],
              { allowFailure: true },
            )
          ).code === 0;
        if (input.kind === "download") {
          if (state.files.length)
            throw Error("Save all local changes before getting updates.");
          if (
            (
              await git(
                p.directory,
                ["merge-base", "--is-ancestor", state.head, remote],
                { allowFailure: true },
              )
            ).code !== 0
          )
            throw Error(
              "Both copies changed. Review and combine them manually; nothing was overwritten.",
            );
        } else if (!containsRemote)
          throw Error(
            "GitHub has changes you do not have. Save locally, then use Get updates. If both copies changed, review them first.",
          );
      } else if (input.kind === "download")
        throw Error(
          "This task has not been uploaded yet. There are no GitHub updates to download.",
        );
      if (["sync", "start"].includes(input.kind))
        outgoing = await inspectOutgoing(p, state.head, remote);
    }
    const index = (
      await git(p.directory, [
        "diff",
        "--cached",
        "--raw",
        "-z",
        "--no-ext-diff",
      ])
    ).stdout;
    const snapshot = {
      revision: agreement.revision,
      root: agreement.root,
      head: state.head,
      branch: state.branch,
      status: state.files,
      index,
      files: fingerprints,
      remote,
      remoteInfo,
      kind: input.kind,
      message: messageText(input.message || "Save project work"),
      outgoing,
    };
    return { p, agreement, state, snapshot, fingerprint: hash(snapshot) };
  }
  async function preview(id, input, actor = {}) {
    return locked(id, async () => {
      const s = await snapshot(id, input, actor);
      const r = {
        id: randomUUID(),
        projectID: id,
        kind: input.kind,
        files: s.snapshot.files.map((f) => f.file),
        message: s.snapshot.message,
        branch: s.state.branch,
        destination: s.snapshot.remoteInfo?.name ?? null,
        private: s.snapshot.remoteInfo?.private ?? null,
        existingCheckpoints: s.snapshot.outgoing.count,
        createReview: s.agreement.preset === "review" && input.kind === "sync",
        status: "preview",
        createdAt: now(),
        expiresAt: now() + 10 * 60000,
        fingerprint: s.fingerprint,
        snapshot: s.snapshot,
        summary:
          input.kind === "start"
            ? `Upload the initial ${s.state.branch} checkpoint to empty GitHub project ${s.snapshot.remoteInfo.name}. This is an explicit first-time main upload, not a merge.`
            : input.kind === "checkpoint"
              ? `Save ${input.files.length} selected files on this computer. Do not upload.`
              : input.kind === "download"
                ? "Get compatible updates from GitHub without discarding local work."
                : `Save ${input.files.length} selected files and upload ${s.state.branch} to ${s.snapshot.remoteInfo.name}.${s.agreement.preset === "review" ? " Prepare a review request; do not merge." : ""}`,
      };
      await putOperation(r);
      return publicOperation(r);
    });
  }
  async function execute(id, input, actor = {}) {
    return locked(id, async () => {
      const all = (await store.read("gitOperations")).records,
        r = all[input.planID];
      if (!r || r.projectID !== id)
        throw Error("Choose a preview for this project.");
      if (r.status === "completed") return publicOperation(r);
      if (r.status !== "preview")
        throw Error(
          "This action may already have run. Inspect its result before creating a new preview.",
        );
      if (r.expiresAt < now())
        throw Error("The preview expired. Check the changes again.");
      if (input.confirm !== true)
        throw Error("Approve the preview before proceeding.");
      const s = await snapshot(id, r, actor);
      if (r.kind === "start" && actor.origin !== "panel")
        throw Error("Approve the first main upload in the GitHub panel.");
      if (
        s.agreement.preset === "confirm" &&
        r.kind !== "checkpoint" &&
        actor.origin !== "panel"
      )
        throw Error(
          "This agreement requires upload approval in the GitHub panel.",
        );
      if (s.fingerprint !== r.fingerprint)
        throw Error(
          "Files, account, settings or GitHub changed. Refresh the preview; nothing was sent.",
        );
      r.status = "running";
      await putOperation(r); // Durable claim before mutation.
      let checkpoint = null,
        uploaded = false;
      try {
        if (r.files.length) {
          // Native --only commits selected paths and preserves unrelated staging.
          await git(s.p.directory, ["add", "--", ...r.files]);
          await git(s.p.directory, [
            "diff",
            "--cached",
            "--check",
            "--",
            ...r.files,
          ]);
          await git(
            s.p.directory,
            ["commit", "--only", "-m", r.message, "--", ...r.files],
            { timeout: 120000 },
          );
          checkpoint = (await local(s.p)).head;
          r.checkpoint = checkpoint;
          await putOperation(r);
        }
        if (r.kind !== "checkpoint") {
          const info = await remoteMetadata(s.agreement.repository.name);
          if (JSON.stringify(info) !== JSON.stringify(s.snapshot.remoteInfo))
            throw Error(
              "The GitHub account or destination changed after the checkpoint.",
            );
          const tr = await transport(s.p, info.name);
          if ((await remoteTip(s.p, tr, s.state.branch)) !== s.snapshot.remote)
            throw Error(
              "GitHub changed after the checkpoint. Check again before uploading.",
            );
          if (r.kind === "download") {
            await git(s.p.directory, ["merge", "--ff-only", s.snapshot.remote]);
          } else {
            const current = await local(s.p);
            if (!current.head)
              throw Error("Save a first checkpoint before uploading.");
            if (current.branch !== s.state.branch)
              throw Error("The working branch changed. Nothing was uploaded.");
            await inspectOutgoing(s.p, current.head, s.snapshot.remote);
            // Verify whitespace/conflict-marker checks on the actual outgoing tree.
            await git(s.p.directory, [
              "diff",
              "--check",
              ...(s.snapshot.remote
                ? [s.snapshot.remote, current.head]
                : [`${current.head}^!`]),
            ]);
            await git(
              s.p.directory,
              [
                ...tr.prefix,
                "push",
                "--porcelain",
                "--no-follow-tags",
                "--recurse-submodules=no",
                tr.url,
                `${current.head}:refs/heads/${current.branch}`,
              ],
              { timeout: 120000 },
            );
            if ((await remoteTip(s.p, tr, current.branch)) !== current.head)
              throw Error(
                "Upload acknowledgement could not be verified. Check GitHub before trying again.",
              );
            uploaded = true;
            r.uploaded = true;
            await putOperation(r);
            if (r.createReview) {
              const base = info.mainBranch;
              if (base === current.branch)
                throw Error(
                  "The task became GitHub’s main branch. A review request cannot target itself.",
                );
              let prs = JSON.parse(
                (
                  await gh([
                    "pr",
                    "list",
                    "--repo",
                    info.name,
                    "--state",
                    "open",
                    "--head",
                    current.branch,
                    "--base",
                    base,
                    "--json",
                    "url",
                  ])
                ).stdout,
              );
              if (!prs.length) {
                await gh([
                  "pr",
                  "create",
                  "--repo",
                  info.name,
                  "--head",
                  current.branch,
                  "--base",
                  base,
                  "--title",
                  r.message.slice(0, 200),
                  "--body",
                  "Prepared by Freelancer Sync. Review the changes and required checks before merging. No merge was performed.",
                ]);
                prs = JSON.parse(
                  (
                    await gh([
                      "pr",
                      "list",
                      "--repo",
                      info.name,
                      "--state",
                      "open",
                      "--head",
                      current.branch,
                      "--base",
                      base,
                      "--json",
                      "url",
                    ])
                  ).stdout,
                );
              }
              if (
                !prs[0]?.url?.startsWith(
                  `https://github.com/${info.name}/pull/`,
                )
              )
                throw Error(
                  "Upload succeeded, but the review request could not be verified. Check GitHub.",
                );
              r.reviewURL = prs[0].url;
            }
          }
        }
        r.status = "completed";
        r.finishedAt = now();
        r.result =
          r.kind === "checkpoint"
            ? "Saved on this computer. Nothing was uploaded."
            : r.kind === "download"
              ? "Downloaded compatible updates. No local work was discarded."
              : r.kind === "start"
                ? "Starting version uploaded to GitHub. Future tasks follow your saved agreement."
                : `Uploaded to GitHub.${r.createReview ? " Review request prepared. Main was not changed." : s.agreement.preset === "main" ? " Main was updated without rewriting history." : " Main was not changed."}`;
      } catch (error) {
        r.status = "needs_attention";
        r.result = `${checkpoint ? "Checkpoint saved locally. " : ""}${uploaded ? "Upload verified. " : ""}${error.message} Inspect before retrying; completed actions will not be replayed automatically.`;
      }
      await putOperation(r);
      return publicOperation(r);
    });
  }
  // Local source handoff only: stage an exact preview in an empty repository,
  // without making a checkpoint or configuring a remote. Uses the same scanner,
  // agreement, idle checks and fingerprint as every other managed Git mutation.
  async function stageInitialSource(id, input) {
    return locked(id, async () => {
      if (input.confirm !== true) throw Error('Confirm staging the initial source preview.');
      const r = (await store.read('gitOperations')).records[input.planID];
      if (!r || r.projectID !== id || r.kind !== 'checkpoint' || r.status !== 'preview' || r.expiresAt < now())
        throw Error('Choose a current initial-source preview.');
      const s = await snapshot(id, r);
      if (s.state.head || (await git(s.p.directory, ['remote'])).stdout.trim() || (await git(s.p.directory, ['ls-files', '--stage'])).stdout.trim())
        throw Error('Initial source staging requires an empty local repository with no remote or existing index.');
      if (s.fingerprint !== r.fingerprint) throw Error('Source or agreement changed. Refresh the preview before staging.');
      r.status = 'running';
      await putOperation(r);
      try {
        await git(s.p.directory, ['add', '--', ...r.files]);
        const staged = (await git(s.p.directory, ['diff', '--cached', '--name-only', '-z'])).stdout.split('\0').filter(Boolean).sort();
        if (JSON.stringify(staged) !== JSON.stringify([...r.files].sort())) throw Error('Staged source differs from the preview. Inspect the index.');
        r.status = 'completed';
        r.result = `Staged ${staged.length} source files locally. No checkpoint or upload was created.`;
        await putOperation(r);
        return { files: staged, status: r.status, result: r.result };
      } catch (error) {
        r.status = 'needs_attention'; r.result = error.message; await putOperation(r); throw error;
      }
    });
  }
  async function merge(id, input = {}, actor = {}) {
    if (input.planID) {
      const existing = (await store.read("gitOperations")).records[
        input.planID
      ];
      if (existing && existing.kind !== "merge")
        return execute(id, input, actor);
    }
    return locked(id, async () => {
      const p = await project(id),
        agreement = await policy(id);
      if (!agreement.tracking)
        throw Error("Turn on project history before merging branches.");
      if (agreement.preset === "inspect")
        throw Error("This project is inspect-only. Merging is not allowed.");
      await idle(p, actor);
      await assertAgreement(p, agreement);
      const target = agreement.mainBranch;
      const source =
        typeof input.branch === "string" ? input.branch.trim() : "";
      const rev = async (branch) => {
        const r = await git(
          p.directory,
          ["rev-parse", "--verify", `refs/heads/${branch}`],
          { allowFailure: true },
        );
        if (r.code !== 0 || !r.stdout.trim()) return null;
        return r.stdout.trim();
      };
      const contained = async (from, to) =>
        (
          await git(p.directory, ["merge-base", "--is-ancestor", from, to], {
            allowFailure: true,
          })
        ).code === 0;
      if (!input.planID) {
        if (!source) throw Error("Specify the branch to merge.");
        if (source === target)
          throw Error("Cannot merge a branch into itself.");
        const sourceTip = await rev(source);
        if (!sourceTip)
          throw Error(`Branch "${source}" was not found. Nothing was changed.`);
        const targetTip = await rev(target);
        if (!targetTip)
          throw Error(`Branch "${target}" was not found. Nothing was changed.`);
        if (await contained(source, target))
          throw Error(
            `Branch "${source}" is already contained in "${target}". Nothing was changed.`,
          );
        const revision = agreement.revision;
        const fingerprint = hash({
          action: "merge",
          source,
          target,
          sourceTip,
          targetTip,
          revision,
          commits: [],
        });
        const r = {
          id: randomUUID(),
          projectID: id,
          project: id,
          kind: "merge",
          branch: source,
          source,
          target,
          revision,
          status: "ready",
          createdAt: now(),
          expiresAt: now() + 10 * 60000,
          fingerprint,
          snapshot: {
            action: "merge",
            source,
            target,
            sourceTip,
            targetTip,
            revision,
            commits: [],
          },
          summary: `Merge ${source} into ${target} on this computer. Do not upload.`,
        };
        await putOperation(r);
        return {
          id: r.id,
          ok: true,
          plan: {
            action: "merge",
            id: r.id,
            branch: source,
            tip: targetTip,
            base: sourceTip,
            commits: [],
            stale: false,
          },
          record: publicOperation(r),
        };
      }
      const all = (await store.read("gitOperations")).records,
        r = all[input.planID];
      if (!r) throw Error("The preview expired. Check the changes again.");
      if ((r.projectID ?? r.project) !== id)
        throw Error("Choose a preview for this project.");
      if (r.kind !== "merge") throw Error("Choose a preview for this project.");
      if (r.expiresAt < now())
        throw Error("The preview expired. Check the changes again.");
      if (r.status === "completed") return publicOperation(r);
      if (r.status !== "ready" && r.status !== "preview")
        throw Error(
          "This action may already have run. Inspect its result before creating a new preview.",
        );
      if (input.confirm !== true)
        throw Error("Approve the preview before proceeding.");
      const recordSource = r.source ?? r.snapshot?.source,
        recordTarget = r.target ?? r.snapshot?.target;
      if (!recordSource || !recordTarget)
        throw Error("Choose a preview for this project.");
      if (source && source !== recordSource)
        throw Error("Choose a preview for this project.");
      if (recordSource === recordTarget)
        throw Error("Cannot merge a branch into itself.");
      const sourceTip = await rev(recordSource);
      if (!sourceTip)
        throw Error(
          `Branch "${recordSource}" was not found. Nothing was changed.`,
        );
      const targetTip = await rev(recordTarget);
      if (!targetTip)
        throw Error(
          `Branch "${recordTarget}" was not found. Nothing was changed.`,
        );
      if (await contained(recordSource, recordTarget))
        throw Error(
          `Branch "${recordSource}" is already contained in "${recordTarget}". Nothing was changed.`,
        );
      const fresh = await policy(id);
      if (
        hash({
          action: "merge",
          source: recordSource,
          target: recordTarget,
          sourceTip,
          targetTip,
          revision: fresh.revision,
          commits: [],
        }) !== r.fingerprint
      )
        throw Error(
          "The branch changed since the preview. Rebuild the preview. Nothing was changed.",
        );
      if ((await git(p.directory, ["status", "--porcelain"])).stdout.trim())
        throw Error(
          "Save or commit the current changes before merging branches. Nothing was changed.",
        );
      const current = (
        await git(p.directory, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
          allowFailure: true,
        })
      ).stdout.trim();
      if (!current)
        throw Error(
          "Return to a branch before merging branches. Nothing was changed.",
        );
      r.status = "running";
      await putOperation(r); // Durable claim before mutation.
      try {
        if (current !== recordTarget)
          await git(p.directory, ["switch", recordTarget]);
        const m = await git(
          p.directory,
          ["merge", "--no-edit", recordSource],
          { allowFailure: true },
        );
        if (m.code !== 0) {
          const message = (m.stderr || m.stdout || "").trim().split("\n")[0];
          await git(p.directory, ["merge", "--abort"], {
            allowFailure: true,
          });
          if (current !== recordTarget)
            await git(p.directory, ["switch", current]);
          throw Error(
            message
              ? `${message} Nothing was changed.`
              : "The branches could not be merged automatically. Nothing was changed.",
          );
        }
        if (!(await contained(recordSource, recordTarget))) {
          await git(p.directory, ["merge", "--abort"], {
            allowFailure: true,
          });
          if (current !== recordTarget)
            await git(p.directory, ["switch", current]);
          throw Error("Merge did not apply cleanly. Nothing was changed.");
        }
        const tip = await rev(recordTarget);
        r.status = "completed";
        r.completedAt = now();
        r.finishedAt = r.completedAt;
        r.result = `Merged ${recordSource} into ${recordTarget} (${tip}).${/fast-forward/i.test(m.stdout || "") ? " Fast-forward." : ""} Nothing was uploaded.`;
      } catch (error) {
        r.status = "needs_attention";
        r.result = `${error.message} Inspect before retrying; completed actions will not be replayed automatically.`;
        await putOperation(r);
        throw error;
      }
      await putOperation(r);
      return publicOperation(r);
    });
  }
  async function beforeBuild(id, session, workflow) {
    // Inspection and managed Sync work on the checked-out branch. Only an
    // implementation request may prepare/switch a task branch.
    if (workflow?.mode !== "build" || workflow?.id === "sync") return;
    const agreement = await policy(id);
    if (!agreement.tracking) return;
    if (agreement.preset === "inspect") return;
    return locked(id, async () => {
      const p = await project(id);
      await idle(p, session);
      await assertAgreement(p, agreement);
      const state = await local(p);
      if (!state.branch) throw Error("Return to a branch before building.");

      const target =
        agreement.preset === "main"
          ? validBranch(agreement.mainBranch)
          : validBranch(
              agreement.tasks[session] ||
                `freelancer/${session.replace(/^ses_/, "").slice(0, 70)}`,
            );
      if (state.branch !== target) {
        if (state.files.length)
          throw Error(
            "Save the current changes as a local checkpoint in Project history before starting a different task.",
          );
        if (!state.head)
          throw Error(
            "Save your first local checkpoint in Project history before starting a task.",
          );
        const exists = await git(
          p.directory,
          ["show-ref", "--verify", `refs/heads/${target}`],
          { allowFailure: true },
        );
        await git(
          p.directory,
          exists.code === 0
            ? ["switch", target]
            : ["switch", "-c", target, agreement.mainBranch],
        );
      }
      if (agreement.preset !== "main")
        await store.update("settings", (s) => {
          const saved = s.gitProjects[id];
          saved.tasks = { ...saved.tasks, [session]: target };
          return s;
        });
      if (!leases.has(id))
        leases.set(id, { sessionID: session, messageID: null });
    });
  }
  return {
    inspect,
    async changedFiles(id) {
      const p = await project(id);
      if (!await repository(p, true)) return [];
      const result = await git(p.directory, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
      return parseGitStatus(result.stdout).filter(row => !row.excluded).map(row => ({
        file: row.file,
        status: row.conflicted ? "Conflict" : row.status === "??" || row.status.includes("A") ? "New file" : row.status.includes("D") ? "Deleted" : row.status.includes("R") ? "Renamed" : "Modified",
        original: row.original,
      }));
    },
    policy,
    initialize,
    updateIdentity,
    updatePolicy,
    updateDefaults,
    bind,
    setup,
    preview,
    execute,
    stageInitialSource,
    merge,
    beforeBuild,
    finishDispatch(id, session, messageID) {
      const lease = leases.get(id);
      if (!lease || lease.sessionID !== session) return;
      if (messageID) lease.messageID = messageID;
      else if (!lease.messageID) leases.delete(id);
    },
    async recover() {
      await store.update("gitOperations", (s) => {
        for (const r of Object.values(s.records))
          if (r.status === "running") {
            r.status = "needs_attention";
            r.result =
              "The application restarted during this action. Check local history and GitHub before retrying; no action was replayed.";
          }
        return s;
      });
    },
    async close() {
      for (const j of jobs.values())
        if (j.status === "running") j.controller.abort();
      await Promise.allSettled([...locks.values()]);
    },
  };
}
