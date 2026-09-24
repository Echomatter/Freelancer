import { useEffect, useRef, useState } from "react";
import { Dialog } from './echoflex/Dialog';
import {
  Github,
  HardDrive,
  CloudUpload,
  GitBranch,
  ShieldCheck,
  Check,
  LoaderCircle,
  RefreshCw,
  ExternalLink,
  History,
  X,
} from "lucide-react";
import { Button, Badge, Empty, Panel } from "./echoflex/Controls";
import { api, query } from "./api";
import { gitPresets, agreementText } from "../domain/git-project.mjs";
import "./git-project.css";

type Props = { project: string; onUseSync: () => void };
export function GitHubProject({ project, onUseSync }: Props) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [destination, setDestination] = useState("");
  const [message, setMessage] = useState("Save project changes"),
    [preset, setPreset] = useState("review");
  const [github, setGithub] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [mainBranch, setMainBranch] = useState("");
  const [confirmation, setConfirmation] = useState<any>(null);
  const inFlight = useRef(false),
    alive = useRef(true),
    version = useRef(0),
    initialized = useRef(false);
  const refresh = async (signal?: AbortSignal) => {
    const revision = ++version.current;
    const next = await api("git?" + query(project), undefined, "GET", signal);
    if (alive.current && revision === version.current) setData(next);
  };
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3500);
    };
    void poll();
    return () => {
      alive.current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [project]);
  useEffect(() => {
    if (!data) return;
    setPreset(data.agreement.preset);
    setGithub(data.agreement.github);
    setMainBranch(data.agreement.mainBranch || data.local?.suggestedMain || "");
  }, [data?.agreement.revision]);
  useEffect(() => {
    if (!data || initialized.current) return;
    initialized.current = true;
    setName(data.local?.identity.name || "");
    setEmail(data.local?.identity.email || "");
    setDestination(data.agreement.repository?.name || data.local?.remote || "");
    setSelected(
      (data.local?.files || [])
        .filter(
          (f) => !f.excluded && !f.partial && !f.original && !f.conflicted,
        )
        .map((f) => f.file),
    );
  }, [data]);
  async function act(action: () => Promise<any>, done?: (r: any) => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (!alive.current) return;
      if (result.status === "needs_attention")
        setError(result.result || "This Git action needs attention. Inspect its recorded result before retrying.");
      else done?.(result);
      if (result.status !== "needs_attention" && (result.message || result.result))
        setNotice(result.message || result.result);
      // Success remains success even if the status refresh fails.
      try {
        await refresh();
      } catch {
        setError(
          "Action finished, but status could not be refreshed. Check again before repeating it.",
        );
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(false);
    }
  }
  function preview(kind: string) {
    const valid = selected.filter((file) =>
      data.local?.files.some((f) => f.file === file && !f.excluded && !f.partial && !f.original && !f.conflicted),
    );
    if (!["download", "start"].includes(kind) && valid.length !== selected.length) {
      setError("The changed-file list was updated. Review the eligible files and choose again.");
      setSelected(valid);
      return;
    }
    void act(
      () =>
        api("git/preview", {
          project,
          kind,
          files: ["download", "start"].includes(kind) ? [] : valid,
          message,
        }),
      (r) => setConfirmation({ kind: "plan", plan: r }),
    );
  }
  const ask = (action: string, title: string, text: string, extra = {}) =>
    setConfirmation({ kind: "setup", action, title, text, ...extra });
  function confirm() {
    if (!confirmation) return;
    const c = confirmation;
    if (c.kind === "plan")
      void act(
        () => api("git/execute", { project, planID: c.plan.id, confirm: true }),
        () => {
          setConfirmation(null);
          setSelected([]);
        },
      );
    else if (c.action === "initialize")
      void act(
        () =>
          api("git/initialize", {
            project,
            name,
            email,
            mainBranch,
            confirm: true,
          }),
        () => {
          initialized.current = false;
          setConfirmation(null);
        },
      );
    else if (c.action === "bind")
      void act(
        () =>
          api("git/bind", { project, repository: destination, confirm: true }),
        () => setConfirmation(null),
      );
    else
      void act(
        () =>
          api("git/setup", {
            project,
            action: c.action,
            tool: c.tool,
            repository: destination,
            confirm: true,
          }),
        () => setConfirmation(null),
      );
  }
  if (!project)
    return (
      <Empty icon={Github} title="Open a project first">
        Git history and GitHub choices belong to the selected project.
      </Empty>
    );
  if (!data)
    return (
      <Empty
        icon={LoaderCircle}
        title="Checking project history…"
        action={
          error ? (
            <Button onClick={() => void act(() => refresh())}>Try again</Button>
          ) : undefined
        }
      >
        {error}
      </Empty>
    );
  const policy = data.agreement,
    repo = policy.repository;
  const changed = data.local?.files || [],
    eligible = changed.filter(
      (f) => !f.excluded && !f.partial && !f.original && !f.conflicted,
    );
  const canMutate =
    policy.tracking && policy.preset !== "inspect" && !data.issue;
  const identityNeedsAttention =
    data.local?.identity.name?.trim().toLowerCase() === "your real name" ||
    data.local?.identity.email?.trim().toLowerCase() === "your-github-email@example.com";
  const branchMismatch = policy.preset === "main" && data.local?.branch &&
    data.local.branch !== policy.mainBranch;
  const jobs = (data.setup || []).filter((j) => j.status === "running");
  const disabled = pending || jobs.length > 0;
  const githubStatus = !data.auth.connected
    ? "Not signed in"
    : repo
      ? "Project linked"
      : "Account connected";
  return (
    <div className="page git-project-page">
      <div className="page-title">
        <div>
          <div className="git-eyebrow">
            <Github size={19} /> THIS PROJECT
          </div>
          <h1>Project history &amp; GitHub</h1>
          <p>
            Git remembers checkpoints on your computer. GitHub keeps the
            checkpoints you choose to upload online.
          </p>
        </div>
        <Button
          aria-label="Refresh Git status"
          disabled={pending}
          onClick={() => void act(() => refresh())}
        >
          <RefreshCw size={17} className={pending ? "spin" : ""} />
        </Button>
      </div>
      {error && !confirmation && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss Git error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {data.issue && (
        <p className="notice error" role="status">
          {data.issue}
        </p>
      )}
      {jobs.map((j) => (
        <div className="git-setup-progress" role="status" key={j.id}>
          <LoaderCircle className="spin" size={21} />
          <div>
            <strong>{j.label}</strong>
            <p>{j.message}</p>
            {j.deviceCode && (
              <p>
                Enter <strong>{j.deviceCode}</strong> on{" "}
                <a
                  href="https://github.com/login/device"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  GitHub’s sign-in page
                </a>
                .
              </p>
            )}
          </div>
          <Button
            onClick={() =>
              void act(() =>
                api("git/setup", { project, action: "cancel", id: j.id }),
              )
            }
          >
            Cancel
          </Button>
        </div>
      ))}
      {(data.setup || [])
        .filter((j) => j.status === "failed" || j.status === "cancelled")
        .slice(-1)
        .map((j) => (
          <p role="status" className="notice error" key={j.id}>
            {j.message}
          </p>
        ))}
      <div className="git-setup-grid">
        <Panel className="git-setup-card">
          <div className="git-card-heading">
            <span>
              <HardDrive size={23} />
            </span>
            <div>
              <small>01 · ON THIS COMPUTER</small>
              <h2>Local project history</h2>
            </div>
            <Badge tone={policy.tracking ? "success" : "neutral"}>
              {policy.tracking ? "On" : "Off"}
            </Badge>
          </div>
          <p>
            Save checkpoints you can return to. Nothing leaves this computer.
          </p>
          {!data.tools.git ? (
            <>
              <p>Git needs to be installed once.</p>
              <Button
                disabled={disabled || !data.windows || !data.tools.winget}
                onClick={() =>
                  ask(
                    "install",
                    "Install Git?",
                    "Windows will install Git for Windows from its package catalog. Its license and system approval may be shown. This does not upload any project.",
                    { tool: "git" },
                  )
                }
              >
                Install Git
              </Button>
              <a
                href="https://git-scm.com/install/windows"
                target="_blank"
                  rel="noreferrer noopener"
              >
                Use the official Windows installer <ExternalLink size={13} />
              </a>
            </>
          ) : !policy.tracking ? (
            <>
              <p>
                {data.local
                  ? "This project already has history. Keep and use its existing setup."
                  : "Set up history for this folder, then review files for your first checkpoint."}
              </p>
              {data.local?.branches?.length > 0 && (
                <label>
                  Main version
                  <select
                    aria-label="Setup main version"
                    value={mainBranch}
                    disabled={disabled}
                    onChange={(e) => setMainBranch(e.target.value)}
                  >
                    <option value="" disabled>
                      Choose the project's main version
                    </option>
                    {data.local.branches.map((b: string) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <small>
                    This names the existing main version; it does not rename or
                    switch a branch.
                  </small>
                </label>
              )}
              {(!data.local?.identity.name || !data.local?.identity.email) && (
                <div className="git-identity">
                  <label>
                    Name on checkpoints
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                    />
                  </label>
                  <label>
                    Email on checkpoints
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Your GitHub private email or work email"
                    />
                  </label>
                  <small>
                    Saved for this project only. These details appear in its
                    history.
                  </small>
                </div>
              )}
              <Button
                variant="primary"
                disabled={disabled || !!data.issue}
                onClick={() =>
                  ask(
                    "initialize",
                    "Turn on project history?",
                    "Use the existing history, or initialize Git in this selected folder. New repositories receive a private-file ignore list. No checkpoint or upload happens until you review the files.",
                  )
                }
              >
                Turn on project history
              </Button>
            </>
          ) : (
            <>
              <p className="git-ready">
                <Check size={17} /> Checkpoints stay on this computer until you
                sync.
              </p>
              <small>
                {data.local?.identity.name} · {data.local?.identity.email}
              </small>
              {identityNeedsAttention && <p className="notice error" role="alert">
                This project still has a placeholder checkpoint identity. Set your name and email before saving new history.
              </p>}
              <Button variant="quiet" disabled={disabled} onClick={() => setEditingIdentity((value) => !value)}>
                {editingIdentity ? "Cancel identity edit" : "Edit checkpoint identity"}
              </Button>
              {editingIdentity && <div className="git-identity">
                <label>Name on checkpoints<input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></label>
                <label>Email on checkpoints<input value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} /></label>
                <Button disabled={disabled || !name.trim() || !email.trim()} onClick={() => void act(
                  () => api("git/identity", { project, name, email }, "PUT"),
                  () => setEditingIdentity(false),
                )}>Save checkpoint identity</Button>
                <small>Saved in this project’s Git configuration only.</small>
              </div>}
              <Button
                variant="quiet"
                disabled={disabled}
                onClick={() =>
                  void act(() =>
                    api(
                      "git/policy",
                      {
                        project,
                        revision: policy.revision,
                        preset: policy.preset,
                        tracking: false,
                        github: false,
                      },
                      "PUT",
                    ),
                  )
                }
              >
                Stop tracking automation
              </Button>
              <small>Existing history and files are kept.</small>
            </>
          )}
        </Panel>
        <Panel className="git-setup-card">
          <div className="git-card-heading">
            <span>
              <Github size={23} />
            </span>
            <div>
              <small>02 · ONLINE WHEN READY</small>
              <h2>GitHub connection</h2>
            </div>
            <Badge tone={data.auth.connected ? "success" : "neutral"}>
              {githubStatus}
            </Badge>
          </div>
          {!data.tools.gh ? (
            <>
              <p>Install GitHub CLI to connect this computer securely.</p>
              <Button
                disabled={disabled || !data.windows || !data.tools.winget}
                onClick={() =>
                  ask(
                    "install",
                    "Install GitHub CLI?",
                    "Windows will install GitHub’s official connection tool. No sign-in or upload is performed by installation.",
                    { tool: "gh" },
                  )
                }
              >
                Install GitHub CLI
              </Button>
              <a
                href="https://cli.github.com/"
                target="_blank"
                  rel="noreferrer noopener"
              >
                Official installation help <ExternalLink size={13} />
              </a>
            </>
          ) : (
            <>
              <p>
                {data.auth.connected
                  ? repo
                    ? `Signed in as ${data.auth.login}. This project is linked to ${repo.name}. Credentials stay in the system credential store.`
                    : `Signed in as ${data.auth.login}. Choose a GitHub project below to link this project. Credentials stay in the system credential store.`
                  : data.auth.message ||
                    "Sign in with your browser. Never paste a token into chat."}
              </p>
              <Button
                disabled={disabled}
                onClick={() =>
                  ask(
                    "login",
                    "Sign in to GitHub?",
                    "GitHub will open its browser sign-in. Review the account and permissions there. This does not upload your files or put tokens in chat.",
                  )
                }
              >
                {data.auth.connected ? "Sign in again" : "Connect GitHub"}
              </Button>
              <a
                href="https://github.com/login/device"
                target="_blank"
                  rel="noreferrer noopener"
              >
                Open GitHub sign-in page <ExternalLink size={13} />
              </a>
              {repo && (
                <div className="git-destination">
                  <a href={repo.url} target="_blank" rel="noreferrer noopener">
                    {repo.name} <ExternalLink size={14} />
                  </a>
                  <Badge>{repo.private ? "Private" : "Public"}</Badge>
                  <small>
                    {policy.github
                      ? "Uploads follow your agreement below."
                      : "Uploads are off."}
                  </small>
                </div>
              )}
              {data.auth.connected && !repo && !policy.tracking && (
                <p className="git-footnote">
                  Turn on local project history below before linking a GitHub
                  project. Building remains independent of GitHub sign-in.
                </p>
              )}
              {data.auth.connected && policy.tracking && !repo && (
                <>
                  <label>
                    GitHub project
                    <input
                      aria-label="GitHub destination"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                      placeholder={`${data.auth.login}/my-project`}
                    />
                  </label>
                  <div className="action-row">
                    <Button
                      disabled={disabled || !destination.trim()}
                      onClick={() =>
                        ask(
                          "bind",
                          "Use this GitHub project?",
                          `Connect ${destination}. Its existing visibility is preserved. Nothing is uploaded. An existing connection to a different project will not be overwritten.`,
                        )
                      }
                    >
                      Connect this project
                    </Button>
                    <Button
                      variant="quiet"
                      disabled={disabled || !destination.trim()}
                      onClick={() =>
                        ask(
                          "create",
                          "Create a private GitHub project?",
                          `Create ${destination} under your signed-in account, with private visibility. No files will be uploaded.`,
                        )
                      }
                    >
                      Create private project
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </Panel>
      </div>
      <Panel className="git-agreement">
        <div className="git-section-heading">
          <ShieldCheck size={22} />
          <div>
            <h2>How should Freelancer handle your work?</h2>
            <p>
              Choose the agreement. The application checks it; changing an
              agent’s instructions cannot grant more access.
            </p>
          </div>
        </div>
        <fieldset disabled={disabled} className="git-presets">
          <legend className="git-sr-only">Working agreement</legend>
          {gitPresets.map((p) => (
            <label key={p.id} className={preset === p.id ? "chosen" : ""}>
              <input
                type="radio"
                name="git-preset"
                value={p.id}
                checked={preset === p.id}
                onChange={() => setPreset(p.id)}
              />
              <span>
                <strong>{p.name}</strong>
                <small>{p.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="git-agreement-options">
          {policy.tracking && data.local?.branches?.length > 0 && (
            <label>
              Main version
              <select
                aria-label="Main version"
                value={mainBranch}
                disabled={disabled}
                onChange={(e) => setMainBranch(e.target.value)}
              >
                <option value="" disabled>
                  Choose the main version
                </option>
                {data.local.branches.map((b: string) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <small>
                Only affects future work. No branch is renamed or switched now.
              </small>
            </label>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={github}
              disabled={disabled || !repo || !policy.tracking}
              onChange={(e) => setGithub(e.target.checked)}
            />
            Allow GitHub sync for this project
          </label>
          <Button
            disabled={disabled}
            onClick={() =>
              void act(() =>
                api(
                  "git/policy",
                  {
                    project,
                    revision: policy.revision,
                    preset,
                    tracking: policy.tracking,
                    github,
                    mainBranch,
                  },
                  "PUT",
                ),
              )
            }
          >
            Save agreement
          </Button>
        </div>
        <div className="git-agreement-summary">
          <small>YOUR SAVED AGREEMENT</small>
          <p>“{agreementText(policy)}”</p>
          <small>
            The main version is{" "}
            <strong>{policy.mainBranch || "determined during setup"}</strong>.
            Turning sync off keeps all existing files and history.
          </small>
        </div>
      </Panel>
      <Panel>
        <div className="git-section-heading">
          <GitBranch size={22} />
          <div>
            <h2>Current work</h2>
            <p>
              {data.local?.branch
                ? `Working on ${data.local.branch}`
                : "No working branch yet"}{" "}
              · {changed.length} changed files
            </p>
          </div>
          <Button variant="quiet" onClick={onUseSync}>
            Ask the Git agent
          </Button>
        </div>
        <div className="git-files" aria-label="Changed files">
          {!changed.length ? (
            <p>
              No file changes to save. Existing checkpoints may still need
              uploading.
            </p>
          ) : (
            <>
              <label className="git-select-all">
                <input
                  type="checkbox"
                  checked={
                    eligible.length > 0 &&
                    eligible.every((f) => selected.includes(f.file))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? eligible.map((f) => f.file) : [],
                    )
                  }
                  disabled={disabled}
                />{" "}
                Select eligible changed files
              </label>
              {changed.map((f) => (
                <label key={f.file}>
                  <input
                    type="checkbox"
                    checked={selected.includes(f.file)}
                    disabled={
                      disabled ||
                      !!f.excluded ||
                      f.partial ||
                      !!f.original ||
                      f.conflicted
                    }
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked
                          ? [...s, f.file]
                          : s.filter((x) => x !== f.file),
                      )
                    }
                  />
                  <span>
                    <strong>{f.file}</strong>
                    <small>
                      {f.excluded ||
                        (f.partial
                          ? "Partly staged — preserve the selection and save manually"
                          : f.original
                            ? "Staged rename — save manually first"
                            : f.conflicted
                              ? "Conflicting edits — review first"
                              : f.status.includes("D")
                                ? "Removed"
                                : f.status === "??"
                                  ? "New file"
                                  : "Changed")}
                    </small>
                  </span>
                </label>
              ))}
            </>
          )}
        </div>
        {changed.some((f) => f.excluded) && <p className="git-footnote">
          Files marked with a reason above are left out of managed checkpoints. Select the source files you want to save.
        </p>}
        {branchMismatch && <p className="notice" role="status">
          This checkout is on {data.local.branch}, while the current agreement syncs {policy.mainBranch}.
          You can save a local checkpoint here; choose a task-branch agreement to sync this branch.
        </p>}
        <label className="git-checkpoint-message">
          Describe this checkpoint
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={4000}
          />
        </label>
        <div className="git-work-actions">
          <Button
            disabled={disabled || !canMutate || !selected.length || identityNeedsAttention}
            onClick={() => preview("checkpoint")}
          >
            <HardDrive size={17} />
            Save checkpoint
          </Button>
          <Button
            variant="quiet"
            disabled={disabled || !canMutate || !policy.github || (identityNeedsAttention && selected.length > 0)}
            onClick={() => preview("download")}
          >
            Get updates
          </Button>
          <Button
            variant="primary"
            disabled={disabled || !canMutate || !policy.github || (identityNeedsAttention && selected.length > 0)}
            onClick={() => preview("sync")}
          >
            <CloudUpload size={18} />
            Sync
          </Button>
        </div>
        {pending && <p className="git-footnote" role="status">Checking this action and its selected files…</p>}
        {policy.github &&
          policy.preset !== "main" &&
          data.local?.branch === policy.mainBranch && (
            <div className="git-first-upload">
              <p>
                New GitHub project? Upload its starting checkpoint before
                preparing task reviews. This is available only while the GitHub
                project is empty.
              </p>
              <Button
                variant="quiet"
                disabled={disabled || !canMutate}
                onClick={() => preview("start")}
              >
                Upload starting version
              </Button>
            </div>
          )}
        <p className="git-footnote">
          Every preview names the exact files and destination. Sync checks
          outgoing history for common credential patterns and Git errors; it
          does not run your project’s test suite.
        </p>
      </Panel>
      <Panel>
        <div className="git-section-heading">
          <History size={21} />
          <div>
            <h2>History &amp; recent actions</h2>
            <p>A local checkpoint is not proof of an upload.</p>
          </div>
        </div>
        <div className="git-operation-list">
          {(data.operations || []).map((op) => (
            <article key={op.id}>
              <span className={`git-operation-dot ${op.status}`} />
              <div>
                <strong>{op.result || op.summary}</strong>
                <small>
                  {op.status === "preview"
                    ? "Preview — nothing has run"
                    : op.status === "completed"
                      ? "Verified completion"
                      : op.status === "running"
                        ? "In progress"
                        : "Needs attention"}{" "}
                  · {op.branch}
                </small>
                {op.reviewURL && (
                  <a href={op.reviewURL} target="_blank" rel="noreferrer noopener">
                    Open review on GitHub <ExternalLink size={12} />
                  </a>
                )}
              </div>
              {op.status === "preview" && (
                <Button
                  variant="quiet"
                  disabled={disabled}
                  onClick={() => setConfirmation({ kind: "plan", plan: op })}
                >
                  Review
                </Button>
              )}
            </article>
          ))}
        </div>
        <details>
          <summary>Recent local checkpoints</summary>
          {(data.local?.history || []).map((h) => (
            <p key={h.id}>
              <strong>{h.title}</strong>{" "}
              <small>
                {h.id} · {h.date.slice(0, 10)}
              </small>
            </p>
          ))}
        </details>
      </Panel>
      <p className="git-footnote">
        {data.limitations} Conflicts, staged renames, large histories and
        unsupported storage stop with guidance rather than destructive recovery.
      </p>
      {confirmation && (
        <Dialog
          className="git-confirm"
          title={confirmation.kind === 'plan' ? 'Review this action' : confirmation.title}
          icon={<ShieldCheck />} priority="confirmation" busy={pending}
          footer={<>
            <Button
              disabled={pending}
              onClick={() => {
                setConfirmation(null);
                setError("");
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" disabled={pending} onClick={confirm}>
              {pending ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  Working…
                </>
              ) : confirmation.kind === "plan" ? (
                "Approve this action"
              ) : (
                "Continue"
              )}
            </Button>
          </>}
          onClose={() => { setConfirmation(null); setError(''); }}
        >
          <p>
            {confirmation.kind === "plan"
              ? confirmation.plan.summary
              : confirmation.text}
          </p>
          {confirmation.kind === "plan" && (
            <>
              <dl>
                <dt>Files to checkpoint</dt>
                <dd>{confirmation.plan.files.length}</dd>
                <dt>Existing checkpoints to upload</dt>
                <dd>{confirmation.plan.existingCheckpoints}</dd>
                <dt>Destination</dt>
                <dd>
                  {confirmation.plan.destination || "This computer only"}{" "}
                  {confirmation.plan.destination &&
                    `· ${confirmation.plan.private ? "Private" : "Public"}`}
                </dd>
              </dl>
              <ul>
                {confirmation.plan.files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
              <p className="git-footnote">
                The app rechecks this exact preview before executing. No
                force-push, automatic merge or branch deletion.
              </p>
            </>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}

        </Dialog>
      )}
    </div>
  );
}
