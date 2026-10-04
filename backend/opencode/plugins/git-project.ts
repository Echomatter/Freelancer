import { tool, type Plugin } from "@opencode-ai/plugin";
import { readStateText as readFile } from '../../tools/runtime/state-database.mjs';
import path from "node:path";
import { pathToFileURL } from "node:url";

const GitProject: Plugin = async ({ client, directory }) => {
  const root = process.env.FREELANCER_RUNTIME_ROOT;
  if (!root) throw new Error("Start this plugin through Freelancer.");
  const { gitToolGuard } = await import(
    pathToFileURL(path.join(root, "tools/runtime/git-guard.mjs")).href
  );
  async function call(body: unknown, signal: AbortSignal) {
    const launch = JSON.parse(
      await readFile(path.join(root!, ".state/webpage/launch.json"), "utf8"),
    );
    const url = new URL(launch.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
      throw new Error("Git actions require the local Freelancer server.");
    const response = await fetch(new URL("/api/git/agent", url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Freelancer-Git-Bridge": process.env.FREELANCER_GIT_BRIDGE || "",
      },
      body: JSON.stringify(body),
      signal,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "Git action was blocked.");
    return value;
  }
  return {
    tool: {
      git_project: tool({
        description:
          "Manage project Git/GitHub through its saved agreement. Inspect state; prepare the agreed working branch when needed; preview an ordinary checkpoint, sync or download, then execute its exact returned id as planID. Merge previews a local branch into agreed main and executes with planID; it uses native permission without a separate question. Request handles an explicit exception: present returned questions unchanged through native question, wait for the recorded approval, then request with planID. Revalidate stale or uncertain operations rather than replaying them. Preserve unrelated work, native permission and content checks; never bypass this service through shell.",
        args: {
          action: tool.schema.enum(["inspect", "preview", "execute", "merge", "request", "prepare"]).describe("inspect reads agreement/state; prepare prepares its working branch. preview requires kind; execute requires planID. merge/request preview without planID and execute with it."),
          reason: tool.schema.string().max(2000).optional().describe("Initial request only: explain the explicit user request and its exception to the agreement."),
          tool: tool.schema.enum(["git", "gh"]).optional().describe("Initial request command, instead of agreement changes. Managed Git history operations or gh repo edit --visibility public|private; account setup stays in the panel."),
          args: tool.schema.array(tool.schema.string()).max(50).optional().describe("Initial request: exact arguments without the executable name, credentials or shell syntax. Supported command/options are validated by the service."),
          agreement: tool.schema.object({ tracking: tool.schema.boolean().optional().describe("Enable local project history."), github: tool.schema.boolean().optional().describe("Enable GitHub sync for the linked project."), preset: tool.schema.enum(["main", "branch", "review", "confirm", "inspect"]).optional().describe("Working agreement: direct main, separate task, prepare review, confirm uploads, or inspect only."), mainBranch: tool.schema.string().optional().describe("Designated local main branch.") }).optional().describe("Initial request: proposed saved agreement changes, instead of tool/args. A one-time command request does not change defaults."),
          kind: tool.schema.enum(["checkpoint", "sync", "download"]).optional().describe("preview only: checkpoint saves selected files locally; sync saves/uploads per agreement; download gets compatible updates on a clean tree."),
          files: tool.schema.array(tool.schema.string()).max(500).optional().describe("preview only: selected project-relative changed paths. checkpoint requires at least one; download uses none. Unrelated staging is preserved."),
          message: tool.schema.string().max(4000).optional().describe("preview only: checkpoint message; defaults to Save project work."),
          planID: tool.schema.string().optional().describe("Exact returned preview id for execute, merge or approved request. Never invent it or substitute a branch name."),
          branch: tool.schema.string().optional().describe("Initial merge only: exact existing local source branch; target comes from the saved mainBranch agreement."),
        },
        async execute(args, context) {
          if (["execute", "prepare"].includes(args.action) || (["merge", "request"].includes(args.action) && args.planID)) {
            await context.ask({
              permission: "git_project",
              patterns: [args.planID || "missing-preview"],
              always: [],
              metadata: {
                description:
                  "Execute the exact Git preview within the project agreement",
                planID: args.planID,
              },
            });
          }
          const result = await call(
            {
              ...args,
              files: args.files ?? [],
              directory,
              sessionID: context.sessionID,
              messageID: context.messageID,
            },
            context.abort,
          );
          return {
            title: result.result || result.summary || "Project history",
            output: JSON.stringify(result, null, 2),
          };
        },
      }),
    },
    "tool.execute.before": async (input, output) => {
      await gitToolGuard({
        toolkitRoot: root,
        directory,
        input,
        args: output.args,
        client,
      });
    },
  };
};
export default GitProject;
