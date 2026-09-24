import { tool, type Plugin } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
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
          "Application-owned Git/GitHub: inspect the saved agreement, preview selected files, and execute that exact plan. Any named agent or workflow may use this tool; the saved project agreement and explicit user intent determine what is allowed. Merging a branch into the main version is allowed only through this tool with an explicit user request and confirmation; no raw shell commands, account setup, force-push or policy changes. Confirm-only uploads must be approved in the GitHub panel.",
        args: {
          action: tool.schema.enum(["inspect", "preview", "execute", "merge"]),
          kind: tool.schema.enum(["checkpoint", "sync", "download"]).optional(),
          files: tool.schema.array(tool.schema.string()).max(500).optional(),
          message: tool.schema.string().max(4000).optional(),
          planID: tool.schema.string().optional(),
          branch: tool.schema.string().optional(),
        },
        async execute(args, context) {
          if (args.action === "execute" || (args.action === "merge" && args.planID)) {
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
