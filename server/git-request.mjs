// Explicit requests outside the saved defaults still use a durable, exact plan.
// No shell, model-supplied approval flag, or agent identity grants consent.
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { containsCredential, projectAgreement, safeRelative } from "../domain/git-project.mjs";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function createGitRequests({ store, project, policy, idle, repository, local, git, gh, transport, remoteMetadata, inspectOutgoing, updatePolicy, now }) {
  const put = record => store.update("gitOperations", s => {
    s.records[record.id] = record;
    return s;
  });
  async function state(id, network = false) {
    const p = await project(id), agreement = await policy(id), status = await local(p);
    const repo = await repository(p);
    if (agreement.root && path.resolve(agreement.root).toLowerCase() !== path.resolve(repo.root).toLowerCase()) throw Error("The project location changed. Reconnect this folder first.");
    const refs = (await git(p.directory, ["show-ref"], { allowFailure: true })).stdout;
    const diff = (await git(p.directory, ["diff", "HEAD", "--binary"], { allowFailure: true })).stdout;
    const worktrees = (await git(p.directory, ["worktree", "list", "--porcelain"])).stdout;
    let remote = null;
    if (network && agreement.repository) {
      const tr = await transport(p, agreement.repository.name);
      remote = (await git(p.directory, [...tr.prefix, "ls-remote", "--heads", tr.url])).stdout;
    }
    return { p, agreement, status, worktrees, fingerprint: hash({ agreement, refs, diff, remote, worktrees, files: status.files }) };
  }
  function command(input) {
    const args = input.args;
    if (!Array.isArray(args) || !args.length || args.length > 50 || args.some(a => typeof a !== "string" || a.length > 1000 || /[\x00-\x1f]/.test(a) || containsCredential(a)))
      throw Error("Provide a short Git argument list without credentials or control characters.");
    if (input.tool === "git" && args.length === 3 && args[0] === "worktree" && args[1] === "detach") return { tool: "git", args: [...args] };
    // Repository/configuration escapes and arbitrary executable hooks are never
    // agreement preferences. Native credentials remain outside the tool inputs.
    if (args.some(a => /^(?:-C|-x|-f$|--(?:git-dir|work-tree|exec-path|config-env|upload-pack|receive-pack|exec|recurse-submodules|force)(?:=|$))/.test(a)))
      throw Error("Use project-local arguments; unrestricted force and executable overrides are not supported. Use --force-with-lease for an explicitly requested rewrite.");
    if (input.tool === "gh") {
      if (args.length !== 4 || args[0] !== "repo" || args[1] !== "edit" || args[2] !== "--visibility" || !["public", "private"].includes(args[3]))
        throw Error("Managed GitHub requests support repo edit --visibility public|private. Account setup remains in the panel.");
    } else if (input.tool !== "git" || !["branch", "switch", "merge", "fetch", "push", "rebase", "reset", "restore", "tag"].includes(args[0])) {
      throw Error("Choose a managed project Git history command or agreement change.");
    }
    if (input.tool === "git") {
      const flags = {
        branch: ["-d", "-D", "-m", "--set-upstream-to", "--unset-upstream"],
        switch: ["-c", "--detach"], merge: ["--ff-only", "--no-edit", "--abort", "--continue", "--allow-unrelated-histories", "--strategy", "-m"],
        fetch: ["--prune", "--tags"], push: ["--delete", "--force-with-lease", "--set-upstream", "-u"],
        rebase: ["--onto", "--abort", "--continue", "--skip"], reset: ["--soft", "--mixed", "--hard"],
        restore: ["--source", "--staged", "--worktree", "--"], tag: ["-d", "-a", "-m"],
      };
      for (const arg of args.slice(1)) {
        if (arg.startsWith("--strategy") && arg !== "--strategy=ours") throw Error("Only the explicit history-preserving ours strategy is supported.");
        if (arg.startsWith("-") && !flags[args[0]].includes(arg.split("=")[0])) throw Error(`Unsupported managed ${args[0]} option: ${arg}`);
        if (arg.includes("\\") || /^[A-Za-z]:/.test(arg)) throw Error("Use repository-relative targets.");
      }
      if (args[0] === "restore") for (const arg of args.slice(args.indexOf("--") + 1)) {
        if (args.indexOf("--") < 0) throw Error("Separate restore paths with --.");
        safeRelative(arg);
      }
    }
    if (["push", "fetch"].includes(args[0]) && (args[1] !== "origin" || args.slice(2).some(a => /:\/\/|@.*:/.test(a))))
      throw Error("Network requests must use origin, bound to this project's verified GitHub repository.");
    return { tool: input.tool, args: [...args] };
  }
  return {
    async preview(id, input, actor = {}) {
      const network = input.tool === "gh" || ["push", "fetch"].includes(input.args?.[0]);
      const s = await state(id, network);
      await idle(s.p, actor);
      const reason = String(input.reason ?? "").trim();
      if (!reason || reason.length > 2000 || containsCredential(reason)) throw Error("Describe the explicit user request and why it differs from the agreement.");
      let operation;
      if (input.agreement) {
        const next = projectAgreement({ ...s.agreement, ...Object.fromEntries(["tracking", "github", "preset", "mainBranch"].filter(k => k in input.agreement).map(k => [k, input.agreement[k]])) });
        operation = { agreement: { tracking: next.tracking, github: next.github, preset: next.preset, mainBranch: next.mainBranch } };
      } else operation = command(input);
      const record = { id: randomUUID(), project: id, kind: "request", status: "preview", createdAt: now(), expiresAt: now() + 600000, sessionID: actor.sessionID ?? null, fingerprint: s.fingerprint, operation, reason };
      record.summary = operation.agreement
        ? `Change the saved agreement for ${s.p.name}: ${JSON.stringify(operation.agreement)}.`
        : `Run ${operation.tool} ${operation.args.join(" ")} in ${s.p.directory}.`;
      if (actor.origin !== "panel") {
        const messages = await input.readMessages();
        record.userMessageID = messages.findLast(m => m.info?.role === "user")?.info.id;
        if (!record.userMessageID) throw Error("A current user request is required.");
      }
      record.questions = [{ header: "Git request", question: `${record.summary}\n${reason}\nApprove this exact request? (${record.id})`, options: [{ label: "Approve", description: "Apply this request, including the stated exception to the saved agreement." }, { label: "Cancel", description: "Keep the project unchanged." }] }];
      await put(record);
      const { fingerprint, ...result } = record;
      return result;
    },
    async execute(id, input, actor = {}) {
      const r = structuredClone((await store.read("gitOperations")).records[input.planID]);
      if (!r || r.project !== id || r.kind !== "request" || r.sessionID !== (actor.sessionID ?? null)) throw Error("Choose this conversation's exact request preview.");
      if (r.status === "completed") { const { fingerprint, ...result } = r; return result; }
      if (r.status !== "preview" || r.expiresAt < now()) throw Error("This request expired or may already have run. Inspect before making a new preview.");
      if (input.confirm !== true) throw Error("Approve the exact request first.");
      if (actor.origin !== "panel") {
        // Approval is read from native question history, not from model arguments.
        const messages = await input.readMessages();
        if (messages.findLast(m => m.info?.role === "user")?.info.id !== r.userMessageID) throw Error("The user request changed. Make a new preview.");
        const answer = messages.flatMap(m => m.parts ?? []).findLast(p => p.type === "tool" && p.tool === "question" && p.state?.status === "completed" && hash(p.state.input?.questions) === hash(r.questions) && (p.state.time?.end ?? 0) >= r.createdAt);
        const approved = JSON.stringify(answer?.state.metadata?.answers) === JSON.stringify([["Approve"]]);
        if (!approved) throw Error("Ask the native question using this preview's questions unchanged, then execute after the user approves.");
      }
      const s = await state(id, r.operation.tool === "gh" || ["push", "fetch"].includes(r.operation.args?.[0]));
      await idle(s.p, actor);
      if (s.fingerprint !== r.fingerprint) throw Error("The repository or agreement changed. Make a fresh request preview.");
      r.status = "running";
      await put(r);
      try {
        const op = r.operation;
        if (op.agreement) {
          await updatePolicy(id, { ...op.agreement, revision: s.agreement.revision }, actor);
        } else if (op.tool === "gh") {
          const binding = s.agreement.repository;
          if (!binding) throw Error("Link a GitHub repository before changing visibility.");
          const info = await remoteMetadata(binding.name);
          if (info.id !== binding.id || info.account !== binding.account) throw Error("The GitHub repository identity changed. Reconnect first.");
          await gh([...op.args.slice(0, 2), binding.name, ...op.args.slice(2), "--accept-visibility-change-consequences"]);
          const updated = await remoteMetadata(binding.name);
          if (updated.private !== (op.args[3] === "private")) throw Error("GitHub visibility could not be verified.");
          await store.update("settings", settings => { settings.gitProjects[id].repository = updated; settings.gitProjects[id].revision++; return settings; });
        } else {
          let args = op.args;
          if (args[0] === "worktree") {
            const directory = path.resolve(args[2]);
            const registered = s.worktrees.split("\n").filter(line => line.startsWith("worktree ")).map(line => path.resolve(line.slice(9)));
            if (!registered.includes(directory) || directory === path.resolve(s.p.directory)) throw Error("Choose another registered worktree of this repository.");
            if ((await git(directory, ["status", "--porcelain"])).stdout.trim()) throw Error("Preserve the worktree's pending changes before detaching its branch.");
            const result = await git(directory, ["switch", "--detach"]);
            r.output = result.stdout.slice(0, 12000);
            args = null;
          }
          if (args && ["push", "fetch"].includes(args[0])) {
            const binding = s.agreement.repository;
            if (!binding) throw Error("Link a GitHub repository first.");
            const info = await remoteMetadata(binding.name);
            if (info.id !== binding.id || info.account !== binding.account || info.private !== binding.private) throw Error("The GitHub destination changed. Reconnect first.");
            const tr = await transport(s.p, binding.name);
            if (args[0] === "push" && !args.includes("--delete")) {
              // Inspect all local heads that could be published by this request.
              const refs = (await git(s.p.directory, ["for-each-ref", "--format=%(objectname)", "refs/heads", "refs/tags"])).stdout.trim().split(/\s+/).filter(Boolean);
              for (const tip of new Set(refs)) {
                const remoteTip = (await git(s.p.directory, [...tr.prefix, "ls-remote", "--heads", tr.url, `refs/heads/${binding.mainBranch}`])).stdout.trim().split(/\s+/)[0];
                const base = remoteTip && (await git(s.p.directory, ["merge-base", "--is-ancestor", remoteTip, tip], { allowFailure: true })).code === 0 ? remoteTip : null;
                await inspectOutgoing(s.p, tip, base);
              }
            }
            args = [...tr.prefix, args[0], tr.url, ...args.slice(2)];
          }
          if (args) {
            const result = await git(s.p.directory, args);
            r.output = result.stdout.slice(0, 12000);
          }
        }
        r.status = "completed";
        r.result = `${r.summary} Completed. Verify the resulting repository state before reporting the requested outcome.`;
        r.completedAt = now();
      } catch (error) {
        r.status = "needs_attention";
        r.result = `${error.message} Inspect the current state before retrying; this request will not be replayed.`;
        await put(r);
        throw error;
      }
      await put(r);
      const { fingerprint, ...result } = r;
      return result;
    },
  };
}
